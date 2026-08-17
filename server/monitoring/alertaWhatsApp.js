/**
 * Envío de alertas operativas por WhatsApp SIN tocar Firestore.
 *
 * Lo usan el watchdog de Firebase y el detector de mensajes sin atender. La restricción de "sin
 * Firestore" existe por el watchdog: si Firestore está caído, una alerta que necesite leer el
 * contacto o guardar el mensaje enviado nunca sale. Por eso NO se usa sendAdvancedWhatsAppMessage
 * (services.js), que arranca leyendo el contacto y termina escribiéndolo.
 *
 * Efecto secundario deseable: estos avisos no crean un contacto ni ensucian la lista de chats
 * del CRM con la conversación del admin.
 *
 * VENTANA DE 24 HORAS: WhatsApp solo permite texto libre si ese número le escribió al CRM en las
 * últimas 24 h. Una alerta puede tardar meses en dispararse, así que esa ventana casi siempre
 * estará cerrada. Si se configura una plantilla aprobada, se intenta primero y el texto libre
 * queda de respaldo. Comprueba cuál funciona hoy con: node scripts/watchdog-test.js
 */
const axios = require('axios');

const TELEFONO_ALERTAS = process.env.ALERTA_OPS_PHONE || '5216183322226';

function graphUrl() {
    const phoneId = process.env.PHONE_NUMBER_ID;
    if (!phoneId) throw new Error('Falta PHONE_NUMBER_ID en el entorno');
    return `https://graph.facebook.com/v19.0/${phoneId}/messages`;
}

function graphHeaders() {
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) throw new Error('Falta WHATSAPP_TOKEN en el entorno');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** El error de Meta viene anidado; sin esto solo se ve "Request failed with status code 400". */
function detalleErrorMeta(err) {
    const metaErr = err.response?.data?.error;
    if (!metaErr) return err.message;
    return `${metaErr.message} (code ${metaErr.code}${metaErr.error_subcode ? `/${metaErr.error_subcode}` : ''})`;
}

async function enviarTextoLibre(telefono, texto) {
    const { data } = await axios.post(
        graphUrl(),
        { messaging_product: 'whatsapp', to: telefono, type: 'text', text: { body: texto, preview_url: false } },
        { headers: graphHeaders(), timeout: 20000 }
    );
    return data;
}

async function enviarPlantilla(telefono, plantilla, params) {
    const { data } = await axios.post(
        graphUrl(),
        {
            messaging_product: 'whatsapp',
            to: telefono,
            type: 'template',
            template: {
                name: plantilla,
                language: { code: 'es_MX' },
                components: params.length
                    ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p) })) }]
                    : []
            }
        },
        { headers: graphHeaders(), timeout: 20000 }
    );
    return data;
}

/**
 * Manda la alerta: plantilla primero (si hay), texto libre de respaldo.
 * Si no sale por ningún lado lanza con AMBOS motivos — que una alerta falle en silencio es
 * justo el modo de falla que estos módulos vienen a eliminar.
 */
async function enviarAlertaWhatsApp({ texto, params = [], plantilla = '', telefono = TELEFONO_ALERTAS }) {
    const fallos = [];
    if (plantilla) {
        try {
            const data = await enviarPlantilla(telefono, plantilla, params);
            return { via: 'plantilla', messageId: data.messages?.[0]?.id || null, telefono };
        } catch (err) {
            fallos.push(`plantilla "${plantilla}": ${detalleErrorMeta(err)}`);
        }
    }
    try {
        const data = await enviarTextoLibre(telefono, texto);
        return { via: 'texto_libre', messageId: data.messages?.[0]?.id || null, telefono };
    } catch (err) {
        fallos.push(`texto libre: ${detalleErrorMeta(err)}`);
        if (String(err.response?.data?.error?.code) === '131047') {
            fallos.push('PISTA: el 131047 es la ventana de 24 h cerrada. Sin una plantilla aprobada configurada, esta alerta NUNCA va a llegar.');
        }
    }
    throw new Error(fallos.join(' | '));
}

module.exports = { enviarAlertaWhatsApp, detalleErrorMeta, TELEFONO_ALERTAS };
