// --- Servicio de rastreo unificado --------------------------------------------------------------
// Punto único para "¿dónde va el paquete?": intenta la API OFICIAL de DHL (si hay DHL_API_KEY) y,
// si no, cae al estatus vía T1 (que igual es el del paquete DHL, solo transmitido por T1). Devuelve
// SIEMPRE la misma forma normalizada, con una "fase" simple para el cliente. Lo consumen el endpoint
// /api/rastreo, la página de rastreo y la nota de rastreo que se inyecta al bot de IA.
const dhl = require('../dhl/dhlTracking');

// Fases en orden, para la barra de progreso de la página.
const FASES = ['Pedido enviado', 'En camino', 'En tu ciudad', 'En reparto', 'Entregado'];

// Deriva la fase simple a partir del texto del estatus (fallback robusto para T1, que solo da texto).
function faseFromText(txt) {
    const t = String(txt || '').toLowerCase();
    if (/entregad|delivered/.test(t)) return 'Entregado';
    if (/reparto|out for delivery|en ruta de entrega|con.*repartidor/.test(t)) return 'En reparto';
    if (/(en tu ciudad|centro de distribuci|instalaci.*destino|arrived at|delivery facility|lleg[oó] a la ciudad)/.test(t)) return 'En tu ciudad';
    if (/tr[aá]nsito|transit|recolectad|recogid|picked up|procesad|processed|en camino|embarcad/.test(t)) return 'En camino';
    return 'Pedido enviado';
}

/**
 * Estatus de rastreo de una guía. `provider` ('t1' | 'ep') ayuda a decidir la fuente.
 * @returns objeto normalizado { fuente, guia, fase, descripcion, fecha, ubicacion, entregado, eventos } o null.
 */
async function getTrackingStatus(guia, { provider } = {}) {
    const g = String(guia || '').trim();
    if (!g) return null;

    // 1) DHL oficial (timeline con ciudades) si hay clave. No aplica a guías de Envíos Perros.
    if (process.env.DHL_API_KEY && provider !== 'ep') {
        try {
            const d = await dhl.getTracking(g);
            if (d) return d;
        } catch (e) {
            console.warn('[TRACK] DHL API falló, uso T1:', e.response && e.response.status, e.message);
        }
    }

    // 2) T1 (relaya el estatus DHL). Guías de Envíos Perros no las cubre T1.
    if (provider === 'ep') {
        return { fuente: 'ep', guia: g, fase: null, descripcion: 'Guía de otra paquetería; rastreo directo con la paquetería.', eventos: [] };
    }
    try {
        const t1 = require('../t1/t1Client');
        const r = await t1.rastrear(g);
        const det = (r && r.detail) || {};
        const descripcion = det.descripcion || det.familia_descripcion || (r && r.message) || '';
        const entregado = /entregad|delivered/i.test(descripcion) || /entregad/i.test(det.familia || '');
        return {
            fuente: 't1',
            guia: g,
            fase: faseFromText(`${descripcion} ${det.familia || ''} ${det.familia_descripcion || ''}`),
            descripcion,
            fecha: det.fecha || null,
            ubicacion: det.recibe ? `Recibió: ${det.recibe}` : null,
            entregado,
            eventos: [],
            raw: det, // temporal: para afinar el mapeo con respuestas reales; se puede quitar después
        };
    } catch (e) {
        console.warn('[TRACK] T1 rastrear falló:', e.response && e.response.status, e.message);
        return null;
    }
}

// Busca la guía de un pedido por su número consecutivo (DHxxxx o solo dígitos) y lo rastrea.
async function getTrackingByOrderNumber(db, num) {
    const n = parseInt(String(num).replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return { error: 'numero_invalido' };
    const snap = await db.collection('pedidos').where('consecutiveOrderNumber', '==', n).limit(1).get();
    if (snap.empty) return { error: 'pedido_no_encontrado' };
    const o = snap.docs[0].data();
    const ge = o.guiaEnvio;
    if (!ge || !ge.guia) return { error: 'sin_guia', pedido: n };
    const st = await getTrackingStatus(ge.guia, { provider: ge.proveedor });
    return { pedido: n, guia: ge.guia, proveedor: ge.proveedor || 't1', trackingUrl: ge.tracking || null, estatus: st };
}

module.exports = { getTrackingStatus, getTrackingByOrderNumber, FASES, faseFromText };
