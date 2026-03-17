/**
 * M2 Nano USB Driver
 * Protocolo basado en K40 Whisperer / M2 Nano EGV format.
 *
 * La controladora M2 Nano usa el chip CH341 (VID 0x1A86).
 * REQUIERE driver WinUSB instalado con Zadig (no el CH341SER.sys por defecto).
 * Ver: https://zadig.akeo.ie/ → seleccionar CH341 → WinUSB
 */

const usb = require('usb');

// VID/PID conocidos de M2 Nano con chip CH341
const DEVICES = [
    { vid: 0x1A86, pid: 0x5512, name: 'M2 Nano' },
    { vid: 0x1A86, pid: 0x5523, name: 'M2 Nano (variante)' },
];

const EP_OUT       = 0x02;   // Bulk OUT → máquina
const EP_IN        = 0x82;   // Bulk IN  ← máquina
const PKT_SIZE     = 34;     // Tamaño de paquete USB (34 bytes, formato K40-Whisperer — confirmado por diagnóstico)
const CMD_PKT_SIZE = 32;     // Tamaño de paquete de comando (sin CRC)
const DATA_SIZE    = 30;     // Bytes de datos por paquete (payload)
const PKT_FRAME    = 0xA6;   // Byte de framing (header y footer del paquete EGV)
const CMD_STATUS   = 0xA0;   // Comando de solicitud de estado
const RESP_SIZE    = 6;      // Tamaño de respuesta de estado

// Resolución del M2 Nano: 1000 DPI → 39.37 pasos/mm
const STEPS_PER_MM = 39.37;

class M2Nano {
    constructor(onLog) {
        this.device    = null;
        this.iface     = null;
        this.epOut     = null;
        this.epIn      = null;
        this.log       = onLog || console.log;
        this._posX     = 0;
        this._posY     = 0;
    }

    /** Busca y abre el dispositivo USB. Retorna Promise (async por el init CH341). */
    async connect() {
        let found = null;
        for (const d of DEVICES) {
            const dev = usb.findByIds(d.vid, d.pid);
            if (dev) { found = { dev, name: d.name }; break; }
        }

        if (!found) {
            throw new Error(
                'M2 Nano no encontrado.\n' +
                '→ Verifica la conexión USB.\n' +
                '→ En Windows instala el driver WinUSB con Zadig (https://zadig.akeo.ie/).'
            );
        }

        this.log(`Dispositivo encontrado: ${found.name}`);
        this.device = found.dev;
        this.device.open();

        // SET_CONFIGURATION — activa los endpoints USB.
        // pyusb (K40 Whisperer, MeerK40t) llama set_configuration() obligatoriamente.
        // node-usb NO lo hace automáticamente. Sin esto el CH341 puede ignorar
        // bulk transfers aunque los ACK a nivel USB.
        try {
            await new Promise((resolve, reject) => {
                this.device.setConfiguration(1, err => err ? reject(err) : resolve());
            });
            this.log('USB setConfiguration(1) OK.');
        } catch (e) {
            // En Windows con WinUSB puede fallar si ya está configurado — eso es OK.
            this.log(`setConfiguration aviso: ${e.message} (continuando...)`);
        }

        this.iface = this.device.interface(0);

        // En Linux/Mac puede necesitar liberar el driver del kernel
        try {
            if (this.iface.isKernelDriverActive()) {
                this.iface.detachKernelDriver();
            }
        } catch (_) {}

        this.iface.claim();

        this.epOut = this.iface.endpoints.find(e => e.direction === 'out');
        this.epIn  = this.iface.endpoints.find(e => e.direction === 'in');

        if (!this.epOut || !this.epIn) {
            this.disconnect();
            throw new Error('Endpoints USB no encontrados en el dispositivo.');
        }

        this.log(`Puerto USB abierto y reclamado. EP_OUT=0x${this.epOut.address.toString(16)} EP_IN=0x${this.epIn.address.toString(16)} type=${this.epOut.transferType} maxPkt=${this.epOut.descriptor.wMaxPacketSize}`);

        // Inicializar CH341 en modo EPP (K40 Whisperer hace esto con pyusb).
        // Sin este controlTransfer el CH341 no enruta los bulk writes 0xA6 al puerto
        // paralelo EPP — los datos EGV nunca llegan a la placa aunque los USB ACK pasen.
        // Esto cambia el status de 0xCE (estado interno CH341) a 0xCF (estado real M3 Nano).
        try {
            await new Promise((resolve, reject) => {
                this.device.controlTransfer(0x40, 0xA1, 0, 0, Buffer.alloc(0), err => err ? reject(err) : resolve());
            });
            this.log('CH341 init EPP (0xA1) OK.');
        } catch (e) {
            this.log(`CH341 init aviso: ${e.message} (continuando...)`);
        }

        // ── Diagnóstico: probar múltiples formatos de paquete ──
        await this._diagTestFormats();
    }

