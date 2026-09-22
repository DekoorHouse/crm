'use strict';
/**
 * Cobertura de envío por código postal — lógica compartida por:
 *   - la IA (services.js): detecta el C.P. del cliente, cotiza en T1 y le deja a Leonel la NOTA
 *     interna; guarda el veredicto en el contacto (`coverage`); candados de /ttt y de /registrar.
 *   - el formulario de datos de envío (apiRoutes POST /datos-envio): revalida el C.P. que llenó el
 *     cliente (SEPOMEX + cotización) y marca el pedido en Envíos / Atención si no cuadra.
 *
 * Por qué existe (auditoría de 20 pedidos "sin cobertura" que sí se pagaron, 22-sep-2026):
 *   1. El chequeo solo miraba el ÚLTIMO mensaje del cliente: "83554" + "Puerto Peñasco" en dos
 *      mensajes -> el turno arrancaba con el segundo, sin dígitos, sin cotizar, sin nota, y Leonel
 *      respondía /ttt por inercia (6 de 20). Ahora se busca el C.P. en TODO el lote de mensajes del
 *      cliente desde nuestra última respuesta (ultimoCpDelLote).
 *   2. Tras un /lamento correcto, el cliente contestaba con el nombre del pueblo o "aquí llega DHL"
 *      y Leonel, sin nota nueva, "revisaba de nuevo" y decía que sí (5 de 20). Ahora el veredicto se
 *      guarda en el contacto y se le recuerda a la IA en cada turno (veredictoVigente + notaCobertura),
 *      y si aun así emite /ttt sin veredicto servible, el candado lo sustituye (decidirGuardTtt).
 *   3. Nada frenaba el registro del pedido tras un /lamento: 31 pedidos salieron con el mismo C.P. al
 *      que Leonel había dicho que no (bloqueaRegistro).
 *   4. El C.P. del formulario nunca se revalidaba: 13 pedidos salieron a reexpedición con un C.P.
 *      distinto al verificado; 4 eran errores de dedo detectables con SEPOMEX (validarFormularioEnvio).
 *
 * Regla de negocio vigente: SERVIMOS la zona solo si DHL cotiza <= MAX_ENVIO_SERVIBLE (default $200).
 * Pendiente de Chris (23-sep-2026): contar también FedEx <= umbral como servible.
 *
 * Sin dependencias de módulo al cargar (config/t1/sepomex se piden dentro de cada función) para
 * que las funciones puras se prueben sin Firestore.
 */

const UMBRAL_DEFAULT = 200;
const COVERAGE_TTL_DAYS = 45;              // un veredicto más viejo que esto ya no vale para /ttt
const TTT_TEXT_RE = /Ya hemos enviado varias veces a tu zona/i;
const LAMENTO_TEXT_RE = /no tenemos cobertura de env/i;
const TEXTO_REGISTRO_BLOQUEADO = 'Antes de registrar tu pedido necesito que el equipo confirme la cobertura de envío a tu zona 🙏 En cuanto lo tengan te aviso por aquí para continuar.';

function umbralEnvio() {
    const n = Number(process.env.MAX_ENVIO_SERVIBLE || UMBRAL_DEFAULT);
    return Number.isFinite(n) && n > 0 ? n : UMBRAL_DEFAULT;
}

function toMs(t) {
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (t instanceof Date) return t.getTime();
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (t._seconds != null) return t._seconds * 1000;
    if (t.seconds != null) return t.seconds * 1000;
    return 0;
}

/**
 * Códigos postales (5 dígitos sueltos) en un texto, sin repetir y en orden de aparición. Se ignoran
 * los que vienen pegados a un signo de dinero ("$12000") y los que forman parte de números más largos.
 */
