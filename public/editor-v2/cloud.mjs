import { validateDocument, objectsWithContents } from './model.mjs';

let connection;
export async function connect() {
    if (!connection) connection = initialize().catch(error => { connection = null; throw error; });
    return connection;
}
async function initialize() {
    const [appSdk, authSdk, dbSdk, storageSdk] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js'),
    ]);
    const app = appSdk.getApps().find(app => app.name === '[DEFAULT]') || appSdk.initializeApp({
        apiKey: 'AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg',
        authDomain: 'pedidos-con-gemini.firebaseapp.com', projectId: 'pedidos-con-gemini',
        storageBucket: 'pedidos-con-gemini.firebasestorage.app',
        messagingSenderId: '300825194175', appId: '1:300825194175:web:972fa7b8af195a83e6e00a',
    });
    const auth = authSdk.getAuth(app), db = dbSdk.getFirestore(app);
    await auth.authStateReady();
    const storage = storageSdk.getStorage(app), uploaded = new Map(), urls = new Map();
    const media = {
        // Uploads the images not uploaded yet and returns where each one is (data URL → Storage URL).
        // Images are remembered by their data URL, so saving every few seconds neither hashes nor
        // uploads them again.
        async prepare(document) {
            const found = new Map();
            for (const object of objectsWithContents(document.objects)) {
                if (object.type !== 'image' || !object.src.startsWith('data:') || found.has(object.src)) continue;
                if (!urls.has(object.src)) {
                    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(object.src));
                    const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
                    const path = `editor-v2/images/${auth.currentUser.uid}/${hash}`;
                    if (!uploaded.has(path)) {
                        const reference = storageSdk.ref(storage, path);
                        await storageSdk.uploadString(reference, object.src, 'data_url');
                        uploaded.set(path, await storageSdk.getDownloadURL(reference));
                    }
                    urls.set(object.src, uploaded.get(path));
                }
                found.set(object.src, urls.get(object.src));
            }
            return found;
        },
        async hydrate(document) {
            for (const object of objectsWithContents(document.objects)) {
                if (object.type !== 'image' || object.src.startsWith('data:')) continue;
                const response = await fetch(object.src);
                if (!response.ok) throw new Error('No se pudo cargar una imagen del proyecto.');
                const blob = await response.blob();
                if (blob.size > 10 * 1024 * 1024) throw new Error('Una imagen supera el límite de 10 MB.');
                const url = object.src;
                object.src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
                // Already in Storage: saving the project again does not upload it again.
                urls.set(object.src, url);
            }
            return validateDocument(document);
        },
    };
    return {
        get user() { return auth.currentUser; },
        // The CRM API accepts the Firebase ID token of an allowed account.
        async token() { return auth.currentUser ? auth.currentUser.getIdToken() : null; },
        // Licensed fonts live in Storage, not in the public repository (see fonts.mjs).
        fonts: {
            async url(file) {
                try { return await storageSdk.getDownloadURL(storageSdk.ref(storage, `editor-v2/fonts/${file}`)); }
                catch (error) { if (error?.code === 'storage/object-not-found') return null; throw error; }
            },
            async upload(file, bytes) {
                if (!auth.currentUser) throw new Error('Inicia sesión para subir la fuente.');
                await storageSdk.uploadBytes(storageSdk.ref(storage, `editor-v2/fonts/${file}`), bytes, { contentType: 'font/ttf', cacheControl: 'private, max-age=31536000' });
            },
        },
        watch(callback) { return authSdk.onAuthStateChanged(auth, callback); },
        async login(email, password) { await authSdk.signInWithEmailAndPassword(auth, email, password); },
        ...createProjectRepository(dbSdk, db, () => auth.currentUser, media),
    };
}

