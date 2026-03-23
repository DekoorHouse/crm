/**
 * Script para crear las paginas iniciales en Firestore.
 * Ejecutar una sola vez: node server/autopost/seedPages.js
 *
 * IMPORTANTE: Asegurate de tener FIREBASE_SERVICE_ACCOUNT_JSON configurado
 * o el archivo de credenciales accesible.
 */
require('dotenv').config();
const { db } = require('../config');

const pages = [
    {
        name: 'Dekoor House',
        fbPageId: '1853281218308124',
        accessToken: process.env.FB_PAGE_ACCESS_TOKEN || 'PEGAR_TOKEN_AQUI',
        storageFolder: 'dekoor-house',
        brandPrompt: 'Dekoor House',
        enabled: true,
        createdAt: new Date()
    },
    {
        name: 'Dekoor',
        fbPageId: '110927358587213',
        accessToken: 'EAAe16CH16cUBRLFDeAZAbF7nX2DWMNXc5uIgiQ6rCbNEoIHXXyhNxi8SAi8A5yYjqFmfX2y8AzETCuB6dXRuHGlMCZB9Taoz8wOI5dFTzrkDBGS0x9VlWt9bhr6hFCtlcSXC1eTAaubgGpNKaGfwcj9ZCDLpp2fWZATZCAZBZBjBRWnQ69Be8gwUkFisTdwIFcaUDkGZCbNlDduJDZBuq0zucpZBsJaSzItZCMleXDW0QZDZD',
        storageFolder: 'dekoor',
        brandPrompt: 'Dekoor',
        enabled: true,
        createdAt: new Date()
    }
];

async function seed() {
    console.log('Creando paginas en Firestore...');

    for (const page of pages) {
        // Verificar si ya existe
        const existing = await db.collection('autopost_pages')
            .where('fbPageId', '==', page.fbPageId)
            .get();

        if (!existing.empty) {
            console.log(`  -> ${page.name} ya existe (${existing.docs[0].id}), actualizando...`);
            await db.collection('autopost_pages').doc(existing.docs[0].id).update(page);
        } else {
            const ref = await db.collection('autopost_pages').add(page);
            console.log(`  -> ${page.name} creada (${ref.id})`);
        }
    }

    console.log('Listo! Paginas configuradas.');
    process.exit(0);
}

seed().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
