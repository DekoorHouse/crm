/**
 * Núcleo COMPARTIDO de creación de pedidos, extraído de POST /api/orders (apiRoutes.js)
 * para que el registro automático por IA (aiOrderRegistration.js) cree pedidos EXACTAMENTE
 * igual que el modal del CRM: mismo contador consecutivo (transaccional), atribución de
 * anuncio, corona plateada del contacto (y quitar la etiqueta pendientes_ia), métrica de
 * rescate de order_followup, evento Purchase a Meta (si el ajuste está en "registro") y
 * detección de cliente recurrente. Cualquier cambio al flujo de registro debe hacerse aquí.
 */
const { db, admin, bucket } = require('../config');

/**
 * Normaliza los productos al formato canónico [{producto, cantidad, precio, datosProducto}].
 * Acepta el array `items` o los campos legacy (producto/precio/datosProducto sueltos).
 */
function normalizeOrderItems({ items, producto, precio, datosProducto }) {
    if (Array.isArray(items) && items.length > 0) {
        return items
            .filter(it => it && it.producto)
            .map(it => ({
                producto: String(it.producto),
                cantidad: Math.max(1, parseInt(it.cantidad, 10) || 1),
                precio: Number(it.precio) || 0,
                datosProducto: it.datosProducto || ''
            }));
    }
    if (producto) {
        return [{
            producto: String(producto),
            cantidad: 1,
            precio: Number(precio) || 0,
            datosProducto: datosProducto || ''
        }];
    }
    return [];
}

/**
 * Campos derivados de los items (total y campos "principales" para backward compat).
 * Compartido entre crear pedido y ACTUALIZAR pedido (registro por IA cuando el cliente
 * cambia su pedido ya registrado) para que ambos caminos queden idénticos.
 */
function computeOrderMainFields(normalizedItems) {
    const totalValue = normalizedItems.reduce((sum, it) => sum + (it.precio || 0) * it.cantidad, 0);
    const mainProducto = normalizedItems[0].producto;
    const mainDatosProducto = normalizedItems.map(it => {
        const qtyTxt = it.cantidad > 1 ? ` ×${it.cantidad}` : '';
        const base = `${it.producto}${qtyTxt}${it.precio ? ` ($${it.precio})` : ''}`;
        return it.datosProducto ? `${base}: ${it.datosProducto}` : base;
    }).join('\n');
    return { totalValue, mainProducto, mainDatosProducto };
}

/**
 * Crea un pedido con TODA la mecánica del CRM (ver cabecera del archivo).
 *
 * @param {object} args
 * @param {string} args.contactId - ID del contacto (contacts_whatsapp).
 * @param {string} args.telefono - Teléfono del cliente (puede diferir del contactId).
 * @param {Array}  [args.items] - [{producto, cantidad, precio, datosProducto}]
 * @param {string} [args.producto] - (legacy) producto único si no viene items.
 * @param {number} [args.precio] - (legacy) precio del producto único.
 * @param {string} [args.datosProducto] - (legacy) detalles del producto único.
 * @param {string} [args.datosPromocion]
 * @param {string} [args.comentarios]
 * @param {string[]} [args.fotoUrls]
 * @param {string[]} [args.fotoPromocionUrls]
 * @param {string} [args.campana_id]
 * @param {string} [args.plantilla_origen]
 * @param {object} [args.extraFields] - Campos adicionales a persistir en el doc del pedido
 *                 (ej. registeredByAI / aiReviewStatus para el registro automático por IA).
 * @returns {Promise<{orderNumber:number, orderRef:FirebaseFirestore.DocumentReference, totalValue:number, itemCount:number}>}
 * @throws {Error} con .statusCode=400 si faltan datos obligatorios.
 */
