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
const PKT_SIZE     = 34;     // Tamaño de paquete USB (34 bytes, formato K40-Whisperer)
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

    /**
     * Lista todos los dispositivos M2 Nano conectados.
     * @returns {Array<{dev, name, busNumber, deviceAddress}>}
     */
    static listDevices() {
        const allDevices = usb.getDeviceList();
        const found = [];
        for (const dev of allDevices) {
            const desc = dev.deviceDescriptor;
            for (const d of DEVICES) {
                if (desc.idVendor === d.vid && desc.idProduct === d.pid) {
                    found.push({
                        dev,
                        name: d.name,
                        busNumber: dev.busNumber,
                        deviceAddress: dev.deviceAddress,
                    });
                }
            }
        }
        return found;
    }

    /**
     * Busca y abre un dispositivo USB.
     * @param {number} [deviceIndex=0]  índice del dispositivo (0=primero, 1=segundo)
     */
    async connect(deviceIndex = 0) {
        // Siempre listar TODOS los CH341 para poder elegir por índice
        const allDevs = usb.getDeviceList();
        const matching = [];
        for (const dev of allDevs) {
            const desc = dev.deviceDescriptor;
            const match = DEVICES.find(d => desc.idVendor === d.vid && desc.idProduct === d.pid);
            if (match) {
                matching.push({ dev, name: match.name, bus: dev.busNumber, addr: dev.deviceAddress });
            }
        }
        this.log(`CH341 detectados: ${matching.length} (pidiendo índice ${deviceIndex})`);
        for (let i = 0; i < matching.length; i++) {
            const m = matching[i];
            this.log(`  [${i}] ${m.name} bus=${m.bus} addr=${m.addr}`);
        }

        let found = null;
        if (deviceIndex < matching.length) {
            found = matching[deviceIndex];
        }

        if (!found) {
            throw new Error(
                deviceIndex === 0
                    ? 'M2 Nano no encontrado.\n→ Verifica la conexión USB.\n→ En Windows instala el driver WinUSB con Zadig.'
                    : `Dispositivo #${deviceIndex} no encontrado.`
            );
        }

        this.log(`Dispositivo #${deviceIndex}: ${found.name}`);
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

        // K40-Whisperer: ctrl_transfer(0x40, 177, 0x0102, 0, 0, 2000)
        // Request 0xB1 (177), wValue 0x0102 — inicializa el CH341 para EPP.
        // ANTES teníamos 0xA1 con wValue=0 que era INCORRECTO.
        try {
            await new Promise((resolve, reject) => {
                this.device.controlTransfer(0x40, 0xB1, 0x0102, 0, Buffer.alloc(0), err => err ? reject(err) : resolve());
            });
            this.log('CH341 init (0xB1, 0x0102) OK.');
        } catch (e) {
            this.log(`CH341 init aviso: ${e.message} (continuando...)`);
        }

        // Unlock rail (IS2P) — como K40-Whisperer
        try {
            await this.sendEGV('IS2P');
            this.log('Unlock rail (IS2P) OK.');
        } catch (e) {
            this.log(`Unlock rail aviso: ${e.message}`);
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
     * Envía un paquete de datos EGV de 34 bytes (formato K40-Whisperer).
     * Formato: [0xA6][0x00][payload (30 bytes)][0xA6][CRC-8]
     */
    sendPacket(data, logFirst = false) {
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

        return this._usbTimeout(new Promise((resolve, reject) => {
            this.epOut.transfer(pkt, err => err ? reject(err) : resolve());
        }), 5000, 'sendPacket');
    }

    /**
     * say_hello — exacto como K40 Whisperer.
     * Envía [0xA0] (1 byte), lee 168 bytes, retorna status byte (resp[1]).
     * Status: 0xCE(206)=OK, 0xEE(238)=BUFFER_FULL, 0xCF(207)=CRC_ERROR, 0xEC(236)=TASK_COMPLETE
     */
    async sayHello() {
        try {
            return await this._usbTimeout(new Promise((resolve) => {
                const cmd = Buffer.from([CMD_STATUS]); // [0xA0] — 1 byte, como K40 Whisperer
                this.epOut.transfer(cmd, (err) => {
                    if (err) { resolve(null); return; }
                    this.epIn.transfer(168, (err2, data) => {
                        if (err2 || !data || data.length < 2) { resolve(null); return; }
                        resolve(data[1]); // status byte
                    });
                });
            }), 5000, 'sayHello');
        } catch (_) {
            return null; // timeout → null para no romper loops
        }
    }

    /** Wrapper con timeout para operaciones USB que pueden congelarse. */
    _usbTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`USB timeout (${label}, ${ms}ms)`)), ms)
            ),
        ]);
    }

    /** Espera a que la máquina esté lista (para init, jog, etc.). */
    async waitReady(timeout = 6000) {
        const deadline = Date.now() + timeout;
        let lastStatus = -1;
        while (Date.now() < deadline) {
            try {
                const s = await this.sayHello();
                if (s !== null && s !== lastStatus) {
                    this.log(`Board status: 0x${s.toString(16).padStart(2, '0')} (${s})`);
                    lastStatus = s;
                }
                // 0xCE=OK, 0xEC=TASK_COMPLETE
                if (s === 0xCE || s === 0xEC) return;
            } catch (_) {}
            await sleep(80);
        }
        this.log(`waitReady timeout (status: 0x${(lastStatus >= 0 ? lastStatus : 0).toString(16).padStart(2,'00')})`);
        throw new Error('Timeout: la máquina no respondió.');
    }

    /**
     * Envía un comando EGV dividido en chunks de 30 bytes.
     */
    async sendEGV(cmd) {
        const bytes = Buffer.from(cmd, 'ascii');
        const totalPkts = Math.ceil(bytes.length / DATA_SIZE);
        this.log(`sendEGV: ${bytes.length} bytes → ${totalPkts} paquete(s)`);
        for (let i = 0; i < bytes.length; i += DATA_SIZE) {
            const chunk = bytes.slice(i, i + DATA_SIZE);
            const pktIdx = Math.floor(i / DATA_SIZE);
            await this.sendPacket(chunk, pktIdx === 0);
            // Flow control como K40 Whisperer
            const s = await this.sayHello();
            while (s === 0xEE) { await this.sayHello(); }
        }
    }

    /**
     * Envía un job EGV largo.
     * Envía paquetes lo más rápido posible (USB bulk flow control nativo).
     * sayHello solo cuando el board reporta buffer lleno (0xEE).
     */
    async sendEGVJob(egvString, { onProgress, shouldStop, shouldPause } = {}) {
        const bytes = Buffer.from(egvString, 'ascii');
        const totalPkts = Math.ceil(bytes.length / DATA_SIZE);
        this.log(`sendEGVJob: ${bytes.length} bytes → ${totalPkts} paquete(s)`);

        this.log('Esperando board ready...');
        try {
            await this.waitReady(10000);
            this.log('Board listo. Enviando...');
        } catch (e) {
            this.log(`waitReady falló: ${e.message} — intentando enviar de todas formas...`);
        }

        for (let i = 0; i < bytes.length; i += DATA_SIZE) {
            const pktIdx = Math.floor(i / DATA_SIZE);

            // Verificar stop/pausa cada 50 paquetes
            if (pktIdx % 50 === 0) {
                if (shouldStop && shouldStop()) {
                    await this.estop();
                    return 'stopped';
                }
                while (shouldPause && shouldPause()) {
                    if (shouldStop && shouldStop()) { await this.estop(); return 'stopped'; }
                    await sleep(200);
                }
            }

            const chunk = bytes.slice(i, i + DATA_SIZE);
            await this.sendPacket(chunk);

            // sayHello cada 20 paquetes para detectar buffer lleno
            if (pktIdx % 20 === 0 && pktIdx > 0) {
                let s = await this.sayHello();
                while (s === 0xEE) { s = await this.sayHello(); } // tight loop si lleno
            }

            // Progreso cada 500 paquetes
            if (onProgress && pktIdx % 500 === 0) {
                onProgress(pktIdx / totalPkts);
            }
        }

        this.log('Todos los paquetes enviados. Esperando que el board termine...');
        // 0xCE = "buffer con espacio" (puede estar aún ejecutando)
        // 0xEE = "buffer lleno / ejecutando"
        // 0xEC = "tarea completada" (algunos boards nunca lo envían)
        // Estrategia: esperar 0xCE consistente por 2 segundos seguidos
        const deadline = Date.now() + 300000;
        let ceStartTime = 0;
        const CE_STABLE_MS = 2000; // 0xCE debe persistir 2s para considerar "terminado"
        while (Date.now() < deadline) {
            try {
                const s = await this.sayHello();
                if (s === 0xEC) { this.log('Board: TASK_COMPLETE (0xEC)'); break; }
                if (s === 0xCE) {
                    if (ceStartTime === 0) ceStartTime = Date.now();
                    if (Date.now() - ceStartTime >= CE_STABLE_MS) {
                        this.log('Board: 0xCE estable por 2s → terminado');
                        break;
                    }
                } else {
                    ceStartTime = 0; // reset si el board reporta algo diferente (0xEE busy)
                }
            } catch (_) { ceStartTime = 0; }
        }
        if (onProgress) onProgress(1);
        return 'complete';
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

        // Dos comandos separados (Y luego X) — el M2 Nano solo ejecuta la
        // última dirección si se combinan ambas en un solo I...S1P.
        const cmds = [];
        if (sy > 0) cmds.push('I' + (dy < 0 ? 'L' : 'R') + encodeDistance(sy) + 'S1P');
        if (sx > 0) cmds.push('I' + (dx > 0 ? 'B' : 'T') + encodeDistance(sx) + 'S1P');

        this.log(`Jog: dx=${dx.toFixed(2)} dy=${dy.toFixed(2)} pasos=${sx},${sy}`);

        for (const cmd of cmds) {
            try { await this.waitReady(5000); } catch (_) {
                this.log('waitReady timeout antes de jog');
            }

            // Enviar paquete directamente — NO usar sendEGV (que manda sayHello
            // inmediatamente después y puede interferir con el jog)
            const bytes = Buffer.from(cmd, 'ascii');
            for (let i = 0; i < bytes.length; i += DATA_SIZE) {
                await this.sendPacket(bytes.slice(i, i + DATA_SIZE), i === 0);
            }

            // Dar tiempo al board para procesar el comando y empezar a mover
            await sleep(300);

            // Esperar a que el jog termine: board va de 0xCE → posiblemente 0xEE → 0xCE
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                try {
                    const s = await this.sayHello();
                    if (s === 0xCE || s === 0xEC) break;
                } catch (_) {}
            }
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

    /** Desbloquea los rieles (libera steppers). Protocolo K40: IS2P */
    async unlock() {
        this.log('Desbloqueando rieles...');
        try {
            await this.waitReady(3000);
            await this.sendEGV('IS2P');
        } catch (_) {}
    }

    /** Ajusta posición interna sin mover el cabezal (post-EGV). */
    adjustPos(dx, dy) { this._posX += dx; this._posY += dy; }

    /** Fuerza posición interna a valores conocidos (post-estop). */
    resetPos(x, y) { this._posX = x; this._posY = y; }

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
