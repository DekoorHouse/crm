'use strict';
// ===================================================================================
// Búsqueda de TEXTO dentro de las conversaciones.
// -----------------------------------------------------------------------------------
// Firestore no tiene búsqueda de texto. Escanear los mensajes por fuerza bruta no es viable aquí:
// hay ~368,000 mensajes en 30 días (medido jul-2026), así que cada búsqueda leería cientos de miles
// de documentos (lenta y cara).
//
// Solución: un ÍNDICE DE PALABRAS. Cada mensaje guarda en el campo `st` (search tokens) las palabras
// que contiene, normalizadas (minúsculas, sin acentos). Buscar es entonces UNA consulta indexada
// (`array-contains`) que devuelve SOLO los mensajes que coinciden: instantánea y con costo = nº de
// resultados, no de mensajes existentes.
//
// El indexado lo hace un CRON (no el webhook): así el camino caliente de recepción de mensajes no se
// toca y, si algo se salta, la siguiente corrida lo recupera. Los mensajes quedan buscables a los
// pocos minutos de llegar (INDEX_LAG_MS + periodo del cron).
//
// LIMITACIÓN CONOCIDA: busca por PALABRA COMPLETA (normalizada). "juan" encuentra "Juan"/"JUAN"/
// "Juán", pero "jua" no encuentra "juan" (Firestore no hace substring sobre arreglos).
// ===================================================================================
const cron = require('node-cron');
const { db, admin } = require('../config');

const TOKENS_FIELD = 'st';           // nombre corto: se replica en ~cientos de miles de docs e índices
const MIN_TOKEN_LEN = 3;             // "y", "de" no aportan; además acota el tamaño del índice
const MAX_TOKEN_LEN = 24;
const MAX_TOKENS = 40;               // tope por mensaje (acota el crecimiento del índice)

const INDEX_CRON = process.env.MSG_INDEX_CRON || '*/3 * * * *';                       // cada 3 min
const INDEX_LAG_MS = parseInt(process.env.MSG_INDEX_LAG_MS || '120000', 10);          // no indexar lo recién llegado
const STATE_DOC_ID = 'messageSearchIndex';

// minúsculas + sin acentos (á->a, ñ->n) para que la búsqueda sea insensible a acentos y mayúsculas.
function normalizeText(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Texto -> palabras únicas normalizadas (>= MIN_TOKEN_LEN). MISMA función para indexar y para buscar:
// si difieren, lo indexado nunca coincidiría con lo buscado.
function tokenize(text) {
    const seen = new Set();
    const out = [];
    for (const raw of normalizeText(text).split(/[^a-z0-9]+/)) {
        if (raw.length < MIN_TOKEN_LEN) continue;
        const t = raw.slice(0, MAX_TOKEN_LEN);
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= MAX_TOKENS) break;
    }
    return out;
}

// Palabras de un mensaje: su texto + la transcripción de la nota de voz (si la tiene).
function tokensForMessage(d) {
    return tokenize([(d && d.text) || '', (d && d.transcription) || ''].join(' '));
}

const toMs = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : (v && v._seconds ? v._seconds * 1000 : 0));
const stateRef = () => db.collection('crm_settings').doc(STATE_DOC_ID);

