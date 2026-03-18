const { google } = require('googleapis');
const { db } = require('../config');

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];
const SETTINGS_DOC = 'crm_settings/autopost_google';

function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_PHOTOS_CLIENT_ID,
        process.env.GOOGLE_PHOTOS_CLIENT_SECRET,
        process.env.GOOGLE_PHOTOS_REDIRECT_URI
    );
}

function getAuthUrl() {
    const client = getOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
}

async function handleAuthCallback(code) {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);

    // Guardar refresh token en Firestore para persistencia
    await db.doc(SETTINGS_DOC).set({
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiryDate: tokens.expiry_date,
        updatedAt: new Date()
    }, { merge: true });

    console.log('[GOOGLE PHOTOS] Tokens guardados exitosamente en Firestore.');
    return tokens;
}

async function getAuthenticatedClient() {
    const client = getOAuth2Client();

    // Intentar obtener refresh token de Firestore
    const doc = await db.doc(SETTINGS_DOC).get();
    const data = doc.data();

    if (!data?.refreshToken) {
        throw new Error('No hay refresh token. Autoriza Google Photos primero en /api/autopost/google/auth');
    }

    client.setCredentials({
        refresh_token: data.refreshToken,
        access_token: data.accessToken,
        expiry_date: data.expiryDate
    });

    // Refrescar token si expiró
    const tokenInfo = await client.getAccessToken();
    if (tokenInfo.token !== data.accessToken) {
        await db.doc(SETTINGS_DOC).set({
            accessToken: tokenInfo.token,
            expiryDate: client.credentials.expiry_date,
            updatedAt: new Date()
        }, { merge: true });
    }

    return client;
}

async function fetchRecentPhotos(maxResults = 20) {
    const client = await getAuthenticatedClient();
    const accessToken = (await client.getAccessToken()).token;

    const albumId = process.env.AUTOPOST_ALBUM_ID;

    // Si hay álbum configurado, buscar en ese álbum
    if (albumId) {
        const response = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                albumId,
                pageSize: maxResults
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Google Photos API error: ${response.status} - ${err}`);
        }

        const data = await response.json();
        return (data.mediaItems || []).filter(item => item.mimeType?.startsWith('image/'));
    }

    // Sin álbum, buscar fotos recientes (últimas 48 horas)
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const response = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            pageSize: maxResults,
            filters: {
                dateFilter: {
                    ranges: [{
                        startDate: {
                            year: twoDaysAgo.getFullYear(),
                            month: twoDaysAgo.getMonth() + 1,
                            day: twoDaysAgo.getDate()
                        },
                        endDate: {
                            year: now.getFullYear(),
                            month: now.getMonth() + 1,
                            day: now.getDate()
                        }
                    }]
                },
                mediaTypeFilter: {
                    mediaTypes: ['PHOTO']
                }
            }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Google Photos API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.mediaItems || [];
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

async function downloadPhoto(baseUrl) {
    // Agregar parámetros para obtener resolución completa
    const downloadUrl = `${baseUrl}=w2048-h2048`;
    const response = await fetch(downloadUrl);

    if (!response.ok) {
        throw new Error(`Error descargando foto: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function listAlbums() {
    const client = await getAuthenticatedClient();
    const accessToken = (await client.getAccessToken()).token;

    const albums = [];
    let nextPageToken = null;

    do {
        const url = new URL('https://photoslibrary.googleapis.com/v1/albums');
        url.searchParams.set('pageSize', '50');
        if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

        const response = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Google Photos API error: ${response.status} - ${err}`);
        }

        const data = await response.json();
        if (data.albums) albums.push(...data.albums);
        nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    return albums.map(a => ({ id: a.id, title: a.title, mediaItemsCount: a.mediaItemsCount }));
}

module.exports = {
    getAuthUrl,
    handleAuthCallback,
    fetchRecentPhotos,
    pickUnpostedPhoto,
    downloadPhoto,
    listAlbums
};
