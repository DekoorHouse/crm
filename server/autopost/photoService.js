const { db, bucket } = require('../config');

const STORAGE_FOLDER = 'autopost';

// Filtrar archivos de imagen validos (excluye thumbnails auto-generados)
function filterOriginalPhotos(files) {
    return files.filter(file => {
        const name = file.name.toLowerCase();
        const isImage = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
        const isFolder = file.name === `${STORAGE_FOLDER}/`;

        // Solo archivos directamente en autopost/, no subdirectorios (ej: autopost/thumbs/)
        const relativePath = file.name.slice(STORAGE_FOLDER.length + 1);
        const isDirectChild = relativePath.length > 0 && !relativePath.includes('/');

        // Excluir thumbnails auto-generados (ej: _200x200, thumb_, etc.)
        const isThumbnail = /_\d+x\d+\./.test(relativePath) || /thumb/i.test(relativePath);

        return isImage && !isFolder && isDirectChild && !isThumbnail;
    });
}

async function fetchAvailablePhotos() {
    const [files] = await bucket.getFiles({ prefix: `${STORAGE_FOLDER}/` });
    const photos = filterOriginalPhotos(files);

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

// Listar solo IDs/filenames sin generar URLs (rapido, para cola)
async function listPhotoIds() {
    const [files] = await bucket.getFiles({ prefix: `${STORAGE_FOLDER}/` });
    return filterOriginalPhotos(files).map(file => ({
        id: file.name,
        filename: file.name.split('/').pop()
    }));
}

async function uploadPhoto(buffer, filename, mimeType) {
    const filePath = `${STORAGE_FOLDER}/${filename}`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
        metadata: {
            contentType: mimeType,
            metadata: { uploadedBy: 'autopost' }
        },
        resumable: false
    });

    console.log(`[PHOTOS] Foto subida: ${filePath}`);
    return filePath;
}

async function deletePhoto(fileId) {
    const file = bucket.file(fileId);
    await file.delete();
    console.log(`[PHOTOS] Foto eliminada: ${fileId}`);

    // Limpiar thumbnails asociados (generados por Firebase Extensions)
    const basename = fileId.split('/').pop().replace(/\.[^.]+$/, '');
    try {
        const [allFiles] = await bucket.getFiles({ prefix: `${STORAGE_FOLDER}/` });
        for (const f of allFiles) {
            if (f.name !== fileId && f.name.includes(basename)) {
                await f.delete();
                console.log(`[PHOTOS] Thumbnail eliminado: ${f.name}`);
            }
        }
    } catch (err) {
        console.error(`[PHOTOS] Error limpiando thumbnails: ${err.message}`);
    }
}

module.exports = {
    fetchAvailablePhotos,
    listPhotoIds,
    pickUnpostedPhoto,
    downloadPhoto,
    getPhotoPublicUrl,
    uploadPhoto,
    deletePhoto
};
