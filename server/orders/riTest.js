// =================================================================
// === Prueba A/B de la RI (mensaje inicial) =======================
// =================================================================
// Experimento INDEPENDIENTE del piloto preview: solo cambia el mensaje
// inicial (RI) del grupo A; el resto del flujo queda EXACTAMENTE como el
// original (paga al ver la foto del trabajo terminado, etc.).
//
// Grupo A (teléfono par): recibe la RI nueva (más corta, con el riesgo-cero
// arriba y pidiendo nombres + fecha de una vez). Grupo B (non): RI original.
//
// Asignación por paridad del último dígito del teléfono, sellada UNA vez en
// el contacto (campo riTest) al iniciar conversación NUEVA en el dept elegible.
// Switch: crm_settings/ri_test.enabled (default APAGADO).
//
// ⚠️ Correr SOLO uno de los dos experimentos a la vez (este o el piloto
// preview): ambos tocan la RI y se confundirían las lecturas.
const { db, admin } = require('../config');
// Reutilizamos las piezas puras del piloto preview (mismo criterio de grupo y
// de elegibilidad de pedido) para no duplicar lógica.
const { groupForPhone, orderEligible } = require('./pilotoPreview');

const DEFAULT_DEPTS = ['39mmdwkqkp28M2dqwRzT'];   // Lámparas corazón

// RI nueva (grupo A) — default aprobado por Alex el 20-jul. Editable sin deploy
// vía crm_settings/ri_test.message. Mantiene el modelo ORIGINAL de pago
// ("pagas al ver la foto de tu lámpara ya terminada").
const DEFAULT_RI = `¡Hola! 👋 ¡Qué bonito detalle! 😍
Cada lámpara *$750* con *envío GRATIS* a todo México 🚚 y +6,000 clientes felices ✅

💛 Lo mejor: *pagas hasta ver la foto de tu lámpara ya terminada* — cero riesgo, compras viendo tu pedido hecho 📸

¿Qué *nombres* y qué *fecha* quieres que lleve la tuya? 🥰`;

let cache = { at: 0, cfg: null };

async function getRiTestConfig() {
    if (cache.cfg && (Date.now() - cache.at) < 60 * 1000) return cache.cfg;
    let cfg = { enabled: false, departmentIds: DEFAULT_DEPTS, message: DEFAULT_RI };
    try {
        const d = await db.collection('crm_settings').doc('ri_test').get();
        if (d.exists) {
            const x = d.data();
            cfg = {
                enabled: x.enabled === true,
                departmentIds: Array.isArray(x.departmentIds) && x.departmentIds.length ? x.departmentIds.map(String) : DEFAULT_DEPTS,
                message: (typeof x.message === 'string' && x.message.trim()) ? x.message : DEFAULT_RI,
            };
        }
    } catch (e) {
        console.warn('[RI_TEST] No se pudo leer crm_settings/ri_test; queda apagado:', e.message);
    }
    cache = { at: Date.now(), cfg };
    return cfg;
}

// Sella el grupo del contacto si aplica (test encendido + conversación NUEVA +
// dept elegible). Devuelve 'A' | 'B' | null.
async function maybeAssignRiTestGroup({ contactRef, phone, departmentId, isNewContact }) {
    if (!isNewContact) return null;
    const cfg = await getRiTestConfig();
    if (!cfg.enabled) return null;
    if (!cfg.departmentIds.includes(String(departmentId || ''))) return null;
    const group = groupForPhone(phone);
    if (!group) return null;
    await contactRef.update({
        riTest: group,
        riTestAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[RI_TEST] Contacto ${phone} sellado en grupo ${group} (dept ${departmentId}).`);
    return group;
}

module.exports = {
    getRiTestConfig,
    maybeAssignRiTestGroup,
    orderEligible,   // re-exportado por conveniencia (mismo criterio que el piloto)
    DEFAULT_RI,
};
