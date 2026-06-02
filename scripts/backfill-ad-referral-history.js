/**
 * Backfill de historial de anuncios (adReferralHistory) para contactos existentes.
 *
 * Antes solo se guardaba el PRIMER anuncio del que vino un contacto (campo `adReferral`).
 * Cada mensaje sí guarda su `adId`, así que aquí reconstruimos el historial COMPLETO de
 * anuncios distintos de los que vino cada contacto, en orden cronológico (por la fecha del
 * primer mensaje recibido desde cada anuncio), y lo guardamos en `adReferralHistory`.
 *
 * El nombre de cada anuncio se toma de:
 *   1) el `adReferral` del propio contacto (si ese anuncio coincide),
 *   2) el `adReferral` de cualquier otro contacto que vino del mismo anuncio (caché global),
 *   3) la Graph API de Meta (si hay META_GRAPH_TOKEN y no se pasa --no-graph),
 *   4) en última instancia, solo el número (#source_id).
 *
 * Uso:
 *   node scripts/backfill-ad-referral-history.js                  # dry-run (no escribe)
 *   node scripts/backfill-ad-referral-history.js --apply          # aplica los cambios
 *   node scripts/backfill-ad-referral-history.js --limit 20       # procesa solo 20 contactos (prueba)
 *   node scripts/backfill-ad-referral-history.js --no-graph       # no consulta nombres a Meta
 *   node scripts/backfill-ad-referral-history.js --force          # reconstruye aunque ya tenga historial
 *
 * Requiere: FIREBASE_SERVICE_ACCOUNT_JSON en .env (y opcional META_GRAPH_TOKEN para nombres).
 */
require('dotenv').config();
const admin = require('firebase-admin');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Mismo criterio que server/config.js: env var en producción, o serviceAccountKey.json local.
function loadServiceAccount() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw && raw.trim()) {
        try { return JSON.parse(raw); }
        catch (e) { console.warn('[firebase] env var presente pero JSON.parse falló:', e.message); }
    }
    const localPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(localPath)) {
        console.log('[firebase] usando serviceAccountKey.json local');
        return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
    throw new Error('No se encontró FIREBASE_SERVICE_ACCOUNT_JSON válido ni serviceAccountKey.json local.');
}

const APPLY = process.argv.includes('--apply');
const NO_GRAPH = process.argv.includes('--no-graph');
const FORCE = process.argv.includes('--force');
const GRAPH_TOKEN = process.env.META_GRAPH_TOKEN;
const limitArg = process.argv.find(a => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt((limitArg.split('=')[1] || process.argv[process.argv.indexOf(limitArg) + 1]), 10) : null;

function tsMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
}
function tsDate(ts) {
    const ms = tsMs(ts);
    return ms ? new Date(ms).toISOString().slice(0, 10) : 'sin fecha';
}

// Sembrar la caché global adId -> datos del anuncio a partir de un adReferral.
function seedMeta(adMeta, ref) {
    if (ref && ref.source_id) {
        const id = String(ref.source_id);
        if (!adMeta.has(id)) {
            adMeta.set(id, {
                ad_name: ref.ad_name || null,
                source_type: ref.source_type || null,
                source_url: ref.source_url || null,
                headline: ref.headline || null,
                body: ref.body || null
            });
        }
    }
}

// Trae solo los mensajes con adId (mucho menos lecturas). Si la query falla, cae a un scan completo.
async function fetchAdMessages(contactRef) {
    try {
        const snap = await contactRef.collection('messages')
            .where('adId', '!=', null)
            .select('adId', 'timestamp')
            .get();
        return snap.docs.map(d => d.data()).filter(d => d.adId);
    } catch (e) {
        const snap = await contactRef.collection('messages')
            .select('adId', 'timestamp')
            .get();
        return snap.docs.map(d => d.data()).filter(d => d.adId);
    }
}

// Lista de anuncios distintos en orden cronológico (por primer mensaje con ese adId).
function buildDistinctAds(messages, contact) {
    const msgs = messages.slice().sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
    const seen = new Set();
    const distinct = [];
    for (const m of msgs) {
        const id = String(m.adId);
        if (!seen.has(id)) {
            seen.add(id);
            distinct.push({ source_id: id, firstSeenAt: m.timestamp || null });
        }
    }
    // Garantizar que el anuncio original (adReferral) esté incluido, aunque sus mensajes ya no existan.
    const refId = contact.adReferral && contact.adReferral.source_id ? String(contact.adReferral.source_id) : null;
    if (refId && !seen.has(refId)) {
        distinct.unshift({ source_id: refId, firstSeenAt: contact.createdAt || null });
    }
    return distinct;
}

function buildEntry(d, contact, adMeta) {
    const id = d.source_id;
    // Si coincide con el adReferral del contacto, conservar TODOS sus datos ricos.
    if (contact.adReferral && String(contact.adReferral.source_id) === id) {
        return { ...contact.adReferral, source_id: id, firstSeenAt: d.firstSeenAt || contact.adReferral.firstSeenAt || null };
    }
    const meta = adMeta.get(id) || {};
    const entry = { source_id: id, source_type: meta.source_type || 'ad', firstSeenAt: d.firstSeenAt || null };
    if (meta.ad_name) entry.ad_name = meta.ad_name;
    if (meta.source_url) entry.source_url = meta.source_url;
    if (meta.headline) entry.headline = meta.headline;
    if (meta.body) entry.body = meta.body;
    return entry;
}

async function resolveName(id) {
    try {
        const r = await axios.get(`https://graph.facebook.com/v18.0/${id}`, {
            params: { fields: 'name', access_token: GRAPH_TOKEN }
        });
        return r.data && r.data.name ? r.data.name : null;
    } catch (e) {
        return null;
    }
}

