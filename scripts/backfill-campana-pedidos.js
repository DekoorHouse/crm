/**
 * Backfill retroactivo: taguea pedidos con `campana_id` + `plantilla_origen`
 * cruzando contactId con el historial de mensajes de plantilla WhatsApp.
 *
 * Patrón:
 *   Cuando se manda una plantilla desde el CRM (endpoints /api/campaigns/*),
 *   el mensaje queda registrado en contacts_whatsapp/{contactId}/messages
 *   con `from == PHONE_NUMBER_ID` y un texto del tipo:
 *     "📄 Plantilla: dekoor_promo_mayo_porta_retrato"
 *     "🖼️ Plantilla con imagen: dekoor_promo_mayo_segunda_lampara"
 *
 * Algoritmo:
 *   Para cada pedido SIN campana_id, creado >= campana.fecha_inicio:
 *     1. Trae mensajes del contacto donde timestamp <= pedido.createdAt
 *     2. Extrae nombres de plantilla recibidas que estén en campana.plantillas
 *     3. Si recibió EXACTAMENTE UNA plantilla → taguea
 *     4. Si recibió 2+ o 0 → skip (queda para revisión manual)
 *
 * Uso:
 *   node scripts/backfill-campana-pedidos.js <campana_id> --dry-run
 *   node scripts/backfill-campana-pedidos.js <campana_id> --apply
 *
 * Para obtener el id de la campaña: Firebase Console > Firestore > campanas
 * O leer el id desde Firestore con --list para listar campañas activas.
 *
 * Requiere: FIREBASE_SERVICE_ACCOUNT_JSON en .env (igual que otros scripts)
 */
require('dotenv').config();
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIST = args.includes('--list');
const campanaIdArg = args.find(a => !a.startsWith('--'));

if (!LIST && !campanaIdArg) {
    console.error('Uso: node scripts/backfill-campana-pedidos.js <campana_id> [--dry-run|--apply]');
    console.error('     node scripts/backfill-campana-pedidos.js --list   (lista campañas)');
    process.exit(1);
}

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
    console.error('Error inicializando Firebase Admin. Verifica FIREBASE_SERVICE_ACCOUNT_JSON en .env');
    process.exit(1);
}

const db = admin.firestore();

// Regex que matchea los formatos generados por buildAdvancedTemplatePayload()
// en server/apiRoutes.js:3210-3240. Captura el nombre de la plantilla.
//   "📄 Plantilla: dekoor_promo_mayo_porta_retrato"
//   "🖼️ Plantilla con imagen: dekoor_promo_mayo_segunda_lampara"
//   "🎬 Plantilla con video: foo"
//   "📄 Plantilla con documento: bar"
const PLANTILLA_REGEX = /Plantilla(?:\s+con\s+(?:imagen|video|documento))?\s*:\s*([A-Za-z0-9_\-]+)/i;

async function listCampanas() {
    const snap = await db.collection('campanas').orderBy('creada_en', 'desc').get();
    console.log(`\nCampañas en Firestore (${snap.size}):`);
    snap.docs.forEach(d => {
        const data = d.data();
        const ini = data.fecha_inicio?.toDate().toISOString().slice(0, 10) || '—';
        const fin = data.fecha_fin?.toDate().toISOString().slice(0, 10) || '—';
        const plantillas = Object.keys(data.plantillas || {});
        console.log(`  ${d.id}  [${data.estatus || 'activa'}]  ${data.nombre}`);
        console.log(`    ${ini} → ${fin}`);
        console.log(`    plantillas: ${plantillas.join(', ') || '(ninguna)'}`);
    });
    console.log('');
}

async function getCampana(campanaId) {
    const doc = await db.collection('campanas').doc(campanaId).get();
    if (!doc.exists) {
        console.error(`No existe campana ${campanaId}.`);
        process.exit(1);
    }
    const data = doc.data();
    const plantillas = Object.keys(data.plantillas || {});
    if (plantillas.length === 0) {
        console.error(`La campaña ${campanaId} no tiene plantillas declaradas. Edítala primero.`);
        process.exit(1);
    }
    return {
        id: doc.id,
        nombre: data.nombre,
        fecha_inicio: data.fecha_inicio?.toDate(),
        fecha_fin: data.fecha_fin?.toDate(),
        plantillas: new Set(plantillas) // Set para lookup O(1)
    };
}

/**
 * Extrae el set de plantillas de la campaña que recibió el contacto
 * antes del timestamp dado.
 */
async function getPlantillasRecibidasAntes(contactId, beforeTimestamp, plantillasValidas) {
    if (!contactId) return new Set();
    const msgsSnap = await db
        .collection('contacts_whatsapp')
        .doc(contactId)
        .collection('messages')
        .where('timestamp', '<=', beforeTimestamp)
        .get();

    const found = new Set();
    msgsSnap.docs.forEach(m => {
        const data = m.data();
        // Solo mensajes salientes (de nuestro PHONE_NUMBER_ID) son plantillas
        // pero el endpoint guarda `from: PHONE_NUMBER_ID` así que también filtramos.
        // Robustez: filtra por texto que matchee el patrón, sin importar `from`.
        const text = typeof data.text === 'string' ? data.text : '';
        const m2 = text.match(PLANTILLA_REGEX);
        if (m2) {
            const name = m2[1];
            if (plantillasValidas.has(name)) {
                found.add(name);
            }
        }
    });
    return found;
}

