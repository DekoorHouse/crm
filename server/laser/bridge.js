const net = require('net');
const EventEmitter = require('events');

class MeerK40tBridge extends EventEmitter {
    constructor(host = '127.0.0.1', port = 2323) {
        super();
        this.host = host;
        this.port = port;
        this.socket = null;
        this.connected = false;
        this.buffer = '';
        this._reconnectTimer = null;
    }

    connect() {
        if (this.socket) {
            this.socket.destroy();
        }

        this.socket = new net.Socket();
        this.socket.setEncoding('utf8');

        this.socket.connect(this.port, this.host, () => {
            this.connected = true;
            this.emit('connected');
            console.log(`[laser-bridge] Conectado a MeerK40t en ${this.host}:${this.port}`);
        });

        this.socket.on('data', (data) => {
            this.buffer += data;
            const lines = this.buffer.split('\n');
            // Keep incomplete last line in buffer
            this.buffer = lines.pop() || '';
            for (const line of lines) {
                const clean = line.replace(/\r/g, '').trim();
                if (clean) {
                    this.emit('output', clean);
                }
            }
        });

        this.socket.on('close', () => {
            const wasConnected = this.connected;
            this.connected = false;
            if (wasConnected) {
                console.log('[laser-bridge] Desconectado de MeerK40t');
                this.emit('disconnected');
            }
            this._scheduleReconnect();
        });

        this.socket.on('error', (err) => {
            this.connected = false;
            if (err.code !== 'ECONNREFUSED') {
                console.error('[laser-bridge] Error TCP:', err.message);
            }
        });
    }

    _scheduleReconnect() {
        if (this._reconnectTimer) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect();
        }, 5000);
    }

    send(command) {
        if (!this.connected || !this.socket) {
            return false;
        }
        this.socket.write(command + '\n');
        return true;
    }

    disconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }
}

// Singleton instance — only active when MEERK40T_ENABLED=true or running locally
const bridge = new MeerK40tBridge(
    process.env.MEERK40T_HOST || '127.0.0.1',
    parseInt(process.env.MEERK40T_PORT || '2323', 10)
);

// Override connect() to no-op in production unless explicitly enabled
const originalConnect = bridge.connect.bind(bridge);
bridge.connect = function() {
    if (process.env.RENDER && !process.env.MEERK40T_ENABLED) {
        console.log('[laser-bridge] Deshabilitado en producción (set MEERK40T_ENABLED=true para activar)');
        return;
    }
    originalConnect();
};

module.exports = bridge;
