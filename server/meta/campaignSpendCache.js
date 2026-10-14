/**
 * Caché del gasto por campaña de Meta, para el costo por pedido del desglose.
 *
 * A diferencia del mapa anuncio->campaña, esto SÍ cambia solo: el gasto de hoy
 * crece durante el día. Por eso la caché dura pocos minutos — lo justo para que
 * cambiar de filtro o de agrupación no dispare una llamada nueva cada vez.
 *
 * Las cuentas no salen de una lista configurada a mano (la de Firestore se
 * quedó vieja: no trae la cuenta donde hoy corre la publicidad), sino de los
 * propios anuncios que trajeron los pedidos del rango.
 */

const metaAdsService = require('./metaAdsService');

const TTL_MS = 5 * 60 * 1000;

// "cuentas|desde|hasta" -> { porCampana: Object<string,number>, total: number, errores: [], ts: number }
const cache = new Map();

/**
 * Gasto por campaña en el rango, sumando las cuentas indicadas.
 *
 * Nunca lanza: si Meta no contesta devuelve el mapa vacío y el motivo en
 * `error`, para que el desglose se pinte igual pero sin costo por pedido.
 *
 * @param {string[]} accountIds  IDs limpios (sin act_)
 * @param {string} dateFrom  YYYY-MM-DD
 * @param {string} dateTo    YYYY-MM-DD (inclusivo, como lo espera Meta)
 * @returns {Promise<{porCampana: Object<string,number>, total: number, error: string|null}>}
 */
async function gastoPorCampana(accountIds, dateFrom, dateTo) {
    const cuentas = [...new Set((accountIds || []).filter(Boolean).map(String))].sort();
    if (!cuentas.length || !dateFrom || !dateTo) {
        return { porCampana: {}, porAnuncio: {}, detalle: {}, total: 0, error: null };
    }

    const llave = `${cuentas.join(',')}|${dateFrom}|${dateTo}`;
    const hit = cache.get(llave);
    if (hit && (Date.now() - hit.ts) < TTL_MS) {
        return { porCampana: hit.porCampana, porAnuncio: hit.porAnuncio, detalle: hit.detalle || {}, total: hit.total, error: hit.error };
    }

    try {
        // Se pide a nivel ANUNCIO y se suma por campaña: el total cuadra igual que
        // pidiéndolo por campaña y de paso sale el costo por pedido de cada anuncio.
        // Un 5xx de Meta suele ser pasajero (13-oct-2026: "Request failed with status code 503" dejó el
        // desglose sin costos): se reintenta una vez. Si el nivel anuncio sigue fallando en una cuenta,
        // esa cuenta se pide por CAMPAÑA: se pierde el costo por anuncio pero no el de la campaña.
        let { ads, errors } = await metaAdsService.getAdSpendForAccounts(cuentas, dateFrom, dateTo);
        if (errors.length) {
            await new Promise(r => setTimeout(r, 1500));
            const reintento = await metaAdsService.getAdSpendForAccounts(errors.map(e => e.accountId), dateFrom, dateTo);
            ads = ads.concat(reintento.ads);
            errors = reintento.errors;
        }
        let campanasRespaldo = [];
        if (errors.length) {
            const porCamp = await metaAdsService.getCampaignSpendForAccounts(errors.map(e => e.accountId), dateFrom, dateTo);
            campanasRespaldo = porCamp.campaigns;
            if (porCamp.errors.length) console.warn('[DESGLOSE] Gasto de Meta no disponible:', porCamp.errors.map(e => `${e.accountId}: ${e.error}`).join(' | '));
            errors = porCamp.errors;
        }

        const porCampana = {};
        const porAnuncio = {};
        // Nombres y campaña de cada anuncio y campaña con gasto: el desglose también enseña los que
        // gastaron sin traer pedidos (a pedido, 13-oct-2026).
        const detalle = { anuncios: {}, campanas: {} };
        let total = 0;
        for (const a of ads) {
            if (a.adId) {
                porAnuncio[String(a.adId)] = (porAnuncio[String(a.adId)] || 0) + a.spend;
                detalle.anuncios[String(a.adId)] = { nombre: a.adName || null, campaignId: a.campaignId ? String(a.campaignId) : null };
            }
            if (a.campaignId && a.campaignName) detalle.campanas[String(a.campaignId)] = a.campaignName;
            if (!a.campaignId) continue;
            porCampana[String(a.campaignId)] = (porCampana[String(a.campaignId)] || 0) + a.spend;
            total += a.spend;
        }
        for (const c of campanasRespaldo) {
            if (!c.campaignId) continue;
            if (c.campaignName) detalle.campanas[String(c.campaignId)] = c.campaignName;
            porCampana[String(c.campaignId)] = (porCampana[String(c.campaignId)] || 0) + c.spend;
            total += c.spend;
        }

        // Si TODAS las cuentas fallaron no hay gasto que enseñar; hay que
        // decirlo en vez de pintar un costo por pedido de $0, que se leería
        // como "la campaña no gastó nada".
        const error = (errors.length && errors.length === cuentas.length)
            ? errors[0].error
            : null;

        // Si Meta falló del todo pero hay un dato bueno anterior del mismo rango, se enseña ese (unos
        // minutos viejo) en vez de dejar las tarjetas sin costo. No se cachea el fallo.
        if (error && hit && !hit.error) {
            return { porCampana: hit.porCampana, porAnuncio: hit.porAnuncio, detalle: hit.detalle || {}, total: hit.total, error: null };
        }
        const entrada = { porCampana, porAnuncio, detalle, total, error, ts: error ? Date.now() - TTL_MS + 30000 : Date.now() };
        cache.set(llave, entrada);
        return { porCampana, porAnuncio, detalle, total, error };
    } catch (err) {
        return { porCampana: {}, porAnuncio: {}, detalle: {}, total: 0, error: err.message };
    }
}

function limpiarCache() {
    cache.clear();
}

module.exports = { gastoPorCampana, limpiarCache };
