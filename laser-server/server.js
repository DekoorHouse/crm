/**
 * Servidor WebSocket local para K40 con controladora M2 Nano
 * ─────────────────────────────────────────────────────────
 * Escucha en ws://localhost:7654
 * Se conecta con la máquina por USB (requiere driver WinUSB via Zadig).
 *
 * Uso:
 *   cd laser-server
 *   npm install
 *   node server.js
 */

const { WebSocketServer } = require('ws');
const M2Nano = require('./m2nano');

const PORT = 7654;

const wss = new WebSocketServer({ port: PORT });
let laser = null;
let client = null;  // Solo un cliente a la vez (la página web)

console.log(`\n🔴 Servidor Laser K40 iniciado en ws://localhost:${PORT}`);
console.log('   Abre http://app.dekoormx.com/laser y presiona "Conectar"\n');

wss.on('connection', (ws) => {
    client = ws;
    log('Cliente web conectado.');
    send({ type: 'status', text: 'Servidor local conectado. Iniciando USB...', level: 'success' });

    // Intentar conectar con la máquina
    connectMachine();

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }
        await handleCommand(msg);
    });

    ws.on('close', () => {
        log('Cliente web desconectado.');
        client = null;
        disconnectMachine();
    });

    ws.on('error', (err) => {
        log('Error WebSocket: ' + err.message, 'error');
    });
});

// ───────── Conexión USB ─────────

function connectMachine() {
    if (laser) disconnectMachine();

    laser = new M2Nano(onLaserLog);

    try {
        laser.connect();
        send({ type: 'machine_ready', ok: true });
        send({ type: 'status', text: '¡Máquina K40 conectada por USB!', level: 'success' });
        log('M2 Nano listo.');
    } catch (err) {
        send({ type: 'machine_ready', ok: false, error: err.message });
        log(err.message, 'error');
        laser = null;
    }
}

function disconnectMachine() {
    if (laser) { laser.disconnect(); laser = null; }
}

function onLaserLog(msg) {
    log(msg);
}

// ───────── Manejador de comandos ─────────

async function handleCommand(msg) {
    if (!laser) {
        send({ type: 'status', text: 'Máquina no conectada.', level: 'error' });
        return;
    }

    try {
        switch (msg.cmd) {

            case 'home':
                send({ type: 'status', text: 'Moviendo a origen...', level: 'info' });
                await laser.home();
                send({ type: 'position', x: 0, y: 0 });
                send({ type: 'status', text: 'En origen (0,0)', level: 'success' });
                break;

            case 'jog': {
                const dx = parseFloat(msg.dx) || 0;
                const dy = parseFloat(msg.dy) || 0;
                await laser.jog(dx, dy);
                send({ type: 'position', x: laser.posX, y: laser.posY });
                send({ type: 'status', text: `Pos: X=${laser.posX.toFixed(1)} Y=${laser.posY.toFixed(1)} mm`, level: 'cmd' });
                break;
            }

            case 'frame':
                send({ type: 'status', text: 'Frame: recorriendo bordes...', level: 'info' });
                await doFrame();
                send({ type: 'status', text: 'Frame completado.', level: 'success' });
                break;

            case 'pulse':
                await laser.testPulse(msg.power || 50, msg.ms || 50);
                break;

            case 'estop':
                await laser.estop();
                send({ type: 'status', text: 'PARO DE EMERGENCIA', level: 'error' });
                break;

            case 'start':
                send({ type: 'status', text: 'El envío de trabajos completos estará disponible próximamente.', level: 'warning' });
                // TODO: convertir imagen a EGV y enviar
                break;

            case 'stop':
                await laser.estop();
                break;

            case 'pause':
                // M2 Nano no tiene pause nativo; el servidor simplemente deja de enviar datos
                send({ type: 'status', text: 'Pausado (detén el flujo de datos).', level: 'warning' });
                break;

            case 'resume':
                send({ type: 'status', text: 'Reanudado.', level: 'success' });
                break;

            default:
                send({ type: 'status', text: `Comando desconocido: ${msg.cmd}`, level: 'warning' });
        }

    } catch (err) {
        send({ type: 'status', text: `Error: ${err.message}`, level: 'error' });
        log(err.message, 'error');
    }
}

// ───────── Frame (recorre las 4 esquinas del área de trabajo) ─────────

async function doFrame() {
    // El frame recorre las 4 esquinas del diseño cargado.
    // Usamos el área completa del K40 (300×200mm) como referencia.
    const corners = [
        [0, 0],
        [300, 0],
        [300, 200],
        [0, 200],
        [0, 0],
    ];

    // Mover a origen primero
    await laser.home();
    send({ type: 'position', x: 0, y: 0 });

    let prevX = 0, prevY = 0;
    for (const [x, y] of corners.slice(1)) {
        const dx = x - prevX;
        const dy = y - prevY;
        await laser.jog(dx, dy);
        send({ type: 'position', x: laser.posX, y: laser.posY });
        prevX = x; prevY = y;
        await sleep(200);
    }
}

// ───────── Helpers ─────────

function send(data) {
    if (client && client.readyState === 1 /* OPEN */) {
        client.send(JSON.stringify(data));
    }
}

function log(msg, level = 'cmd') {
    const t = new Date().toLocaleTimeString('es-MX', { hour12: false });
    console.log(`[${t}] ${msg}`);
    send({ type: 'status', text: msg, level });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

process.on('SIGINT', () => {
    disconnectMachine();
    process.exit(0);
});
