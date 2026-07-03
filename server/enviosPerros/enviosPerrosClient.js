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
    // La respuesta real de EP viene como { message: [ { title, deliveryType:{name,feature,description,company}, available, cost, currency, ... } ] }
    const arr = Array.isArray(data && data.message) ? data.message
        : (Array.isArray(data) ? data
            : (Array.isArray(data && data.data) ? data.data : []));
    return arr.map((r) => {
        const dt = r.deliveryType || {};
        return {
            paqueteria: dt.company || r.company || 'EP',
            servicio: r.title || dt.description || dt.name || '',
            tipo_servicio: dt.name || '',          // código del servicio (deliveryType) para crear la orden
            costo: Number(r.cost != null ? r.cost : 0),
            dias: dt.feature || null,
            moneda: r.currency || 'MXN',
            deliveryType: dt.name || null,
            available: r.available !== false,
            pickup: !!r.pickup,
            raw: r,
        };
    }).filter((x) => x.available && x.costo > 0 && x.costo < 9999); // solo disponibles (cuenta verificada) y con costo real
}

/**
 * POST /orders — crea la orden/guía en Envíos Perros con el servicio elegido (deliveryType, ej.
 * "ESTAFETA_ECONOMICO"). Recibe el mismo `destino` mapeado que usa T1 (codigo_postal, nombre, calle,
 * numero, colonia, municipio, estado, referencias, telefono, email). Devuelve la respuesta cruda.
 * OJO: el esquema exacto se afina con la 1ª orden real (los 422 indican qué falta, sin cobrar).
 */
async function crearGuia({ destino, deliveryType, paquete = {} } = {}) {
    if (!deliveryType) throw new Error('EP crearGuia: falta deliveryType (código del servicio).');
    if (!destino || !destino.codigo_postal) throw new Error('EP crearGuia: falta destino.codigo_postal.');
    const p = {
        largo: paquete.largo != null ? paquete.largo : DEF.largo,
        ancho: paquete.ancho != null ? paquete.ancho : DEF.ancho,
        alto: paquete.alto != null ? paquete.alto : DEF.alto,
        peso: paquete.peso != null ? paquete.peso : DEF.peso,
        valor: paquete.valor != null ? paquete.valor : DEF.valor,
    };
    const body = {
        depth: Number(p.largo), width: Number(p.ancho), height: Number(p.alto), weight: Number(p.peso),
        deliveryType,
        type: 'package',
        // Carta porte (SAT) — valores genéricos configurables por env.
        claveProdServ: process.env.EP_CLAVE_PROD_SERV || '01010101',
        descripcion_producto: paquete.descripcion || 'Lampara decorativa',
        clave_unidad: process.env.EP_CLAVE_UNIDAD || 'H87',
        nombre_unidad: process.env.EP_NOMBRE_UNIDAD || 'Pieza',
        valor_mercancia: Number(p.valor),
        // Remitente (Dekoor)
        company_origin: ORIGEN.company, name_origin: ORIGEN.name, email_origin: ORIGEN.email,
        street_origin: ORIGEN.street, outdoor_number_origin: ORIGEN.outdoor_number, interior_number_origin: '',
        neighborhood_origin: ORIGEN.neighborhood, zip_code_origin: ORIGEN.zip_code, city_origin: ORIGEN.city,
        state_origin: ORIGEN.state, references_origin: ORIGEN.references, phone_origin: ORIGEN.phone,
        rfc_origin: process.env.EP_RFC_ORIGIN || 'XAXX010101000', save_origin: false,
        // Destinatario (cliente)
        company_dest: destino.nombre || '', name_dest: destino.nombre || '',
        street_dest: destino.calle || 'Domicilio', outdoor_number_dest: destino.numero || 'SN', interior_number_dest: '',
        neighborhood_dest: destino.colonia || '', zip_code_dest: String(destino.codigo_postal).replace(/\D/g, ''),
        city_dest: destino.municipio || '', state_dest: destino.estado || '',
        references_dest: destino.referencias || '', phone_dest: String(destino.telefono || '').replace(/\D/g, ''),
        email_dest: destino.email || '', rfc_dest: 'XAXX010101000', save_dest: false,
        ocurre: false,
    };
    const r = await axios.post(`${EP_API_BASE}/orders`, body, { headers: _headers(), timeout: 30000 });
    return r.data;
}

// Extrae número de guía / rastreo y URL de etiqueta de la respuesta de /orders (tolerante al formato).
function extractGuia(data) {
    const d = (data && data.data) ? data.data : (data || {});
    const guia = d.guide || d.waybill || d.tracking || d.trackingNumber || d.numero_guia || d.guia || (d.order && d.order.guide) || null;
    const label = d.label || d.label_url || d.pdf || d.url || d.etiqueta || (d.order && d.order.label) || null;
    const orderId = d.id || d.order_id || (d.order && d.order.id) || null;
    return { guia: guia ? String(guia) : null, label: label || null, orderId: orderId || null };
}

module.exports = {
    cotizar,
    crearGuia,
    normalizarRates,
    extractGuia,
    _config: { EP_API_BASE, DEF, ORIGEN, hasKey: !!EP_API_KEY },
};
