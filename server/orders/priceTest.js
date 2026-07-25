// =================================================================
// === Prueba de PRECIO ($850 / $950) ==============================
// =================================================================
// Test de precio REAL de punta a punta: el grupo A ve el precio variante
// en la RI, en la cotización, en el resumen que confirma y en el TOTAL del
// pedido que se registra y se cobra. El grupo B queda en $750 (control).
//
// Estructura de la RI = la básica/original; SOLO cambia el precio.
//
// Asignación por paridad del último dígito del teléfono (par = A = precio
// variante; non = B = $750), sellada UNA vez en el contacto al iniciar
// conversación NUEVA en el dept elegible. El precio variante se guarda por
// contacto (priceTestValue) para que, aunque después se cambie la config a
// otro precio, ese contacto conserve el que ya se le cotizó.
//
// Switch: crm_settings/price_test.enabled + .price (850|950). Default APAGADO.
//
// ⚠️ Correr SOLO un experimento a la vez (precio, RI o preview): todos tocan
// la RI y se confundirían las lecturas. Los toggles lo impiden.
const { db, admin } = require('../config');
const { groupForPhone, orderEligible } = require('./pilotoPreview');

const DEFAULT_DEPTS = ['39mmdwkqkp28M2dqwRzT'];       // Lámparas corazón
const DEPT_ANTICIPO = 'r6VSzBKpxDxygazz1qdr';          // "Lamparas Corazon anticipo"
const CONTROL_PRICE = 750;
const VALID_PRICES = [850, 950];

// En el flujo de anticipo el APARTADO no se mueve con el precio: siguen siendo $300.
// Lo que cambia es el RESTANTE ($950 − $300 = $650). Si no se ajusta, Andrea cotiza
// "$950, apartas con $300 y restan $450" — cuentas que no cuadran y el cliente lo nota.
const ANTICIPO = 300;
const CONTROL_REMAINDER = 450;                          // $750 − $300
const remainderFor = price => (Number(price) || CONTROL_PRICE) - ANTICIPO;
const isAnticipoDept = departmentId => String(departmentId || '') === DEPT_ANTICIPO;

let cache = { at: 0, cfg: null };

async function getPriceTestConfig() {
    if (cache.cfg && (Date.now() - cache.at) < 60 * 1000) return cache.cfg;
    let cfg = { enabled: false, price: 850, departmentIds: DEFAULT_DEPTS };
    try {
        const d = await db.collection('crm_settings').doc('price_test').get();
        if (d.exists) {
            const x = d.data();
            const price = VALID_PRICES.includes(Number(x.price)) ? Number(x.price) : 850;
            cfg = {
                enabled: x.enabled === true,
                price,
                departmentIds: Array.isArray(x.departmentIds) && x.departmentIds.length ? x.departmentIds.map(String) : DEFAULT_DEPTS,
            };
        }
    } catch (e) {
        console.warn('[PRICE_TEST] No se pudo leer crm_settings/price_test; queda apagado:', e.message);
    }
    cache = { at: Date.now(), cfg };
    return cfg;
}

// Sella el grupo del contacto si aplica. Devuelve 'A' | 'B' | null.
// Grupo A = precio variante (config.price); grupo B = $750 control.
async function maybeAssignPriceGroup({ contactRef, phone, departmentId, isNewContact }) {
    if (!isNewContact) return null;
    const cfg = await getPriceTestConfig();
    if (!cfg.enabled) return null;
    if (!cfg.departmentIds.includes(String(departmentId || ''))) return null;
    const group = groupForPhone(phone);
    if (!group) return null;
    const value = group === 'A' ? cfg.price : CONTROL_PRICE;
    await contactRef.update({
        priceTest: group,
        priceTestValue: value,
        priceTestAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[PRICE_TEST] Contacto ${phone} sellado en grupo ${group} ($${value}) (dept ${departmentId}).`);
    return group;
}

// Precio efectivo de un contacto en la prueba (variante si es grupo A, 750 si B),
// o null si no está en la prueba. NO depende de que el test siga encendido: una vez
// sellado, el contacto conserva su precio cotizado (coherencia con el cliente).
function priceForContact(contactData) {
    if (!contactData) return null;
    if (contactData.priceTest === 'A' && VALID_PRICES.includes(Number(contactData.priceTestValue))) {
        return Number(contactData.priceTestValue);
    }
    return null;   // grupo B o no sellado: precio normal ($750)
}

// Reemplaza el precio de control ($750) por el variante en un texto (RI, quick reply
// expandida, o mensaje libre de Andrea). Solo toca "$750" (con signo) para no pisar
// códigos postales, cantidades, etc. Idempotente.
function applyPrice(text, price, { anticipo = false } = {}) {
    if (!text || !price || price === CONTROL_PRICE) return text;
    let out = String(text).replace(/\$\s?750\b/g, '$' + price);
    // Flujo de anticipo: el apartado se queda en $300 y el restante sube con el precio.
    if (anticipo) out = out.replace(/\$\s?450\b/g, '$' + remainderFor(price));
    return out;
}

// Nota dinámica para Andrea. La aritmética vive aquí (un solo lugar) para que la nota,
// el candado de texto y el total del pedido no puedan desalinearse.
function noteFor(price, { anticipo = false } = {}) {
    if (!price) return '';
    const base = `\n**PRECIO PARA ESTE CLIENTE: $${price} por lámpara (NO $${CONTROL_PRICE}).** Usa *$${price}* en TODO: cuando cotices, en el resumen del pedido y en el total. El envío sigue GRATIS. Si el cliente pregunta el precio, es $${price}.`;
    if (!anticipo) return base;
    return base + ` El APARTADO sigue siendo de *$${ANTICIPO}* (no cambia), así que el RESTANTE que paga al ver la foto es de *$${remainderFor(price)}*, NO $${CONTROL_REMAINDER}. Repite siempre esta cuenta: $${price} = $${ANTICIPO} de apartado + $${remainderFor(price)} restantes.`;
}

module.exports = {
    getPriceTestConfig,
    maybeAssignPriceGroup,
    priceForContact,
    applyPrice,
    noteFor,
    orderEligible,
    isAnticipoDept,
    remainderFor,
    CONTROL_PRICE,
    VALID_PRICES,
    DEFAULT_DEPTS,
    DEPT_ANTICIPO,
    ANTICIPO,
};
