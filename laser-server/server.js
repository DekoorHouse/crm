/**
 * Servidor WebSocket local para K40 con controladora M2 Nano
 * ─────────────────────────────────────────────────────────
 * Escucha en ws://localhost:7654
 * Se conecta con la máquina por USB (requiere driver WinUSB via Zadig).
 */

const { WebSocketServer } = require('ws');
const M2Nano = require('./m2nano');
const egv = require('./egv');

const PORT = 7654;

const wss = new WebSocketServer({ port: PORT, maxPayload: 50 * 1024 * 1024 });
let laser = null;
let client = null;

// Estado del job actual
let jobState = { running: false, paused: false, stopped: false };
let pendingRasterData = null;

console.log(`\n🔴 Servidor Laser K40 iniciado en ws://localhost:${PORT}`);
console.log('   Abre http://app.dekoormx.com/laser y presiona "Conectar"\n');

wss.on('connection', async (ws) => {
    client = ws;
    log('Cliente web conectado.');
    send({ type: 'status', text: 'Servidor local conectado. Iniciando USB...', level: 'success' });

    await connectMachine();

    ws.on('message', async (raw, isBinary) => {
        if (isBinary) {
            pendingRasterData = raw;
            log(`Datos raster recibidos: ${raw.byteLength} bytes`);
            return;
        }
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }
        await handleCommand(msg);
    });

    ws.on('close', () => {
        log('Cliente web desconectado.');
        client = null;
        jobState.stopped = true;
        disconnectMachine();
    });

    ws.on('error', (err) => {
        log('Error WebSocket: ' + err.message, 'error');
    });
});

// ───────── Conexión USB ─────────

async function connectMachine() {
    if (laser) disconnectMachine();
    laser = new M2Nano(onLaserLog);
    try {
        await laser.connect();
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

function onLaserLog(msg) { log(msg); }

// ───────── Manejador de comandos ─────────

async function handleCommand(msg) {
    if (!laser && msg.cmd !== 'stop' && msg.cmd !== 'estop') {
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
                await doFrame(msg.bounds);
                send({ type: 'status', text: 'Frame completado.', level: 'success' });
                break;

            case 'pulse':
                await laser.testPulse(msg.power || 50, msg.ms || 50);
                break;

            case 'estop':
                jobState.stopped = true;
                await laser.estop();
                send({ type: 'status', text: 'PARO DE EMERGENCIA', level: 'error' });
                break;

            case 'start':
                if (jobState.running) {
                    send({ type: 'status', text: 'Ya hay un trabajo en ejecución.', level: 'warning' });
                    break;
                }
                runJob(msg).catch(err => {
                    send({ type: 'status', text: `Error en job: ${err.message}`, level: 'error' });
                    log(err.message, 'error');
                    jobState.running = false;
                    send({ type: 'done' });
                });
                break;

            case 'stop':
                jobState.stopped = true;
                if (laser) await laser.estop();
                send({ type: 'status', text: 'Trabajo detenido.', level: 'warning' });
                break;

            case 'pause':
                jobState.paused = true;
                send({ type: 'status', text: 'Trabajo pausado.', level: 'warning' });
                break;

            case 'resume':
                jobState.paused = false;
                send({ type: 'status', text: 'Trabajo reanudado.', level: 'success' });
                break;

            default:
                send({ type: 'status', text: `Comando desconocido: ${msg.cmd}`, level: 'warning' });
        }
    } catch (err) {
        send({ type: 'status', text: `Error: ${err.message}`, level: 'error' });
        log(err.message, 'error');
    }
}

// ───────── Ejecución de trabajos ─────────

async function runJob(msg) {
    const { mode, speed, passes } = msg;
    jobState = { running: true, paused: false, stopped: false };

    let egvString;

    // Usar posición actual del cabezal como origen del trabajo
    const startX = laser.posX;
    const startY = laser.posY;

    if (mode === 'cut' && msg.segments) {
        send({ type: 'status', text: `Generando EGV vectorial: ${msg.segments.length} segmentos (desde X=${startX} Y=${startY})...`, level: 'info' });
        egvString = egv.generateVectorEGV(msg.segments, speed, startX, startY);
    } else if (mode === 'engrave' && msg.raster) {
        // Esperar datos binarios del raster si no han llegado
        const maxWait = 5000;
        const start = Date.now();
        while (!pendingRasterData && Date.now() - start < maxWait) {
            await sleep(50);
        }
        if (!pendingRasterData) {
            throw new Error('No se recibieron datos raster del frontend.');
        }
        const { width, height, step, offsetX, offsetY } = msg.raster;
        send({ type: 'status', text: `Generando EGV raster: ${width}×${height}px (desde X=${startX} Y=${startY})...`, level: 'info' });
        egvString = egv.generateRasterEGV(pendingRasterData, width, height, speed, step || 1, startX + (offsetX || 0), startY + (offsetY || 0));
        pendingRasterData = null;
    } else {
        throw new Error('Datos de trabajo incompletos. Se requiere segments (corte) o raster (grabado).');
    }

    send({ type: 'status', text: `EGV generado: ${egvString.length} bytes. Iniciando...`, level: 'success' });

    for (let pass = 0; pass < (passes || 1); pass++) {
        if (jobState.stopped) break;

        if (passes > 1) {
            send({ type: 'status', text: `Pasada ${pass + 1}/${passes}...`, level: 'info' });
        }

        // Volver a la posición de inicio (no al origen) para multi-pasada
        if (pass > 0) {
            const dx = startX - laser.posX;
            const dy = startY - laser.posY;
            if (dx !== 0 || dy !== 0) await laser.jog(dx, dy);
        }

        const result = await laser.sendEGVJob(egvString, {
            onProgress: (pct) => {
                const totalPct = ((pass + pct) / (passes || 1)) * 100;
                send({ type: 'progress', pct: Math.round(totalPct) });
            },
            shouldStop: () => jobState.stopped,
            shouldPause: () => jobState.paused,
        });

        if (result === 'stopped') {
            send({ type: 'status', text: 'Trabajo detenido por usuario.', level: 'warning' });
            break;
        }
    }

    // Volver a posición de inicio del job
    try {
        const dx = startX - laser.posX;
        const dy = startY - laser.posY;
        if (dx !== 0 || dy !== 0) await laser.jog(dx, dy);
    } catch (_) {}

    jobState.running = false;
    send({ type: 'done' });
    send({ type: 'status', text: 'Trabajo completado.', level: 'success' });
}

// ───────── Frame ─────────

async function doFrame(bounds) {
    const x = bounds?.x || 0;
    const y = bounds?.y || 0;
    const w = bounds?.w || 300;
    const h = bounds?.h || 200;

    const corners = [
        [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y],
    ];

    await laser.home();
    send({ type: 'position', x: 0, y: 0 });

    let prevX = 0, prevY = 0;
    for (const [cx, cy] of corners) {
        await laser.jog(cx - prevX, cy - prevY);
        send({ type: 'position', x: laser.posX, y: laser.posY });
        prevX = cx; prevY = cy;
        await sleep(200);
    }
}

// ───────── Helpers ─────────

function send(data) {
    if (client && client.readyState === 1) {
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