async function main() {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
    const db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });

    console.log(`Modo: ${APPLY ? 'APPLY (escribe a Firestore)' : 'DRY-RUN (no escribe)'}`);
    console.log(`Nombres vía Graph API: ${(!NO_GRAPH && GRAPH_TOKEN) ? 'sí' : 'no'}${(!NO_GRAPH && !GRAPH_TOKEN) ? ' (falta META_GRAPH_TOKEN)' : ''}`);
    if (LIMIT) console.log(`Límite de contactos a procesar: ${LIMIT}`);
    if (FORCE) console.log('FORCE: se reconstruirá aunque ya exista adReferralHistory.');
    console.log('');

    console.log('Cargando contactos...');
    const snap = await db.collection('contacts_whatsapp').get();
    console.log(`Total contactos: ${snap.size}`);

    // Caché global de metadatos de anuncios + selección de candidatos.
    const adMeta = new Map();
    const candidates = [];
    let alreadyHave = 0;

    snap.docs.forEach(doc => {
        const data = doc.data();
        seedMeta(adMeta, data.adReferral);
        if (!(data.adReferral && data.adReferral.source_id)) return; // solo contactos que vinieron de un anuncio
        if (!FORCE && Array.isArray(data.adReferralHistory) && data.adReferralHistory.length) {
            alreadyHave++;
            return;
        }
        candidates.push({ ref: doc.ref, id: doc.id, data });
    });

    console.log(`Contactos con anuncio (adReferral): ${candidates.length + alreadyHave}`);
    console.log(`  - ya tienen historial (se omiten): ${alreadyHave}`);
    console.log(`  - a procesar: ${candidates.length}`);
    console.log(`Anuncios distintos conocidos por nombre (caché): ${adMeta.size}\n`);

    const toProcess = LIMIT ? candidates.slice(0, LIMIT) : candidates;

    // Pass 1: reconstruir anuncios distintos por contacto y recolectar IDs sin nombre.
    console.log('Reconstruyendo historial desde los mensajes...');
    const unknownIds = new Set();
    let i = 0;
    for (const c of toProcess) {
        i++;
        if (i % 100 === 0) console.log(`  ${i}/${toProcess.length}`);
        const messages = await fetchAdMessages(c.ref);
        c.distinct = buildDistinctAds(messages, c.data);
        for (const d of c.distinct) {
            const meta = adMeta.get(d.source_id);
            const isOwnRef = c.data.adReferral && String(c.data.adReferral.source_id) === d.source_id;
            if (!isOwnRef && (!meta || !meta.ad_name)) unknownIds.add(d.source_id);
        }
    }

    // Pass 2: resolver nombres faltantes vía Graph API (una sola vez por anuncio).
    let resolved = 0, graphFails = 0;
    if (!NO_GRAPH && GRAPH_TOKEN && unknownIds.size) {
        console.log(`\nResolviendo ${unknownIds.size} nombres de anuncio vía Graph API...`);
        let k = 0;
        for (const id of unknownIds) {
            k++;
            if (k % 25 === 0) console.log(`  ${k}/${unknownIds.size}`);
            const name = await resolveName(id);
            if (name) {
                const prev = adMeta.get(id) || {};
                adMeta.set(id, { ...prev, ad_name: name, source_type: prev.source_type || 'ad' });
                resolved++;
            } else {
                graphFails++;
            }
        }
    }

    // Pass 3: armar el adReferralHistory final.
    const toUpdate = [];
    let multiAd = 0, totalAds = 0;
    for (const c of toProcess) {
        const history = (c.distinct || []).map(d => buildEntry(d, c.data, adMeta));
        if (!history.length) continue;
        if (history.length > 1) multiAd++;
        totalAds += history.length;
        toUpdate.push({ ref: c.ref, id: c.id, history });
    }

    console.log(`\nResumen:`);
    console.log(`  Contactos a actualizar: ${toUpdate.length}`);
    console.log(`  - con varios anuncios: ${multiAd}`);
    console.log(`  - con un solo anuncio: ${toUpdate.length - multiAd}`);
    console.log(`  Anuncios reconstruidos en total: ${totalAds}`);
    console.log(`  Nombres resueltos vía Graph: ${resolved} (fallidos: ${graphFails})\n`);

    // Muestra: priorizar contactos con varios anuncios.
    const sample = toUpdate.slice().sort((a, b) => b.history.length - a.history.length).slice(0, 8);
    console.log('Muestra (los de más anuncios primero):');
    sample.forEach(it => {
        const list = it.history.map(h => `#${h.source_id}${h.ad_name ? `(${h.ad_name})` : ''}@${tsDate(h.firstSeenAt)}`).join('  →  ');
        console.log(`  ${it.id} [${it.history.length}]: ${list}`);
    });

    if (!APPLY) {
        console.log('\n(Dry-run. Vuelve a correr con --apply para escribir.)');
        return;
    }

    console.log('\nEscribiendo en lotes de 400...');
    let written = 0;
    for (let j = 0; j < toUpdate.length; j += 400) {
        const chunk = toUpdate.slice(j, j + 400);
        const batch = db.batch();
        chunk.forEach(it => batch.update(it.ref, { adReferralHistory: it.history }));
        await batch.commit();
        written += chunk.length;
        console.log(`  ${written}/${toUpdate.length}`);
    }

    console.log(`\n✅ ${written} contactos actualizados con adReferralHistory.`);
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); }).finally(() => process.exit());
}

// Exportado para pruebas de la lógica pura (sin Firestore).
module.exports = { tsMs, buildDistinctAds, buildEntry };
