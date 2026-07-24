/**
 * backfill-message-search.js — Indexa el HISTORIAL de mensajes para la búsqueda en conversaciones.
 *
 * El cron del servidor (server/search/messageSearch.js) solo indexa lo NUEVO. Este script recorre lo
 * que ya existía y le escribe el campo `st` (palabras del mensaje) para que sea buscable.
 *
 * Recorre los CONTACTOS con actividad en la ventana (índice lastMessageTimestamp, ya existente) y de
 * cada uno sus mensajes de la ventana; salta los que ya tienen `st`. Es REANUDABLE: guarda el avance
 * en crm_settings/messageSearchBackfill, así se puede cortar (Ctrl+C) y volver a correr.
 *
 * Uso:
 *   node scripts/backfill-message-search.js --days 90          # indexa los últimos 90 días
 *   node scripts/backfill-message-search.js --days 90 --dry    # solo cuenta, no escribe
 *   node scripts/backfill-message-search.js --days 90 --reset  # empieza desde cero
 */
'use strict';
const { db, admin } = require('../server/config');
const { tokensForMessage, TOKENS_FIELD } = require('../server/search/messageSearch');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const RESET = argv.includes('--reset');
const DAYS = (() => { const i = argv.indexOf('--days'); return i >= 0 ? Math.max(1, parseInt(argv[i + 1], 10) || 90) : 90; })();
const PAGE = 300;   // contactos por página

const STATE = db.collection('crm_settings').doc('messageSearchBackfill');
const toMs = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : (v && v._seconds ? v._seconds * 1000 : 0));

(async () => {
    const cutoff = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
    if (RESET && !DRY) await STATE.delete().catch(() => {});
    const st = (await STATE.get()).data() || {};
    let cursorMs = st.cursorMs || 0;   // avance por lastMessageTimestamp (ASC)
    let totals = { contacts: st.contacts || 0, scanned: st.scanned || 0, indexed: st.indexed || 0 };

    console.log(`[BACKFILL] Ventana: últimos ${DAYS} días (desde ${cutoff.toISOString().slice(0, 10)})${DRY ? ' — DRY RUN' : ''}`);
    if (cursorMs) console.log(`[BACKFILL] Reanudando desde ${new Date(cursorMs).toISOString()} (llevaba ${totals.contacts} contactos)`);

    const started = Date.now();
    for (;;) {
        const from = new Date(Math.max(cutoff.getTime(), cursorMs));
        const snap = await db.collection('contacts_whatsapp')
            .where('lastMessageTimestamp', '>', from)
            .orderBy('lastMessageTimestamp', 'asc')
            .limit(PAGE)
            .get();
        if (snap.empty) break;

        for (const c of snap.docs) {
            const msgs = await c.ref.collection('messages')
                .where('timestamp', '>=', cutoff)
                .orderBy('timestamp', 'asc')
                .get();
            let writer = db.batch();
            let pending = 0;
            for (const doc of msgs.docs) {
                totals.scanned++;
                const d = doc.data();
                if (Array.isArray(d[TOKENS_FIELD])) continue;
                const tokens = tokensForMessage(d);
                if (!tokens.length) continue;
                totals.indexed++;
                if (DRY) continue;
                writer.update(doc.ref, { [TOKENS_FIELD]: tokens });
                pending++;
                if (pending >= 450) { await writer.commit(); writer = db.batch(); pending = 0; }
            }
            if (pending) await writer.commit();
            totals.contacts++;
            cursorMs = toMs(c.data().lastMessageTimestamp) || cursorMs;
        }

        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`[BACKFILL] ${totals.contacts} contactos · ${totals.scanned} mensajes revisados · ${totals.indexed} indexados · ${mins} min`);
        if (!DRY) await STATE.set({ ...totals, cursorMs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        if (snap.size < PAGE) break;
    }

    console.log(`[BACKFILL] LISTO: ${totals.contacts} contactos, ${totals.indexed} mensajes indexados de ${totals.scanned} revisados.`);
    process.exit(0);
})().catch(e => { console.error('[BACKFILL] ERROR:', e.stack || e.message); process.exit(1); });