async function createOrder({
    contactId, telefono, items, producto, precio, datosProducto,
    datosPromocion, comentarios, fotoUrls, fotoPromocionUrls,
    campana_id, plantilla_origen, extraFields = {}
}) {
    const normalizedItems = normalizeOrderItems({ items, producto, precio, datosProducto });

    if (!contactId || normalizedItems.length === 0 || !telefono) {
        const err = new Error('Faltan datos obligatorios: contactId, producto(s) y teléfono.');
        err.statusCode = 400;
        throw err;
    }

    // require perezoso: services.js requiere (indirectamente) este módulo para el registro
    // automático por IA; requerir services arriba del archivo crearía un ciclo de módulos.
    const { getPedidoAttribution, sendConversionEvent, messagingContactInfo, getPurchaseEventTrigger } = require('../services');

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const orderCounterRef = db.collection('counters').doc('orders');

    // Prueba de precio: si el contacto es grupo A y el pedido lo registró la IA, forzar el
    // precio de cada item al variante ($850/$950). Es la red de seguridad para que el TOTAL
    // registrado (y por ende el cobro y el evento Purchase) use el mismo precio que Andrea le
    // cotizó al cliente — sin depender de lo que el extractor haya calculado. Solo pisa el
    // precio de control ($750) para no clobberear un precio que un humano puso a propósito.
    try {
        if (extraFields.registeredByAI === true) {
            const priceTest = require('./priceTest');
            if ((await priceTest.getPriceTestConfig()).enabled) {
                const cSnap = await contactRef.get();
                const precio = cSnap.exists ? priceTest.priceForContact(cSnap.data()) : null;
                if (precio && priceTest.orderEligible(normalizedItems)) {
                    for (const it of normalizedItems) {
                        if (Number(it.precio) === priceTest.CONTROL_PRICE) it.precio = precio;
                    }
                    console.log(`[PRICE_TEST] Pedido de ${contactId}: precio forzado a $${precio} por item (grupo A).`);
                }
            }
        }
    } catch (priceErr) {
        console.warn('[PRICE_TEST] Override de precio falló (no fatal):', priceErr.message);
    }

    // --- Generar número de pedido consecutivo usando una transacción ---
    const newOrderNumber = await db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(orderCounterRef);
        let currentCounter = counterDoc.exists ? counterDoc.data().lastOrderNumber || 0 : 0;
        // Asegurar que el contador empiece en 1001 si es menor
        const nextOrderNumber = (currentCounter < 1000) ? 1001 : currentCounter + 1;
        transaction.set(orderCounterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
        return nextOrderNumber;
    });

    // Calcular totales y datos "principales" (para backward compat con queries y reportes)
    const { totalValue, mainProducto, mainDatosProducto } = computeOrderMainFields(normalizedItems);

    // Crear objeto del nuevo pedido con items embebidos
    const nuevoPedido = {
        contactId,
        producto: mainProducto, // Primer producto para backward compat (queries where producto==)
        items: normalizedItems, // Lista completa de productos
        telefono,
        precio: totalValue, // Suma total para mostrar el valor real del pedido
        datosProducto: normalizedItems.length > 1 ? mainDatosProducto : normalizedItems[0].datosProducto,
        datosPromocion: datosPromocion || '',
        comentarios: comentarios || '',
        fotoUrls: fotoUrls || [],
        fotoPromocionUrls: fotoPromocionUrls || [],
        consecutiveOrderNumber: newOrderNumber,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        estatus: 'Sin estatus',
        telefonoVerificado: false,
        estatusVerificado: false,
        // Tracking de campañas (opcional): si vienen, persisten; si no, quedan null
        campana_id: (typeof campana_id === 'string' && campana_id.trim()) ? campana_id.trim() : null,
        plantilla_origen: (typeof plantilla_origen === 'string' && plantilla_origen.trim()) ? plantilla_origen.trim() : null,
        ...extraFields
    };

    // Hacer públicas las fotos para que se vean en la lista de pedidos
    const allUrls = [...(fotoUrls || []), ...(fotoPromocionUrls || [])];
    for (const url of allUrls) {
        if (url && url.includes(bucket.name)) {
            try {
                const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                if (filePath) {
                    await bucket.file(decodeURIComponent(filePath)).makePublic();
                }
            } catch (e) {
                console.error('Error al hacer pública la foto de GCS:', e);
            }
        }
    }

    // Añadir el nuevo pedido a la colección 'pedidos'
    const newOrderRef = await db.collection('pedidos').add(nuevoPedido);

    // --- Atribución del pedido al ad más reciente del contacto antes de su creación ---
    // Se usa para el dashboard de rentabilidad: agrupa por ad y por leadDate (no por createdAt)
    try {
        const attribution = await getPedidoAttribution(contactId, new Date());
        await newOrderRef.update({
            attributedAdId: attribution.attributedAdId,
            leadDate: attribution.leadDate,
            leadSource: attribution.leadSource
        });
    } catch (attrErr) {
        console.error(`[ATTRIBUTION] No se pudo escribir atribución para pedido ${newOrderRef.id}:`, attrErr.message);
    }

    // Piloto preview (docs/plan-preview-diseno.md): el pedido hereda el grupo A/B del
    // contacto SOLO si es corazones estándar (1-4 pzas, sin especiales). Best-effort.
    try {
        const piloto = require('./pilotoPreview');
        if ((await piloto.getPilotoConfig()).enabled) {
            const cSnap = await contactRef.get();
            const grupo = cSnap.exists ? cSnap.data().pilotoPreview : null;
            if ((grupo === 'A' || grupo === 'B') && piloto.orderEligible(normalizedItems)) {
                await newOrderRef.update({ pilotoPreview: grupo });
                console.log(`[PILOTO] Pedido DH${newOrderNumber} heredó el grupo ${grupo} del contacto ${contactId}.`);
            }
        }
    } catch (pilotoErr) {
        console.warn('[PILOTO] Herencia de grupo al pedido falló (no fatal):', pilotoErr.message);
    }

    // Prueba A/B de la RI: el pedido hereda el grupo riTest del contacto (mismo
    // criterio de elegibilidad). Independiente del piloto preview. Best-effort.
    try {
        const riTest = require('./riTest');
        if ((await riTest.getRiTestConfig()).enabled) {
            const cSnap = await contactRef.get();
            const grupo = cSnap.exists ? cSnap.data().riTest : null;
            if ((grupo === 'A' || grupo === 'B') && riTest.orderEligible(normalizedItems)) {
                await newOrderRef.update({ riTest: grupo });
                console.log(`[RI_TEST] Pedido DH${newOrderNumber} heredó el grupo ${grupo} del contacto ${contactId}.`);
            }
        }
    } catch (riErr) {
        console.warn('[RI_TEST] Herencia de grupo al pedido falló (no fatal):', riErr.message);
    }

    // Prueba de precio: el pedido hereda el grupo y el precio del contacto (para el corte).
    try {
        const priceTest = require('./priceTest');
        if ((await priceTest.getPriceTestConfig()).enabled) {
            const cSnap = await contactRef.get();
            const grupo = cSnap.exists ? cSnap.data().priceTest : null;
            if ((grupo === 'A' || grupo === 'B') && priceTest.orderEligible(normalizedItems)) {
                await newOrderRef.update({ priceTest: grupo, priceTestValue: cSnap.data().priceTestValue || null });
                console.log(`[PRICE_TEST] Pedido DH${newOrderNumber} heredó el grupo ${grupo} del contacto ${contactId}.`);
            }
        }
    } catch (priceErr2) {
        console.warn('[PRICE_TEST] Herencia de grupo al pedido falló (no fatal):', priceErr2.message);
    }

    // Prueba de anticipo: el pedido hereda el grupo (para el corte y los chips). En grupo A el
    // registro implica anticipo YA pagado (Andrea solo registra con comprobante), así que se
    // sella anticipoCobrado como dato para postventa/cobranza y para medir la caja adelantada.
    try {
        const anticipoTest = require('./anticipoTest');
        if ((await anticipoTest.getAnticipoConfig()).enabled) {
            const cSnap = await contactRef.get();
            const grupo = cSnap.exists ? cSnap.data().anticipoTest : null;
            if ((grupo === 'A' || grupo === 'B') && anticipoTest.orderEligible(normalizedItems)) {
                const update = { anticipoTest: grupo };
                if (grupo === 'A') update.anticipoCobrado = anticipoTest.ANTICIPO;
                await newOrderRef.update(update);
                console.log(`[ANTICIPO_TEST] Pedido DH${newOrderNumber} heredó el grupo ${grupo} del contacto ${contactId}.`);
            }
        }
    } catch (antErr) {
        console.warn('[ANTICIPO_TEST] Herencia de grupo al pedido falló (no fatal):', antErr.message);
    }

    // Actualizar el documento del contacto con la información del último pedido y MARCAR COMO REGISTRADO (corona plateada)
    const contactUpdate = {
        lastOrderNumber: newOrderNumber,
        lastOrderDate: nuevoPedido.createdAt,
        purchaseStatus: 'registered',
        purchaseValue: totalValue,
        purchaseDate: admin.firestore.FieldValue.serverTimestamp()
    };
    // Registrar un pedido resuelve la revisión pendiente: quitar la etiqueta
    // "Pendientes de revisión IA" si el contacto la tenía.
    try {
        const contactSnap = await contactRef.get();
        if (contactSnap.exists && contactSnap.data().status === 'pendientes_ia') {
            contactUpdate.status = null;
            // Igual que PUT /contacts/:id/status: bump para que el listener del frontend
            // (filtra por lastMessageTimestamp > carga de la app) vea el cambio en vivo.
            contactUpdate.lastMessageTimestamp = admin.firestore.FieldValue.serverTimestamp();
            console.log(`[ORDERS] Contacto ${contactId}: etiqueta pendientes_ia quitada al registrar el pedido DH${newOrderNumber}.`);
        }
    } catch (_) { /* si la lectura falla, el update principal continúa igual */ }
    // No fatal: el pedido YA está creado. Si este update lanzara, el caller (en especial el
    // registro por IA) creería que el pedido NO se creó y pediría registrarlo de nuevo a mano
    // — un pedido duplicado. La corona/último-pedido del contacto es metadato best-effort.
    try {
        await contactRef.update(contactUpdate);
    } catch (contactErr) {
        console.error(`[ORDERS] Pedido DH${newOrderNumber} creado, pero falló el update del contacto ${contactId}:`, contactErr.message);
    }

    // Métrica de rescate: si este contacto fue contactado por el seguimiento de IA
    // recientemente, contabilizar el pedido como recuperación (fire-and-forget).
    try {
        require('../leads/orderFollowupMetrics')
            .markOrderFollowupConverted(contactId, { orderNumber: `DH${newOrderNumber}`, value: totalValue })
            .catch(() => {});
    } catch (_) {}

    // Evento Purchase a Meta — SOLO si el ajuste (Ajustes > Herramientas) está en "registro".
    // Por defecto el ajuste es "fabricar", así que normalmente esto NO se envía aquí; el Purchase
    // se manda al pasar a "Fabricar" vía sendPurchaseEventOnFabricar(). El flag metaPurchaseSentAt
    // evita duplicados si después cambia el estatus.
    try {
        if ((await getPurchaseEventTrigger()) === 'registration' && contactRef) {
            const contactSnap = await contactRef.get();
            const cData = contactSnap.exists ? contactSnap.data() : null;
            // Multicanal: WhatsApp (wa_id), Messenger (psid) o Instagram (igsid).
            const eventInfo = cData ? messagingContactInfo(cData) : null;
            if (eventInfo && (eventInfo.wa_id || eventInfo.psid || eventInfo.igsid)) {
                const customData = { value: totalValue, currency: 'MXN' };
                console.log(`[META EVENT] Enviando Purchase por registro de pedido DH${newOrderNumber}, contacto ${contactId}`);
                await sendConversionEvent('Purchase', eventInfo, cData.adReferral || {}, customData);
                await newOrderRef.update({ metaPurchaseSentAt: admin.firestore.FieldValue.serverTimestamp() });
                console.log(`[META EVENT] ✅ Evento Purchase enviado por registro, pedido DH${newOrderNumber}, valor $${totalValue}`);
            } else {
                console.warn(`[META EVENT] Contacto ${contactId} sin identificador de mensajería. No se envió Purchase por registro.`);
            }
        }
    } catch (metaError) {
        console.error('[META EVENT] Error al enviar Purchase por registro:', metaError.message);
        if (metaError.response) console.error('[META EVENT] Respuesta:', JSON.stringify(metaError.response.data));
        // No fallar el registro del pedido por un error en Meta
    }

    // --- Detección automática de cliente recurrente ---
    // Buscar si este teléfono ya tiene otros pedidos PAGADOS anteriores
    const phone = contactId || telefono;
    if (phone) {
        try {
            const previousOrders = await db.collection('pedidos')
                .where('contactId', '==', phone)
                .get();

            // Filtrar solo pedidos pagados (Pagado o Fabricar)
            const paidDocs = previousOrders.docs.filter(doc => {
                const est = doc.data().estatus;
                return est === 'Pagado' || est === 'Fabricar';
            });

            // Si tiene 2+ pedidos PAGADOS, es recurrente
            if (paidDocs.length >= 2) {
                let totalSpent = 0;
                const products = [];
                let lastOrderDate = null;

                paidDocs.forEach(doc => {
                    const d = doc.data();
                    totalSpent += d.precio || 0;
                    if (d.producto && !products.includes(d.producto)) products.push(d.producto);
                    const oDate = d.createdAt ? d.createdAt.toDate() : null;
                    if (oDate && (!lastOrderDate || oDate > lastOrderDate)) lastOrderDate = oDate;
                });

                // Obtener nombre
                const contactData = (await contactRef.get()).data();
                const name = contactData?.name || 'Sin nombre';

                // Guardar/actualizar en recurring_customers
                await db.collection('recurring_customers').doc(phone).set({
                    name,
                    orderCount: paidDocs.length,
                    totalSpent,
                    products,
                    lastOrderDate,
                    detectedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                console.log(`[RECURRENTE] Cliente ${name} (${phone}) detectado con ${paidDocs.length} pedidos pagados, total: $${totalSpent}`);
            }
        } catch (recErr) {
            console.error('Error al detectar recurrente:', recErr);
            // No bloquear la creación del pedido por este error
        }
    }

    return { orderNumber: newOrderNumber, orderRef: newOrderRef, totalValue, itemCount: normalizedItems.length };
}

module.exports = { createOrder, normalizeOrderItems, computeOrderMainFields };