async function processCampana(campanaId) {
    const campana = await getCampana(campanaId);
    console.log(`\nCampaña: "${campana.nombre}" (${campanaId})`);
    console.log(`Rango:    ${campana.fecha_inicio?.toISOString().slice(0, 10)} → ${campana.fecha_fin?.toISOString().slice(0, 10)}`);
    console.log(`Plantillas: ${[...campana.plantillas].join(', ')}`);
    console.log(`Modo:     ${DRY_RUN ? 'DRY-RUN (no escribe)' : 'APPLY (escribe a Firestore)'}\n`);

    // Pedidos sin tag, creados >= fecha_inicio. NO acotamos por fecha_fin porque
    // conversiones tardías (1-2 semanas después) siguen siendo válidas para la campaña.
    const inicioTs = admin.firestore.Timestamp.fromDate(campana.fecha_inicio);
    const pedidosSnap = await db
        .collection('pedidos')
        .where('createdAt', '>=', inicioTs)
        .get();

    console.log(`Pedidos creados desde inicio de campaña: ${pedidosSnap.size}`);

    let stats = {
        total: 0,
        skipYaTagueado: 0,
        skipSinContactId: 0,
        skipSinPlantilla: 0,
        skipMultiplesPlantillas: 0,
        tagged: 0,
        errores: 0,
        muestras: { tagged: [], multi: [], sin: [] }
    };

    let batch = db.batch();
    let batchOps = 0;
    const BATCH_LIMIT = 400; // Firestore límite 500, dejamos margen
    let batchesFlushed = 0;

    for (const pedidoDoc of pedidosSnap.docs) {
        stats.total++;
        const pedido = pedidoDoc.data();

        // 1. Skip si ya tiene tag (idempotencia)
        if (pedido.campana_id) {
            stats.skipYaTagueado++;
            continue;
        }

        // 2. Skip si no tiene contactId (no podemos cruzar mensajes)
        if (!pedido.contactId) {
            stats.skipSinContactId++;
            continue;
        }

        // 3. Cruza: ¿qué plantillas de la campaña recibió antes de comprar?
        try {
            const recibidas = await getPlantillasRecibidasAntes(
                pedido.contactId,
                pedido.createdAt,
                campana.plantillas
            );

            if (recibidas.size === 0) {
                stats.skipSinPlantilla++;
                if (stats.muestras.sin.length < 3) {
                    stats.muestras.sin.push(`DH${pedido.consecutiveOrderNumber} (contactId: ${pedido.contactId})`);
                }
                continue;
            }

            if (recibidas.size > 1) {
                stats.skipMultiplesPlantillas++;
                if (stats.muestras.multi.length < 5) {
                    stats.muestras.multi.push(`DH${pedido.consecutiveOrderNumber} → recibió: ${[...recibidas].join(', ')}`);
                }
                continue;
            }

            // 4. Una sola plantilla → taguear
            const plantilla = [...recibidas][0];
            stats.tagged++;
            if (stats.muestras.tagged.length < 5) {
                stats.muestras.tagged.push(`DH${pedido.consecutiveOrderNumber} → ${plantilla}`);
            }

            if (!DRY_RUN) {
                batch.update(pedidoDoc.ref, {
                    campana_id: campanaId,
                    plantilla_origen: plantilla
                });
                batchOps++;
                if (batchOps >= BATCH_LIMIT) {
                    await batch.commit();
                    batchesFlushed++;
                    batchOps = 0;
                    batch = db.batch(); // firebase-admin: nueva instancia tras commit
                }
            }
        } catch (err) {
            stats.errores++;
            console.warn(`Error procesando pedido ${pedidoDoc.id}: ${err.message}`);
        }
    }

    if (!DRY_RUN && batchOps > 0) {
        await batch.commit();
        batchesFlushed++;
    }

    console.log('\n— Resultados —');
    console.log(`Total pedidos analizados:    ${stats.total}`);
    console.log(`  Ya tagueados (skip):       ${stats.skipYaTagueado}`);
    console.log(`  Sin contactId (skip):      ${stats.skipSinContactId}`);
    console.log(`  Sin plantilla recibida:    ${stats.skipSinPlantilla}`);
    console.log(`  Recibió 2+ plantillas:     ${stats.skipMultiplesPlantillas}  (← revisión manual)`);
    console.log(`  Errores:                   ${stats.errores}`);
    console.log(`  ${DRY_RUN ? 'A taguear' : 'Tagueados'}:                ${stats.tagged}`);
    if (!DRY_RUN) console.log(`  Batches escritos:          ${batchesFlushed}`);

    if (stats.muestras.tagged.length) {
        console.log('\n  Muestra de tagueados:');
        stats.muestras.tagged.forEach(s => console.log(`    ${s}`));
    }
    if (stats.muestras.multi.length) {
        console.log('\n  Muestra con múltiples plantillas (revisión manual):');
        stats.muestras.multi.forEach(s => console.log(`    ${s}`));
    }
    if (stats.muestras.sin.length) {
        console.log('\n  Muestra sin plantilla detectada (no eran de la campaña):');
        stats.muestras.sin.forEach(s => console.log(`    ${s}`));
    }

    if (DRY_RUN) {
        console.log('\n→ Para aplicar cambios, vuelve a correr con --apply');
    } else {
        console.log('\n→ Listo. Verifica los KPIs en /conversion-campanas');
    }
}

(async () => {
    try {
        if (LIST) {
            await listCampanas();
        } else {
            await processCampana(campanaIdArg);
        }
        process.exit(0);
    } catch (err) {
        console.error('Error fatal:', err);
        process.exit(1);
    }
})();
