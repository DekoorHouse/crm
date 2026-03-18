const { db, bucket } = require('../config');

const STORAGE_FOLDER = 'autopost';

async function fetchAvailablePhotos() {
    const [files] = await bucket.getFiles({ prefix: `${STORAGE_FOLDER}/` });

    // Filtrar solo imagenes
    const photos = files.filter(file => {
        const name = file.name.toLowerCase();
        return (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp'))
            && file.name !== `${STORAGE_FOLDER}/`;
    });

    // Generar URLs firmadas para thumbnails
    const result = [];
    for (const file of photos) {
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 24 * 60 * 60 * 1000 // 24 horas
        });
        result.push({
            id: file.name,
            filename: file.name.split('/').pop(),
            mimeType: file.metadata.contentType || 'image/jpeg',
            size: file.metadata.size,
            createdAt: file.metadata.timeCreated,
            thumbnailUrl: url
        });
    }

    return result;
}

async function pickUnpostedPhoto(photos) {
    if (!photos.length) return null;

    // Obtener IDs ya publicados
    const logSnapshot = await db.collection('auto_post_log')
        .where('status', '==', 'success')
        .select('photoId')
        .get();

    const postedIds = new Set(logSnapshot.docs.map(d => d.data().photoId));

    // Encontrar la primera foto no publicada
    return photos.find(photo => !postedIds.has(photo.id)) || null;
}

async function downloadPhoto(fileId) {
    const file = bucket.file(fileId);
    const [buffer] = await file.download();
    return buffer;
}

async function getPhotoPublicUrl(fileId) {
    const file = bucket.file(fileId);
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${fileId}`;
}

async function uploadPhoto(buffer, filename, mimeType) {
    const filePath = `${STORAGE_FOLDER}/${filename}`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
        metadata: { contentType: mimeType },
        resumable: false
    });

    console.log(`[PHOTOS] Foto subida: ${filePath}`);
    return filePath;
}

async function deletePhoto(fileId) {
    const file = bucket.file(fileId);
    await file.delete();
    console.log(`[PHOTOS] Foto eliminada: ${fileId}`);
}

module.exports = {
    fetchAvailablePhotos,
    pickUnpostedPhoto,
    downloadPhoto,
    getPhotoPublicUrl,
    uploadPhoto,
    deletePhoto
};
