/**
 * Herramienta de prompts de la IA (sección Entrenamiento IA) — leer/editar con respaldo.
 * Los prompts viven en Firestore; los cambios aplican de inmediato (el bot re-lee
 * las instrucciones en cada mensaje).
 *
 * Uso:
 *   node scripts/prompt-tool.js get <target>                 # imprime el prompt actual
 *   node scripts/prompt-tool.js set <target> <archivo.txt>   # RESPALDA el actual y lo reemplaza
 *   node scripts/prompt-tool.js backups [target]             # lista respaldos (colección prompt_backups)
 *   node scripts/prompt-tool.js restore <backupId>           # restaura un respaldo (respaldando el actual)
 *
 * target: bot | postventa | dept:<departmentId> | ad:<adId>
 */
const admin = require('firebase-admin');
const fs = require('fs');
const { db } = require('../server/config');

function resolveTarget(target) {
    if (target === 'bot') return { ref: db.collection('crm_settings').doc('bot'), field: 'instructions', label: 'Instrucciones del Bot (ventas)' };
    if (target === 'postventa') return { ref: db.collection('crm_settings').doc('postventa'), field: 'instructions', label: 'Instrucciones de Post-Venta' };
    if (target.startsWith('dept:')) return { ref: db.collection('ai_department_prompts').doc(target.slice(5)), field: 'prompt', label: `Prompt del departamento ${target.slice(5)}` };
    if (target.startsWith('ad:')) return { adId: target.slice(3), field: 'prompt', label: `Prompt del anuncio ${target.slice(3)}` };
    return null;
}

async function getDocRef(t) {
    if (t.ref) return t.ref;
    const snap = await db.collection('ai_ad_prompts').where('adId', '==', t.adId).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].ref;
}

async function readCurrent(t) {
    const ref = await getDocRef(t);
    if (!ref) return { ref: null, value: null };
    const doc = await ref.get();
    return { ref, value: doc.exists ? (doc.data()[t.field] || '') : null };
}

async function saveBackup(target, t, value, reason) {
    const backup = await db.collection('prompt_backups').add({
        target, field: t.field, label: t.label,
        value: value || '',
        reason: reason || 'edición vía prompt-tool',
        at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return backup.id;
}

async function main() {
    const [cmd, arg1, arg2] = process.argv.slice(2);

    if (cmd === 'get' && arg1) {
        const t = resolveTarget(arg1);
        if (!t) { console.error(`Target desconocido: ${arg1}`); process.exit(1); }
        const { value } = await readCurrent(t);
        if (value === null) { console.error('No existe ese documento/prompt.'); process.exit(1); }
        console.log(value);
        return;
    }

    if (cmd === 'set' && arg1 && arg2) {
        const t = resolveTarget(arg1);
        if (!t) { console.error(`Target desconocido: ${arg1}`); process.exit(1); }
        const newValue = fs.readFileSync(arg2, 'utf8').replace(/^﻿/, '').trim();
        if (!newValue) { console.error('El archivo está vacío; no se aplica (protección).'); process.exit(1); }
        const { ref, value: current } = await readCurrent(t);
        if (!ref) { console.error('No existe ese documento/prompt.'); process.exit(1); }
        const backupId = await saveBackup(arg1, t, current, `antes de reemplazar (${newValue.length} chars nuevos)`);
        await ref.set({ [t.field]: newValue }, { merge: true });
        console.log(`✅ ${t.label} actualizado (${(current || '').length} → ${newValue.length} chars).`);
        console.log(`   Respaldo del anterior: prompt_backups/${backupId}`);
        console.log('   El cambio aplica de inmediato en las próximas respuestas del bot.');
        return;
    }

    if (cmd === 'backups') {
        let q = db.collection('prompt_backups').orderBy('at', 'desc').limit(20);
        const snap = await q.get();
        for (const doc of snap.docs) {
            const d = doc.data();
            if (arg1 && d.target !== arg1) continue;
            const at = d.at && d.at.toDate ? d.at.toDate().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '?';
            console.log(`${doc.id}  [${d.target}]  ${at}  (${(d.value || '').length} chars)  ${d.reason || ''}`);
        }
        return;
    }

    if (cmd === 'restore' && arg1) {
        const bDoc = await db.collection('prompt_backups').doc(arg1).get();
        if (!bDoc.exists) { console.error('No existe ese respaldo.'); process.exit(1); }
        const b = bDoc.data();
        const t = resolveTarget(b.target);
        const { ref, value: current } = await readCurrent(t);
        if (!ref) { console.error('El documento destino ya no existe.'); process.exit(1); }
        const backupId = await saveBackup(b.target, t, current, `antes de restaurar ${arg1}`);
        await ref.set({ [t.field]: b.value }, { merge: true });
        console.log(`✅ ${t.label} restaurado desde ${arg1} (${(b.value || '').length} chars).`);
        console.log(`   El valor que estaba se respaldó en prompt_backups/${backupId}`);
        return;
    }

    console.log('Uso:\n  node scripts/prompt-tool.js get <bot|postventa|dept:<id>|ad:<adId>>\n  node scripts/prompt-tool.js set <target> <archivo.txt>\n  node scripts/prompt-tool.js backups [target]\n  node scripts/prompt-tool.js restore <backupId>');
}

main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
