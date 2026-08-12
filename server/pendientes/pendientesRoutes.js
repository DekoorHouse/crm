// =================================================================================================
// === Sección "Pendientes" (Lupita) ===============================================================
// =================================================================================================
// Tablero HERMANO de "Pendientes de Diseño" (Erika). Ahí van los pendientes de diseño; aquí los
// demás, que son de otra persona (Chris, 2026-08-06):
//
//   1. video          -> el cliente pidió VIDEO de su lámpara y falta grabárselo/mandárselo.
//                        Estos pedidos suelen ser mockups que además hay que CORTAR, así que la
//                        tarjeta trae el botón "Diseñar con IA" (misma skill svg-corte que Diseño).
//   2. mockup         -> pedido 'Sin estatus' que todavía no tiene su mockup. ANTES salía en Diseño.
//   3. atencion       -> conversaciones marcadas needsAttention (la IA no pudo y pidió un humano).
//   4. ia_cola        -> contactos atorados >1 h en la cola "Pendientes IA" que YA tienen pedido:
//                        son CAMBIOS confirmados por el cliente que faltan de aplicar.
//   5. ia_sin_pedido  -> lo grave: la IA cerró la venta ("ya registramos tu pedido") y el pedido NO
//                        existe. Sin traslape con la columna 4: un contacto sale en una o en otra.
//
// Los motivos 1 y 2 se calculan con el MISMO motor que Diseño (server/design/designPending.js), para
// que un pedido no pueda aparecer en los dos tableros; 3-5 son de CONTACTOS y se calculan aquí.
// El vigilante que avisa por WhatsApp de 4 y 5 sigue vivo (orders/pendientesIaWatchdog.js): esto es
// la misma información, pero para trabajarla en vez de solo enterarse.
const express = require('express');
const router = express.Router();
const { db, admin } = require('../config');
const { pendientesReasonsForOrderData } = require('../design/designPending');

const STUCK_MS = 60 * 60 * 1000;                  // >1 h en la cola Pendientes IA = atorado
const FALLAS_MS = 3 * 24 * 60 * 60 * 1000;        // ventana de ai_order_failures que se muestra
const MAX_CONTACTOS_IA = 60;                      // tope de contactos a los que se les buscan pedidos

const tsToMs = (t) => (t && t.toMillis) ? t.toMillis() : (t && t._seconds ? t._seconds * 1000 : null);
const now = () => Date.now();

// Corre fn sobre items con como máximo `n` consultas en vuelo. En serie esta sección tardaba 10 s
// (una query de pedidos por cada contacto atorado, y hay decenas); así baja a ~3 s.
async function mapLimit(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx], idx);
        }
    }));
    return out;
}

// ¿Tiene el contacto ALGÚN pedido? (mismo criterio que el vigilante: sin query compuesta; un
// contacto tiene pocos pedidos y se ordena en memoria). Devuelve el más reciente o null.
async function ultimoPedidoDeContacto(contactId) {
    try {
        const snap = await db.collection('pedidos').where('contactId', '==', contactId).limit(10).get();
        if (snap.empty) return null;
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0))[0];
    } catch (e) {
        console.warn('[PENDIENTES] no se pudieron leer los pedidos de', contactId, e.message);
        return null;
    }
}

