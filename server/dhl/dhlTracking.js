// --- Rastreo con la API oficial de DHL (Shipment Tracking - Unified) ---------------------------
// GET https://api-eu.dhl.com/track/shipments?trackingNumber=XXX  con header DHL-API-Key.
// Devuelve el timeline real del paquete DHL. Solo se usa si DHL_API_KEY está en el entorno;
// si no, el orquestador (trackingService.js) cae al estatus vía T1. Docs: developer.dhl.com.
const axios = require('axios');

const DHL_BASE = process.env.DHL_TRACK_URL || 'https://api-eu.dhl.com/track/shipments';

// Ubicación legible de un evento/estatus DHL (ciudad o país).
function locOf(node) {
    const a = node && node.location && node.location.address;
    if (!a) return null;
    return a.addressLocality || a.streetAddress || a.countryCode || null;
}

// Mapea el statusCode/descripción de DHL a nuestra fase simple para el cliente.
function faseFromDHL(statusCode, descr, ubic) {
    const c = String(statusCode || '').toLowerCase();
    const t = `${descr || ''} ${ubic || ''}`.toLowerCase();
    if (c === 'delivered' || /delivered|entregad/.test(t)) return 'Entregado';
    if (/out for delivery|con.*repartidor|en ruta de entrega|reparto/.test(t)) return 'En reparto';
    if (/(delivery facility|at.*facility|arrived at|centro de distribuci|instalaci.*destino|en la ciudad)/.test(t)) return 'En tu ciudad';
    if (c === 'transit' || /transit|tr[aá]nsito|picked up|recolectad|recogid|processed|procesad/.test(t)) return 'En camino';
    return 'Pedido enviado'; // pre-transit / unknown / info-received
}

/**
 * Consulta el rastreo de una guía en la API oficial de DHL.
 * @returns objeto normalizado, o null si no hay DHL_API_KEY o no hay datos.
 */
async function getTracking(guia) {
    const key = process.env.DHL_API_KEY;
    if (!key) return null;
    const g = String(guia || '').trim();
    if (!g) return null;

    const r = await axios.get(DHL_BASE, {
        params: { trackingNumber: g, language: 'es' },
        headers: { 'DHL-API-Key': key, Accept: 'application/json' },
        timeout: 20000,
    });
    const sh = (r.data && Array.isArray(r.data.shipments) && r.data.shipments[0]) || null;
    if (!sh) return null;

    const status = sh.status || {};
    const events = Array.isArray(sh.events) ? sh.events : [];
    const ubic = locOf(status) || (events[0] && locOf(events[0])) || null;
    const descr = status.description || status.status || status.statusCode || '';
    const entregado = String(status.statusCode || '').toLowerCase() === 'delivered';

    return {
        fuente: 'dhl',
        guia: g,
        fase: faseFromDHL(status.statusCode, descr, ubic),
        descripcion: descr,
        ubicacion: ubic,
        fecha: status.timestamp || (events[0] && events[0].timestamp) || null,
        entregado,
        estimacionEntrega: sh.estimatedTimeOfDelivery || null,
        // Historial (más reciente primero), acotado y en términos simples.
        eventos: events.slice(0, 10).map(e => ({
            fecha: e.timestamp || null,
            descripcion: e.description || e.status || '',
            ubicacion: locOf(e),
        })),
    };
}

module.exports = { getTracking, faseFromDHL };
