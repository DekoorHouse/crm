/**
 * Scheduler diario de reporte de inventario.
 *
 * A las 18:00 (config: INVENTARIO_REPORTE_CRON) calcula el reporte y lo manda
 * al número configurado vía plantilla aprobada de Meta.
 *
 * Variables de entorno:
 *  - INVENTARIO_REPORTE_CRON          (default '0 18 * * *')
 *  - INVENTARIO_REPORTE_WA_TO         (número destino, ej. '5216182297167')
 *  - INVENTARIO_REPORTE_TEMPLATE      (default 'reporte_inventario_diario')
 *  - INVENTARIO_REPORTE_TEMPLATE_LANG (default 'es_MX')
 *  - WHATSAPP_TOKEN, PHONE_NUMBER_ID  (ya existen, compartidos con el resto del CRM)
 *  - APP_BASE_URL                     (para el link al panel; default app.dekoormx.com)
 */
const cron = require('node-cron');
const axios = require('axios');
const { db } = require('../config');
const { calcularReporte } = require('./inventarioReporte');

const CRON_SCHEDULE = process.env.INVENTARIO_REPORTE_CRON || '0 18 * * *';
const WA_TO = process.env.INVENTARIO_REPORTE_WA_TO || '';
const TEMPLATE_NAME = process.env.INVENTARIO_REPORTE_TEMPLATE || 'reporte_inventario_diario';
const TEMPLATE_LANG = process.env.INVENTARIO_REPORTE_TEMPLATE_LANG || 'es_MX';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://app.dekoormx.com';

let scheduledTask = null;

function toWaId(phone) {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';
    const last10 = digits.slice(-10);
    if (digits.startsWith('521')) return '52' + last10;
    if (digits.length === 10) return '52' + last10;
    return digits;
}

function fmtFechaCorta(d) {
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtMoney(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtNum(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

/**
 * Construye los 4 valores que llenan {{1}}…{{4}} de la plantilla.
 * La plantilla aprobada en Meta debe ser:
 *   "🔔 Reporte de inventario — {{1}}
 *    Hoy se vendieron {{2}} pedido(s) pagado(s).
 *    ⚠️ Materiales a reabastecer: {{3}}
 *    💰 Costo aproximado del pedido: ${{4}} MXN
 *    Ver detalle completo: <link>"
 */
/**
 * Construye los parámetros de la plantilla. Por restricción de Meta,
 * los valores no pueden contener \n, tabs ni > 4 espacios consecutivos:
 * por eso la lista de materiales va en UNA línea separada con " • ".
 */
function construirParametros(reporte) {
    const fecha = fmtFechaCorta(reporte.periodo.hasta);
    const totalPedidos = String(reporte.pedidos.total || 0);

    let materialesText;
    if (reporte.aPedir.length === 0) {
        materialesText = 'Ninguno (stock OK)';
    } else {
        const items = reporte.aPedir.map(p => {
            const sug = p.sugerencia;
            const cantidadTxt = sug.multiplo > 1
                ? `${sug.paquetes} pack${sug.paquetes === 1 ? '' : 's'} (${fmtNum(sug.unidades)} ${p.unidad})`
                : `${fmtNum(sug.unidades)} ${p.unidad}`;
            return `${p.nombre}: ${cantidadTxt}`;
        });
        materialesText = items.join(' • ');
        // Límite seguro de Meta: 1024 chars por variable. Truncamos a ~900
        // para dejar margen y dirigir a la pantalla web si la lista es larga.
        if (materialesText.length > 900) {
            materialesText = materialesText.substring(0, 870) + '… (ver detalle)';
        }
    }

    const costo = fmtMoney(reporte.costoTotal);
    return [fecha, totalPedidos, materialesText, costo];
}

async function enviarReporteWhatsApp(reporte) {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return { ok: false, motivo: 'Faltan credenciales WHATSAPP_TOKEN/PHONE_NUMBER_ID' };
    }
    if (!WA_TO) {
        return { ok: false, motivo: 'Falta INVENTARIO_REPORTE_WA_TO' };
    }

    const waId = toWaId(WA_TO);
    if (waId.length < 12) {
        return { ok: false, motivo: `Número destino inválido: ${WA_TO}` };
    }

    const params = construirParametros(reporte);
    const payload = {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'template',
        template: {
            name: TEMPLATE_NAME,
            language: { code: TEMPLATE_LANG },
            components: [
                {
                    type: 'body',
                    parameters: params.map(p => ({ type: 'text', text: String(p) }))
                }
            ]
        }
    };

    try {
        const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
        const res = await axios.post(url, payload, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const messageId = res.data?.messages?.[0]?.id || null;
        return { ok: true, messageId, params };
    } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        return { ok: false, motivo: detail.substring(0, 500) };
    }
}

/**
 * Ejecuta el ciclo completo: calcula reporte, lo envía por WhatsApp y guarda
 * un log en `inventario_reportes_log` para auditoría.
 */
async function ejecutarReporteDiario() {
    const ahora = new Date();
    console.log(`[INVENTARIO] Iniciando reporte diario @ ${ahora.toISOString()}`);

    let reporte;
    try {
        reporte = await calcularReporte(ahora);
    } catch (err) {
        console.error('[INVENTARIO] Error calculando reporte:', err.message);
        return { ok: false, motivo: 'calcularReporte: ' + err.message };
    }

    const envio = await enviarReporteWhatsApp(reporte);

    // Log de auditoría
    try {
        await db.collection('inventario_reportes_log').add({
            generadoAt: ahora,
            pedidosTotal: reporte.pedidos.total,
            aPedirCount: reporte.aPedir.length,
            costoTotal: reporte.costoTotal,
            envioWhatsApp: envio.ok,
            envioDetalle: envio.ok ? envio.messageId : envio.motivo,
            params: envio.params || null
        });
    } catch (logErr) {
        console.warn('[INVENTARIO] No se pudo guardar log:', logErr.message);
    }

    if (envio.ok) {
        console.log(`[INVENTARIO] ✓ Reporte enviado (msg ${envio.messageId}). ${reporte.aPedir.length} materiales a pedir.`);
    } else {
        console.error(`[INVENTARIO] ✗ No se pudo enviar reporte: ${envio.motivo}`);
    }
    return { ok: envio.ok, reporte, envio };
}

function startInventarioScheduler() {
    if (scheduledTask) {
        console.log('[INVENTARIO] Scheduler ya iniciado');
        return;
    }
    if (!WA_TO) {
        console.warn('[INVENTARIO] Scheduler iniciado sin INVENTARIO_REPORTE_WA_TO — no se enviarán mensajes hasta configurar la variable.');
    }
    console.log(`[INVENTARIO] Scheduler iniciado. Cron: "${CRON_SCHEDULE}". Plantilla: ${TEMPLATE_NAME}. Destino: ${WA_TO || '(no configurado)'}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        ejecutarReporteDiario().catch(e => console.error('[INVENTARIO] Error en ejecución:', e.message));
    }, { timezone: 'America/Mexico_City' });
}

module.exports = {
    startInventarioScheduler,
    ejecutarReporteDiario,
    enviarReporteWhatsApp
};