// GET /api/pendientes — las 5 colas de la sección, en un solo viaje.
router.get('/', async (req, res) => {
    try {
        const { isVideoAutoWaiting, isCorazon, MANUAL_SPECIAL_RE, datosOf } = require('../design/svgAuto');

        // --- Candidatos de PEDIDOS: 'Corregir' (posible video) + 'Sin estatus' (posible mockup) ---
        const [sCor, sSin, sAtn, sIa, sSus] = await Promise.all([
            db.collection('pedidos').where('estatus', '==', 'Corregir').get(),
            db.collection('pedidos').where('estatus', '==', 'Sin estatus').limit(500).get(),
            db.collection('contacts_whatsapp').where('needsAttention', '==', true).limit(200).get(),
            db.collection('contacts_whatsapp').where('status', '==', 'pendientes_ia').limit(300).get(),
            // Comprobantes que la IA marcó /sospechoso (bandera en el contacto). El operador los aprueba
            // o rechaza; al aprobar, la conversación sigue su flujo (se valida el comprobante).
            db.collection('contacts_whatsapp').where('suspiciousReceiptPending', '==', true).limit(200).get(),
        ]);

        // Previews (mockup_previews) en lote: fuente de verdad de "ya tiene mockup" y del mockup que
        // aprobó el cliente (la tarjeta de video lo muestra para saber qué lámpara hay que grabar).
        const ids = [...new Set([...sCor.docs, ...sSin.docs].map(d => d.id))];
        const prevMap = new Map();
        for (let i = 0; i < ids.length; i += 300) {
            const refs = ids.slice(i, i + 300).map(id => db.collection('mockup_previews').doc(String(id)));
            const mdocs = await db.getAll(...refs);
            mdocs.forEach(md => prevMap.set(md.id, (md.exists && Array.isArray(md.data().previews)) ? md.data().previews : []));
        }

        const mapOrder = (doc, motivo) => {
            const p = doc.data();
            const previews = prevMap.get(doc.id) || [];
            const last = previews.length ? previews[previews.length - 1] : null;
            const num = p.consecutiveOrderNumber != null ? p.consecutiveOrderNumber : null;
            return {
                id: doc.id,
                motivo,
                orderNumber: num != null ? `DH${num}` : (p.numeroPedido || doc.id),
                contactId: p.contactId || p.telefono || null,
                telefono: p.telefono || null,
                estatus: p.estatus || 'Sin estatus',
                producto: p.producto || (Array.isArray(p.items) && p.items[0] ? p.items[0].producto : ''),
                itemCount: Array.isArray(p.items) ? p.items.length : (p.producto ? 1 : 0),
                datos: (Array.isArray(p.items) ? p.items.map(i => i.datosProducto).filter(Boolean).join(' | ') : '') || p.datosProducto || '',
                createdAt: tsToMs(p.createdAt),
                corregirAt: tsToMs(p.corregirAt),
                videoRequestedAt: tsToMs(p.videoRequestedAt),
                comentario: p.comentarioPendiente || '',
                // El mockup que aprobó el cliente: es la referencia de lo que hay que grabar/mandar.
                mockupUrl: last ? (last.imageUrl || last.url || null) : null,
                // Corte ya generado (worker o "Diseñar con IA"): si existe, la pieza se puede fabricar.
                svgCorteUrl: p.svgCorteUrl || null,
                svgCortePreviewUrl: p.svgCortePreviewUrl || null,
                svgCorteAt: tsToMs(p.svgCorteAt),
                // Ciclo del diseño forzado con la skill (cola -> staged -> aprobado). Mismos endpoints
                // que usa Diseño (/api/design-pending/:id/design-ia, ia-confirm, ia-reject).
                iaForce: p.iaForce ? {
                    status: p.iaForce.status || null,
                    previewUrl: p.iaForce.previewUrl || null,
                    cortePreviewUrl: p.iaForce.cortePreviewUrl || null,
                    error: p.iaForce.error || null,
                } : null,
                iaEligible: isCorazon(p) && !MANUAL_SPECIAL_RE.test(datosOf(p)) && !p.svgCorteAt,
                // El worker ya lo tiene en su cola de corte automático: no hay que diseñarlo a mano.
                autoCutQueued: !p.iaForce && !p.svgCorteAt && isVideoAutoWaiting(p, previews),
            };
        };

        const video = [], mockup = [];
        for (const doc of [...sCor.docs, ...sSin.docs]) {
            const motivos = pendientesReasonsForOrderData(doc.data(), (prevMap.get(doc.id) || []).length > 0);
            if (motivos.includes('video')) video.push(mapOrder(doc, 'video'));
            if (motivos.includes('mockup')) mockup.push(mapOrder(doc, 'mockup'));
        }
        // Más viejo primero: lo que lleva más tiempo esperando es lo más urgente.
        video.sort((a, b) => (a.videoRequestedAt || a.corregirAt || 0) - (b.videoRequestedAt || b.corregirAt || 0));
        mockup.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        // --- Nombre + canal del cliente para las tarjetas de pedido ---
        const cids = [...new Set([...video, ...mockup].map(o => o.contactId).filter(Boolean))];
        const infoById = new Map();
        for (let i = 0; i < cids.length; i += 300) {
            const refs = cids.slice(i, i + 300).map(id => db.collection('contacts_whatsapp').doc(String(id)));
            const docs = await db.getAll(...refs);
            docs.forEach(d => { if (d.exists) infoById.set(d.id, d.data()); });
        }
        [...video, ...mockup].forEach(o => {
            const c = infoById.get(o.contactId) || {};
            o.clienteName = c.name || o.contactId;
            o.channel = c.channel || 'whatsapp';
            // El cliente escribió DESPUÉS de lo último que le mandó una PERSONA (la IA no cuenta):
            // normalmente es su respuesta al video/mockup que le mandamos.
            const lc = tsToMs(c.lastClientMsgAt), lh = tsToMs(c.lastHumanMsgAt);
            o.clienteRespondio = !!(lh && lc && lc > lh);
            o.clienteRespondioAt = o.clienteRespondio ? lc : null;
        });

        // --- Columna 3: conversaciones que necesitan apoyo humano (needsAttention) ---
        const mapContact = (doc, extra) => {
            const c = doc.data();
            return {
                id: doc.id,
                name: c.name || doc.id,
                channel: c.channel || 'whatsapp',
                lastMessage: String(c.lastMessage || '').slice(0, 160),
                lastMessageAt: tsToMs(c.lastMessageTimestamp),
                unreadCount: c.unreadCount || 0,
                botActive: c.botActive === true,
                ...(extra || {}),
            };
        };
        const atencion = sAtn.docs
            .map(doc => mapContact(doc, {
                reason: doc.data().needsAttentionReason || null,
                at: tsToMs(doc.data().needsAttentionAt),
            }))
            .sort((a, b) => (a.at || a.lastMessageAt || 0) - (b.at || b.lastMessageAt || 0));

        // --- Columna: comprobantes SOSPECHOSOS (la IA emitió /sospechoso) --------------------------
        const sospechoso = sSus.docs
            .map(doc => {
                const sr = doc.data().suspiciousReceipt || {};
                return mapContact(doc, {
                    reason: sr.reason || '',
                    imageUrl: sr.imageUrl || null,   // el comprobante que el cliente mandó (imagen/PDF)
                    fileType: sr.fileType || null,
                    orderNumber: sr.orderNumber || null,
                    at: tsToMs(sr.at),
                });
            })
            .sort((a, b) => (a.at || a.lastMessageAt || 0) - (b.at || b.lastMessageAt || 0));   // más viejo primero

        // --- Columnas 4 y 5: cola "Pendientes IA" atorada (>1 h) -------------------------------
        // Misma clasificación que el vigilante (orders/pendientesIaWatchdog.js): con pedido = cambio
        // pendiente de aplicar; sin pedido = venta cerrada que nunca se registró.
        const atorados = sIa.docs
            .map(doc => {
                const c = doc.data();
                const refMs = tsToMs(c.pendientesIaAt) || tsToMs(c.lastMessageTimestamp) || 0;
                return { doc, refMs };
            })
            .filter(x => x.refMs && (now() - x.refMs) >= STUCK_MS)
            .sort((a, b) => a.refMs - b.refMs)
            .slice(0, MAX_CONTACTOS_IA);

        const ia_cola = [], ia_sin_pedido = [];
        const yaListado = new Set();
        const pedidosDeAtorados = await mapLimit(atorados, 10, ({ doc }) => ultimoPedidoDeContacto(doc.id));
        atorados.forEach(({ doc, refMs }, idx) => {
            const pedido = pedidosDeAtorados[idx];
            yaListado.add(doc.id);
            const item = mapContact(doc, {
                at: refMs,
                horas: +((now() - refMs) / 3600000).toFixed(1),
                pedido: pedido ? {
                    id: pedido.id,
                    orderNumber: pedido.consecutiveOrderNumber != null ? `DH${pedido.consecutiveOrderNumber}` : pedido.id,
                    estatus: pedido.estatus || 'Sin estatus',
                    createdAt: tsToMs(pedido.createdAt),
                } : null,
            });
            (pedido ? ia_cola : ia_sin_pedido).push(item);
        });

        // Fallas registradas del registro automático (ai_order_failures): entran a la columna 5 SIN
        // esperar la hora — el aviso "la IA cerró una venta pero NO pudo registrar el pedido" ya sabe
        // el motivo exacto, así que se muestra en cuanto pasa. Se descarta la que ya se resolvió
        // (alguien registró el pedido después de la falla, o se marcó a mano).
        let fallas = [];
        try {
            const sFail = await db.collection('ai_order_failures').orderBy('at', 'desc').limit(80).get();
            const porContacto = new Map();
            sFail.forEach(d => {
                const f = d.data();
                const at = tsToMs(f.at);
                if (!f.contactId || !at || (now() - at) > FALLAS_MS) return;
                if (f.resueltoAt) return;
                if (!porContacto.has(f.contactId)) porContacto.set(f.contactId, { ...f, at, docId: d.id });
            });
            fallas = [...porContacto.entries()].slice(0, MAX_CONTACTOS_IA);
        } catch (e) {
            console.warn('[PENDIENTES] no se pudieron leer las fallas de registro:', e.message);
        }
        // Las que ya están en una columna solo aportan el MOTIVO de la falla a esa tarjeta.
        const nuevas = [];
        for (const [contactId, f] of fallas) {
            if (yaListado.has(contactId)) {
                const card = [...ia_cola, ...ia_sin_pedido].find(x => x.id === contactId);
                if (card) card.motivoFalla = f.motivo || null;
            } else nuevas.push([contactId, f]);
        }
        const extras = await mapLimit(nuevas, 10, async ([contactId, f]) => {
            const [pedido, cDoc] = await Promise.all([
                ultimoPedidoDeContacto(contactId),
                db.collection('contacts_whatsapp').doc(String(contactId)).get(),
            ]);
            // Si ya hay un pedido creado DESPUÉS de la falla, alguien lo registró: resuelto.
            if (pedido && (tsToMs(pedido.createdAt) || 0) >= f.at) return null;
            if (!cDoc.exists) return null;
            // Misma clasificación que los atorados de la cola: con pedido previo la falla fue un
            // CAMBIO que no se aplicó (motivo 'cambio_no_aplicado', el pedido sí existe); sin ningún
            // pedido es la venta cerrada que nunca se registró.
            return mapContact(cDoc, {
                at: f.at,
                horas: +((now() - f.at) / 3600000).toFixed(1),
                motivoFalla: f.motivo || null,
                pedido: pedido ? {
                    id: pedido.id,
                    orderNumber: pedido.consecutiveOrderNumber != null ? `DH${pedido.consecutiveOrderNumber}` : pedido.id,
                    estatus: pedido.estatus || 'Sin estatus',
                    createdAt: tsToMs(pedido.createdAt),
                } : null,
            });
        });
        extras.filter(Boolean).forEach(x => (x.pedido ? ia_cola : ia_sin_pedido).push(x));
        // Estas dos van al REVÉS que las demás: lo más NUEVO arriba. En las colas de trabajo (video,
        // mockup, atención) manda quien lleva más esperando; aquí no — un cliente al que la IA le dijo
        // "ya registramos tu pedido" hace 2 h todavía se recupera, y uno de hace un mes ya no. La cola
        // arrastra meses de casos viejos (medido: 43 contactos, varios de +700 h), así que ordenarla
        // por antigüedad enterraría justo lo que sí se puede salvar.
        ia_cola.sort((a, b) => (b.at || 0) - (a.at || 0));
        ia_sin_pedido.sort((a, b) => (b.at || 0) - (a.at || 0));

        res.json({
            success: true,
            buckets: { video, mockup, atencion, ia_cola, ia_sin_pedido, sospechoso },
            counts: {
                video: video.length, mockup: mockup.length, atencion: atencion.length,
                ia_cola: ia_cola.length, ia_sin_pedido: ia_sin_pedido.length, sospechoso: sospechoso.length,
            },
        });
    } catch (e) {
        console.error('[PENDIENTES] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/video/:orderId/enviado — "✓ Video enviado": cierra el pendiente del video.
// NO toca el estatus del pedido (sigue en 'Corregir' hasta que su flujo lo cambie) ni la marca de
// diseño de Erika (disenoListoAt): son dos pendientes distintos de dos personas distintas.
router.post('/video/:orderId/enviado', async (req, res) => {
    const { orderId } = req.params;
    try {
        const ref = db.collection('pedidos').doc(orderId);
        if (!(await ref.get()).exists) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        await ref.update({ videoEnviadoAt: admin.firestore.FieldValue.serverTimestamp() });
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/video-enviado] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/video/:orderId/reabrir — deshace lo anterior (se marcó por error).
router.post('/video/:orderId/reabrir', async (req, res) => {
    const { orderId } = req.params;
    try {
        const ref = db.collection('pedidos').doc(orderId);
        if (!(await ref.get()).exists) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        await ref.update({ videoEnviadoAt: admin.firestore.FieldValue.delete() });
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/video-reabrir] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/mockup/:orderId/ocultar — saca un pedido de la cola de mockup sin hacerle uno
// (mismo campo `mockupHidden` que el botón "Ocultar" de la sección Mockup, así no se contradicen).
router.post('/mockup/:orderId/ocultar', async (req, res) => {
    const { orderId } = req.params;
    try {
        const ref = db.collection('pedidos').doc(orderId);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        await ref.update({ mockupHidden: req.body && req.body.enabled === false ? false : true });
        // El motor de Diseño lee el mismo pedido: recalcula por si esto cambia su bandera.
        try { await require('../design/designPending').recomputeForOrder(orderId, doc.data()); } catch (_) {}
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/mockup-ocultar] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/atencion/:contactId/atendido — quita lo urgente de una conversación (mismo
// efecto que el botón "✔ Atendido" del chat; también se limpia solo al responder o encender la IA).
router.post('/atencion/:contactId/atendido', async (req, res) => {
    const { contactId } = req.params;
    try {
        await db.collection('contacts_whatsapp').doc(String(contactId))
            .update({ needsAttention: false, needsAttentionReason: null });
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/atendido] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/atencion/:contactId/reabrir — DESHACER de lo anterior (Ctrl+Z). El motivo y la
// fecha original los manda el CRM desde la tarjeta que quitó, para que la conversación vuelva a la
// columna tal como estaba (con su antigüedad real, no como si acabara de marcarse urgente).
router.post('/atencion/:contactId/reabrir', async (req, res) => {
    const { contactId } = req.params;
    const { reason, at } = req.body || {};
    try {
        const upd = {
            needsAttention: true,
            needsAttentionReason: reason || null,
            needsAttentionAt: at
                ? admin.firestore.Timestamp.fromMillis(Number(at))
                : admin.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection('contacts_whatsapp').doc(String(contactId)).update(upd);
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/atencion-reabrir] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/sospechoso/:contactId/aprobar — el operador aprueba un comprobante que la IA
// marcó /sospechoso: limpia la bandera y VALIDA el comprobante (markComprobanteValidadoAndSendForm),
// para que la conversación siga su flujo (se le manda el formulario de envío como si hubiera sido válido).
router.post('/sospechoso/:contactId/aprobar', async (req, res) => {
    const { contactId } = req.params;
    try {
        const cref = db.collection('contacts_whatsapp').doc(String(contactId));
        const cdoc = await cref.get();
        if (!cdoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        await cref.set({ suspiciousReceiptPending: false, suspiciousReceipt: admin.firestore.FieldValue.delete() }, { merge: true });
        // Continuar el flujo: validar el comprobante (sella comprobanteValidadoAt + manda el formulario).
        try {
            const { markComprobanteValidadoAndSendForm } = require('../services');
            await markComprobanteValidadoAndSendForm(contactId, cdoc.data(), { force: true });
        } catch (e) { console.warn('[PENDIENTES/sospechoso-aprobar] no se pudo validar/enviar formulario:', e.message); }
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/sospechoso-aprobar] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/sospechoso/:contactId/descartar — quita el comprobante de la columna SIN validar
// (el operador determinó que el pago NO es bueno, o ya lo atendió por el chat). NO manda formulario.
router.post('/sospechoso/:contactId/descartar', async (req, res) => {
    const { contactId } = req.params;
    try {
        await db.collection('contacts_whatsapp').doc(String(contactId))
            .set({ suspiciousReceiptPending: false, suspiciousReceipt: admin.firestore.FieldValue.delete() }, { merge: true });
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/sospechoso-descartar] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/ia/:contactId/resolver — saca al contacto de la cola "Pendientes IA" (status
// null, igual que hace createOrder al registrar el pedido) y da por vistas sus fallas de registro.
// Es la salida manual: lo normal es registrar el pedido desde el chat y que salga solo.
router.post('/ia/:contactId/resolver', async (req, res) => {
    const { contactId } = req.params;
    try {
        const ref = db.collection('contacts_whatsapp').doc(String(contactId));
        const doc = await ref.get();
        if (doc.exists && doc.data().status === 'pendientes_ia') {
            await ref.update({ status: null, pendientesIaResueltoAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        // Marca las fallas abiertas de este contacto: si no, la tarjeta reaparece por ai_order_failures.
        const sFail = await db.collection('ai_order_failures').where('contactId', '==', String(contactId)).limit(20).get();
        const batch = db.batch();
        const fallas = [];
        sFail.forEach(d => {
            if (d.data().resueltoAt) return;
            batch.update(d.ref, { resueltoAt: admin.firestore.FieldValue.serverTimestamp() });
            fallas.push(d.id);
        });
        if (fallas.length) await batch.commit();
        // `fallas` se devuelve para poder DESHACER con precisión: al reabrir solo se destapan las que
        // esta llamada tapó, no las que ya estaban resueltas de antes.
        res.json({ success: true, fallas, estabaEnCola: doc.exists && doc.data().status === 'pendientes_ia' });
    } catch (e) {
        console.error('[PENDIENTES/ia-resolver] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/ia/:contactId/reabrir — DESHACER del anterior (Ctrl+Z): regresa al contacto a
// la cola "Pendientes IA" y destapa las fallas que aquella llamada marcó como resueltas.
// Body: { fallas: [ids], estabaEnCola: bool } (lo que devolvió /resolver).
router.post('/ia/:contactId/reabrir', async (req, res) => {
    const { contactId } = req.params;
    const { fallas, estabaEnCola } = req.body || {};
    try {
        if (estabaEnCola !== false) {
            // pendientesIaAt NO se tocó al resolver, así que la antigüedad de la cola se conserva sola.
            await db.collection('contacts_whatsapp').doc(String(contactId)).update({
                status: 'pendientes_ia',
                pendientesIaResueltoAt: admin.firestore.FieldValue.delete(),
            });
        }
        const ids = Array.isArray(fallas) ? fallas.slice(0, 20) : [];
        if (ids.length) {
            const batch = db.batch();
            ids.forEach(id => batch.update(db.collection('ai_order_failures').doc(String(id)), {
                resueltoAt: admin.firestore.FieldValue.delete(),
            }));
            await batch.commit();
        }
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/ia-reabrir] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/pendientes/:orderId/comentario — nota interna de esta sección (campo propio, para no
// pisar `comentarioDiseno`, que es el cuaderno del equipo de diseño).
router.post('/:orderId/comentario', async (req, res) => {
    const { orderId } = req.params;
    const comentario = String((req.body && req.body.comentario) || '').slice(0, 2000);
    try {
        const ref = db.collection('pedidos').doc(orderId);
        if (!(await ref.get()).exists) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        await ref.update({ comentarioPendiente: comentario });
        res.json({ success: true });
    } catch (e) {
        console.error('[PENDIENTES/comentario] error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
