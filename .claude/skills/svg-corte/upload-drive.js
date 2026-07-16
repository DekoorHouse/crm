// upload-drive.js — Sube un archivo a la carpeta "SVG Corte" de Google Drive a traves del
// Apps Script del usuario (ver apps-script-uploader.gs). Los archivos quedan como propiedad
// del usuario (las cuentas de servicio ya no tienen cuota en Drive personal).
//
// Uso: node upload-drive.js <ruta-archivo> [folderId]
// Exito: imprime una linea JSON {ok:true, id, name, webViewLink}
'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
    const filePath = process.argv[2];
    const folderId = process.argv[3] || null;
    if (!filePath || !fs.existsSync(filePath)) {
        console.error(JSON.stringify({ ok: false, error: 'Archivo no encontrado: ' + filePath }));
        process.exit(1);
    }

    const cfgPath = path.join(__dirname, 'drive-webapp.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!cfg.url || !cfg.url.startsWith('https://script.google.com/')) {
        console.error(JSON.stringify({ ok: false, error: 'drive-webapp.json sin URL valida del Apps Script (debe terminar en /exec). Ver apps-script-uploader.gs para el setup.' }));
        process.exit(1);
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml'
        : ext === '.png' ? 'image/png'
        : ext === '.cdr' ? 'application/x-coreldraw'
        : 'application/octet-stream';

    const payload = {
        secret: cfg.secret,
        name: path.basename(filePath),
        mimeType: mime,
        b64: fs.readFileSync(filePath).toString('base64'),
    };
    if (folderId) payload.folderId = folderId;

    try {
        const res = await fetch(cfg.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow',
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { ok: false, error: 'Respuesta no-JSON del Apps Script: ' + text.slice(0, 300) }; }
        if (data.ok) {
            console.log(JSON.stringify(data));
        } else {
            console.error(JSON.stringify(data));
            process.exit(1);
        }
    } catch (e) {
        console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
        process.exit(1);
    }
}

main();