    /**
     * Prueba diagnóstica: envía "unlock rail" (IS2P) en 3 formatos distintos
     * y reporta cuál hace que la placa cambie de estado.
     */
    async _diagTestFormats() {
        this.log('─── DIAGNÓSTICO: probando formatos de paquete ───');

        // Leer status inicial
        const s0 = await this._readStatusByte();
        this.log(`DIAG status inicial: 0x${s0.toString(16)}`);

        // Datos de prueba: IS2P (unlock rail, como K40-Whisperer)
        const payload = Buffer.from('IS2P', 'ascii');

        // ── Formato A: MeerK40t (actual) → [0x00][payload+pad][CRC] = 32 bytes ──
        {
            const pkt = Buffer.alloc(32, 0x46);
            pkt[0] = 0x00;
            payload.copy(pkt, 1);
            pkt[31] = crc8(pkt.subarray(1, 31));
            await this._rawTransfer(pkt, 'FMT-A (MeerK40t 32B)');
            await sleep(50);
            const s = await this._readStatusByte();
            this.log(`DIAG FMT-A status después: 0x${s.toString(16)} ${s !== s0 ? '← CAMBIÓ!' : '(sin cambio)'}`);
        }

        await sleep(100);

        // ── Formato B: K40-Whisperer → [0xA6][0x00][payload+pad][0xA6][CRC] = 34 bytes ──
        {
            const pkt = Buffer.alloc(34, 0x46);
            pkt[0] = 0xA6;
            pkt[1] = 0x00;
            payload.copy(pkt, 2);
            pkt[32] = 0xA6;
            pkt[33] = crc8(pkt.subarray(2, 32));
            await this._rawTransfer(pkt, 'FMT-B (K40W 34B)');
            await sleep(50);
            const s = await this._readStatusByte();
            this.log(`DIAG FMT-B status después: 0x${s.toString(16)} ${s !== s0 ? '← CAMBIÓ!' : '(sin cambio)'}`);
        }

        await sleep(100);

        // ── Formato C: Híbrido → [0xA6][0x00][payload+pad(28B)][CRC] = 32 bytes ──
        {
            const pkt = Buffer.alloc(32, 0x46);
            pkt[0] = 0xA6;
            pkt[1] = 0x00;
            payload.copy(pkt, 2);
            pkt[31] = crc8(pkt.subarray(2, 31));
            await this._rawTransfer(pkt, 'FMT-C (A6+28B=32)');
            await sleep(50);
            const s = await this._readStatusByte();
            this.log(`DIAG FMT-C status después: 0x${s.toString(16)} ${s !== s0 ? '← CAMBIÓ!' : '(sin cambio)'}`);
        }

        await sleep(100);

        // ── Formato D: Solo payload raw → [payload+pad] = 30 bytes (sin header ni CRC) ──
        {
            const pkt = Buffer.alloc(30, 0x46);
            payload.copy(pkt, 0);
            await this._rawTransfer(pkt, 'FMT-D (raw 30B)');
            await sleep(50);
            const s = await this._readStatusByte();
            this.log(`DIAG FMT-D status después: 0x${s.toString(16)} ${s !== s0 ? '← CAMBIÓ!' : '(sin cambio)'}`);
        }

        this.log('─── FIN DIAGNÓSTICO ───');

        // Enviar unlock_rail (IS2P) como hace K40-Whisperer al inicializar
        this.log('Enviando unlock_rail (IS2P)...');
        await this.sendEGV('IS2P');
        await sleep(50);
        const sUnlock = await this._readStatusByte();
        this.log(`unlock_rail status: 0x${sUnlock.toString(16).padStart(2,'0')}`);
    }

    /** Lee un byte de status rápidamente. Retorna -1 si falla. */
    async _readStatusByte() {
        try {
            await this.sendPacket(Buffer.from([CMD_STATUS]));
            const resp = await this.readStatus(300);
            return resp[1];
        } catch (_) {
            return -1;
        }
    }

    /** Libera el dispositivo USB. */
    disconnect() {
        try { if (this.iface) this.iface.release(true, () => {}); } catch (_) {}
        try { if (this.device) this.device.close(); } catch (_) {}
        this.device = null;
        this.iface  = null;
        this.epOut  = null;
        this.epIn   = null;
    }

    // ───────── Comunicación de bajo nivel ─────────

    /**
     * Envía un buffer raw por USB y retorna el resultado.
     * @param {Buffer} pkt  buffer completo a enviar
     * @param {string} label  etiqueta para logs
     */
    _rawTransfer(pkt, label = 'PKT') {
        return new Promise((resolve, reject) => {
            const hex = Array.from(pkt).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.log(`${label} TX [${pkt.length}B]: ${hex}`);
            this.epOut.transfer(pkt, err => {
                if (err) {
                    this.log(`${label} ERROR: ${err.message}`);
                    reject(err);
                } else {
                    this.log(`${label} TX OK (${pkt.length} bytes)`);
                    resolve();
                }
            });
        });
    }

