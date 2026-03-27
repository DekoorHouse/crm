const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bridge = require('./bridge');

const router = express.Router();

// --------------- SVG Preprocessor for Laser ---------------
// Rule: non-black fills → stroke (cut outline), black fills → keep (engrave)
function preprocessSvgForCut(svgContent) {
    return svgContent.replace(
        /<(path|circle|rect|ellipse|polygon|polyline|text)\b([^>]*?)(\/?)>/gi,
        (match, tag, attrs, selfClose) => {
            const fill = getAttr(attrs, 'fill') || getStyleProp(attrs, 'fill');
            const stroke = getAttr(attrs, 'stroke') || getStyleProp(attrs, 'stroke');
            if (!fill || fill === 'none' || fill === 'transparent') return match;
            if (isBlackColor(fill)) return match;

            // Non-black fill → convert to stroke for cutting the outline
            let newAttrs = hasStyleProp(attrs, 'fill')
                ? setStyleProp(attrs, 'fill', 'none')
                : setAttr(attrs, 'fill', 'none');
            if (!stroke || stroke === 'none') {
                newAttrs = hasStyleProp(newAttrs, 'stroke')
                    ? setStyleProp(newAttrs, 'stroke', fill)
                    : setAttr(newAttrs, 'stroke', fill);
            }
            return `<${tag}${newAttrs}${selfClose}>`;
        }
    );
}

function getAttr(attrs, name) {
    const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
    return m ? m[1].trim().toLowerCase() : null;
}

function getStyleProp(attrs, prop) {
    const st = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
    if (!st) return null;
    const m = st[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
    return m ? m[1].trim().toLowerCase() : null;
}

function hasStyleProp(attrs, prop) {
    return getStyleProp(attrs, prop) !== null;
}

function setAttr(attrs, name, value) {
    const re = new RegExp(`\\b${name}\\s*=\\s*"[^"]*"`, 'i');
    return re.test(attrs)
        ? attrs.replace(re, `${name}="${value}"`)
        : attrs + ` ${name}="${value}"`;
}

function setStyleProp(attrs, prop, value) {
    return attrs.replace(/(\bstyle\s*=\s*")([^"]*)(")/i, (_, pre, style, post) => {
        const re = new RegExp(`(^|;\\s*)${prop}\\s*:[^;]*`, 'i');
        const newStyle = re.test(style)
            ? style.replace(re, `$1${prop}:${value}`)
            : style + `;${prop}:${value}`;
        return pre + newStyle + post;
    });
}

function isBlackColor(color) {
    const c = color.replace(/\s/g, '').toLowerCase();
    return c === 'black' || c === '#000' || c === '#000000' || c === 'rgb(0,0,0)';
}

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

    // For cut mode + SVG: preprocess to convert non-black fills to strokes
    let loadPath = currentFilePath;
    if (mode !== 'raster' && currentFilePath.toLowerCase().endsWith('.svg')) {
        try {
            const svgContent = fs.readFileSync(currentFilePath.replace(/\//g, '\\'), 'utf8');
            const processed = preprocessSvgForCut(svgContent);
            const cutPath = currentFilePath.replace(/\.svg$/i, '-cut.svg').replace(/\//g, '\\');
            fs.writeFileSync(cutPath, processed, 'utf8');
            loadPath = path.resolve(cutPath).replace(/\\/g, '/');
        } catch (e) { /* fallback to original */ }
    }

    // Build piped command for atomic sequential execution in MeerK40t
    let cmd = `spool clear | element* delete | operation* delete | load ${loadPath} | element* position 0 0 | operation* enable | operation* speed ${speed}`;
    if (mode === 'raster' && dpi) {
        cmd += ` | operation* dpi ${dpi}`;
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
