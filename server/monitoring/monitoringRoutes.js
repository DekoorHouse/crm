/**
 * Rutas de diagnóstico de las dos redes de seguridad. Cuelgan de /api, así que ya pasan por
 * apiAuth (server/apiAuth.js) — no hay endpoint público que dispare WhatsApps.
 *
 * Watchdog de Firebase:
 *  GET /api/monitoring/watchdog/status        → estado en memoria (última caída, último OK…)
 *  GET /api/monitoring/watchdog/test          → manda el mensaje de prueba y dice por dónde salió
 *  GET /api/monitoring/watchdog/run           → un chequeo ya
 *  GET /api/monitoring/watchdog/run?forzar=1  → simulacro: recorre el aviso de caída completo
 *
 * Mensajes sin atender:
 *  GET /api/monitoring/sin-atender/run?dryRun=1  → reporta sin avisar ni marcar (empieza por aquí)
 *  GET /api/monitoring/sin-atender/run           → barrido real
 *  GET /api/monitoring/sin-atender/run?force=1   → reavisa aunque ya se hubiera reportado
 */
const express = require('express');
const router = express.Router();

const { runChequeoWatchdog, enviarAlertaDePrueba, estadoWatchdog } = require('./firebaseWatchdog');
const { runBarridoSinAtender } = require('./mensajesSinAtender');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/watchdog/status', (req, res) => res.json(estadoWatchdog()));

router.get('/watchdog/test', asyncHandler(async (req, res) => {
    try {
        res.json({ ok: true, ...(await enviarAlertaDePrueba()) });
    } catch (e) {
        // 200 con ok:false a propósito: el motivo del fallo (ventana de 24 h, token vencido) es
        // justo lo que se viene a averiguar, y se lee mejor así que en un stack trace de 500.
        res.json({ ok: false, error: e.message });
    }
}));

router.get('/watchdog/run', asyncHandler(async (req, res) => {
    res.json(await runChequeoWatchdog({ forzarAlerta: req.query.forzar === '1' }));
}));

router.get('/sin-atender/run', asyncHandler(async (req, res) => {
    res.json(await runBarridoSinAtender({
        dryRun: req.query.dryRun === '1',
        force: req.query.force === '1'
    }));
}));

module.exports = router;
