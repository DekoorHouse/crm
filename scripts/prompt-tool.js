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
 *   node scripts/prompt-tool.js export                       # vuelca TODOS los prompts a prompts/ (espejo versionado)
 *
 * target: bot | postventa | cobranza | catalogo | dept:<departmentId> | ad:<adId>
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { db } = require('../server/config');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

function resolveTarget(target) {
    if (target === 'bot') return { ref: db.collection('crm_settings').doc('bot'), field: 'instructions', label: 'Instrucciones del Bot (ventas)' };
    if (target === 'postventa') return { ref: db.collection('crm_settings').doc('postventa'), field: 'instructions', label: 'Instrucciones de Post-Venta' };
    if (target === 'cobranza') return { ref: db.collection('crm_settings').doc('bot_cobranza'), field: 'instructions', label: 'Instrucciones de Cobranza' };
    if (target === 'catalogo') return { ref: db.collection('crm_settings').doc('ai_order_registration'), field: 'catalogText', label: 'Catálogo del registro automático de pedidos' };
    if (target.startsWith('dept:')) return { ref: db.collection('ai_department_prompts').doc(target.slice(5)), field: 'prompt', label: `Prompt del departamento ${target.slice(5)}` };
    if (target.startsWith('ad:')) return { adId: target.slice(3), field: 'prompt', label: `Prompt del anuncio ${target.slice(3)}` };
    return null;
}

function slugify(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sin-nombre';
}

// Escribe un prompt como archivo del repo (UTF-8, saltos \n, newline final).
function writePromptFile(relPath, content) {
    const full = path.join(PROMPTS_DIR, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(content || '').replace(/\r\n/g, '\n').trim() + '\n', 'utf8');
    return relPath.replace(/\\/g, '/');
}

// Borra los .md de una subcarpeta que ya no correspondan a un doc vivo en Firestore.
function cleanOrphans(subdir, keepBasenames) {
    const dir = path.join(PROMPTS_DIR, subdir);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md') && !keepBasenames.has(f)) {
            fs.unlinkSync(path.join(dir, f));
            console.log(`   (borrado huérfano: prompts/${subdir}/${f})`);
        }
    }
}

// Espejo en prompts/ del target recién editado con `set` (best-effort; no rompe el flujo).
async function syncExportedFile(targetStr, value) {
    try {
        if (targetStr === 'bot') return writePromptFile('bot.md', value);
        if (targetStr === 'postventa') return writePromptFile('postventa.md', value);
        if (targetStr === 'cobranza') return writePromptFile('cobranza.md', value);
        if (targetStr === 'catalogo') return writePromptFile('registro-pedidos-catalogo.md', value);
        if (targetStr.startsWith('dept:')) {
            const id = targetStr.slice(5);
            let name = id;
            try { const d = await db.collection('departments').doc(id).get(); if (d.exists && d.data().name) name = d.data().name; } catch (e) { /* solo afecta el nombre del archivo */ }
            return writePromptFile(path.join('departamentos', `${slugify(name)}--${id}.md`), value);
        }
        if (targetStr.startsWith('ad:')) return writePromptFile(path.join('anuncios', `${targetStr.slice(3)}.md`), value);
    } catch (e) {
        console.warn('   (no se pudo actualizar el espejo en prompts/:', e.message + ')');
    }
    return null;
}

async function exportAll() {
    const written = [];

    for (const [target, file] of [['bot', 'bot.md'], ['postventa', 'postventa.md'], ['cobranza', 'cobranza.md'], ['catalogo', 'registro-pedidos-catalogo.md']]) {
        const { value } = await readCurrent(resolveTarget(target));
        if (value && value.trim()) written.push(writePromptFile(file, value));
        else console.log(`   (sin contenido en Firestore para "${target}"; no se escribió ${file})`);
    }

    const deptNames = {};
    try { (await db.collection('departments').get()).docs.forEach(d => { deptNames[d.id] = d.data().name || ''; }); } catch (e) { /* sin nombres, se usa el id */ }
    const keepDept = new Set();
    for (const doc of (await db.collection('ai_department_prompts').get()).docs) {
        const prompt = (doc.data().prompt || '').trim();
        if (!prompt) continue;
        const base = `${slugify(deptNames[doc.id] || doc.id)}--${doc.id}.md`;
        keepDept.add(base);
        written.push(writePromptFile(path.join('departamentos', base), prompt));
    }
    cleanOrphans('departamentos', keepDept);

    const keepAds = new Set();
    for (const doc of (await db.collection('ai_ad_prompts').get()).docs) {
        const d = doc.data();
        if (!d.adId || !(d.prompt || '').trim()) continue;
        const base = `${d.adId}.md`;
        keepAds.add(base);
        written.push(writePromptFile(path.join('anuncios', base), d.prompt));
    }
    cleanOrphans('anuncios', keepAds);

    // Solo lectura: compilados con el MISMO formato que arma buildStaticContext (services.js).
    const kb = (await db.collection('ai_knowledge_base').get()).docs
        .map(doc => `- ${doc.data().topic}: ${doc.data().answer}`)
        .sort((a, b) => a.localeCompare(b, 'es'));
    written.push(writePromptFile('conocimiento.md', kb.join('\n') || '(vacío)'));

    const qr = (await db.collection('quick_replies').get()).docs
        .filter(doc => doc.data().message)
        .map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`)
        .sort((a, b) => a.localeCompare(b, 'es'));
    written.push(writePromptFile('respuestas-rapidas.md', qr.join('\n') || '(vacío)'));

    console.log(`✅ Exportados ${written.length} archivos a prompts/:`);
    for (const f of written) console.log(`   prompts/${f}`);
    console.log('Recuerda commitear la carpeta prompts/ para versionar este snapshot.');
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
        const mirrored = await syncExportedFile(arg1, newValue);
        if (mirrored) console.log(`   Espejo del repo actualizado: prompts/${mirrored} (recuerda commitear).`);
        return;
    }

    if (cmd === 'export') {
        await exportAll();
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

    console.log('Uso:\n  node scripts/prompt-tool.js get <bot|postventa|cobranza|catalogo|dept:<id>|ad:<adId>>\n  node scripts/prompt-tool.js set <target> <archivo.txt>\n  node scripts/prompt-tool.js backups [target]\n  node scripts/prompt-tool.js restore <backupId>\n  node scripts/prompt-tool.js export   # vuelca todos los prompts a prompts/');
}

main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
