/**
 * Consulta la herramienta pública de "Frecuencia de entregas" de Estafeta para un C.P. destino,
 * usando un origen fijo (Durango 34188 → plaza DGO). Devuelve la frecuencia de entrega, si hay
 * "Ocurre Forzoso" (el cliente recoge en sucursal) y si hay "Costos de Reexpedición" (zona lejana).
 *
 * Se usa desde: el endpoint GET /api/estafeta/frecuencia/:cp y la IA (nota de cobertura).
 * Config por env: ESTAFETA_ORIGIN_SQUARE (default 'DGO'), ESTAFETA_ORIGIN_CP (default '34188').
 */
const axios = require('axios');

const ESTAFETA_ORIGIN_SQUARE = process.env.ESTAFETA_ORIGIN_SQUARE || 'DGO';
const ESTAFETA_ORIGIN_CP = process.env.ESTAFETA_ORIGIN_CP || '34188';
const ESTAFETA_FREQ_BASE = 'https://frecuenciaentregasitecorecms.azurewebsites.net/FreqDelivery/getFreqDeliverySquare';

// Parser del HTML que devuelve la herramienta de frecuencia de Estafeta.
function parseEstafetaFrecuencia(html) {
    let h = String(html || '');
    const ents = { '&#243;': 'ó', '&#225;': 'á', '&#233;': 'é', '&#237;': 'í', '&#250;': 'ú', '&#209;': 'Ñ', '&#241;': 'ñ', '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ' };
    for (const [k, v] of Object.entries(ents)) h = h.split(k).join(v);
    const plain = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const siNo = (lbl) => {
        const m = plain.match(new RegExp(lbl + '\\s*:?\\s*(S[ií]|No)\\b', 'i'));
        return m ? (/^s/i.test(m[1]) ? 'Sí' : 'No') : null;
    };
    const grab = (re) => { const m = plain.match(re); return m ? m[1].trim() : null; };
    const destinoCP = grab(/C[oó]digo Postal:\s*(\d{4,5})/i);
    const estado = grab(/C[oó]digo Postal:\s*\d{4,5}\s+Estado\s+([A-ZÁÉÍÓÚÑ .]+?)\s+Delegaci/i);
    const delegacion = grab(/Delegaci[oó]n:\s*([A-ZÁÉÍÓÚÑ .]+?)\s+Plaza/i);
    const plaza = grab(/Plaza\s*1\s*:\s*([A-ZÁÉÍÓÚÑ .]+?)\s+Colonia/i);
    const frecuencia = grab(/Modalidad de entrega\s+Frecuencia\s+([A-Za-zÁÉÍÓÚñ ]+?)\s+Ocurre/i);
    const ocurreForzoso = siNo('Ocurre Forzoso');
    // Costos de Reexpedición: Estafeta lo muestra como "No" (sin costo) o como un MONTO ("$174.00")
    // cuando SÍ hay costo. Normalizamos a reexpedicion = 'No'|'Sí' y guardamos el monto aparte.
    let reexpedicion = null, reexpedicionCosto = null;
    const rm = plain.match(/Costos de Reexpedici[oó]n\s*:?\s*(No|\$\s*[\d,]+(?:\.\d+)?)/i);
    if (rm) {
        const v = rm[1].trim();
        if (/^no$/i.test(v)) { reexpedicion = 'No'; }
        else { reexpedicion = 'Sí'; reexpedicionCosto = v.replace(/\s+/g, ''); }
    }
    const found = !!(destinoCP && frecuencia && ocurreForzoso && reexpedicion);
    return { found, destinoCP, estado, delegacion, plaza, frecuencia, ocurreForzoso, reexpedicion, reexpedicionCosto };
}

/**
 * Consulta Estafeta para el C.P. destino. Devuelve un objeto con los criterios, o null si Estafeta
 * no responde. `ok` = (Ocurre Forzoso == No && Costos de Reexpedición == No). Nunca lanza.
 */
async function checkFrecuencia(cp) {
    const dest = String(cp || '').replace(/\D/g, '');
    if (!/^\d{5}$/.test(dest)) return { found: false, invalid: true, origenCP: ESTAFETA_ORIGIN_CP, destinoCP: dest };
    try {
        const r = await axios.get(ESTAFETA_FREQ_BASE, {
            params: { square: ESTAFETA_ORIGIN_SQUARE, destinationZipCode: dest },
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 9000,
            responseType: 'text',
        });
        const parsed = parseEstafetaFrecuencia(r.data);
        const ok = parsed.found && parsed.reexpedicion === 'No' && parsed.ocurreForzoso === 'No';
        return { origenCP: ESTAFETA_ORIGIN_CP, ok, ...parsed };
    } catch (error) {
        console.warn('[ESTAFETA] No se pudo consultar frecuencia para CP', dest, ':', error.message);
        return null; // el llamador degrada con gracia
    }
}

module.exports = { checkFrecuencia, parseEstafetaFrecuencia, ESTAFETA_ORIGIN_CP, ESTAFETA_ORIGIN_SQUARE };
