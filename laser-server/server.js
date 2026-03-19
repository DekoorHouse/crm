/**
 * Servidor WebSocket local para K40 — soporte dual (2 máquinas)
 * ─────────────────────────────────────────────────────────────
 * Escucha en ws://localhost:7654
 * Soporta 2 lásers M2 Nano conectados por USB simultáneamente.
 */

const { WebSocketServer } = require('ws');
const M2Nano = require('./m2nano');
const egv = require('./egv');

const PORT = 7654;
const MAX_MACHINES = 2;

const wss = new WebSocketServer({ port: PORT, maxPayload: 50 * 1024 * 1024 });
wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n⚠ Puerto ${PORT} ya está en uso. Cerrando proceso anterior...`);
        require('child_process').exec(
            `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /PID %a`,
            { shell: 'cmd.exe' },
            () => { setTimeout(() => process.exit(0), 1000); } // el .bat loop reinicia
        );
    } else {
        console.error('Error del servidor:', err);
        process.exit(1);
    }
});
let client = null;

// Estado de cada máquina
const machines = {
    0: { laser: null, jobState: { running: false, paused: false, stopped: false, startX: 0, startY: 0 }, pendingRaster: null },
    1: { laser: null, jobState: { running: false, paused: false, stopped: false, startX: 0, startY: 0 }, pendingRaster: null },
};

console.log(`\n🔴 Servidor Laser K40 (dual) iniciado en ws://localhost:${PORT}`);
console.log('   Abre http://app.dekoormx.com/laser y presiona "Conectar"\n');

wss.on('connection', async (ws) => {
    client = ws;
    log('Cliente web conectado.');

    // No conectar automáticamente — el usuario conecta cada máquina individualmente

    ws.on('message', async (raw, isBinary) => {
        if (isBinary) {
            // Detectar a qué máquina va el raster por el pending
            for (const id of [0, 1]) {
                if (machines[id].expectingRaster) {
                    machines[id].pendingRaster = raw;
                    machines[id].expectingRaster = false;
                    log(`[M${id}] Datos raster recibidos: ${raw.byteLength} bytes`);
                    break;
                }
            }
            return;
        }
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }
        await handleCommand(msg);
    });

    ws.on('close', () => {
        log('Cliente web desconectado.');
        client = null;
        for (const id of [0, 1]) {
            machines[id].jobState.stopped = true;
            disconnectMachine(id);
        }
    });

    ws.on('error', (err) => log('Error WebSocket: ' + err.message, 'error'));
});

// ───────── Conexión USB ─────────

async function connectMachine(id) {
    const m = machines[id];
    if (m.laser) disconnectMachine(id);

    m.laser = new M2Nano((msg) => logMachine(id, msg));
    m.laser._onUSBWaiting = (waiting) => {
        send({ type: 'status', machine: id, text: waiting ? 'Cable USB desconectado. Reconecta para continuar...' : 'Reconexión cancelada.', level: waiting ? 'warning' : 'info' });
    };

    try {
        await m.laser.connect(id);
        send({ type: 'machine_ready', machine: id, ok: true });
        logMachine(id, '¡Máquina conectada por USB!', 'success');
    } catch (err) {
        send({ type: 'machine_ready', machine: id, ok: false, error: err.message });
        logMachine(id, err.message, 'error');
        m.laser = null;
    }
}

function disconnectMachine(id) {
    const m = machines[id];
    if (m.laser) { m.laser.disconnect(); m.laser = null; }
}

// ───────── Manejador de comandos ─────────

