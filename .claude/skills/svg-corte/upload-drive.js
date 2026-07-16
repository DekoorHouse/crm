// upload-drive.js — Sube un archivo a la carpeta "SVG Corte" de Google Drive usando la
// cuenta de servicio del repo (serviceAccountKey.json). Requiere que la carpeta este
// compartida (como Editor) con el correo de la cuenta de servicio.
//
// Uso: node upload-drive.js <ruta-archivo> [folderId]
// Exito: imprime una linea JSON {ok:true, id, name, webViewLink}
'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const FOLDER_SVG_CORTE = '1FhMAUghuLI7u58hPJbV8ZWk9hJ5JOG4b';

async function main() {
    const filePath = process.argv[2];
    const folderId = process.argv[3] || FOLDER_SVG_CORTE;
    if (!filePath || !fs.existsSync(filePath)) {
        console.error(JSON.stringify({ ok: false, error: 'Archivo no encontrado: ' + filePath }));
        process.exit(1);
    }

    const keyPath = path.resolve(__dirname, '..', '..', '..', 'serviceAccountKey.json');
    if (!fs.existsSync(keyPath)) {
        console.error(JSON.stringify({ ok: false, error: 'No existe serviceAccountKey.json en la raiz del repo' }));
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });

    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';

    try {
        const res = await drive.files.create({
            requestBody: { name: path.basename(filePath), parents: [folderId] },
            media: { mimeType: mime, body: fs.createReadStream(filePath) },
            fields: 'id, name, webViewLink',
            supportsAllDrives: true,
        });
        console.log(JSON.stringify({ ok: true, ...res.data }));
    } catch (e) {
        const code = e && e.code;
        let hint = '';
        if (code === 404 || code === 403) {
            hint = 'La carpeta no esta compartida con la cuenta de servicio. Compartir "SVG Corte" (Editor) con: firebase-adminsdk-fbsvc@pedidos-con-gemini.iam.gserviceaccount.com';
        }
        console.error(JSON.stringify({ ok: false, code, error: String(e.message || e), hint }));
        process.exit(1);
    }
}

main();
