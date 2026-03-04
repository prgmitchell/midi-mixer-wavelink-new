/**
 * @class StreamDeck
 * StreamDeck object containing all required code to establish
 * communication with SD-Software and the Property Inspector
 */

const EventEmitter = require('events');
const simple_jsonrpc = require('./SimpleJSONRPC');
const WebSocket = require('ws');
const SocketErrors = require('./SocketErrors');
const fs = require('fs');
const path = require('path');

const EE = new EventEmitter();

 module.exports = class AppClient {
    static instance;
      
    minPort;
    maxPort;
    currentPort;
    websocket;

    rpc = new simple_jsonrpc();

    stopReconnecting = false;

    maxConnectionTries = 20;
    connectionTryCounter = 0;

    debugMode = true;

    onEvent = EE.on;
	emitEvent = EE.emit;

    on = this.rpc.on;
    call = this.rpc.call;

    constructor(minPort) {
        if (AppClient.instance)
            return AppClient.instance;

        AppClient.instance = this;

        this.setPort(minPort);
    }
    
    setPort(minPort) {
        this.debug("setPort", minPort)
        this.currentPort = minPort;
        this.minPort = minPort;
        this.maxPort = minPort + 9;
    }

    connect() {
        this.debug("connect")
        this.refreshPortFromWsInfo();
        if (!this.currentPort) {
            this.emitEvent("webSocketIsDisconnected");
            return;
        }

        this.stopReconnecting = false;

        setTimeout(() => this.tryToConnect(), 250);
    }

    tryToConnect() {
        // Wave Link 3.x expects an Origin header similar to Stream Deck.
        this.websocket = new WebSocket('ws://127.0.0.1:' + this.currentPort, {
            headers: {
                Origin: 'streamdeck://'
            }
        });

        this.websocket.rpc = this.rpc;

        this.websocket.onopen = () => {
            this.connectionTryCounter = 0;
            this.emitEvent("webSocketIsOpen");

            // Set the on close event once the connection has opened
            this.websocket.onclose = () => {
                console.warn('Socket disconnected');
                this.connectionTryCounter = 0;
                this.emitEvent("webSocketIsDisconnected");
            }
        };
        
        this.websocket.onerror = (evt) => {
            const error = `APP WEBOCKET ERROR: ${evt}, ${evt.data}, ${SocketErrors[evt?.code]}`;
            console.warn(error);
            setTimeout(() => this.reconnect(), 200);
        };

        this.websocket.onmessage = (evt) => {
            if (typeof evt.data === 'string') {
                this.debug("Incoming Message", JSON.parse(evt.data));
            } else {
                this.debug("Incoming Message", typeof evt.data, evt.data);
            }
            this.rpc.messageHandler(evt.data);
        };
    }

    reconnect() { 
        if (this.connectionTryCounter < this.maxConnectionTries && !this.stopReconnecting) {
            this.connectionTryCounter++;
            this.connect();
        }
    }

    getWsInfoPath() {
        const appData = process.env.APPDATA;
        if (!appData) return null;
        return path.join(
            appData,
            '..',
            'Local',
            'Packages',
            'Elgato.WaveLink_g54w8ztgkx496',
            'LocalState',
            'ws-info.json'
        );
    }

    refreshPortFromWsInfo() {
        try {
            const wsInfoPath = this.getWsInfoPath();
            if (!wsInfoPath) {
                this.currentPort = null;
                return;
            }

            const json = fs.readFileSync(wsInfoPath, 'utf-8');
            const info = JSON.parse(json);
            const port = Number(info && info.port);
            if (!Number.isFinite(port) || port <= 0 || port > 65535) {
                this.currentPort = null;
                return;
            }

            this.currentPort = Math.trunc(port);
            this.minPort = this.currentPort;
            this.maxPort = this.currentPort;
        } catch (error) {
            this.currentPort = null;
            this.debug('Failed to read ws-info.json', error);
        }
    }

    disconnect() {
        if (this.websocket) {
            this.stopReconnecting = true;
            this.websocket.close();
            this.websocket = null;
            this.emitEvent("webSocketIsClosed");
        }
    }

    initRPC() {
        this.rpc.toStream = (msg) => {
            try {
                this.debug("Sending: " + msg);
                this.websocket.send(msg);
            } catch (error) {
                this.debug("ERROR:", error);
            }
        };
    }

    onConnection(fn) {
        this.initRPC();
        this.onEvent("webSocketIsOpen", () => fn());
    }

    onDisconnection(fn) {
        this.initRPC();
        this.onEvent("webSocketIsClosed", () => fn());
    }

    debug(...args) {
        // if (this.debugMode) console.log(...args);
    }
}
