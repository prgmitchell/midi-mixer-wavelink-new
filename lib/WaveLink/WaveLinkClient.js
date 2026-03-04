const AppClient = require('./AppClient');
const EventEmitter = require('events');

// Ensure constants are loaded (globals)
require('./WaveLinkConstants');

module.exports = class WaveLinkClient extends AppClient {
    static instance;

    constructor() {
        // Wave Link 3.x publishes its active RPC port in ws-info.json
        super(1884);

        if (WaveLinkClient.instance)
            return WaveLinkClient.instance;

        WaveLinkClient.instance = this;
    }

    init(system) {
        this.debug('Init WLC (Wave Link 3.x)...');

        this.UP_MAC = system == 'mac' ? true : false;
        this.UP_WINDOWS = system == 'windows' ? true : false;

        this.maxTries = 10;
        this.counterTries = 0;

        this.isConnected = false;

        this.event = new EventEmitter();
        this.onEvent = this.event.on;
        this.emitEvent = this.event.emit;

        // State (Wave Link 3.x)
        this.mixes = [];
        this.channels = [];

        // Notifications: connection + state updates
        this.on(kJSONPropertyAppConnected, [], () => {
            this.isConnected = true;
            this.emitEvent(kJSONPropertyAppConnected);
            this.fetchAll();
        });

        this.on(kJSONPropertyAppDisconnected, [], () => {
            this.isConnected = false;
            this.emitEvent(kJSONPropertyAppDisconnected);
        });

        this.on(kJSONPropertyMixesChanged, [], () => {
            this.getMixes();
        });

        this.on(kJSONPropertyMixChanged, [], () => {
            this.getMixes();
        });

        this.on(kJSONPropertyChannelsChanged, [], () => {
            this.getChannels();
        });

        this.on(kJSONPropertyChannelChanged, [], () => {
            this.getChannels();
        });

        this.onConnection(() => {
            this.isConnected = true;
            this.emitEvent('connected');
            this.fetchAll();
        });

        this.onEvent('webSocketIsDisconnected', () => {
            this.isConnected = false;
            this.emitEvent('disconnected');
        });
    }

    fetchAll() {
        // We can call these without params on Wave Link 3.x
        this.getMixes();
        this.getChannels();
    }

    getMixes() {
        return this.rpc.call(kJSONPropertyGetMixes).then((result) => {
            const mixes = (result && result[kJSONKeyMixes]) ? result[kJSONKeyMixes] : result;
            this.mixes = Array.isArray(mixes) ? mixes : [];
            this.emitEvent('mixesUpdated');
            this.emitEvent('stateChanged');
        });
    }

    getChannels() {
        return this.rpc.call(kJSONPropertyGetChannels).then((result) => {
            const channels = (result && result[kJSONKeyChannels]) ? result[kJSONKeyChannels] : result;
            this.channels = Array.isArray(channels) ? channels : [];
            this.emitEvent('channelsUpdated');
            this.emitEvent('stateChanged');
        });
    }

    setMixLevel(mixId, level) {
        if (!mixId) return;
        const clamped = Math.max(0, Math.min(1, level));
        return this.rpc.call(kJSONPropertySetMix, { [kJSONKeyId]: mixId, [kJSONKeyLevel]: clamped });
    }

    setMixMute(mixId, muted) {
        if (!mixId) return;
        return this.rpc.call(kJSONPropertySetMix, { [kJSONKeyId]: mixId, [kJSONKeyIsMuted]: Boolean(muted) });
    }

    setChannelLevel(channelId, level) {
        if (!channelId) return;
        const clamped = Math.max(0, Math.min(1, level));
        return this.rpc.call(kJSONPropertySetChannel, { [kJSONKeyId]: channelId, [kJSONKeyLevel]: clamped });
    }

    setChannelMute(channelId, muted) {
        if (!channelId) return;
        return this.rpc.call(kJSONPropertySetChannel, { [kJSONKeyId]: channelId, [kJSONKeyIsMuted]: Boolean(muted) });
    }

    setChannelMixLevel(channelId, mixId, level) {
        if (!channelId || !mixId) return;
        const clamped = Math.max(0, Math.min(1, level));
        return this.rpc.call(kJSONPropertySetChannel, {
            [kJSONKeyId]: channelId,
            mixes: [{ [kJSONKeyId]: mixId, [kJSONKeyLevel]: clamped }]
        });
    }

    setChannelMixMute(channelId, mixId, muted) {
        if (!channelId || !mixId) return;
        return this.rpc.call(kJSONPropertySetChannel, {
            [kJSONKeyId]: channelId,
            mixes: [{ [kJSONKeyId]: mixId, [kJSONKeyIsMuted]: Boolean(muted) }]
        });
    }

    debug(...args) {
        // console.log(...args);
    }
};
