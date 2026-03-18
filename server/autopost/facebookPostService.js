const FormData = require('form-data');
const axios = require('axios');

async function publishPhotoToPage(imageBuffer, caption) {
    const pageId = process.env.FB_PAGE_ID;
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;

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
    console.log(`[FB PUBLISH] Foto publicada exitosamente. Post ID: ${postId}`);
    return postId;
}

async function verifyPageToken() {
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) return { valid: false, error: 'Token no configurado' };

    try {
        const response = await axios.get('https://graph.facebook.com/v21.0/me', {
            params: { access_token: pageToken, fields: 'id,name,access_token' }
        });
        return { valid: true, pageId: response.data.id, pageName: response.data.name };
    } catch (error) {
        return { valid: false, error: error.response?.data?.error?.message || error.message };
    }
}

module.exports = { publishPhotoToPage, verifyPageToken };
