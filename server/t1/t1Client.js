/**
 * Cliente de la API de T1 Envíos (https://apiv2.t1envios.com) para generar guías DHL
 * automáticamente desde el CRM. Reemplaza la automatización del viejo sistema J&T.
 *
 * Autenticación: Keycloak OAuth2 "password grant" (id.t1.com, realm T1). El token dura
 * 30 min; aquí se cachea y se renueva solo. El token va ligado al comercio (correo/contraseña),
 * por eso /balance/consult no necesita más identificador.
 *
 * Credenciales SOLO por env (nunca en el repo): T1_EMAIL, T1_PASSWORD.
 * Docs: https://t1docs.dev.plataformat1.com/docs/T1Envios/
 */
const axios = require('axios');

// ---- Config (todo overrideable por env; defaults = producción de Dekoor) --------------------
const T1_TOKEN_URL     = process.env.T1_TOKEN_URL     || 'https://id.t1.com/auth/realms/T1/protocol/openid-connect/token';
const T1_CLIENT_ID     = process.env.T1_CLIENT_ID     || 't1envios';
const T1_CLIENT_SECRET = process.env.T1_CLIENT_SECRET || 'f64cd365-346d-461d-95b4-91938594b84a'; // público (viene en la doc)
const T1_API_BASE      = (process.env.T1_API_BASE     || 'https://apiv2.t1envios.com').replace(/\/+$/, '');
const T1_EMAIL         = process.env.T1_EMAIL || '';
const T1_PASSWORD      = process.env.T1_PASSWORD || '';
const T1_SHOP_ID       = process.env.T1_SHOP_ID     || '312698'; // id de la tienda (header shop_id)
const T1_COMERCIO_ID   = process.env.T1_COMERCIO_ID || '30463';  // clave del comercio (la reporta /balance/consult)

// Mensajería / paquete por defecto
const T1_MENSAJERIA    = process.env.T1_MENSAJERIA    || 'DHL';
const T1_TIPO_SERVICIO = process.env.T1_TIPO_SERVICIO || 'Dia Siguiente'; // DHL EXPRESS DOMESTIC (confirmar valor exacto en 1ª guía real)
const T1_TIPO_PAQUETE  = Number(process.env.T1_TIPO_PAQUETE || 2); // 1=sobre, 2=paquete

// Paquete por defecto (la lámpara): 22×17×5 cm, ~300 g real. Volumétrico ≈ 0.37 kg → DHL
// lo cobra como guía de 1 kg, así que se declara peso=1. Ajustables por env.
const DEFAULT_PAQUETE = {
    peso:  Number(process.env.T1_PESO  || 1),
    largo: Number(process.env.T1_LARGO || 22),
    ancho: Number(process.env.T1_ANCHO || 17),
    alto:  Number(process.env.T1_ALTO  || 5),
    valor_paquete: Number(process.env.T1_VALOR_PAQUETE || 750),
    seguro: /^(1|true|si|sí)$/i.test(process.env.T1_SEGURO || 'false'),
};

// Remitente (datos_origen) por defecto. Ajustables por env.
const DATOS_ORIGEN = {
    codigo_postal:          process.env.T1_ORIGEN_CP        || '34190',
    nombre:                 process.env.T1_ORIGEN_NOMBRE    || 'Christian',
    apellidos:              process.env.T1_ORIGEN_APELLIDOS || 'Morales',
    email:                  process.env.T1_ORIGEN_EMAIL     || 'dekoorhouse.work@gmail.com',
    calle:                  process.env.T1_ORIGEN_CALLE     || 'Hilario Moreno',
    numero:                 process.env.T1_ORIGEN_NUMERO    || '206',
    colonia:                process.env.T1_ORIGEN_COLONIA   || 'Azteca',
    telefono:               process.env.T1_ORIGEN_TEL       || '6182297167',
    estado:                 process.env.T1_ORIGEN_ESTADO    || 'Durango',
    municipio:              process.env.T1_ORIGEN_MUNICIPIO || 'Durango',
    referencias:            process.env.T1_ORIGEN_REF       || 'Esquina con Carlos Rueda de León. Puerta Blanca',
    nombre_comercio_origen: process.env.T1_ORIGEN_COMERCIO  || 'Dekoor',
};

// ---- Cache de token -------------------------------------------------------------------------
let _token = null;      // { access_token, expiresAt (ms) }

function _assertCreds() {
    if (!T1_EMAIL || !T1_PASSWORD) {
        throw new Error('Faltan credenciales T1: define T1_EMAIL y T1_PASSWORD en el entorno (.env / Render).');
    }
}

/** Obtiene un access_token (Keycloak password grant), cacheado hasta ~1 min antes de expirar. */
async function getToken(force = false) {
    if (!force && _token && Date.now() < _token.expiresAt - 60000) {
        return _token.access_token;
    }
    _assertCreds();
    const body = new URLSearchParams({
        grant_type: 'password',
        client_id: T1_CLIENT_ID,
        client_secret: T1_CLIENT_SECRET,
        username: T1_EMAIL,
        password: T1_PASSWORD,
    });
    const r = await axios.post(T1_TOKEN_URL, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
    });
    const data = r.data || {};
    if (!data.access_token) throw new Error('T1: respuesta de token sin access_token');
    _token = {
        access_token: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in || 1800) * 1000),
    };
    return _token.access_token;
}

/** Headers estándar autenticados. */
async function _authHeaders(extra = {}) {
    const token = await getToken();
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        shop_id: T1_SHOP_ID,
        ...extra,
    };
}

/** GET /balance/consult → saldo disponible (prepago). */
async function consultarSaldo() {
    const r = await axios.get(`${T1_API_BASE}/balance/consult`, {
        headers: await _authHeaders(),
        timeout: 15000,
    });
    return r.data;
}

