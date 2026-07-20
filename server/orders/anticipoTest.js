// =================================================================
// === Prueba de ANTICIPO ($300 para registrar) ====================
// =================================================================
// Experimento A/B: el grupo A (teléfono par, conversaciones NUEVAS de
// corazones) debe pagar un anticipo de $300 para que su pedido se REGISTRE;
// el resto ($450) lo paga al ver la foto terminada, como siempre. El grupo B
// sigue el flujo normal (registro sin anticipo). REGLA DURA: sin comprobante
// del anticipo NO hay /final — es la única forma de medir disposición real.
//
// Su RI también cambia: la promesa "pagas al ver la foto del trabajo
// terminado" se sustituye por la versión anticipo, para que el cliente no
// sienta un cambio de reglas a medio camino.
//
// Contexto: el canal de anticipo con ads propios dio 40 conversaciones y 0
// pedidos. Este A/B mide lo mismo pero sobre el tráfico ganador y con grupo
// de control: cuántas ventas mata vs cuánta caja adelanta y cuántas
// cancelaciones evita.
//
// Switch: crm_settings/anticipo_test.enabled (default APAGADO).
// ⚠️ Un solo experimento a la vez (los toggles tienen guardia).
const { db, admin } = require('../config');
const { groupForPhone, orderEligible } = require('./pilotoPreview');

const DEFAULT_DEPTS = ['39mmdwkqkp28M2dqwRzT'];   // Lámparas corazón
const ANTICIPO = 300;

// Línea de pago de la RI original (misma detección que el piloto preview) y su
// reemplazo con encuadre de anticipo.
const RI_PAGO_RE = /^.*(foto del trabajo terminado|terminado antes de enviar).*$/im;
const RI_ANTICIPO_LINE = `🪙 *Aparta la tuya con solo $${ANTICIPO}* — el resto lo pagas al ver la foto de tu lámpara terminada 📸`;

// Nota dinámica para Andrea (etapa venta, grupo A). Espeja el flujo del canal
// anticipo existente: /anticipo → comprobante → /final. NUNCA registrar sin
// comprobante.
const NOTA_VENTA = `
**PRUEBA ANTICIPO — ESTE CLIENTE APARTA CON $${ANTICIPO} (OBLIGATORIO PARA REGISTRAR):**
- Su pedido se REGISTRA únicamente DESPUÉS de que pague un anticipo de *$${ANTICIPO}*. El resto (*$450* si es 1 pieza de $750) lo paga al ver la foto de su lámpara terminada, como siempre.
- Flujo: cuando ya tengas nombres + fecha + CP con cobertura y el cliente quiera avanzar, NO registres todavía: manda "/anticipo" (los datos de pago van en esa respuesta, en su propia burbuja) explicando con calidez que con *$${ANTICIPO}* aparta su lugar y arranca su diseño.
- Si acepta pero aún no paga, manda "/esperaanticipo" y quédate al pendiente.
- SOLO cuando mande la foto de su comprobante del anticipo: agradécele y AHÍ SÍ manda "/final" para registrar su pedido.
- NUNCA mandes "/final" sin comprobante del anticipo, aunque insista en que "al rato lo hace" o prometa pagar al ver la foto. Si objeta, eres EXPERTA en resolverlo con calidez: valida su duda, recuérdale que son solo $${ANTICIPO} de $750 (la parte chica; el resto lo paga VIENDO su lámpara ya hecha), garantía y +6,000 pedidos entregados. Si después de eso de plano no acepta, NO registres: despídete con calidez dejando la puerta abierta.`;

let cache = { at: 0, cfg: null };

async function getAnticipoConfig() {
    if (cache.cfg && (Date.now() - cache.at) < 60 * 1000) return cache.cfg;
    let cfg = { enabled: false, departmentIds: DEFAULT_DEPTS };
    try {
        const d = await db.collection('crm_settings').doc('anticipo_test').get();
        if (d.exists) {
            const x = d.data();
            cfg = {
                enabled: x.enabled === true,
                departmentIds: Array.isArray(x.departmentIds) && x.departmentIds.length ? x.departmentIds.map(String) : DEFAULT_DEPTS,
            };
        }
    } catch (e) {
        console.warn('[ANTICIPO_TEST] No se pudo leer crm_settings/anticipo_test; queda apagado:', e.message);
    }
    cache = { at: Date.now(), cfg };
    return cfg;
}

// Sella el grupo del contacto si aplica (test encendido + conversación NUEVA +
// dept elegible). Devuelve 'A' | 'B' | null.
async function maybeAssignAnticipoGroup({ contactRef, phone, departmentId, isNewContact }) {
    if (!isNewContact) return null;
    const cfg = await getAnticipoConfig();
    if (!cfg.enabled) return null;
    if (!cfg.departmentIds.includes(String(departmentId || ''))) return null;
    const group = groupForPhone(phone);
    if (!group) return null;
    await contactRef.update({
        anticipoTest: group,
        anticipoTestAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[ANTICIPO_TEST] Contacto ${phone} sellado en grupo ${group} (dept ${departmentId}).`);
    return group;
}

// Cambia la línea de pago de la RI por la versión anticipo (grupo A). Si la RI
// no trae la línea esperada, la agrega al final para que la promesa quede clara.
function applyRiVariant(message) {
    if (!message) return message;
    if (RI_PAGO_RE.test(message)) return String(message).replace(RI_PAGO_RE, RI_ANTICIPO_LINE);
    return String(message).trim() + '\n\n' + RI_ANTICIPO_LINE;
}

module.exports = {
    getAnticipoConfig,
    maybeAssignAnticipoGroup,
    applyRiVariant,
    orderEligible,
    NOTA_VENTA,
    ANTICIPO,
};
