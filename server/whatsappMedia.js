const axios = require('axios');
const { bucket } = require('./config');
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

async function downloadAndUploadMedia(mediaId, from) {
    try {
        console.log(`[MEDIA] Iniciando descarga para mediaId: ${mediaId}`);
        // 1. Get temporary URL from Meta
        const metaUrlResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            timeout: 30000,
        });

        const mediaUrl = metaUrlResponse.data?.url;
        if (!mediaUrl) {
            throw new Error(`No se pudo obtener la URL del medio para el ID: ${mediaId}`);
        }
        const mimeType = metaUrlResponse.data?.mime_type || 'application/octet-stream';
        const fileExtension = mimeType.split('/')[1] || 'bin';

        // 2. Download file stream from Meta
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            responseType: "stream",
            timeout: 60000,
        });

        // 3. Upload stream to Firebase Storage
        const filePath = `whatsapp_media/${from}/${mediaId}.${fileExtension}`;
        const file = bucket.file(filePath);
        const stream = file.createWriteStream({
            metadata: {
                contentType: mimeType,
            },
        });

        return new Promise((resolve, reject) => {
            mediaResponse.data.on('error', error => { stream.destroy(error); reject(error); });
            mediaResponse.data.pipe(stream)
                .on('finish', async () => {
                    console.log(`[MEDIA] Archivo ${filePath} subido a Firebase Storage.`);
                    try {
                        let publicUrl;
                        try {
                            // El bucket usa Uniform Bucket-Level Access y bloquea el acceso
                            // anónimo, así que las URLs públicas clásicas (storage.googleapis.com)
                            // dan 403. Usamos un token de descarga de Firebase: URL permanente
                            // y compatible con UBLA (no depende de ACLs por objeto).
                            const downloadToken = require('crypto').randomUUID();
                            await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
                            publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
                        } catch (tokenErr) {
                            // Respaldo para buckets sin UBLA: ACL pública clásica.
                            console.warn(`[MEDIA] token de descarga falló, intentando makePublic(). ${tokenErr.message}`);
                            await file.makePublic();
                            publicUrl = file.publicUrl();
                        }
                        console.log(`[MEDIA] URL pública generada: ${publicUrl}`);
                        resolve({ publicUrl, mimeType });
                    } catch (finalErr) {
                        // Si ni el token ni makePublic funcionan, el caller usa el
                        // proxy (/webhook/wa/media/:id) como último respaldo.
                        console.error(`[MEDIA] No se pudo generar URL pública para ${filePath}:`, finalErr);
                        reject(finalErr);
                    }
                })
                .on('error', (error) => {
                    console.error(`[MEDIA] Error al subir el archivo a Firebase Storage:`, error);
                    reject(error);
                });
        });

    } catch (error) {
        console.error(`[MEDIA] Falló el proceso de descarga y subida para mediaId ${mediaId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { downloadAndUploadMedia };
