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
const PKT_SIZE     = 32;     // Tamaño de paquete USB
const DATA_SIZE    = 30;     // Bytes de datos por paquete (sin framing)
const STATUS_READY = 0xA5;   // Byte 0 de respuesta = listo
const STATUS_BUSY  = 0x00;

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

        this.log('Puerto USB abierto y reclamado.');
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
     * Envía un paquete de 32 bytes a la controladora.
     * Formato: [0x00][30 bytes de datos][0x0A]
     */
    sendPacket(data) {
        return new Promise((resolve, reject) => {
            const pkt = Buffer.alloc(PKT_SIZE, 0);
            pkt[0] = 0x00;
            const src = Buffer.isBuffer(data) ? data : Buffer.from(data, 'ascii');
            src.copy(pkt, 1, 0, Math.min(src.length, DATA_SIZE));
            pkt[31] = 0x0A;

            this.epOut.transfer(pkt, err => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /** Lee la respuesta de estado con timeout para no bloquear Node.js. */
    readStatus(timeout = 500) {
        return Promise.race([
            new Promise((resolve, reject) => {
                this.epIn.transfer(PKT_SIZE, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('USB read timeout')), timeout)
            ),
        ]);
    }

    /** Espera a que la máquina esté lista (byte 0 = 0xA5). */
    async waitReady(timeout = 6000, readTimeout = 500) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            try {
                await this.sendPacket(Buffer.alloc(1));
                const resp = await this.readStatus(readTimeout);
                if (resp[0] === STATUS_READY) return;
            } catch (_) {}
            await sleep(80);
        }
        throw new Error('Timeout: la máquina no respondió.');
    }

    /**
     * Envía un comando EGV dividido en chunks de 30 bytes.
     * El EGV format es una cadena ASCII de instrucciones.
     */
    async sendEGV(cmd) {
        const bytes = Buffer.from(cmd, 'ascii');
        for (let i = 0; i < bytes.length; i += DATA_SIZE) {
            await this.sendPacket(bytes.slice(i, i + DATA_SIZE));
            await sleep(5);
        }
    }

    // ───────── Comandos de alto nivel ─────────

    /** Mueve la cabeza al origen (0,0). */
    async home() {
        this.log('Enviando comando Home...');
        await this.waitReady();
        await this.sendEGV('IHF');
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

        // EGV format: I=init, direcciones (1 char = 1 paso), N=ejecutar, S1P=velocidad rápida, F=fin
        let cmd = 'I';
        if (sx > 0) cmd += (dx > 0 ? 'R' : 'L').repeat(sx);
        if (sy > 0) cmd += (dy > 0 ? 'B' : 'T').repeat(sy);
        cmd += 'NS1PF';

        // Solo esperar listo antes; no esperar después para no bloquear
        try { await this.waitReady(2000, 400); } catch (_) {}
        await this.sendEGV(cmd);

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

// encodeDistance ya no se usa (reemplazado por repeat() en jog)

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

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = M2Nano;
