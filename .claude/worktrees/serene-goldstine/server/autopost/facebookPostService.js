const FormData = require('form-data');
const axios = require('axios');
const { bucket } = require('../config');

async function publishPhotoToPage(imageBuffer, caption, pageConfig) {
    const pageId = pageConfig?.fbPageId || process.env.FB_PAGE_ID;
    const pageToken = pageConfig?.accessToken || process.env.FB_PAGE_ACCESS_TOKEN;

    if (!pageId || !pageToken) {
        throw new Error('FB_PAGE_ID o FB_PAGE_ACCESS_TOKEN no configurados.');
    }

    const form = new FormData();
    form.append('source', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    form.append('message', caption);
    form.append('access_token', pageToken);

    const url = `https://graph.facebook.com/v21.0/${pageId}/photos`;

    const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    const postId = response.data.post_id || response.data.id;
    console.log(`[FB PUBLISH] Foto publicada en Facebook. Post ID: ${postId}`);
    return postId;
}

async function publishPhotoToInstagram(imageBuffer, caption, mimeType, pageConfig) {
    const pageId = pageConfig?.fbPageId || process.env.FB_PAGE_ID;
    const pageToken = pageConfig?.accessToken || process.env.FB_PAGE_ACCESS_TOKEN;

    if (!pageId || !pageToken) {
        throw new Error('FB_PAGE_ID o FB_PAGE_ACCESS_TOKEN no configurados.');
    }

    // 1. Obtener el Instagram Business Account ID de la pagina
    const pageResponse = await axios.get(`https://graph.facebook.com/v21.0/${pageId}`, {
        params: { fields: 'instagram_business_account', access_token: pageToken }
    });

    const igUserId = pageResponse.data.instagram_business_account?.id;
    if (!igUserId) {
        throw new Error('No hay cuenta de Instagram vinculada a esta pagina de Facebook.');
    }

    // 2. Subir imagen temporal a Firebase Storage para obtener URL publica
    const tempFileName = `autopost_temp/ig_${Date.now()}.jpg`;
    const file = bucket.file(tempFileName);
    await file.save(imageBuffer, {
        metadata: { contentType: mimeType || 'image/jpeg' },
        resumable: false
    });

    const [imageUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 30 * 60 * 1000 // 30 minutos
    });

    try {
        // 3. Crear container de media en Instagram
        const containerResponse = await axios.post(
            `https://graph.facebook.com/v21.0/${igUserId}/media`,
            {
                image_url: imageUrl,
                caption: caption,
                access_token: pageToken
            }
        );

        const containerId = containerResponse.data.id;
        console.log(`[IG PUBLISH] Container creado: ${containerId}`);

        // 4. Esperar un momento para que Instagram procese la imagen
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 5. Publicar el container
        const publishResponse = await axios.post(
            `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
            {
                creation_id: containerId,
                access_token: pageToken
            }
        );

        const mediaId = publishResponse.data.id;
        console.log(`[IG PUBLISH] Foto publicada en Instagram. Media ID: ${mediaId}`);
        return mediaId;

    } finally {
        // Limpiar imagen temporal
        try { await file.delete(); } catch (e) { /* ignorar */ }
    }
}

async function verifyPageToken(pageConfig) {
    const pageToken = pageConfig?.accessToken || process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) return { valid: false, error: 'Token no configurado' };

    try {
        // Verificar token con campos basicos
        const response = await axios.get('https://graph.facebook.com/v21.0/me', {
            params: { access_token: pageToken, fields: 'id,name' }
        });

        // Intentar obtener Instagram (opcional)
        let hasInstagram = false;
        let igAccountId = null;
        try {
            const igResponse = await axios.get(`https://graph.facebook.com/v21.0/${response.data.id}`, {
                params: { access_token: pageToken, fields: 'instagram_business_account' }
            });
            hasInstagram = !!igResponse.data.instagram_business_account;
            igAccountId = igResponse.data.instagram_business_account?.id;
        } catch (e) { /* Instagram no disponible */ }

        return {
            valid: true,
            pageId: response.data.id,
            pageName: response.data.name,
            instagram: hasInstagram,
            igAccountId
        };
    } catch (error) {
        return { valid: false, error: error.response?.data?.error?.message || error.message };
    }
}

module.exports = { publishPhotoToPage, publishPhotoToInstagram, verifyPageToken };
