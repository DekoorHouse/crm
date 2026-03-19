const cron = require('node-cron');
const { db } = require('../config');
const { fetchAvailablePhotos, listPhotoIds, pickUnpostedPhoto, downloadPhoto, deletePhoto } = require('./photoService');
const { generateCaption } = require('./captionService');
const { publishPhotoToPage, publishPhotoToInstagram } = require('./facebookPostService');

let scheduledTask = null;

async function executeAutoPost() {
    console.log('[AUTOPOST] Iniciando proceso de auto-publicacion...');

    const logEntry = {
        startedAt: new Date(),
        status: 'in_progress'
    };

    try {
        // 1. Obtener fotos disponibles en Firebase Storage
        console.log('[AUTOPOST] Buscando fotos en Firebase Storage (autopost/)...');
        const photos = await fetchAvailablePhotos();
        console.log(`[AUTOPOST] Se encontraron ${photos.length} fotos.`);

        if (!photos.length) {
            logEntry.status = 'skipped';
            logEntry.error = 'No hay fotos en la carpeta autopost/.';
            await saveLog(logEntry);
            console.log('[AUTOPOST] No hay fotos. Proceso omitido.');
            return logEntry;
        }

        // 2. Seleccionar foto no publicada
        const photo = await pickUnpostedPhoto(photos);
        if (!photo) {
            logEntry.status = 'skipped';
            logEntry.error = 'Todas las fotos ya fueron publicadas.';
            await saveLog(logEntry);
            console.log('[AUTOPOST] Todas las fotos ya fueron publicadas. Proceso omitido.');
            return logEntry;
        }

        logEntry.photoId = photo.id;
        logEntry.photoFilename = photo.filename;
        console.log(`[AUTOPOST] Foto seleccionada: ${photo.filename}`);

        // 3. Descargar la imagen
        console.log('[AUTOPOST] Descargando imagen...');
        const imageBuffer = await downloadPhoto(photo.id);
        const mimeType = photo.mimeType || 'image/jpeg';

        // 4. Generar caption con Gemini
        console.log('[AUTOPOST] Generando caption con IA...');
        const caption = await generateCaption(imageBuffer, mimeType);
        logEntry.caption = caption;
        console.log(`[AUTOPOST] Caption generado: "${caption}"`);

        // 5. Publicar en Facebook
        console.log('[AUTOPOST] Publicando en Facebook...');
        const fbPostId = await publishPhotoToPage(imageBuffer, caption);
        logEntry.fbPostId = fbPostId;
        console.log(`[AUTOPOST] Facebook OK! Post ID: ${fbPostId}`);

        // 6. Publicar en Instagram
        try {
            console.log('[AUTOPOST] Publicando en Instagram...');
            const igMediaId = await publishPhotoToInstagram(imageBuffer, caption, mimeType);
            logEntry.igMediaId = igMediaId;
            console.log(`[AUTOPOST] Instagram OK! Media ID: ${igMediaId}`);
        } catch (igError) {
            console.error(`[AUTOPOST] Error en Instagram (FB si se publico): ${igError.message}`);
            logEntry.igError = igError.message;
        }

        logEntry.status = 'success';
        logEntry.completedAt = new Date();
        await saveLog(logEntry);

        // Eliminar foto de Storage despues de publicar
        try {
            await deletePhoto(photo.id);
            console.log(`[AUTOPOST] Foto eliminada de Storage: ${photo.filename}`);
        } catch (delErr) {
            console.error(`[AUTOPOST] Error eliminando foto: ${delErr.message}`);
        }

        return logEntry;

    } catch (error) {
        logEntry.status = 'failed';
        logEntry.error = error.message;
        logEntry.completedAt = new Date();
        await saveLog(logEntry);
        console.error(`[AUTOPOST] Error: ${error.message}`);
        return logEntry;
    }
}

