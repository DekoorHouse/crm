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
    const storage = storageSdk.getStorage(app), uploaded = new Map();
    const media = {
        async prepare(document) {
            const copy = structuredClone(document);
            for (const object of objectsWithContents(copy.objects)) {
                if (object.type !== 'image' || !object.src.startsWith('data:')) continue;
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(object.src));
                const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
                const path = `editor-v2/images/${auth.currentUser.uid}/${hash}`;
                if (!uploaded.has(path)) {
                    const reference = storageSdk.ref(storage, path);
                    await storageSdk.uploadString(reference, object.src, 'data_url');
                    uploaded.set(path, await storageSdk.getDownloadURL(reference));
                }
                object.src = uploaded.get(path);
            }
            return copy;
        },
        async hydrate(document) {
            for (const object of objectsWithContents(document.objects)) {
                if (object.type !== 'image' || object.src.startsWith('data:')) continue;
                const response = await fetch(object.src);
                if (!response.ok) throw new Error('No se pudo cargar una imagen del proyecto.');
                const blob = await response.blob();
                if (blob.size > 10 * 1024 * 1024) throw new Error('Una imagen supera el límite de 10 MB.');
                object.src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
            }
            return validateDocument(document);
        },
    };
    return {
        get user() { return auth.currentUser; },
        watch(callback) { return authSdk.onAuthStateChanged(auth, callback); },
        async login(email, password) { await authSdk.signInWithEmailAndPassword(auth, email, password); },
        ...createProjectRepository(dbSdk, db, () => auth.currentUser, media),
    };
}

export function createProjectRepository(dbSdk, db, getUser, media = { prepare: async document => document, hydrate: async document => document }) {
    const projects = dbSdk.collection(db, 'editor_v2_projects');
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
        async save(document, binding) {
            const user = requireUser(), validated = validateDocument(document);
            const documentJson = JSON.stringify(await media.prepare(validated));
            if (new TextEncoder().encode(documentJson).length > 850000) throw new Error('El proyecto supera el tamaño admitido en Firebase. Descarga una copia local.');
            const reference = binding ? dbSdk.doc(projects, binding.id) : dbSdk.doc(projects);
            const revision = await dbSdk.runTransaction(db, async transaction => {
                const snapshot = await transaction.get(reference);
                if (binding && (!snapshot.exists() || snapshot.data().revision !== binding.revision)) {
                    throw new Error('Este proyecto cambió en otra sesión. Abre la versión reciente o guarda una copia para conservar tus cambios.');
                }
                const revision = binding ? binding.revision + 1 : 1;
                const data = { name: validated.name, documentJson, revision, objectCount: validated.objects.length,
                    updatedAt: dbSdk.serverTimestamp(), updatedBy: user.uid };
                if (!binding) { data.createdAt = dbSdk.serverTimestamp(); data.createdBy = user.uid; }
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
