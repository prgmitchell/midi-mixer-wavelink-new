// Include plugin requirements
const { Assignment } = require("midi-mixer-plugin");
const WaveLinkClient = require("./WaveLink/WaveLinkClient");

module.exports = class Controller {
    assignments = new Map();
    lastLocalChange = new Map();

    isConnected = false;
    reconnectionTimeout = 0;

    constructor() {
        this.WaveLink = new WaveLinkClient();
        this.setupEvents();
        this.initWaveLink();
    }

    setupEvents() {
        this.WaveLink.onConnection(this.connected.bind(this));
        this.WaveLink.onEvent('webSocketIsDisconnected', this.disconnected.bind(this));
        this.WaveLink.onEvent('disconnected', this.disconnected.bind(this));

        // Rebuild assignments whenever Wave Link state updates
        this.WaveLink.onEvent('stateChanged', this.stateChanged.bind(this));
    }

    connected() {
        this.isConnected = true;
        clearTimeout(this.reconnectionTimeout);

        try {
            $MM.setSettingsStatus('connectionStatus', 'Connected');
        } catch { }

        this.rebuildAssignments();
    }

    disconnected() {
        if (!this.isConnected) {
            // Avoid spamming settings if we're already disconnected
        }
        this.isConnected = false;

        try {
            $MM.setSettingsStatus('connectionStatus', 'Reconnecting');
        } catch { }

        this.tryConnect();
    }

    tryConnect() {
        // Reset counter and start scanning ports again
        this.WaveLink.connectionTryCounter = 0;
        this.WaveLink.reconnect();

        // Try again after one minute
        clearTimeout(this.reconnectionTimeout);
        this.reconnectionTimeout = setTimeout(this.tryConnect.bind(this), 60 * 1000);
    }

    initWaveLink() {
        this.WaveLink.init();
        try {
            $MM.setSettingsStatus('connectionStatus', 'Connecting');
        } catch { }
        this.tryConnect();
    }

    stateChanged() {
        this.rebuildAssignments();
    }

    shouldSkipUpdate(key) {
        const last = this.lastLocalChange.get(key) || 0;
        // Prevent momentary bounce while Wave Link catches up to our own writes
        return (Date.now() - last) < 300;
    }

    rebuildAssignments() {
        const mixes = Array.isArray(this.WaveLink.mixes) ? this.WaveLink.mixes : [];
        const channels = Array.isArray(this.WaveLink.channels) ? this.WaveLink.channels : [];

        // Settings panel (best-effort; keep existing keys for backwards compatibility)
        try {
            $MM.setSettingsStatus('outputDevicesCount', mixes.length);
        } catch { }

        const mixNameById = new Map();
        mixes.forEach((m) => {
            if (m && m.id) {
                mixNameById.set(m.id, m.name || m.id);
            }
        });

        const desired = new Set();

        // Mix master faders
        mixes.forEach((mix) => {
            if (!mix || !mix.id) return;
            const key = `mix:${mix.id}`;
            desired.add(key);
            this.upsertMixAssignment(key, mix);
        });

        // Channel-in-mix faders
        channels.forEach((ch) => {
            if (!ch || !ch.id) return;
            const chMixes = Array.isArray(ch.mixes) ? ch.mixes : [];
            chMixes.forEach((mixEntry) => {
                const mixId = mixEntry && mixEntry.id;
                if (!mixId) return;
                const key = `chmix:${ch.id}:${mixId}`;
                desired.add(key);
                this.upsertChannelMixAssignment(key, ch, mixId, mixEntry, mixNameById.get(mixId) || mixId);
            });
        });

        // Remove deleted assignments
        for (const [key, assignment] of this.assignments) {
            if (!desired.has(key)) {
                try {
                    assignment.remove();
                } catch { }
                this.assignments.delete(key);
                this.lastLocalChange.delete(key);
            }
        }
    }

    upsertMixAssignment(key, mix) {
        const mixId = mix.id;
        const name = `Wave Link: ${mix.name || mixId}`;
        const level = (typeof mix.level === 'number') ? mix.level : 0;
        const muted = Boolean(mix.isMuted);

        let assignment = this.assignments.get(key);
        if (!assignment) {
            assignment = new Assignment(`wavelink.mix.${mixId}`, {
                name,
                muted,
                volume: level,
            });
            assignment.throttle = 50;

            assignment.on('volumeChanged', (lvl) => {
                assignment.volume = lvl;
                this.lastLocalChange.set(key, Date.now());
                this.WaveLink.setMixLevel(mixId, lvl);
            });

            assignment.on('mutePressed', () => {
                this.lastLocalChange.set(key, Date.now());
                this.WaveLink.setMixMute(mixId, !assignment.muted);
            });

            this.assignments.set(key, assignment);
            return;
        }

        assignment.name = name;
        if (!this.shouldSkipUpdate(key)) {
            assignment.volume = level;
            assignment.muted = muted;
        }
    }

    upsertChannelMixAssignment(key, channel, mixId, mixEntry, mixName) {
        const channelId = channel.id;
        const channelName = channel.name || channelId;

        const name = `Wave Link: ${channelName} (${mixName})`;
        const level = (mixEntry && typeof mixEntry.level === 'number') ? mixEntry.level : 0;
        const muted = Boolean(mixEntry && mixEntry.isMuted);

        let assignment = this.assignments.get(key);
        if (!assignment) {
            assignment = new Assignment(`wavelink.channel.${channelId}.mix.${mixId}`, {
                name,
                muted,
                volume: level,
            });
            assignment.throttle = 50;

            assignment.on('volumeChanged', (lvl) => {
                assignment.volume = lvl;
                this.lastLocalChange.set(key, Date.now());
                this.WaveLink.setChannelMixLevel(channelId, mixId, lvl);
            });

            assignment.on('mutePressed', () => {
                this.lastLocalChange.set(key, Date.now());
                this.WaveLink.setChannelMixMute(channelId, mixId, !assignment.muted);
            });

            this.assignments.set(key, assignment);
            return;
        }

        assignment.name = name;
        if (!this.shouldSkipUpdate(key)) {
            assignment.volume = level;
            assignment.muted = muted;
        }
    }
};