async function previewNextPost() {
    const photos = await fetchAvailablePhotos();
    const photo = await pickUnpostedPhoto(photos);

    if (!photo) {
        return { message: 'No hay fotos disponibles para publicar. Sube fotos a la carpeta autopost/ en Firebase Storage.' };
    }

    const imageBuffer = await downloadPhoto(photo.id);
    const caption = await generateCaption(imageBuffer, photo.mimeType || 'image/jpeg');

    const base64Image = imageBuffer.toString('base64');

    return {
        photoId: photo.id,
        filename: photo.filename,
        caption,
        imagePreview: `data:${photo.mimeType || 'image/jpeg'};base64,${base64Image}`
    };
}

async function saveLog(entry) {
    try {
        await db.collection('auto_post_log').add(entry);
    } catch (err) {
        console.error('[AUTOPOST] Error guardando log:', err.message);
    }
}

async function getLog(limit = 20) {
    const snapshot = await db.collection('auto_post_log')
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function startScheduler() {
    const enabled = process.env.AUTOPOST_ENABLED === 'true';
    // Default: cada 3 horas de 9am a 9pm (9,12,15,18,21)
    const cronExpression = process.env.AUTOPOST_CRON || '0 9,12,15,18,21 * * *';

    if (!enabled) {
        console.log('[AUTOPOST] Scheduler desactivado (AUTOPOST_ENABLED != true).');
        return;
    }

    if (!cron.validate(cronExpression)) {
        console.error(`[AUTOPOST] Expresion cron invalida: ${cronExpression}`);
        return;
    }

    scheduledTask = cron.schedule(cronExpression, async () => {
        console.log(`[AUTOPOST] Cron disparado: ${new Date().toISOString()}`);
        await executeAutoPost();
    }, {
        timezone: 'America/Mexico_City'
    });

    console.log(`[AUTOPOST] Scheduler iniciado. Cron: "${cronExpression}" (America/Mexico_City)`);
}

function stopScheduler() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('[AUTOPOST] Scheduler detenido.');
    }
}

function getSchedulerStatus() {
    return {
        enabled: process.env.AUTOPOST_ENABLED === 'true',
        running: scheduledTask !== null,
        cron: process.env.AUTOPOST_CRON || '0 9,12,15,18,21 * * *',
        timezone: 'America/Mexico_City'
    };
}

async function getUpcomingQueue() {
    const enabled = process.env.AUTOPOST_ENABLED === 'true';
    if (!enabled) return [];

    const photos = await fetchAvailablePhotos();
    if (!photos.length) return [];

    // Obtener IDs ya publicados
    const logSnapshot = await db.collection('auto_post_log')
        .where('status', '==', 'success')
        .select('photoId')
        .get();
    const postedIds = new Set(logSnapshot.docs.map(d => d.data().photoId));
    const unposted = photos.filter(p => !postedIds.has(p.id));

    if (!unposted.length) return [];

    // Calcular proximos horarios del cron
    const cronExpr = process.env.AUTOPOST_CRON || '0 9,12,15,18,21 * * *';
    const hours = cronExpr.split(' ')[1].split(',').map(Number).sort((a, b) => a - b);

    const now = new Date();
    const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const offsetMs = now.getTime() - mxNow.getTime();

    const queue = [];
    const startDay = new Date(mxNow);
    startDay.setHours(0, 0, 0, 0);

    for (let d = 0; d < 60 && queue.length < unposted.length; d++) {
        const dayDate = new Date(startDay);
        dayDate.setDate(startDay.getDate() + d);

        for (const hour of hours) {
            if (queue.length >= unposted.length) break;

            const mxTime = new Date(dayDate);
            mxTime.setHours(hour, 0, 0, 0);

            if (mxTime > mxNow) {
                const absoluteTime = new Date(mxTime.getTime() + offsetMs);
                queue.push({
                    photoFilename: unposted[queue.length].filename,
                    thumbnailUrl: unposted[queue.length].thumbnailUrl,
                    scheduledAt: absoluteTime
                });
            }
        }
    }

    return queue;
}

module.exports = {
    executeAutoPost,
    previewNextPost,
    getLog,
    getUpcomingQueue,
    startScheduler,
    stopScheduler,
    getSchedulerStatus
};