function extraerCps(text) {
    const out = [];
    const s = String(text || '');
    const re = /(^|[^\d$#])(\d{5})(?!\d)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
        if (!out.includes(m[2])) out.push(m[2]);
    }
    return out;
}

/**
 * El C.P. que el cliente dio en su lote de mensajes actual (todo lo que escribió desde nuestra última
 * respuesta), leyendo del más reciente al más viejo. Cubre el caso "83554" + "Puerto Peñasco" en dos
 * mensajes, que antes no se cotizaba. Si un mensaje trae varios, se prefiere el que sigue a "cp" /
 * "código postal"; si no, el último del mensaje.
 * @param {Array<object>} messagesDesc mensajes de la conversación, del más nuevo al más viejo
 * @param {string} contactId
 * @returns {{cp:string, texto:string, timestamp:number}|null}
 */
function ultimoCpDelLote(messagesDesc, contactId, { maxInbound = 8 } = {}) {
    let vistos = 0;
    for (const m of messagesDesc || []) {
        if (!m || m.status === 'scheduled') continue;
        const inbound = String(m.from) === String(contactId) || m.status === 'received';
        if (!inbound) break;                 // llegamos a nuestra última respuesta: fin del lote
        vistos++;
        const texto = String(m.text || '');
        const cps = extraerCps(texto);
        if (cps.length) {
            let cp = cps[cps.length - 1];
            const tras = texto.match(/(?:c\.?\s?p\.?|c[oó]digo\s+postal)\s*(?:es|:)?\s*(\d{5})(?!\d)/i);
            if (tras && cps.includes(tras[1])) cp = tras[1];
            return { cp, texto: texto.slice(0, 120), timestamp: toMs(m.timestamp) };
        }
        if (vistos >= maxInbound) break;
    }
    return null;
}

/**
 * Evalúa la respuesta cruda de T1 (`q.result[].cotizacion.servicios{}`) con la regla vigente.
 * En T1 la paquetería viene en `r.clave` ("DHL", "FEDEX", "EXPRESS"=Paquetexpress) y el servicio en
 * `servicio` ("EXPRESS DOMESTIC", "ECONOMY SELECT DOMESTIC" = DHL). Se busca "dhl" en ambos;
 * "domestic" NO sirve como señal (otras paqueterías también usan esa palabra).
 */
function evaluarCotizacionT1(q, umbral = umbralEnvio()) {
    const result = Array.isArray(q && q.result) ? q.result : [];
    const ops = [];
    result.forEach((r) => {
        const svc = (r && r.cotizacion && r.cotizacion.servicios) || {};
        Object.keys(svc).forEach((k) => {
            const s = svc[k] || {};
            if (s.costo_total != null && Number.isFinite(Number(s.costo_total))) {
                ops.push({ paq: r.clave, serv: s.servicio || k, dias: s.dias_entrega, costo: Number(s.costo_total) });
            }
        });
    });
    ops.sort((a, b) => a.costo - b.costo);
    const esDhl = o => /dhl/i.test(`${o.paq || ''} ${o.serv || ''}`);
    const esFedex = o => /fedex|overnight/i.test(`${o.paq || ''} ${o.serv || ''}`);
    const dhlOps = ops.filter(esDhl), fedexOps = ops.filter(esFedex);
    const dhl = dhlOps.length ? dhlOps[0].costo : null;
    const fedex = fedexOps.length ? fedexOps[0].costo : null;
    const claves = [...new Set(ops.map(o => o.paq).filter(Boolean))];
    let verdict;
    if (!ops.length) verdict = 'sin_tarifas';
    else if (dhl != null && dhl <= umbral) verdict = 'servible';
    else verdict = 'reexpedicion';
    return { ops, dhl, fedex, claves, verdict, umbral };
}

/**
 * Cotiza un C.P. en T1 y lo evalúa. Nunca lanza: si T1 falla, verdict = 'error' (la IA no debe
 * confirmar cobertura con ese veredicto).
 */
async function cotizarCp(cp, { t1 } = {}) {
    const cpLimpio = String(cp || '').replace(/\D/g, '');
    const base = { cp: cpLimpio, at: Date.now(), umbral: umbralEnvio() };
    if (!/^\d{5}$/.test(cpLimpio)) return { ...base, verdict: 'error', error: 'cp_invalido', dhl: null, fedex: null, ops: [], claves: [] };
    try {
        const client = t1 || require('../t1/t1Client');
        const q = await client.cotizar({ cpDestino: cpLimpio });
        return { ...base, ...evaluarCotizacionT1(q, base.umbral), error: null };
    } catch (e) {
        return { ...base, verdict: 'error', error: String(e && e.message || e).slice(0, 200), dhl: null, fedex: null, ops: [], claves: [] };
    }
}

function _fmtOps(check) {
    const ops = Array.isArray(check.ops) ? check.ops : [];
    return ops.slice(0, 4).map(o => `${o.paq || '?'} ${o.serv || ''} $${Number(o.costo).toFixed(2)}${o.dias ? ` (~${o.dias}d)` : ''}`).join(' · ') || 'sin tarifas';
}

function _hace(ms) {
    if (!ms) return '';
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 60) return `hace ${Math.max(min, 1)} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
}

/**
 * Texto de la NOTA interna que se le inyecta a la IA en el turno. `recordatorio` = el veredicto no es
 * de este turno sino el guardado en el contacto (el cliente no dio un C.P. nuevo).
 */
function notaCobertura(check, { recordatorio = false } = {}) {
    if (!check || !check.cp) return '';
    const cp = check.cp;
    const umbral = check.umbral || umbralEnvio();
    const dhl = check.dhl != null ? `$${Number(check.dhl).toFixed(2)}` : null;
    const cuando = recordatorio ? ` (verificado ${_hace(toMs(check.at))}${check.source === 'humano' ? ', confirmado por el equipo' : ''})` : '';
    const REGLA_INSISTE = 'Si el cliente insiste —dice que sí llega DHL, que vive en otra parte, que ya ha recibido paquetes, o solo escribe el nombre de su ciudad o colonia— NO cambies el veredicto ni digas que "revisaste de nuevo": el sistema solo puede cotizar un C.P. de 5 dígitos, así que pídele con amabilidad un código postal distinto (5 dígitos). Sin un C.P. nuevo NO continúes la venta ni registres el pedido. No ofrezcas entrega en sucursal ni "ocurre": ese servicio no existe.';
    const IGNORA = 'Si el número de 5 dígitos NO es un código postal (es un pedido, monto, teléfono, etc.), ignora esta nota.';
    if (check.verdict === 'servible') {
        return `\n\n**Cobertura de envío para el C.P. ${cp}${cuando} (cotización real de DHL vía T1, desde Durango):** SÍ hay cobertura a domicilio (DHL llega por ${dhl}) y el envío al cliente es GRATIS (nosotros pagamos la guía). Opciones (referencia interna de costo, NO para el cliente): ${_fmtOps(check)}. NO le cobres envío ni le menciones estos montos. ${recordatorio ? 'Este es el último C.P. verificado; si el cliente da OTRO C.P. de 5 dígitos, el sistema lo volverá a cotizar y te dejará una nota nueva. ' : 'Sigue el flujo normal de cobertura (responde "/ttt" y luego "/qqq"). '}Usa esta info SOLO si el cliente pregunta por cobertura/envío o está dando su C.P./dirección. ${IGNORA}`;
    }
    if (check.verdict === 'reexpedicion') {
        const motivo = check.dhl == null
            ? 'DHL NO cotiza esa zona (las demás paqueterías no cuentan para esta decisión)'
            : `DHL cuesta ${dhl}, por arriba de nuestro límite de $${umbral}`;
        return `\n\n**Cobertura de envío para el C.P. ${cp}${cuando} (cotización real vía T1, desde Durango):** NO tenemos cobertura en esa zona — ${motivo}. ${recordatorio ? 'Es el último C.P. verificado y el cliente NO ha dado uno nuevo de 5 dígitos: el veredicto sigue siendo NO. No respondas "/ttt", no digas que sí llegamos y no registres el pedido. ' : 'En este caso NO tomamos el pedido: responde ÚNICAMENTE con "/lamento" (en su propio renglón, sólo eso, sin ningún texto adicional). '}NO le menciones al cliente el costo del envío ni ningún monto. (Referencia interna de opciones: ${_fmtOps(check)}.) ${REGLA_INSISTE} ${IGNORA}`;
    }
    if (check.verdict === 'sin_tarifas') {
        return `\n\n**Cobertura de envío para el C.P. ${cp}${cuando}:** ninguna paquetería (DHL/FedEx) devolvió tarifa para ese C.P. — posible zona sin cobertura o C.P. inválido. NO confirmes cobertura ni respondas "/ttt". Pídele al cliente que revise su código postal y, si insiste en que es correcto, avísale con amabilidad que lo confirmarás con el equipo y escribe /equipo (en su propio renglón) antes de prometer la entrega. ${REGLA_INSISTE} ${IGNORA}`;
    }
    // error: T1 no respondió
    return `\n\n**Cobertura de envío para el C.P. ${cp}${cuando}:** el sistema NO pudo cotizar en este momento (falla temporal de la paquetería). NO confirmes cobertura ni respondas "/ttt": dile al cliente con calidez que en un momento le confirmas si llegamos a su zona y escribe /equipo en su propio renglón para que una persona lo revise. ${IGNORA}`;
}

/**
 * Veredicto guardado en el contacto (`coverage`), ajustado con lo que pasó después en el chat:
 *   - si un HUMANO mandó el atajo /ttt (su texto) después del veredicto, cuenta como override servible;
 *   - si es más viejo que COVERAGE_TTL_DAYS se marca `stale` (para /ttt hay que volver a pedir el C.P.).
 * Devuelve null si el contacto no tiene veredicto.
 */
function veredictoVigente(contactData, messagesDesc = [], contactId = '', now = Date.now()) {
    const cov = contactData && contactData.coverage;
    if (!cov || !cov.cp || !cov.verdict) return null;
    const at = toMs(cov.at);
    const out = { cp: String(cov.cp), verdict: String(cov.verdict), dhl: cov.dhl != null ? Number(cov.dhl) : null, fedex: cov.fedex != null ? Number(cov.fedex) : null, umbral: cov.umbral || umbralEnvio(), source: cov.source || 'ia', at, ops: Array.isArray(cov.ops) ? cov.ops : [], stale: false };
    for (const m of messagesDesc || []) {
        if (!m || m.status === 'scheduled') continue;
        const outbound = String(m.from) !== String(contactId) && m.status !== 'received';
        if (!outbound || m.isAutoReply) continue;
        const ts = toMs(m.timestamp);
        if (ts <= at) break;
        const t = String(m.text || '');
        if (TTT_TEXT_RE.test(t) || /\/ttt\b/i.test(t)) { out.verdict = 'servible'; out.source = 'humano'; out.at = ts; break; }
    }
    if (out.at && now - out.at > COVERAGE_TTL_DAYS * 864e5) out.stale = true;
    return out;
}

/** Datos del veredicto para guardarlos en el contacto (sin `ops` completas para no inflar el doc). */
function coverageParaGuardar(check, source = 'ia') {
    return {
        cp: check.cp,
        verdict: check.verdict,
        dhl: check.dhl != null ? Number(check.dhl) : null,
        fedex: check.fedex != null ? Number(check.fedex) : null,
        umbral: check.umbral || umbralEnvio(),
        claves: Array.isArray(check.claves) ? check.claves.slice(0, 6) : [],
        error: check.error || null,
        source,
    };
}

/**
 * Candado de /ttt: la IA solo puede confirmar cobertura si hay un veredicto SERVIBLE vigente (de este
 * turno o guardado y no caduco). Si no, se sustituye la respuesta.
 * @returns {{ok:boolean, motivo?:string, texto?:string, escalar?:boolean}}
 */
function decidirGuardTtt(cov) {
    if (!cov) return { ok: false, motivo: 'sin_cp', escalar: false, texto: '¡Con gusto reviso la cobertura de envío a tu domicilio! 📍 ¿Me compartes tu *código postal* de 5 dígitos, por favor?' };
    if (cov.verdict === 'servible' && !cov.stale) return { ok: true };
    if (cov.stale) return { ok: false, motivo: 'cp_viejo', escalar: false, texto: 'Para confirmarte la cobertura con datos actuales, ¿me compartes de nuevo tu *código postal* de 5 dígitos, por favor? 📍' };
    if (cov.verdict === 'error') return { ok: false, motivo: 'error_cotizacion', escalar: true, texto: 'En este momento no puedo confirmar la cobertura de tu zona 🙏 Lo reviso con el equipo y te aviso por aquí en cuanto tenga respuesta.' };
    return { ok: false, motivo: cov.verdict, escalar: true, texto: 'Entiendo 🙏 Déjame revisar con el equipo si podemos llegar a tu zona; en cuanto tenga respuesta te confirmo por aquí.' };
}

/** Candado de /registrar: con veredicto NEGATIVO vigente (y sin override humano) el pedido no se registra. */
function bloqueaRegistro(cov) {
    if (!cov) return false;
    if (cov.source === 'humano') return false;
    return cov.verdict === 'reexpedicion' || cov.verdict === 'sin_tarifas';
}

// ---------------------------------------------------------------------------------------------
// Formulario de datos de envío
// ---------------------------------------------------------------------------------------------

const _norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const _ESTADO_ALIAS = {
    'ciudad de mexico': ['cdmx', 'distrito federal', 'df', 'mexico df', 'ciudad de mexico'],
    'mexico': ['estado de mexico', 'edomex', 'edo de mexico', 'edo mex'],
    'michoacan de ocampo': ['michoacan'],
    'veracruz de ignacio de la llave': ['veracruz'],
    'coahuila de zaragoza': ['coahuila'],
    'queretaro': ['queretaro de arteaga'],
    'nuevo leon': ['nl', 'n l'],
};

function _mismoEstado(sepomexEstado, escrito) {
    const a = _norm(sepomexEstado), b = _norm(escrito);
    if (!a || !b) return true;                    // sin dato no se puede juzgar: no marcar error
    if (a === b) return true;
    const alias = _ESTADO_ALIAS[a] || [];
    if (alias.includes(b)) return true;
    // "mexico" (Edomex) vs "ciudad de mexico": son estados distintos
    if ((a === 'mexico' && b.includes('ciudad')) || (b === 'mexico' && a.includes('ciudad'))) return false;
    return a.includes(b) || b.includes(a);
}

function _mismaCiudad(sepomexMunicipio, sepomexCiudad, escrito) {
    const b = _norm(escrito);
    if (!b) return true;
    const cands = [sepomexMunicipio, sepomexCiudad].map(_norm).filter(Boolean);
    if (!cands.length) return true;
    for (const a of cands) {
        if (a === b || a.includes(b) || b.includes(a)) return true;
        const ta = a.split(' ').filter(w => w.length >= 4), tb = b.split(' ').filter(w => w.length >= 4);
        if (ta.some(w => tb.includes(w))) return true;
    }
    return false;
}

/**
 * Cruza el C.P. del formulario con SEPOMEX y con la ciudad/estado que escribió el cliente.
 * Caso real DH16320: escribió "Cihuatlán, Jalisco" pero el C.P. 47980 es Degollado (el real, 48980, sí
 * tenía cobertura). `svc` = sepomexService (inyectable para pruebas).
 */
function validarCpSepomex(cp, ciudad, estado, svc) {
    const s = svc || require('../data/sepomex/sepomexService');
    const r = s.getByCp(String(cp || '').replace(/\D/g, ''));
    if (!r) return { existe: false, municipio: null, estado: null, ciudad: null, coincideEstado: false, coincideCiudad: false };
    return {
        existe: true,
        municipio: r.municipio || null,
        estado: r.estado || null,
        ciudad: r.ciudad || null,
        coincideEstado: _mismoEstado(r.estado, estado),
        coincideCiudad: _mismaCiudad(r.municipio, r.ciudad, ciudad),
    };
}

/** Banderas del formulario a partir de SEPOMEX + cotización + C.P. verificado en el chat. */
function flagsFormulario({ sepomex, cotizacion, cpChat, cp }) {
    const flags = [];
    if (sepomex) {
        if (!sepomex.existe) flags.push('cp_inexistente');
        else {
            if (!sepomex.coincideEstado) flags.push('cp_no_coincide_estado');
            if (!sepomex.coincideCiudad) flags.push('cp_no_coincide_ciudad');
        }
    }
    if (cotizacion) {
        if (cotizacion.verdict === 'reexpedicion') flags.push('reexpedicion');
        else if (cotizacion.verdict === 'sin_tarifas') flags.push('sin_tarifas');
        else if (cotizacion.verdict === 'error') flags.push('error_cotizacion');
    }
    if (cpChat && cp && String(cpChat) !== String(cp)) flags.push('distinto_al_chat');
    return flags;
}

const FLAG_LABEL = {
    cp_inexistente: 'C.P. no existe',
    cp_no_coincide_estado: 'C.P. de otro estado',
    cp_no_coincide_ciudad: 'C.P. no coincide con la ciudad',
    reexpedicion: 'reexpedición (DHL caro)',
    sin_tarifas: 'sin tarifa en T1',
    error_cotizacion: 'no se pudo cotizar',
    distinto_al_chat: 'distinto al C.P. del chat',
};
const PROBLEMAS = new Set(['cp_inexistente', 'cp_no_coincide_estado', 'cp_no_coincide_ciudad', 'reexpedicion', 'sin_tarifas', 'error_cotizacion']);

/**
 * Revalida el C.P. de un formulario de datos de envío recién recibido. Guarda `envioCpCheck` en el
 * pedido (la sección Envíos lo pinta), y si hay un PROBLEMA marca el contacto en Atención y avisa al
 * admin por WhatsApp (salvo `silent`). Nunca lanza (fire-and-forget desde el endpoint). Se puede volver
 * a correr con POST /api/envios/revalidar-cp (uno o todos los pendientes de guía).
 */
async function validarFormularioEnvio({ numeroPedido, codigoPostal, ciudad, estado, nombre, silent = false }) {
    const out = { ok: false, flags: [], numeroPedido };
    try {
        const { db, admin } = require('../config');
        // Kill-switch: crm_settings/general.cpEnvioCheckActive = false apaga la revalidación completa.
        const general = (await db.collection('crm_settings').doc('general').get()).data() || {};
        if (general.cpEnvioCheckActive === false) return { ...out, skipped: 'kill_switch' };
        const cp = String(codigoPostal || '').replace(/\D/g, '');
        const num = parseInt(String(numeroPedido || '').replace(/\D/g, ''), 10);
        if (!/^\d{5}$/.test(cp) || !num) return { ...out, skipped: 'datos_incompletos' };
        const snap = await db.collection('pedidos').where('consecutiveOrderNumber', '==', num).limit(1).get();
        if (snap.empty) return { ...out, skipped: 'pedido_no_encontrado' };
        const pedidoRef = snap.docs[0].ref;
        const pedido = snap.docs[0].data();
        const contactId = pedido.contactId || pedido.telefono || null;
        let contact = {};
        if (contactId) {
            const c = await db.collection('contacts_whatsapp').doc(String(contactId)).get();
            contact = c.exists ? c.data() : {};
        }
        const sepomex = validarCpSepomex(cp, ciudad, estado);
        const cov = contact.coverage || null;
        const cpChat = cov && cov.cp ? String(cov.cp) : null;
        let cotizacion;
        const fresco = cov && toMs(cov.at) && (Date.now() - toMs(cov.at)) < COVERAGE_TTL_DAYS * 864e5;
        if (cov && cpChat === cp && fresco && ['servible', 'reexpedicion', 'sin_tarifas'].includes(cov.verdict)) {
            cotizacion = { cp, verdict: cov.verdict, dhl: cov.dhl != null ? Number(cov.dhl) : null, fedex: cov.fedex != null ? Number(cov.fedex) : null, reutilizada: true };
        } else {
            cotizacion = await cotizarCp(cp);
        }
        const flags = flagsFormulario({ sepomex, cotizacion, cpChat, cp });
        const problemas = flags.filter(f => PROBLEMAS.has(f));
        const check = {
            cp, ciudadEscrita: ciudad || '', estadoEscrito: estado || '',
            sepomex: { existe: sepomex.existe, municipio: sepomex.municipio, estado: sepomex.estado, coincideEstado: sepomex.coincideEstado, coincideCiudad: sepomex.coincideCiudad },
            verdict: cotizacion.verdict, dhl: cotizacion.dhl != null ? cotizacion.dhl : null, fedex: cotizacion.fedex != null ? cotizacion.fedex : null,
            cpChat, cpChatVerdict: cov ? cov.verdict || null : null,
            flags, problema: problemas.length > 0,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await pedidoRef.set({ envioCpCheck: check }, { merge: true });
        // silent = solo guardar el resultado (p. ej. revalidación en lote desde Envíos): sin Atención ni alerta.
        if (problemas.length && contactId && !silent) {
            await db.collection('contacts_whatsapp').doc(String(contactId)).set({
                needsAttention: true, needsAttentionReason: 'cp_envio', needsAttentionAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true }).catch(e => console.warn('[CP ENVIO] no se pudo marcar Atención:', e.message));
            try {
                const services = require('../services');
                const adminPhone = process.env.ADMIN_VERIFY_PHONE || '5216182297167';
                const lugar = sepomex.existe ? `${sepomex.municipio || ''}, ${sepomex.estado || ''}` : 'no existe en SEPOMEX';
                const dhlTxt = cotizacion.dhl != null ? `$${Number(cotizacion.dhl).toFixed(0)}` : 'sin tarifa';
                const fedexTxt = cotizacion.fedex != null ? `$${Number(cotizacion.fedex).toFixed(0)}` : 'sin tarifa';
                const lines = [
                    `⚠️ *C.P. del formulario de envío con problema* — *DH${num}*`,
                    `Cliente: ${contact.name || nombre || contactId}${contactId ? ` (${contactId})` : ''}`,
                    `C.P. del formulario: *${cp}* (${lugar}) — el cliente escribió "${ciudad || '?'}, ${estado || '?'}"`,
                    cpChat ? `C.P. verificado en el chat: ${cpChat} (${cov.verdict || '?'})${cpChat !== cp ? ' — DISTINTO' : ''}` : 'En el chat no se verificó ningún C.P.',
                    `Cotización hoy: DHL ${dhlTxt} · FedEx ${fedexTxt} → ${cotizacion.verdict}`,
                    `Motivo: ${problemas.map(f => FLAG_LABEL[f] || f).join(', ')}`,
                    'Revísalo en Envíos antes de generar la guía.',
                ];
                await services.sendAdvancedWhatsAppMessage(adminPhone, { text: lines.join('\n') });
            } catch (e) { console.warn('[CP ENVIO] no se pudo avisar al admin:', e.message); }
        }
        console.log(`[CP ENVIO] DH${num} CP ${cp}: ${cotizacion.verdict}${cotizacion.reutilizada ? ' (veredicto del chat)' : ''} | flags: ${flags.join(',') || 'ninguna'}`);
        return { ...out, ok: true, flags, problema: problemas.length > 0, check };
    } catch (e) {
        console.warn('[CP ENVIO] validarFormularioEnvio falló:', e.message);
        return { ...out, error: e.message };
    }
}

module.exports = {
    UMBRAL_DEFAULT, COVERAGE_TTL_DAYS, TTT_TEXT_RE, LAMENTO_TEXT_RE, TEXTO_REGISTRO_BLOQUEADO, FLAG_LABEL,
    umbralEnvio, toMs, extraerCps, ultimoCpDelLote, evaluarCotizacionT1, cotizarCp, notaCobertura,
    veredictoVigente, coverageParaGuardar, decidirGuardTtt, bloqueaRegistro,
    validarCpSepomex, flagsFormulario, validarFormularioEnvio,
};
