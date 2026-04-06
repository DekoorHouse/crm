const { db } = require('../config');

const PAGES_COLLECTION = 'autopost_pages';

async function getPages() {
    const snapshot = await db.collection(PAGES_COLLECTION).orderBy('name').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getEnabledPages() {
    const snapshot = await db.collection(PAGES_COLLECTION)
        .where('enabled', '==', true)
        .orderBy('name')
        .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getPage(pageId) {
    const doc = await db.collection(PAGES_COLLECTION).doc(pageId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

async function createPage({ name, fbPageId, accessToken, storageFolder, brandPrompt, enabled = true }) {
    const docRef = await db.collection(PAGES_COLLECTION).add({
        name,
        fbPageId,
        accessToken,
        storageFolder: storageFolder || name.toLowerCase().replace(/\s+/g, '-'),
        brandPrompt: brandPrompt || name,
        enabled,
        createdAt: new Date()
    });
    return docRef.id;
}

async function updatePage(pageId, data) {
    await db.collection(PAGES_COLLECTION).doc(pageId).update(data);
}

async function deletePage(pageId) {
    await db.collection(PAGES_COLLECTION).doc(pageId).delete();
}

module.exports = { getPages, getEnabledPages, getPage, createPage, updatePage, deletePage };
