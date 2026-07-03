/**
 * Cliente de la API de Envíos Perros (https://app.enviosperros.com/api/v2) — 2ª paquetería del CRM
 * (Estafeta/J&T/Redpack/FedEx), complementaria a T1 Envíos (DHL). Se usa cuando DHL sale caro.
 *
 * Auth: API Key (header Bearer). La key se genera en app.enviosperros.com/integrations y va SOLO en
 * env de Render como ENVIOSPERROS_API_KEY (nunca en el repo).
 * Docs: https://enviosperrosv2.docs.apiary.io/
 */
const axios = require('axios');

const EP_API_BASE = (process.env.EP_API_BASE || 'https://app.enviosperros.com/api/v2').replace(/\/+$/, '');
const EP_API_KEY = process.env.ENVIOSPERROS_API_KEY || process.env.EP_API_KEY || '';

// Paquete por defecto (la lámpara): 22×17×5 cm, ~1 kg. Reusa los env de T1 si existen.
const DEF = {
    largo: Number(process.env.T1_LARGO || 22),
    ancho: Number(process.env.T1_ANCHO || 17),
    alto: Number(process.env.T1_ALTO || 5),
    peso: Number(process.env.T1_PESO || 1),
    valor: Number(process.env.T1_VALOR_PAQUETE || 750),
};

// Remitente (datos_origen) Dekoor. Reusa los env de T1 si existen.
const ORIGEN = {
    company: process.env.T1_ORIGEN_COMERCIO || 'Dekoor',
    name: `${process.env.T1_ORIGEN_NOMBRE || 'Christian'} ${process.env.T1_ORIGEN_APELLIDOS || 'Morales'}`.trim(),
    email: process.env.T1_ORIGEN_EMAIL || 'dekoorhouse.work@gmail.com',
    street: process.env.T1_ORIGEN_CALLE || 'Hilario Moreno',
    outdoor_number: process.env.T1_ORIGEN_NUMERO || '206',
    neighborhood: process.env.T1_ORIGEN_COLONIA || 'Azteca',
    zip_code: process.env.T1_ORIGEN_CP || '34190',
    city: process.env.T1_ORIGEN_MUNICIPIO || 'Durango',
    state: process.env.T1_ORIGEN_ESTADO || 'Durango',
    phone: process.env.T1_ORIGEN_TEL || '6182297167',
    references: process.env.T1_ORIGEN_REF || 'Esquina con Carlos Rueda de León. Puerta Blanca',
};

function _headers() {
    if (!EP_API_KEY) throw new Error('Falta ENVIOSPERROS_API_KEY en el entorno (.env / Render).');
    return { Authorization: `Bearer ${EP_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

/**
 * POST /shipping/rates — cotiza envío entre 2 C.P. Devuelve la respuesta cruda de Envíos Perros
 * (lista de tarifas por paquetería/servicio).
 */
async function cotizar({ cpDestino, cpOrigen, peso, largo, ancho, alto } = {}) {
    const body = {
        depth: Number(largo != null ? largo : DEF.largo),
        width: Number(ancho != null ? ancho : DEF.ancho),
        height: Number(alto != null ? alto : DEF.alto),
        weight: Number(peso != null ? peso : DEF.peso),
        origin: { codePostal: String(cpOrigen || ORIGEN.zip_code).replace(/\D/g, '') },
        destination: { codePostal: String(cpDestino || '').replace(/\D/g, '') },
    };
    const r = await axios.post(`${EP_API_BASE}/shipping/rates`, body, { headers: _headers(), timeout: 25000 });
    return r.data;
}

/**
 * Normaliza la respuesta de cotizar() a una lista uniforme { paqueteria, servicio, tipo_servicio,
 * costo, dias, moneda, deliveryType, raw } para mezclar con las de T1. Tolerante al formato exacto
 * (se ajusta tras ver la respuesta real).
 */
function normalizarRates(data) {
    const arr = Array.isArray(data) ? data : (Array.isArray(data && data.data) ? data.data : (Array.isArray(data && data.rates) ? data.rates : []));
    return arr.map((r) => ({
        paqueteria: r.company || r.name || r.carrier || 'EP',
        servicio: r.name || r.deliveryType || r.service || '',
        tipo_servicio: r.deliveryType || r.service_type || '',
        costo: Number(r.cost != null ? r.cost : (r.total != null ? r.total : (r.amount != null ? r.amount : 0))),
        dias: r.days || r.estimated_days || r.deliveryDays || null,
        moneda: r.currency || 'MXN',
        deliveryType: r.deliveryType || r.service || null,
        raw: r,
    })).filter((x) => x.costo > 0);
}

module.exports = {
    cotizar,
    normalizarRates,
    _config: { EP_API_BASE, DEF, ORIGEN, hasKey: !!EP_API_KEY },
};
