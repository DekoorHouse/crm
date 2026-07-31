/**
 * Caché en memoria de anuncio -> campaña de Meta.
 *
 * El desglose por campaña necesita traducir el `attributedAdId` de cada pedido a
 * su campaña, y eso es una llamada a la Graph API. Sin caché, cada vez que
 * alguien abre /pedidos/desglose y cambia de filtro se le vuelve a pegar a Meta
 * por los mismos 20-60 anuncios.
 *
 * Un anuncio nunca cambia de campaña, así que el positivo se puede guardar
 * horas; lo único que caduca es el NOMBRE (si renombran la campaña en Ads
 * Manager). El negativo dura poco: puede venir de un anuncio borrado (no se va a
 * arreglar) pero también de un token vencido o de la Graph caída, y en ese caso
 * queremos reintentar pronto.
 */

const metaAdsService = require('./metaAdsService');

const TTL_OK_MS = 6 * 60 * 60 * 1000;   // 6 h: por si renombran la campaña
const TTL_FAIL_MS = 10 * 60 * 1000;     // 10 min: reintentar tras un fallo pasajero

// adId -> { campaignId: string|null, campaignName: string|null, ts: number }
const cache = new Map();

function vigente(entrada, ahora) {
    if (!entrada) return false;
    const ttl = entrada.campaignId ? TTL_OK_MS : TTL_FAIL_MS;
    return (ahora - entrada.ts) < ttl;
}

/**
 * Resuelve una lista de Ad IDs a su campaña, usando la caché y pidiendo a Meta
 * solo los que faltan.
 *
 * Nunca lanza: si Meta no responde (o no hay token) devuelve lo que sí tenía y
 * el motivo en `error`, para que la página pueda pintar el desglose igual y
 * avisar que unas campañas quedaron sin identificar.
 *
 * @param {Array<string>} adIds
 * @returns {Promise<{map: Object<string,{campaignId:string, campaignName:string}>, error: string|null, resueltos:number, total:number}>}
 */
async function mapAdsToCampaigns(adIds) {
    const ahora = Date.now();
    const unicos = [...new Set((adIds || []).filter(Boolean).map(String))];
    const map = {};
    const faltantes = [];

    for (const id of unicos) {
        const entrada = cache.get(id);
        if (vigente(entrada, ahora)) {
            if (entrada.campaignId) {
                map[id] = { campaignId: entrada.campaignId, campaignName: entrada.campaignName };
            }
        } else {
            faltantes.push(id);
        }
    }

    let error = null;
    if (faltantes.length > 0) {
        try {
            const resueltos = await metaAdsService.resolveAdsToCampaigns(faltantes);
            for (const id of faltantes) {
                const campana = resueltos[id];
                cache.set(id, {
                    campaignId: campana ? String(campana.campaignId) : null,
                    campaignName: campana ? campana.campaignName : null,
                    ts: ahora
                });
                if (campana) map[id] = { campaignId: String(campana.campaignId), campaignName: campana.campaignName };
            }
        } catch (err) {
            // Falta de token: resolveAdsToCampaigns sí lanza aquí. Los errores de
            // red los traga adentro y simplemente no resuelve esos anuncios.
            error = err.message;
        }
    }

    return { map, error, resueltos: Object.keys(map).length, total: unicos.length };
}

// Para pruebas y para el endpoint de refresco manual.
function limpiarCache() {
    cache.clear();
}

module.exports = { mapAdsToCampaigns, limpiarCache };
