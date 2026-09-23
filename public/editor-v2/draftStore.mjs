// The working draft lives in IndexedDB, which holds hundreds of MB; localStorage (about 5 MB) is only a
// fallback and the place older drafts are migrated from. Each embedded image is stored once, under its
// fingerprint, so a save only writes the images that are new.
import { separateImages, restoreImages, packDocument, unpackDocument, rememberImageToken } from './model.mjs';

const legacyKey = 'dekoor.editor-v2.document.v1';
let opening = null, legacy = false, stored = new Set(), queue = Promise.resolve();

function open() {
    opening ??= new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('IndexedDB no está disponible.')); return; }
        const request = indexedDB.open('dekoor-editor-v2', 1);
        request.onupgradeneeded = () => { request.result.createObjectStore('draft'); request.result.createObjectStore('images'); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB está bloqueado por otra pestaña.'));
    });
    return opening;
}
const ask = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const finished = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el borrador.'));
});

function readLegacy() {
    const saved = localStorage.getItem(legacyKey);
    return saved ? { document: unpackDocument(saved), meta: JSON.parse(localStorage.getItem(legacyKey + '.cloud') || 'null') } : null;
}

// Resolves to { document, meta } or null when there is no draft; rejects when a draft cannot be read.
export async function loadDraft() {
    let db;
    try { db = await open(); }
    catch { legacy = true; return readLegacy(); }
    const transaction = db.transaction(['draft', 'images']), images = transaction.objectStore('images');
    const [record, keys, values] = await Promise.all([ask(transaction.objectStore('draft').get('current')), ask(images.getAllKeys()), ask(images.getAll())]);
    if (!record) return readLegacy();
    stored = new Set(keys);
    keys.forEach((key, i) => rememberImageToken(values[i], key));
    return { document: restoreImages(JSON.parse(record.json), new Map(keys.map((key, i) => [key, values[i]]))), meta: record.meta };
}

// Saves run one after another; images no longer in the document are removed in the same transaction.
export function saveDraft(document, meta) {
    const { json, images } = separateImages(document);
    const run = queue.then(async () => {
        if (legacy) {
            localStorage.setItem(legacyKey, packDocument(document));
            localStorage.setItem(legacyKey + '.cloud', JSON.stringify(meta));
            return;
        }
        const db = await open(), transaction = db.transaction(['draft', 'images'], 'readwrite'), store = transaction.objectStore('images');
        for (const [token, src] of images) if (!stored.has(token)) store.put(src, token);
        for (const token of stored) if (!images.has(token)) store.delete(token);
        transaction.objectStore('draft').put({ json, meta, savedAt: Date.now() }, 'current');
        await finished(transaction);
        stored = new Set(images.keys());
        try { localStorage.removeItem(legacyKey); localStorage.removeItem(legacyKey + '.cloud'); } catch {}
    });
    queue = run.catch(() => {});
    return run;
}
