'use strict';
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

function storageService(bucket) {
    async function save(key, bytes, contentType) {
        const token = randomUUID();
        await bucket.file(key).save(bytes, { resumable: false, metadata: { contentType,
            metadata: { firebaseStorageDownloadTokens: token } } });
        return { path: key, url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(key)}?alt=media&token=${token}` };
    }
    return {
        async saveSheet(jobId, index, result) {
            const base = `svg-corte/server/${jobId}/${index}`;
            const svg = await save(base + '.svg', Buffer.from(result.svg), 'image/svg+xml');
            const natural = await save(base + '-natural.svg', Buffer.from(result.naturalSvg), 'image/svg+xml');
            const preview = await save(base + '.png', result.preview, 'image/png');
            return { svg, natural, preview };
        },
        async read(key) { const [bytes] = await bucket.file(key).download(); return bytes; }
    };
}

async function uploadDrive(name, bytes) {
    // Same authorized folder as the previous worker; secrets never enter logs or API responses.
    const fallback = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.claude/skills/svg-corte/drive-webapp.json'), 'utf8'));
    const response = await fetch(process.env.SVG_CUT_DRIVE_URL || fallback.url, {
        method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            secret: process.env.SVG_CUT_DRIVE_SECRET || fallback.secret,
            name, mimeType: 'image/svg+xml', b64: bytes.toString('base64')
        })
    });
    let data;
    try { data = JSON.parse(await response.text()); } catch (_) { throw new Error('Drive no confirmó la subida (respuesta no JSON).'); }
    if (!response.ok || !data.ok || !data.id || !data.webViewLink) throw new Error('Drive no confirmó la subida del archivo.');
    return { id: data.id, name: data.name || name, webViewLink: data.webViewLink };
}
// ID de Drive de un link «…/file/d/<id>/view» (o el id tal cual).
const driveIdOf = value => (String(value || '').match(/\/d\/([\w-]{20,})/) || String(value || '').match(/^([\w-]{20,})$/) || [])[1] || null;

// Manda a la PAPELERA de Drive un archivo de la carpeta SVG Corte que ya no se usa (reemplazado). El Apps Script
// solo acepta archivos de esa carpeta. Necesita la versión del script con la acción «trash» (con la vieja falla y
// no borra nada).
async function trashDrive(fileOrUrl) {
    const id = driveIdOf(fileOrUrl);
    if (!id) throw new Error('No reconozco el archivo de Drive.');
    const fallback = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.claude/skills/svg-corte/drive-webapp.json'), 'utf8'));
    const response = await fetch(process.env.SVG_CUT_DRIVE_URL || fallback.url, {
        method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(60000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: process.env.SVG_CUT_DRIVE_SECRET || fallback.secret, action: 'trash', id }),
    });
    let data;
    try { data = JSON.parse(await response.text()); } catch (_) { throw new Error('Drive no confirmó (respuesta no JSON).'); }
    if (!data.ok) throw new Error(/base64|undefined/i.test(data.error || '') ? 'el script de Drive todavía no tiene la acción para borrar (hay que actualizarlo)' : (data.error || 'Drive no lo mandó a la papelera.'));
    return { id, name: data.name || '' };
}
module.exports = { storageService, uploadDrive, trashDrive, driveIdOf };
