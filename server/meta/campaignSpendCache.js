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
        return { porCampana: {}, total: 0, error: null };
    }

    const llave = `${cuentas.join(',')}|${dateFrom}|${dateTo}`;
    const hit = cache.get(llave);
    if (hit && (Date.now() - hit.ts) < TTL_MS) {
        return { porCampana: hit.porCampana, total: hit.total, error: hit.error };
    }

    try {
        const { campaigns, errors } = await metaAdsService.getCampaignSpendForAccounts(cuentas, dateFrom, dateTo);

        const porCampana = {};
        let total = 0;
        for (const c of campaigns) {
            if (!c.campaignId) continue;
            porCampana[String(c.campaignId)] = (porCampana[String(c.campaignId)] || 0) + c.spend;
            total += c.spend;
        }

        // Si TODAS las cuentas fallaron no hay gasto que enseñar; hay que
        // decirlo en vez de pintar un costo por pedido de $0, que se leería
        // como "la campaña no gastó nada".
        const error = (errors.length && errors.length === cuentas.length)
            ? errors[0].error
            : null;

        const entrada = { porCampana, total, error, ts: Date.now() };
        cache.set(llave, entrada);
        return { porCampana, total, error };
    } catch (err) {
        return { porCampana: {}, total: 0, error: err.message };
    }
}

function limpiarCache() {
    cache.clear();
}

module.exports = { gastoPorCampana, limpiarCache };
