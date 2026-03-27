const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bridge = require('./bridge');

const router = express.Router();

// Temporary directory for uploaded files
const uploadDir = path.join(os.tmpdir(), 'laser-uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// Track the current loaded file path for atomic start
let currentFilePath = null;

// POST /api/laser/command — Send a console command to MeerK40t
router.post('/command', (req, res) => {
    const { cmd } = req.body;
    if (!cmd) {
        return res.json({ success: false, message: 'No se envió comando' });
    }
    const sent = bridge.send(cmd);
    if (!sent) {
        return res.json({ success: false, message: 'No hay conexión con MeerK40t' });
    }
    res.json({ success: true });
});

// GET /api/laser/status — Check bridge connection status
router.get('/status', (req, res) => {
    res.json({
        success: true,
        connected: bridge.connected,
        host: bridge.host,
        port: bridge.port
    });
});

// POST /api/laser/upload — Upload file and load it in MeerK40t
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.json({ success: false, message: 'No se subió archivo' });
    }

    // Rename to keep original extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newPath = req.file.path + ext;
    fs.renameSync(req.file.path, newPath);

    // Convert to absolute path with forward slashes for MeerK40t
    const absPath = path.resolve(newPath).replace(/\\/g, '/');

    // Clear everything before loading new file
    bridge.send('spool clear');
    bridge.send('element* delete');
    bridge.send('operation* delete');
    const sent = bridge.send(`load ${absPath}`);
    if (!sent) {
        fs.unlinkSync(newPath);
        return res.json({ success: false, message: 'No hay conexión con MeerK40t' });
    }

    currentFilePath = absPath;

    res.json({
        success: true,
        message: 'Archivo cargado en MeerK40t',
        filename: req.file.originalname,
        path: absPath
    });
});

// POST /api/laser/start — Atomic clear + load + configure + execute via pipe
router.post('/start', (req, res) => {
    if (!currentFilePath) {
        return res.json({ success: false, message: 'No hay archivo cargado' });
    }

    const { speed, mode, dpi } = req.body;
    if (!speed) {
        return res.json({ success: false, message: 'Falta velocidad' });
    }

    // Build piped command for atomic sequential execution in MeerK40t
    let cmd = `spool clear | element* delete | operation* delete | load ${currentFilePath} | element* position 0 0`;

    if (mode === 'raster') {
        // Raster: keep auto-classified ops, just set speed/dpi
        cmd += ` | operation* enable | operation* speed ${speed}`;
        if (dpi) cmd += ` | operation* dpi ${dpi}`;
    } else {
        // Cut: force stroke + no fill so classify creates only cut ops
        cmd += ` | element* stroke black | element* fill none | operation* delete | cut -s ${speed} | classify | operation* enable`;
    }

    cmd += ' | plan copy preprocess validate blob spool';

    // Start the device pipe first
    bridge.send('start');
    const sent = bridge.send(cmd);
    if (!sent) {
        return res.json({ success: false, message: 'No hay conexión con MeerK40t' });
    }
    res.json({ success: true });
});

// POST /api/laser/restart — Restart the server (process exits, bat loop restarts it)
router.post('/restart', (req, res) => {
    res.json({ success: true, message: 'Reiniciando servidor...' });
    setTimeout(() => process.exit(0), 500);
});

module.exports = { router, bridge };
