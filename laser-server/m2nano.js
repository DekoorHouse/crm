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
const PKT_SIZE     = 34;     // Tamaño de paquete USB (34 bytes protocolo Lhystudios)
const CMD_PKT_SIZE = 32;     // Tamaño de paquete de comando (sin CRC)
const DATA_SIZE    = 30;     // Bytes de datos por paquete (payload)
const PKT_FRAME    = 0xA6;   // Byte de comando de escritura paralela CH341A
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

    /** Busca y abre el dispositivo USB. */
    connect() {
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

        this.log(`Puerto USB abierto y reclamado. EP_OUT=0x${this.epOut.address.toString(16)} EP_IN=0x${this.epIn.address.toString(16)} type=${this.epOut.transferType}`);
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
     * Envía un paquete de datos EGV de 34 bytes (protocolo Lhystudios).
     * Formato: [0xA6][0x00][payload (30 bytes)][0x00][CRC-8]
     *   - Byte 0:     0xA6 (comando de escritura paralela CH341A)
     *   - Byte 1:     0x00 (byte de inicio de trama M2 Nano)
     *   - Bytes 2-31: payload EGV (30 bytes, padded con 0x46 'F')
     *   - Byte 32:    0x00 (byte de fin de datos)
     *   - Byte 33:    CRC-8 Dallas/Maxim sobre bytes 2-31
     */
    sendPacket(data, logFirst = false) {
        return new Promise((resolve, reject) => {
            const pkt = Buffer.alloc(PKT_SIZE, 0);  // 34 bytes
            pkt[0] = PKT_FRAME;   // 0xA6
            pkt[1] = 0x00;        // Inicio de trama M2 Nano
            pkt.fill(0x46, 2, 32);  // Padding con 'F' en zona de payload
            const src = Buffer.isBuffer(data) ? data : Buffer.from(data, 'ascii');
            src.copy(pkt, 2, 0, Math.min(src.length, DATA_SIZE));  // Payload en bytes 2-31
            pkt[32] = 0x00;       // Fin de datos
            pkt[33] = crc8(pkt.subarray(2, 32));  // CRC sobre los 30 bytes de payload

            if (logFirst) {
                const hex = Array.from(pkt).map(b => b.toString(16).padStart(2, '0')).join(' ');
                this.log(`PKT[0]: ${hex}`);
            }

            this.epOut.transfer(pkt, err => {
                if (err) reject(err);
                else resolve();
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

    /** Espera a que la máquina esté lista. */
    async waitReady(timeout = 6000, readTimeout = 500) {
        const deadline = Date.now() + timeout;
        let logged = false;
        while (Date.now() < deadline) {
            try {
                // Enviar solicitud de estado (0xA0 como comando directo, sin framing 0xA6)
                await this.sendCommand(CMD_STATUS);
                const resp = await this.readStatus(readTimeout);

                if (!logged) {
                    const hex = Array.from(resp).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                    this.log(`Board status: [${hex}]`);
                    logged = true;
                }

                // Ready: el board NO está ocupado si resp[0] != 0xA5 (busy).
                // Valores conocidos: 0xC6=completado, 0x00=idle, 0xFF=idle (varía por firmware).
                // Cualquier respuesta que no sea 0xA5 (busy) indica que podemos continuar.
                if (resp[0] !== 0xA5) return;
            } catch (_) {}
            await sleep(80);
        }
        throw new Error('Timeout: la máquina no respondió.');
    }

    /**
     * Envía un comando EGV dividido en chunks de 30 bytes.
     * Itera sobre todo el buffer enviando cada paquete secuencialmente.
     */
    async sendEGV(cmd) {
        const bytes = Buffer.from(cmd, 'ascii');
        const totalPkts = Math.ceil(bytes.length / DATA_SIZE);
        this.log(`sendEGV: ${bytes.length} bytes → ${totalPkts} paquete(s)`);
        for (let i = 0; i < bytes.length; i += DATA_SIZE) {
            const chunk = bytes.slice(i, i + DATA_SIZE);
            const pktIdx = Math.floor(i / DATA_SIZE);
            await this.sendPacket(chunk, true);
            this.log(`  PKT[${pktIdx}/${totalPkts - 1}]: ${chunk.length} bytes enviados`);
            await sleep(5);
        }
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
     * @param {number} dx  mm en X (positivo = derecha)
     * @param {number} dy  mm en Y (positivo = abajo)
     */
    async jog(dx, dy) {
        const sx = Math.round(Math.abs(dx) * STEPS_PER_MM);
        const sy = Math.round(Math.abs(dy) * STEPS_PER_MM);
        if (sx === 0 && sy === 0) return;

        // EGV rapid move (sin láser): I=init, dirs (1 char=1 paso), SE=fin sección, F=finish
        // NO incluir N (activa el láser).
        // F es obligatorio: la placa buferea y no ejecuta hasta leer 'F'.
        let cmd = 'I';
        if (sx > 0) cmd += (dx > 0 ? 'R' : 'L').repeat(sx);
        if (sy > 0) cmd += (dy > 0 ? 'B' : 'T').repeat(sy);
        cmd += 'SEF';

        this.log(`Jog: dx=${dx} dy=${dy} pasos=${sx},${sy} bytes=${cmd.length}`);

        try { await this.waitReady(2000, 400); } catch (e) {
            this.log('waitReady timeout antes de jog (continuando...)');
        }
        await this.sendEGV(cmd);

        // Leer status POST-jog para ver si el board cambió de estado
        try {
            await this.sendCommand(CMD_STATUS);
            const post = await this.readStatus(400);
            const hex = Array.from(post).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
            this.log(`Status POST-jog: [${hex}]`);
        } catch (_) {}

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