/**
 * POST /quote/create → cotiza envío entre 2 CP. Devuelve la respuesta cruda de T1
 * (result[].cotizacion.servicios{ SERVICIO: { servicio, tipo_servicio, costo_total, ... } }).
 * Útil para descubrir el tipo_servicio de DHL y el costo antes de generar la guía.
 */
async function cotizar({ cpDestino, cpOrigen, peso, largo, ancho, alto, valorPaquete, tipoPaquete, diasEmbarque, seguro } = {}) {
    const payload = {
        codigo_postal_origen: cpOrigen || DATOS_ORIGEN.codigo_postal,
        codigo_postal_destino: String(cpDestino || '').replace(/\D/g, ''),
        peso:  peso  != null ? Number(peso)  : DEFAULT_PAQUETE.peso,
        largo: largo != null ? Number(largo) : DEFAULT_PAQUETE.largo,
        ancho: ancho != null ? Number(ancho) : DEFAULT_PAQUETE.ancho,
        alto:  alto  != null ? Number(alto)  : DEFAULT_PAQUETE.alto,
        dias_embarque: diasEmbarque != null ? Number(diasEmbarque) : 1,
        seguro: seguro != null ? !!seguro : DEFAULT_PAQUETE.seguro,
        valor_paquete: valorPaquete != null ? Number(valorPaquete) : DEFAULT_PAQUETE.valor_paquete,
        tipo_paquete: tipoPaquete != null ? Number(tipoPaquete) : T1_TIPO_PAQUETE,
        comercio_id: T1_COMERCIO_ID,
    };
    const r = await axios.post(`${T1_API_BASE}/quote/create`, payload, {
        headers: await _authHeaders(),
        timeout: 25000,
    });
    return r.data;
}

/**
 * POST /guide/create-without-quote → genera una guía sin cotización previa (usa mensajería +
 * tipo_servicio fijos). Devuelve { success, message, detail: { num_orden, guia, file (PDF base64), pick_up } }.
 *
 * @param {object} opts
 * @param {object} opts.destino   datos_destino: { codigo_postal, nombre, apellidos, email, calle, numero,
 *                                 colonia, telefono, estado, municipio, referencias }
 * @param {string} opts.pedido    número de pedido del comercio (pedido_comercio)
 * @param {object} [opts.paquete] override de { descripcion, tipo_paquete, peso, largo, ancho, alto, seguro }
 * @param {string} [opts.mensajeria]     default T1_MENSAJERIA (DHL)
 * @param {string} [opts.tipoServicio]   default T1_TIPO_SERVICIO
 * @param {boolean}[opts.generarRecoleccion] default false
 */
async function crearGuia({ destino, pedido, paquete = {}, mensajeria, tipoServicio, generarRecoleccion } = {}) {
    if (!destino || !destino.codigo_postal) throw new Error('crearGuia: falta destino.codigo_postal');
    const servicio = tipoServicio || T1_TIPO_SERVICIO;
    if (!servicio) throw new Error('crearGuia: falta tipo_servicio (setéalo en T1_TIPO_SERVICIO tras cotizar)');

    const body = {
        comercio_id: T1_COMERCIO_ID,
        pedido_comercio: String(pedido || ''),
        contenido: {
            descripcion: paquete.descripcion || 'Lámpara decorativa',
            paquetes: Number(paquete.paquetes != null ? paquete.paquetes : 1), // nº de bultos (T1 lo exige en contenido)
            tipo_paquete: String(paquete.tipo_paquete != null ? paquete.tipo_paquete : T1_TIPO_PAQUETE),
            peso:  paquete.peso  != null ? Number(paquete.peso)  : DEFAULT_PAQUETE.peso,
            largo: paquete.largo != null ? Number(paquete.largo) : DEFAULT_PAQUETE.largo,
            ancho: paquete.ancho != null ? Number(paquete.ancho) : DEFAULT_PAQUETE.ancho,
            alto:  paquete.alto  != null ? Number(paquete.alto)  : DEFAULT_PAQUETE.alto,
            seguro: paquete.seguro != null ? !!paquete.seguro : DEFAULT_PAQUETE.seguro,
        },
        mensajeria: {
            mensajeria: mensajeria || T1_MENSAJERIA,
            tipo_servicio: servicio,
            generar_recoleccion: !!generarRecoleccion,
            dias_embarque: Number(process.env.T1_DIAS_EMBARQUE || 1), // T1 lo exige: días para embarcar
        },
        datos_origen: { ...DATOS_ORIGEN },
        datos_destino: {
            codigo_postal: String(destino.codigo_postal || '').replace(/\D/g, ''),
            nombre:      destino.nombre || '',
            apellidos:   destino.apellidos || '',
            email:       destino.email || '',
            calle:       destino.calle || '',
            numero:      destino.numero || '',
            colonia:     destino.colonia || '',
            telefono:    String(destino.telefono || '').replace(/\D/g, ''),
            estado:      destino.estado || '',
            municipio:   destino.municipio || '',
            referencias: destino.referencias || '',
            nombre_comercio_origen: destino.nombre_comercio_origen || '',
        },
    };
    const r = await axios.post(`${T1_API_BASE}/guide/create-without-quote`, body, {
        headers: await _authHeaders(),
        timeout: 30000,
    });
    return r.data;
}

module.exports = {
    getToken,
    consultarSaldo,
    cotizar,
    crearGuia,
    // exportados para pruebas / inspección
    _config: { T1_API_BASE, T1_TOKEN_URL, T1_SHOP_ID, T1_COMERCIO_ID, T1_MENSAJERIA, T1_TIPO_SERVICIO, DEFAULT_PAQUETE, DATOS_ORIGEN },
};