async function handleCommand(msg) {
    const id = msg.machine != null ? msg.machine : 0;
    const m = machines[id];

    // Reiniciar servidor
    if (msg.cmd === 'restart_server') {
        log('Servidor reiniciándose por solicitud del cliente...', 'warning');
        send({ type: 'status', machine: 0, text: 'Reiniciando servidor...', level: 'warning' });
        for (const i of [0, 1]) disconnectMachine(i);
        setTimeout(() => process.exit(0), 500);
        return;
    }

    // Conectar máquina bajo demanda
    if (msg.cmd === 'connect_machine') {
        await connectMachine(id);
        return;
    }

    if (!m || !m.laser) {
        if (msg.cmd !== 'stop' && msg.cmd !== 'estop') {
            send({ type: 'status', machine: id, text: `Máquina #${id} no conectada.`, level: 'error' });
            return;
        }
    }

    const laser = m.laser;

    try {
        switch (msg.cmd) {

            case 'home':
                send({ type: 'status', machine: id, text: 'Moviendo a origen...', level: 'info' });
                await laser.home();
                send({ type: 'position', machine: id, x: 0, y: 0 });
                send({ type: 'status', machine: id, text: 'En origen (0,0)', level: 'success' });
                break;

            case 'jog': {
                const dx = parseFloat(msg.dx) || 0;
                const dy = parseFloat(msg.dy) || 0;
                await laser.jog(dx, dy);
                send({ type: 'position', machine: id, x: laser.posX, y: laser.posY });
                send({ type: 'status', machine: id, text: `Pos: X=${laser.posX.toFixed(1)} Y=${laser.posY.toFixed(1)} mm`, level: 'cmd' });
                break;
            }

            case 'frame':
                send({ type: 'status', machine: id, text: 'Frame: recorriendo bordes...', level: 'info' });
                await doFrame(laser, id, msg.bounds);
                send({ type: 'status', machine: id, text: 'Frame completado.', level: 'success' });
                break;

            case 'pulse':
                await laser.testPulse(msg.power || 50, msg.ms || 50);
                break;

            case 'estop':
                m.jobState.stopped = true;
                if (laser) await laser.estop();
                send({ type: 'status', machine: id, text: 'PARO DE EMERGENCIA', level: 'error' });
                break;

            case 'unlock':
                if (laser) await laser.unlock();
                send({ type: 'status', machine: id, text: 'Riel desbloqueado.', level: 'success' });
                break;

            case 'start':
                if (m.jobState.running) {
                    send({ type: 'status', machine: id, text: 'Ya hay un trabajo en ejecución.', level: 'warning' });
                    break;
                }
                if (msg.mode === 'engrave' && msg.raster) {
                    m.expectingRaster = true;
                }
                runJob(id, msg).catch(err => {
                    send({ type: 'status', machine: id, text: `Error en job: ${err.message}`, level: 'error' });
                    log(`[M${id}] ${err.message}`, 'error');
                    m.jobState.running = false;
                    send({ type: 'done', machine: id });
                });
                break;

            case 'stop':
                m.jobState.stopped = true;
                if (laser) {
                    await laser.estop();
                    // No home — el cabezal se queda donde está.
                    // Posición desconocida: resetear a startX/startY (última posición conocida)
                    if (m.jobState.startX != null) {
                        laser.resetPos(m.jobState.startX, m.jobState.startY);
                        send({ type: 'position', machine: id, x: laser.posX, y: laser.posY });
                    }
                }
                send({ type: 'status', machine: id, text: 'Trabajo detenido.', level: 'warning' });
                break;

            case 'pause':
                m.jobState.paused = true;
                send({ type: 'status', machine: id, text: 'Trabajo pausado.', level: 'warning' });
                break;

            case 'resume':
                m.jobState.paused = false;
                send({ type: 'status', machine: id, text: 'Trabajo reanudado.', level: 'success' });
                break;

            default:
                send({ type: 'status', machine: id, text: `Comando desconocido: ${msg.cmd}`, level: 'warning' });
        }
    } catch (err) {
        send({ type: 'status', machine: id, text: `Error: ${err.message}`, level: 'error' });
        log(`[M${id}] ${err.message}`, 'error');
    }
}

// ───────── Ejecución de trabajos ─────────