// ---------------------------------------------------------------------------------
// INDEXADOR: recorre los mensajes por ventana de tiempo y les escribe `st`.
// Avanza un cursor (lastIndexedMs) guardado en Firestore, así sobrevive reinicios de Render.
// Devuelve {scanned, indexed, caughtUp} — caughtUp=false significa que quedó trabajo pendiente.
// ---------------------------------------------------------------------------------
// OJO (decisión de diseño): recorre los CONTACTOS con actividad reciente y, de cada uno, sus mensajes
// nuevos — en vez de un `collectionGroup('messages')` por fecha. Así NO hace falta un índice de grupo
// sobre `timestamp` (que tendría que construirse sobre TODOS los mensajes históricos, millones); los
// índices que usa aquí ya existen: contacts.lastMessageTimestamp y el de campo simple de cada
// subcolección. El único índice nuevo es el de búsqueda (st + timestamp), que solo contiene los
// mensajes ya indexados.
async function indexRecentMessages({ maxContacts = 300, maxPerContact = 300, lagMs = INDEX_LAG_MS } = {}) {
    const snapState = await stateRef().get();
    const st = snapState.exists ? (snapState.data() || {}) : {};
    const now = Date.now();
    const untilMs = now - lagMs;
    // Primera corrida: arranca 30 min atrás (lo viejo lo cubre el backfill).
    const sinceMs = st.lastIndexedMs || (now - 30 * 60 * 1000);
    if (sinceMs >= untilMs) return { scanned: 0, indexed: 0, contacts: 0, caughtUp: true };

    const contactsSnap = await db.collection('contacts_whatsapp')
        .where('lastMessageTimestamp', '>', new Date(sinceMs))
        .orderBy('lastMessageTimestamp', 'asc')
        .limit(maxContacts)
        .get();

    let scanned = 0, indexed = 0;
    for (const c of contactsSnap.docs) {
        const msgs = await c.ref.collection('messages')
            .where('timestamp', '>', new Date(sinceMs))
            .where('timestamp', '<=', new Date(untilMs))
            .orderBy('timestamp', 'asc')
            .limit(maxPerContact)
            .get();
        let writer = db.batch();
        let pending = 0;
        for (const doc of msgs.docs) {
            scanned++;
            const d = doc.data();
            if (Array.isArray(d[TOKENS_FIELD])) continue;        // ya indexado
            const tokens = tokensForMessage(d);
            if (!tokens.length) continue;                        // sin texto (foto/audio sin transcribir)
            writer.update(doc.ref, { [TOKENS_FIELD]: tokens });
            pending++; indexed++;
            if (pending >= 450) { await writer.commit(); writer = db.batch(); pending = 0; }
        }
        if (pending) await writer.commit();
    }

    // El cursor SOLO avanza si alcanzamos a ver todos los contactos activos de la ventana. Si quedaron
    // fuera (lote lleno), repetimos la misma ventana en la próxima corrida: los ya indexados se saltan
    // sin escribir. Avanzar a medias se saltaría mensajes de los contactos que no alcanzamos.
    const caughtUp = contactsSnap.size < maxContacts;
    await stateRef().set({
        lastIndexedMs: caughtUp ? untilMs : sinceMs,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { scanned, indexed, contacts: contactsSnap.size, caughtUp };
}

let task = null;
let running = false;
function startMessageSearchIndexer() {
    if (task) return;
    task = cron.schedule(INDEX_CRON, async () => {
        if (running) return;                    // no encimar corridas
        running = true;
        try {
            const r = await indexRecentMessages();
            if (r.indexed) console.log(`[MSG-INDEX] ${r.indexed} mensajes indexados (${r.scanned} revisados)${r.caughtUp ? '' : ' — quedó pendiente'}`);
        } catch (e) {
            console.warn('[MSG-INDEX] error:', e.message);
        } finally { running = false; }
    });
    console.log(`[MSG-INDEX] Indexador de búsqueda en conversaciones activo (${INDEX_CRON}).`);
}

// ---------------------------------------------------------------------------------
// BÚSQUEDA: una consulta `array-contains` sobre el token MÁS SELECTIVO (el más largo) y, si el
// usuario escribió varias palabras, se exige el resto en memoria sobre esos pocos resultados.
// `beforeMs` pagina hacia atrás en el tiempo ("Ver más"); `sinceMs` acota la ventana.
// Devuelve un resultado por CONTACTO (el mensaje más reciente que coincide).
// ---------------------------------------------------------------------------------
async function searchMessages(query, { limit = 25, beforeMs = null, sinceMs = null, scanCap = 400 } = {}) {
    const tokens = tokenize(query);
    if (!tokens.length) return { results: [], nextBefore: null, done: true, tokens };

    const main = tokens.slice().sort((a, b) => b.length - a.length)[0];   // el más largo = el más raro
    const rest = tokens.filter(t => t !== main);

    let q = db.collectionGroup('messages')
        .where(TOKENS_FIELD, 'array-contains', main)
        .orderBy('timestamp', 'desc');
    if (beforeMs) q = q.where('timestamp', '<', new Date(beforeMs));
    if (sinceMs) q = q.where('timestamp', '>=', new Date(sinceMs));
    const snap = await q.limit(scanCap).get();

    const byContact = new Map();
    let lastMs = null;
    for (const doc of snap.docs) {
        const d = doc.data();
        lastMs = toMs(d.timestamp) || lastMs;
        // Varias palabras: exige TODAS (el índice solo garantizó la principal).
        if (rest.length) {
            const has = Array.isArray(d[TOKENS_FIELD]) ? new Set(d[TOKENS_FIELD]) : new Set();
            if (!rest.every(t => has.has(t))) continue;
        }
        const contactId = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
        if (!contactId || byContact.has(contactId)) continue;   // ya ordenado desc: el 1º es el más reciente
        byContact.set(contactId, {
            contactId,
            messageId: doc.id,
            text: String(d.text || d.transcription || '').slice(0, 300),
            timestamp: toMs(d.timestamp) || null,
            fromClient: String(d.from || '') === String(contactId),
        });
        if (byContact.size >= limit) break;
    }

    // Nombre/canal del contacto (lote).
    const ids = [...byContact.keys()];
    if (ids.length) {
        const refs = ids.map(id => db.collection('contacts_whatsapp').doc(String(id)));
        const docs = await db.getAll(...refs);
        docs.forEach(cd => {
            const r = byContact.get(cd.id);
            if (!r) return;
            const c = cd.exists ? cd.data() : {};
            r.name = c.name || cd.id;
            r.channel = c.channel || 'whatsapp';
            r.lastMessageTimestamp = toMs(c.lastMessageTimestamp) || null;
            // El contacto COMPLETO: el CRM lo mezcla en la lista de chats para poder pintarlo igual
            // que cualquier otro resultado (avatar, etiquetas, no leídos…) y abrirlo al hacer clic.
            r.contact = cd.exists ? { id: cd.id, ...c } : null;
        });
    }

    return {
        results: [...byContact.values()],
        // Cursor para "Ver más": seguimos desde el último mensaje revisado hacia atrás.
        nextBefore: snap.size >= scanCap ? lastMs : null,
        done: snap.size < scanCap,
        tokens,
    };
}

module.exports = { tokenize, tokensForMessage, indexRecentMessages, startMessageSearchIndexer, searchMessages, TOKENS_FIELD };
