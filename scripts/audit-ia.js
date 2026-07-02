/**
 * Auditoría de conversaciones de la IA (solo lectura).
 * Uso:
 *   node scripts/audit-ia.js list [horas]            # conversaciones con actividad en las últimas N horas (default 24)
 *   node scripts/audit-ia.js chat <tel|id|nombre> [n]  # transcript de los últimos n mensajes (default 60)
 *
 * "tel" acepta 10 dígitos (se prueban los prefijos 521/52), el ID completo del
 * contacto (5216181234567, fb_..., ig_...) o el inicio del nombre del contacto.
 */
const admin = require('firebase-admin');
const { db } = require('../server/config');

const TZ = 'America/Mexico_City';

function fmtTs(ts) {
    if (!ts || typeof ts.toDate !== 'function') return '¿sin fecha?';
    return ts.toDate().toLocaleString('es-MX', {
        timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    });
}

function mediaLabel(d) {
    const t = (d.text || '').trim();
    switch (d.type) {
        case 'image': return t ? `[imagen] ${t}` : '[imagen]';
        case 'audio': return '[audio]' + (t && t !== '🎤 Mensaje de voz' ? ` ${t}` : '');
        case 'video': return t ? `[video] ${t}` : '[video]';
        case 'document': return t ? `[PDF/doc] ${t}` : '[PDF/doc]';
        case 'sticker': return '[sticker]';
        default: return t || (d.fileUrl ? '[archivo]' : '');
    }
}

async function listRecent(hours) {
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - hours * 3600 * 1000);
    const snap = await db.collection('contacts_whatsapp')
        .where('lastMessageTimestamp', '>=', since)
        .orderBy('lastMessageTimestamp', 'desc')
        .limit(150)
        .get();

    console.log(`=== ${snap.size} conversaciones con actividad en las últimas ${hours}h ===\n`);
    for (const doc of snap.docs) {
        const d = doc.data();
        const bot = d.botActive === true ? '🤖ON ' : '     ';
        const stage = d.aiStage === 'postventa' ? '[postventa]' : (d.aiStage === 'venta' ? '[venta]    ' : '           ');
        const err = d.aiLastError ? ' ⚠️IA-error' : '';
        const last = String(d.lastMessage || '').replace(/\s+/g, ' ').slice(0, 60);
        console.log(`${bot}${stage} ${doc.id.padEnd(22)} ${String(d.name || 'Sin nombre').slice(0, 22).padEnd(22)} | ${fmtTs(d.lastMessageTimestamp)} | ${last}${err}`);
    }
    console.log('\nPara ver un chat: node scripts/audit-ia.js chat <id-o-telefono>');
}

async function findContact(q) {
    const coll = db.collection('contacts_whatsapp');
    const candidates = [q, `521${q}`, `52${q}`];
    for (const id of candidates) {
        const doc = await coll.doc(id).get();
        if (doc.exists) return doc;
    }
    // Búsqueda por prefijo de nombre
    const snap = await coll.where('name', '>=', q).where('name', '<=', q + '').limit(6).get();
    if (snap.size === 1) return snap.docs[0];
    if (snap.size > 1) {
        console.log('Varios contactos coinciden, usa el ID exacto:');
        snap.docs.forEach(d => console.log(`  ${d.id}  ${d.data().name || 'Sin nombre'}`));
        process.exit(1);
    }
    return null;
}

async function dumpChat(q, n) {
    const contact = await findContact(q);
    if (!contact) { console.error(`No se encontró el contacto "${q}".`); process.exit(1); }
    const c = contact.data();

    console.log('=== CONTACTO ===');
    console.log(`ID: ${contact.id} | Nombre: ${c.name || 'Sin nombre'} | Canal: ${c.channel || 'whatsapp'}`);
    console.log(`botActive: ${c.botActive === true} | aiStage: ${c.aiStage || '(ninguna)'} | status: ${c.status || '-'} | depto: ${c.assignedDepartmentId || '-'}`);
    if (c.awaitingShippingData) console.log('awaitingShippingData: true (delay de IA de 10 min activo)');
    if (c.aiLastError) console.log(`⚠️ Último error de IA (${fmtTs(c.aiLastErrorAt)}): ${c.aiLastError}`);
    console.log('');

    const msgs = await contact.ref.collection('messages').orderBy('timestamp', 'desc').limit(n).get();
    const rows = [...msgs.docs].reverse();
    console.log(`=== TRANSCRIPT (últimos ${rows.length} mensajes, hora de México) ===\n`);
    for (const doc of rows) {
        const d = doc.data();
        const isClient = d.from === contact.id;
        let who = isClient ? 'CLIENTE' : (d.isAutoReply ? 'IA 🤖  ' : 'AGENTE ');
        const flags = [];
        if (d.status === 'scheduled') flags.push('PROGRAMADO-sin-enviar');
        if (d.status === 'failed') flags.push('FALLÓ');
        if (d.context && d.context.id) flags.push('cita');
        const text = mediaLabel(d).replace(/\s*\n\s*/g, ' ⏎ ');
        console.log(`[${fmtTs(d.timestamp)}] ${who}${flags.length ? ' (' + flags.join(',') + ')' : ''}: ${text}`);
    }
}

(async () => {
    const [cmd, arg1, arg2] = process.argv.slice(2);
    if (cmd === 'list') await listRecent(parseInt(arg1, 10) || 24);
    else if (cmd === 'chat' && arg1) await dumpChat(arg1, parseInt(arg2, 10) || 60);
    else {
        console.log('Uso:\n  node scripts/audit-ia.js list [horas]\n  node scripts/audit-ia.js chat <tel|id|nombre> [n]');
    }
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