// Every save keeps the latest design; at most every VERSION_INTERVAL a save also keeps a version in the
// project's "versions" subcollection (the newest MAX_VERSIONS; their list lives in the project itself).
export const VERSION_INTERVAL = 10 * 60 * 1000, MAX_VERSIONS = 30;
const conflict = () => Object.assign(new Error('Este proyecto cambió en otra sesión. Abre la versión reciente o guarda una copia para conservar tus cambios.'), { code: 'editor/conflict' });
export function createProjectRepository(dbSdk, db, getUser, media = { prepare: async () => null, hydrate: async document => document }) {
    const projects = dbSdk.collection(db, 'editor_v2_projects');
    const versionsOf = reference => dbSdk.collection(reference, 'versions');
    const requireUser = () => {
        const user = getUser();
        if (!user) throw new Error('Inicia sesión para acceder a Firebase.');
        return user;
    };
    return {
        async list() {
            requireUser();
            const result = await dbSdk.getDocsFromServer(dbSdk.query(projects, dbSdk.orderBy('updatedAt', 'desc'), dbSdk.limit(100)));
            return result.docs.map(doc => ({ id: doc.id, name: doc.data().name, updatedAt: doc.data().updatedAt?.toDate(), count: doc.data().objectCount }));
        },
        async load(id) {
            requireUser();
            const snapshot = await dbSdk.getDocFromServer(dbSdk.doc(projects, id));
            if (!snapshot.exists()) throw new Error('El proyecto ya no existe.');
            const data = snapshot.data();
            if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('La versión del proyecto no es compatible.');
            return { document: await media.hydrate(validateDocument(JSON.parse(data.documentJson))), binding: { id, revision: data.revision } };
        },
        async versions(id) {
            requireUser();
            const snapshot = await dbSdk.getDocFromServer(dbSdk.doc(projects, id));
            if (!snapshot.exists()) throw new Error('El proyecto ya no existe.');
            return (snapshot.data().versions || []).map(version => ({ id: version.id, savedAt: new Date(version.savedAt), count: version.objectCount }));
        },
        async loadVersion(id, versionId) {
            requireUser();
            const snapshot = await dbSdk.getDocFromServer(dbSdk.doc(versionsOf(dbSdk.doc(projects, id)), versionId));
            if (!snapshot.exists()) throw new Error('Esa versión ya no existe.');
            return media.hydrate(validateDocument(JSON.parse(snapshot.data().documentJson)));
        },
        async save(document, binding, now = Date.now()) {
            const user = requireUser(), validated = validateDocument(document), located = await media.prepare(validated);
            const documentJson = JSON.stringify(validated, located?.size ? (key, value) => key === 'src' && located.has(value) ? located.get(value) : value : undefined);
            if (new TextEncoder().encode(documentJson).length > 850000) throw new Error('El proyecto supera el tamaño admitido en Firebase. Descarga una copia local.');
            const reference = binding ? dbSdk.doc(projects, binding.id) : dbSdk.doc(projects);
            const revision = await dbSdk.runTransaction(db, async transaction => {
                const snapshot = await transaction.get(reference);
                if (binding && (!snapshot.exists() || snapshot.data().revision !== binding.revision)) throw conflict();
                const revision = binding ? binding.revision + 1 : 1;
                const data = { name: validated.name, documentJson, revision, objectCount: validated.objects.length,
                    updatedAt: dbSdk.serverTimestamp(), updatedBy: user.uid };
                if (!binding) { data.createdAt = dbSdk.serverTimestamp(); data.createdBy = user.uid; }
                const versions = (binding && snapshot.data().versions) || [];
                if (!versions.length || now - versions[0].savedAt >= VERSION_INTERVAL) {
                    const version = dbSdk.doc(versionsOf(reference));
                    transaction.set(version, { name: data.name, documentJson, revision, objectCount: data.objectCount, savedAt: now, savedBy: user.uid });
                    const kept = [{ id: version.id, savedAt: now, objectCount: data.objectCount, revision }, ...versions];
                    for (const old of kept.slice(MAX_VERSIONS)) transaction.delete(dbSdk.doc(versionsOf(reference), old.id));
                    data.versions = kept.slice(0, MAX_VERSIONS);
                }
                transaction.set(reference, data, { merge: true });
                return revision;
            });
            return { id: reference.id, revision };
        },
    };
}

export function cloudError(error) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(error.code)) return 'Revisa tu correo y contraseña.';
    if (error.code === 'auth/too-many-requests') return 'Demasiados intentos. Espera unos minutos antes de volver a entrar.';
    if (error.code === 'permission-denied') return 'Tu sesión no tiene permiso para acceder a estos proyectos.';
    if (['unavailable', 'auth/network-request-failed'].includes(error.code) || error instanceof TypeError) return 'No se pudo conectar con Firebase. Revisa tu conexión; tu borrador local se conserva.';
    return error.message || 'No se pudo completar la operación.';
}