async function runJob(id, msg) {
    const m = machines[id];
    const laser = m.laser;
    const { mode, speed, passes } = msg;
    m.jobState = { running: true, paused: false, stopped: false, startX: laser.posX, startY: laser.posY };

    let egvString;
    let rasterEndX = 0, rasterEndY = 0;
    let rasterJogX = 0, rasterJogY = 0; // jog antes del EGV raster
    const startX = m.jobState.startX;
    const startY = m.jobState.startY;

    if (mode === 'cut' && msg.segments) {
        send({ type: 'status', machine: id, text: `Generando EGV vectorial: ${msg.segments.length} segmentos...`, level: 'info' });
        egvString = egv.generateVectorEGV(msg.segments, speed, startX, startY);
        // Vector EGV already includes return-to-start move, no position adjustment needed
    } else if (mode === 'engrave' && msg.raster) {
        const maxWait = 5000;
        const start = Date.now();
        while (!m.pendingRaster && Date.now() - start < maxWait) await sleep(50);
        if (!m.pendingRaster) throw new Error('No se recibieron datos raster.');
        const { width, height, step } = msg.raster;
        send({ type: 'status', machine: id, text: `Generando EGV raster: ${width}×${height}px...`, level: 'info' });
        const rasterResult = egv.generateRasterEGV(m.pendingRaster, width, height, speed, step || 1, 0, 0);
        egvString = rasterResult.egv;
        rasterEndX = rasterResult.endX;
        rasterEndY = rasterResult.endY;
        // Jog al inicio del raster ANTES del EGV (a velocidad segura, no a 300mm/s)
        rasterJogX = rasterResult.jogX;
        rasterJogY = rasterResult.jogY;
        m.pendingRaster = null;
    } else {
        throw new Error('Datos de trabajo incompletos.');
    }

    send({ type: 'status', machine: id, text: `EGV: ${egvString.length} bytes. Iniciando...`, level: 'success' });

    for (let pass = 0; pass < (passes || 1); pass++) {
        if (m.jobState.stopped) break;
        if (passes > 1) send({ type: 'status', machine: id, text: `Pasada ${pass + 1}/${passes}...`, level: 'info' });

        if (pass > 0) {
            // Volver al punto de inicio para la siguiente pasada
            const dx = startX - laser.posX;
            const dy = startY - laser.posY;
            if (dx !== 0 || dy !== 0) await laser.jog(dx, dy);
        }

        // Jog al inicio del raster a velocidad segura (ANTES del EGV a velocidad raster)
        if (mode === 'engrave' && (rasterJogX !== 0 || rasterJogY !== 0)) {
            send({ type: 'status', machine: id, text: 'Posicionando cabezal...', level: 'info' });
            await laser.jog(rasterJogX, rasterJogY);
        }

        const result = await laser.sendEGVJob(egvString, {
            onProgress: (pct) => {
                const totalPct = ((pass + pct) / (passes || 1)) * 100;
                send({ type: 'progress', machine: id, pct: Math.round(totalPct) });
            },
            shouldStop: () => m.jobState.stopped,
            shouldPause: () => m.jobState.paused,
        });

        if (result === 'stopped') {
            // Posición desconocida — stop handler ya hizo resetPos
            break;
        }

        // Soft reset para limpiar estado residual del modo raster
        // antes de enviar jogs de retorno (sin esto el board puede
        // invertir la dirección L/R del primer jog post-EGV).
        if (mode === 'engrave') {
            await laser.sendEGV('IS2P');
            await sleep(500);
        }

        // Retorno explícito desde el fin del scan al inicio del EGV
        if (mode === 'engrave' && (rasterEndX !== 0 || rasterEndY !== 0)) {
            log(`[M${id}] Retorno scan: (${rasterEndX.toFixed(1)}, ${rasterEndY.toFixed(1)})mm`);
            await laser.jog(rasterEndX, rasterEndY);
        }
    }

    if (!m.jobState.stopped) {
        // Para raster: el EGV ya incluyó el retorno al inicio del EGV.
        // Solo falta deshacer el jog previo (jogX, jogY).
        if (mode === 'engrave' && (rasterJogX !== 0 || rasterJogY !== 0)) {
            log(`[M${id}] Return jog: deshaciendo jog previo (${(-rasterJogX).toFixed(1)}, ${(-rasterJogY).toFixed(1)})mm`);
            try {
                await laser.jog(-rasterJogX, -rasterJogY);
            } catch (e) {
                log(`[M${id}] Error en jog de retorno: ${e.message}`, 'error');
            }
        } else if (mode === 'cut') {
            // Vector: el EGV ya incluye retorno, no necesita jog adicional
        }
        send({ type: 'position', machine: id, x: laser.posX, y: laser.posY });
        send({ type: 'status', machine: id, text: 'Trabajo completado.', level: 'success' });
    }

    m.jobState.running = false;
    send({ type: 'done', machine: id });
}

// ───────── Frame ─────────

async function doFrame(laser, id, bounds) {
    const x = bounds?.x || 0, y = bounds?.y || 0;
    const w = bounds?.w || 400, h = bounds?.h || 400;
    const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];

    await laser.home();
    send({ type: 'position', machine: id, x: 0, y: 0 });

    let prevX = 0, prevY = 0;
    for (const [cx, cy] of corners) {
        await laser.jog(cx - prevX, cy - prevY);
        send({ type: 'position', machine: id, x: laser.posX, y: laser.posY });
        prevX = cx; prevY = cy;
        await sleep(200);
    }
}

// ───────── Helpers ─────────

function send(data) {
    if (client && client.readyState === 1) client.send(JSON.stringify(data));
}

function log(msg, level = 'cmd') {
    const t = new Date().toLocaleTimeString('es-MX', { hour12: false });
    console.log(`[${t}] ${msg}`);
    send({ type: 'status', text: msg, level });
}

function logMachine(id, msg, level = 'cmd') {
    const t = new Date().toLocaleTimeString('es-MX', { hour12: false });
    console.log(`[${t}] [M${id}] ${msg}`);
    send({ type: 'status', machine: id, text: msg, level });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

process.on('SIGINT', () => {
    for (const id of [0, 1]) disconnectMachine(id);
    process.exit(0);
});