    /**
     * Envía un paquete de datos EGV de 34 bytes (formato K40-Whisperer, confirmado por diagnóstico FMT-B).
     * Formato: [0xA6][0x00][payload (30 bytes)][0xA6][CRC-8]
     */
    sendPacket(data, logFirst = false) {
        return new Promise((resolve, reject) => {
            const pkt = Buffer.alloc(PKT_SIZE, 0);  // 34 bytes
            pkt[0] = PKT_FRAME;                       // 0xA6
            pkt[1] = 0x00;
            pkt.fill(0x46, 2, 32);                    // Padding 'F' en payload
            const src = Buffer.isBuffer(data) ? data : Buffer.from(data, 'ascii');
            src.copy(pkt, 2, 0, Math.min(src.length, DATA_SIZE));  // Payload en bytes 2-31
            pkt[32] = PKT_FRAME;                      // 0xA6
            pkt[33] = crc8(pkt.subarray(2, 32));     // CRC sobre 30 bytes de payload

            if (logFirst) {
                const hex = Array.from(pkt).map(b => b.toString(16).padStart(2, '0')).join(' ');
                this.log(`PKT[0]: ${hex}`);
            }

            this.epOut.transfer(pkt, err => {
                if (err) {
                    this.log(`PKT WRITE ERROR: ${err.message}`);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Envía un paquete de comando (status, reset, etc.) de 32 bytes.
     * Formato: [cmd][0x00...0x00]
     * NO usa framing 0xA6 — el primer byte es el comando directamente.
     */
    sendCommand(cmd) {
        return new Promise((resolve, reject) => {
            const pkt = Buffer.alloc(CMD_PKT_SIZE, 0);
            pkt[0] = cmd;  // Comando directo (ej: 0xA0 para status)

            this.epOut.transfer(pkt, err => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /** Lee la respuesta de estado (6 bytes) con timeout. */
    readStatus(timeout = 500) {
        return Promise.race([
            new Promise((resolve, reject) => {
                this.epIn.transfer(RESP_SIZE, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('USB read timeout')), timeout)
            ),
        ]);
    }

    /**
     * Envía "say_hello" (status query) como lo hace K40-Whisperer:
     * el byte 0xA0 se envía DENTRO de un paquete 34B con framing 0xA6,
     * para que llegue a la placa M2 Nano por EPP (no se quede en el CH341).
     */
    async sayHello() {
        await this.sendPacket(Buffer.from([CMD_STATUS]));  // 0xA0 envuelto en paquete EGV
        return this.readStatus(500);
    }

    /** Espera a que la máquina esté lista. */
    async waitReady(timeout = 6000, readTimeout = 500) {
        const deadline = Date.now() + timeout;
        let lastStatus = -1;
        while (Date.now() < deadline) {
            try {
                // K40-Whisperer envía 0xA0 dentro de un paquete 34B (via EPP al board),
                // NO como comando raw del CH341. Así la placa recibe el "hello".
                await this.sendPacket(Buffer.from([CMD_STATUS]));
                const resp = await this.readStatus(readTimeout);

                const s = resp[1];
                if (s !== lastStatus) {
                    const hex = Array.from(resp).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                    this.log(`Board status: [${hex}] → 0x${s.toString(16).padStart(2, '0')}`);
                    lastStatus = s;
                }

                if (s === 0xCE || s === 0xCF || s === 0xEC) return;
            } catch (_) {}
            await sleep(80);
        }
        this.log(`waitReady timeout (último status: 0x${lastStatus.toString(16).padStart(2,'0')})`);
        throw new Error('Timeout: la máquina no respondió.');
    }

    /**
     * Envía un comando EGV dividido en chunks de 30 bytes.
     * Itera sobre todo el buffer enviando cada paquete secuencialmente.
     */
    async sendEGV(cmd) {
        const bytes = Buffer.from(cmd, 'ascii');
        const totalPkts = Math.ceil(bytes.length / DATA_SIZE);
        this.log(`sendEGV: ${bytes.length} bytes → ${totalPkts} paquete(s) cmd="${cmd}"`);
        for (let i = 0; i < bytes.length; i += DATA_SIZE) {
            const chunk = bytes.slice(i, i + DATA_SIZE);
            const pktIdx = Math.floor(i / DATA_SIZE);
            await this.sendPacket(chunk, pktIdx === 0);
            this.log(`  PKT[${pktIdx}/${totalPkts - 1}]: ${chunk.length} bytes enviados`);
            await sleep(5);
        }
        // Leer status inmediatamente después de enviar para ver si la placa reaccionó
        const postStatus = await this._readStatusByte();
        this.log(`sendEGV done → status: 0x${postStatus.toString(16).padStart(2,'0')}`);
    }

    // ───────── Comandos de alto nivel ─────────

    /** Mueve la cabeza al origen (0,0). */
    async home() {
        this.log('Enviando comando Home...');
        await this.waitReady();
        await this.sendEGV('IPP');
        await this.waitReady(15000);
        this._posX = 0;
        this._posY = 0;
        this.log('Home completado.');
    }

    /**
     * Movimiento relativo en mm.
     * Protocolo EGV (K40-Whisperer make_move_data): I + dir + dist + S1P
     * Direcciones: B=derecha, T=izquierda, L=arriba, R=abajo
     * @param {number} dx  mm en X (positivo = derecha)
     * @param {number} dy  mm en Y (positivo = abajo)
     */
    async jog(dx, dy) {
        const sx = Math.round(Math.abs(dx) * STEPS_PER_MM);
        const sy = Math.round(Math.abs(dy) * STEPS_PER_MM);
        if (sx === 0 && sy === 0) return;

        // EGV rapid move (sin láser): I + dirección + distancia compacta + S1P
        // K40-Whisperer: Y se procesa antes que X en make_dir_dist()
        let cmd = 'I';
        if (sy > 0) cmd += (dy < 0 ? 'L' : 'R') + encodeDistance(sy);
        if (sx > 0) cmd += (dx > 0 ? 'B' : 'T') + encodeDistance(sx);
        cmd += 'S1P';

        this.log(`Jog: dx=${dx} dy=${dy} pasos=${sx},${sy} bytes=${cmd.length}`);

        try { await this.waitReady(5000, 400); } catch (e) {
            this.log('waitReady timeout antes de jog (continuando de todas formas)');
        }
        await this.sendEGV(cmd);

        // Esperar a que la placa termine de ejecutar el jog
        try {
            await this.waitReady(15000, 500);
        } catch (e) {
            this.log('waitReady timeout POST-jog (el movimiento puede haber fallado)');
        }

        this._posX += dx;
        this._posY += dy;
    }

    /**
     * Pulso de prueba del láser.
     * @param {number} power      0–100 %
     * @param {number} duration   ms
     */
    async testPulse(power, duration) {
        this.log(`Pulso: ${power}% durante ${duration}ms`);
        const speedCode = powerToSpeedCode(power);
        await this.waitReady();
        await this.sendEGV(`I${speedCode}N`);  // Init + velocidad + start
        await sleep(duration);
        await this.sendEGV('F');               // Finish
        await this.waitReady(5000);
    }

    /** Para la máquina inmediatamente. */
    async estop() {
        try {
            await this.sendEGV('@');
        } catch (_) {}
    }

    get posX() { return this._posX; }
    get posY() { return this._posY; }
}

// ───────── Helpers ─────────

/**
 * Convierte potencia (0–100%) a un código de velocidad EGV aproximado.
 * El M2 Nano controla la potencia efectiva vía velocidad del paso.
 * Valores típicos: S1=lento (alta pot.), S5=rápido (baja pot.)
 */
function powerToSpeedCode(power) {
    if (power >= 80) return 'S1P';
    if (power >= 60) return 'S2P';
    if (power >= 40) return 'S3P';
    if (power >= 20) return 'S4P';
    return 'S5P';
}

/**
 * Codifica distancia en pasos al formato compacto EGV (K40-Whisperer egv.py make_distance).
 *   1–25   → chr(96+n)         = 'a'..'y'
 *   26–51  → '|' + chr(96+n-25)
 *   52–255 → '%03d' (3 dígitos ASCII)
 *   255    → 'z' (se repite para múltiplos)
 */
function encodeDistance(steps) {
    let result = '';
    const fullRanges = Math.floor(steps / 255);
    result += 'z'.repeat(fullRanges);
    const remainder = steps % 255;
    if (remainder === 0) return result;
    if (remainder < 26) {
        result += String.fromCharCode(96 + remainder);
    } else if (remainder < 52) {
        result += '|' + String.fromCharCode(96 + remainder - 25);
    } else {
        result += remainder.toString().padStart(3, '0');
    }
    return result;
}

/**
 * CRC-8 Dallas/Maxim 1-Wire.
 * Polinomio 0x31 (normal) / 0x8C (reflejado). Init = 0x00.
 * Se procesa LSB-first con el polinomio reflejado.
 * @param {Buffer|Uint8Array} data  bytes sobre los cuales calcular el CRC
 * @returns {number} CRC de 8 bits
 */
function crc8(data) {
    let crc = 0x00;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x01) {
                crc = (crc >>> 1) ^ 0x8C;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return crc;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = M2Nano;
