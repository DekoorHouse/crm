// =================================================================
// === Piloto "preview del diseño + cobro inmediato" (A/B) =========
// =================================================================
// Brief completo: docs/plan-preview-diseno.md
//
// Grupo A: desde la conversación se le habla de "diseño para aprobar" (RI variante,
// atajo /tttp, nota de prompt) y al registrar recibe su mockup en minutos con el
// cobro en el mismo envío. Grupo B: flujo actual intacto (control).
//
// Asignación: paridad del ÚLTIMO dígito del teléfono (par = A, non = B), sellada
// UNA vez en el contacto al iniciar conversación NUEVA en departamento elegible.
// El pedido hereda el grupo si es corazones estándar (1-4 pzas, sin especiales).
//
// Switch: crm_settings/piloto_preview.enabled (default: APAGADO).
const { db, admin } = require('../config');

// Departamento elegible por default: "Lámparas corazón" (corazones estándar).
const DEFAULT_DEPTS = ['39mmdwkqkp28M2dqwRzT'];

// Mantener en sintonía con SPECIAL_RE de mockups/mockupAutoScheduler.js:
// pedidos con algo "especial" NO entran al piloto (no hay preview automático para ellos).
const SPECIAL_RE = /foto|imagen|graba|logo|escudo|especial|personaje|mascota|dibuj|dise[nñ]|frase|leyenda|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

let cache = { at: 0, cfg: null };

async function getPilotoConfig() {
    if (cache.cfg && (Date.now() - cache.at) < 60 * 1000) return cache.cfg;
    let cfg = { enabled: false, departmentIds: DEFAULT_DEPTS };
    try {
        const d = await db.collection('crm_settings').doc('piloto_preview').get();
        if (d.exists) {
            const x = d.data();
            cfg = {
                enabled: x.enabled === true,
                departmentIds: Array.isArray(x.departmentIds) && x.departmentIds.length ? x.departmentIds.map(String) : DEFAULT_DEPTS,
            };
        }
    } catch (e) {
        console.warn('[PILOTO] No se pudo leer crm_settings/piloto_preview; queda apagado:', e.message);
    }
    cache = { at: Date.now(), cfg };
    return cfg;
}

// Paridad del último dígito del teléfono: par = 'A' (flujo nuevo), non = 'B' (control).
function groupForPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    return (Number(digits[digits.length - 1]) % 2 === 0) ? 'A' : 'B';
}

/**
 * Sella el grupo del contacto si aplica (piloto encendido + conversación NUEVA +
 * departamento elegible). Devuelve 'A' | 'B' | null. La paridad es determinista,
 * así que una doble escritura escribe el mismo valor (sin carreras).
 */
async function maybeAssignGroup({ contactRef, phone, departmentId, isNewContact }) {
    if (!isNewContact) return null;   // conversaciones previas al piloto quedan fuera
    const cfg = await getPilotoConfig();
    if (!cfg.enabled) return null;
    if (!cfg.departmentIds.includes(String(departmentId || ''))) return null;
    const group = groupForPhone(phone);
    if (!group) return null;
    await contactRef.update({
        pilotoPreview: group,
        pilotoPreviewAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[PILOTO] Contacto ${phone} sellado en grupo ${group} (dept ${departmentId}).`);
    return group;
}

// ¿Pedido de corazones estándar (1-4 piezas, sin personalización especial)?
function orderEligible(items) {
    const list = Array.isArray(items) && items.length ? items : [];
    if (!list.length) return false;
    const totalQty = list.reduce((s, it) => s + (Number(it.cantidad) || 1), 0);
    if (totalQty < 1 || totalQty > 4) return false;
    const esCorazones = list.every(it => /corazon/i.test(String(it.producto || '')));
    if (!esCorazones) return false;
    const datos = list.map(it => it.datosProducto || '').join('\n');
    if (SPECIAL_RE.test(datos)) return false;
    return true;
}

// ---- Textos del grupo A (centralizados para no regarlos por el código) ----

// Línea de la RI que se reemplaza y su versión de preview. Cubre las dos variantes
// que usan los anuncios ("Pagas al ver la foto del trabajo terminado" y
// "SIN ANTICIPO paga hasta que este terminado antes de enviar").
const RI_LINE_RE = /^.*(foto del trabajo terminado|terminado antes de enviar).*$/im;
const RI_PREVIEW_LINE = '📸 Te mandamos el *diseño exacto de tu lámpara* para que lo apruebes — pagas ya que lo veas y te encante';

function applyRiVariant(message) {
    const text = String(message || '');
    if (!RI_LINE_RE.test(text)) return text;
    return text.replace(RI_LINE_RE, RI_PREVIEW_LINE);
}

// Nota que se inyecta al contexto dinámico de Andrea (etapa VENTA) para contactos A.
const NOTA_VENTA = `\n**PILOTO PREVIEW (aplica a ESTE cliente):** a este cliente NO le hables de "foto del trabajo terminado". Su flujo es: al confirmar su pedido le mandamos EN MINUTOS el DISEÑO exacto de su lámpara; lo aprueba, realiza su pago y su lámpara entra a producción hoy mismo. Cuando toque hablar de tiempos o del pago, explícalo así. Usa el atajo /tttp en lugar de /ttt cuando confirmes cobertura.`;

// Nota para la COBRANZA de contactos A (se anexa a las instrucciones del cobro).
const NOTA_COBRANZA = `\n\n**PILOTO PREVIEW (aplica a ESTE cliente):** a este cliente se le envió el DISEÑO de su lámpara para aprobarlo, NO la foto del producto terminado (su lámpara aún no se fabrica). Cobra con ese encuadre: su diseño está listo y apartado; al pagar, entra a producción HOY. NUNCA digas que su lámpara "ya está terminada" o "esperándolo". Si la ventana está cerrada y las plantillas disponibles hablan de "pedido terminado", NO uses plantilla: responde SKIP.`;

// Texto de respaldo del bloque de pago para el grupo A (si no existe la quick reply
// 'cuatrop' en Firestore, se usa este texto en lugar de /cuatro).
const CUATROP_FALLBACK = `¡Mira cómo va a quedar tu lámpara! 😍 Este es el *diseño exacto* que vamos a grabar ✨

*Apruébalo y con tu pago hoy mismo entra a producción* 🚀 Cuando realices tu pago me confirmas con la foto de tu comprobante 😊

Los datos de envío a tu domicilio los solicitamos al recibir tu pago 📨

¿Gustas que tu pago sea por *TRANSFERENCIA*? 💳

Te dejo la cuenta por escrito para que sea más fácil y puedas copiar y pegar✅

🏦*BBVA*
🤵‍♂️*Christian Morales Villa*`;

module.exports = {
    getPilotoConfig,
    groupForPhone,
    maybeAssignGroup,
    orderEligible,
    applyRiVariant,
    NOTA_VENTA,
    NOTA_COBRANZA,
    CUATROP_FALLBACK,
};
