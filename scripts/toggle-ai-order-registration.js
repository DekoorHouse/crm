/**
 * Enciende/apaga el REGISTRO AUTOMÁTICO DE PEDIDOS POR LA IA y muestra su configuración.
 * (crm_settings/ai_order_registration — lo lee server/orders/aiOrderRegistration.js)
 *
 * Uso:
 *   node scripts/toggle-ai-order-registration.js           # ver configuración actual
 *   node scripts/toggle-ai-order-registration.js on        # ACTIVAR
 *   node scripts/toggle-ai-order-registration.js off       # DESACTIVAR
 *   node scripts/toggle-ai-order-registration.js on --minConfidence=80
 *
 * Con el flag activo, la IA de venta valida el resumen del pedido con el cliente y al
 * confirmar lo registra sola (con red de seguridad: fila 🤖 por revisar en /pedidos +
 * aviso por WhatsApp al admin). Apagado, todo vuelve al flujo manual (pendientes_ia).
 * El catálogo (productos, precios y datos requeridos) es editable en el mismo doc
 * (campo catalogText) sin deploy.
 */
require('dotenv').config();
const { db } = require('../server/config');
const { DEFAULT_CONFIG } = require('../server/orders/aiOrderRegistration');

const arg = (process.argv[2] || '').toLowerCase();
const minConfArg = Number((process.argv.find(a => a.startsWith('--minConfidence=')) || '').split('=')[1]);

async function main() {
    const ref = db.collection('crm_settings').doc('ai_order_registration');
    const snap = await ref.get();
    const current = snap.exists ? snap.data() : {};

    if (arg === 'on' || arg === 'off') {
        const update = {
            enabled: arg === 'on',
            // Sembrar defaults solo si el doc aún no los tiene (no pisar ediciones manuales)
            minConfidence: Number.isFinite(minConfArg) ? minConfArg
                : (Number.isFinite(Number(current.minConfidence)) ? Number(current.minConfidence) : DEFAULT_CONFIG.minConfidence),
            catalogText: (typeof current.catalogText === 'string' && current.catalogText.trim())
                ? current.catalogText : DEFAULT_CONFIG.catalogText,
            updatedAt: new Date()
        };
        await ref.set(update, { merge: true });
        console.log(`\n${arg === 'on' ? '✅ Registro automático de pedidos por IA: ACTIVADO' : '⛔ Registro automático de pedidos por IA: DESACTIVADO'}`);
        console.log(`   minConfidence: ${update.minConfidence}%`);
        console.log(`   catalogText:\n${update.catalogText.split('\n').map(l => '     ' + l).join('\n')}`);
        console.log('\n(El bot toma el cambio en su siguiente respuesta; el Context Cache se renueva solo.)');
    } else {
        console.log('\nConfiguración actual (crm_settings/ai_order_registration):');
        console.log(`   enabled: ${current.enabled === true ? 'ACTIVADO ✅' : 'DESACTIVADO ⛔ (default)'}`);
        console.log(`   minConfidence: ${current.minConfidence != null ? current.minConfidence : `${DEFAULT_CONFIG.minConfidence} (default)`}`);
        console.log(`   catalogText: ${current.catalogText ? '\n' + current.catalogText.split('\n').map(l => '     ' + l).join('\n') : '(default del código)'}`);
        console.log('\nUso: node scripts/toggle-ai-order-registration.js on|off [--minConfidence=70]');
    }
    process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
