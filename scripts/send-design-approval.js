/**
 * send-design-approval.js — Manda a un cliente la captura de su diseño ESPECIAL para que lo
 * apruebe, y ARMA el flujo de aprobación automática. Cuando el cliente responda, el clasificador
 * del servidor (server/design/designApproval.js) decide aprobar/cambiar; si aprueba, el propio
 * svg-corte-worker sube el SVG a Drive. Corre LOCAL (necesita CorelDRAW para la captura).
 *
 * Uso:
 *   node scripts/send-design-approval.js --dh 13528 --cdr "<ruta.cdr>" --svg "<ruta.svg>" [--summary "..."]
 *
 * Pasos: (1) genera la captura natural centrada desde el .cdr, (2) la sube y la manda por
 * WhatsApp al cliente (JPEG), (3) deja el pedido en designApproval.status='pending' con la ruta
 * local del SVG (para que el worker lo suba al aprobar) y pone el contacto en modo aprobación.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { db, admin } = require('../server/config');

const API = process.env.CRM_API || 'https://crm-rzon.onrender.com';
const CLIENT_PREVIEW_VBS = path.join(__dirname, '..', '.claude', 'skills', 'svg-corte', 'client-preview.vbs');

function arg(name) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? process.argv[i + 1] : null;
}

const datosOf = o => (Array.isArray(o.items) ? o.items.map(i => i.datosProducto).filter(Boolean).join(' | ') : '') || o.datosProducto || '';

(async () => {
    const dh = parseInt(arg('dh'), 10);
    const cdr = arg('cdr');
    const svg = arg('svg');
    const summary = arg('summary');
    if (!dh || !cdr || !svg) { console.error('Faltan args: --dh --cdr --svg'); process.exit(1); }
    if (!fs.existsSync(cdr)) { console.error('No existe el cdr: ' + cdr); process.exit(1); }
    if (!fs.existsSync(svg)) { console.error('No existe el svg: ' + svg); process.exit(1); }

    // Pedido + contacto
    const snap = await db.collection('pedidos').where('consecutiveOrderNumber', '==', dh).get();
    if (snap.empty) { console.error('No encontré DH' + dh); process.exit(1); }
    const orderDoc = snap.docs[0];
    const order = orderDoc.data();
    const contactId = order.contactId || order.telefono;
    const cName = (await db.collection('contacts_whatsapp').doc(String(contactId)).get()).data()?.name || '';

    // 1) Captura natural centrada
    const png = path.join(os.homedir(), 'Documents', 'SVG-Corte', `DH${dh}-aprobacion-cliente.png`);
    const r = spawnSync('cscript', ['//nologo', CLIENT_PREVIEW_VBS, cdr, png], { encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true });
    if (!fs.existsSync(png)) { console.error('No se generó la captura. ' + ((r.stdout || '') + (r.stderr || '')).slice(0, 300)); process.exit(1); }
    console.log('Captura: ' + png);

    // 2) Subir + convertir a JPEG (WhatsApp rechaza WebP) + enviar
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(png)], { type: 'image/png' }), path.basename(png));
    const up = await (await fetch(`${API}/api/mockups/upload-image`, { method: 'POST', body: fd })).json();
    if (!up.success || !up.url) { console.error('upload-image falló: ' + JSON.stringify(up)); process.exit(1); }
    const wa = await (await fetch(`${API}/api/mockups/wa-image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: up.url }) })).json();
    if (!wa.success || !wa.jpgUrl) { console.error('wa-image falló: ' + JSON.stringify(wa)); process.exit(1); }

    const firstName = (cName || '').split(' ')[0] || '';
    const msg = `¡Hola${firstName ? ' ' + firstName : ''}! 😊 Antes de fabricar tu lámpara, te comparto el diseño para que lo revises con calma ✨ Confirma que los nombres y las fechas estén correctos:\n${(summary || datosOf(order)).trim()}\n¿Lo aprobamos así o le ajustamos algo? 🙌`;
    const sent = await (await fetch(`${API}/api/contacts/${contactId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg, fileUrl: wa.jpgUrl, fileType: 'image/jpeg' }),
    })).json();
    if (sent.success === false) { console.error('envío falló: ' + JSON.stringify(sent)); process.exit(1); }
    console.log('Enviado a ' + (cName || contactId));

    // 3) Armar el estado de aprobación (pedido + contacto)
    await orderDoc.ref.update({
        designApproval: {
            status: 'pending',
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            stagedSvgLocalPath: svg,
            stagedSvgName: path.basename(svg),
            captureUrl: wa.jpgUrl,
            designText: (summary || datosOf(order)).trim(),
        },
    });
    await db.collection('contacts_whatsapp').doc(String(contactId)).update({
        designApprovalPending: true,
        designApprovalOrderId: orderDoc.id,
        botActive: true,   // el clasificador de aprobación corre dentro del flujo de IA
    });
    console.log(`OK — DH${dh} en espera de aprobación. Cuando el cliente responda, el sistema decide solo.`);
    process.exit(0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
