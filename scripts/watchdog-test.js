// =================================================================
// Prueba de entrega de las alertas operativas (watchdog + sin atender)
// =================================================================
// Uso: node scripts/watchdog-test.js
//
// Responde la única pregunta que importa de una alerta: ¿de verdad llega?
// Manda un WhatsApp real al número de alertas y dice por cuál de los dos caminos salió.
//
// EL PUNTO CIEGO QUE VIENE A DESCUBRIR: WhatsApp solo permite TEXTO LIBRE si ese número le
// escribió al CRM en las últimas 24 h. Una alerta de caída puede tardar meses en dispararse,
// así que lo normal será que esa ventana esté cerrada y el texto libre rebote con el error
// 131047. Si esta prueba falla por esa razón, la alerta real también fallaría — y la solución
// es configurar FIREBASE_WATCHDOG_TEMPLATE (y SIN_ATENDER_TEMPLATE) con una plantilla aprobada
// de Meta de 2 variables: {{1}} hora, {{2}} detalle.
//
// A propósito NO toca Firestore ni inicializa firebase-admin: recorre exactamente el mismo
// camino que usaría la alerta con Firebase caído.
//
// Necesita WHATSAPP_TOKEN y PHONE_NUMBER_ID en el entorno. Si en tu máquina no están (no hay
// .env local), corre esto en el shell de Render o usa la ruta del CRM ya autenticada:
//   GET /api/monitoring/watchdog/test
require('dotenv').config();
const { enviarAlertaWhatsApp, TELEFONO_ALERTAS } = require('../server/monitoring/alertaWhatsApp');

const PLANTILLA = process.env.FIREBASE_WATCHDOG_TEMPLATE || '';

(async () => {
    const hora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: true });
    console.log('=== PRUEBA DE ALERTA OPERATIVA ===\n');
    console.log(`Teléfono:  ${TELEFONO_ALERTAS}`);
    console.log(`Plantilla: ${PLANTILLA || '(ninguna configurada — solo se intentará texto libre)'}`);
    console.log(`Token:     ${process.env.WHATSAPP_TOKEN ? 'presente' : 'FALTA'}`);
    console.log(`Phone ID:  ${process.env.PHONE_NUMBER_ID || 'FALTA'}\n`);

    const texto = [
        '🔔 *Prueba de alerta operativa*',
        '',
        `Hora: ${hora}`,
        '',
        'Si estás leyendo esto, las alertas de caída de Firebase y de conversaciones sin respuesta SÍ te van a llegar. ✅'
    ].join('\n');

    try {
        const r = await enviarAlertaWhatsApp({
            texto,
            params: [hora, 'Prueba de alerta operativa: la entrega funciona'],
            plantilla: PLANTILLA
        });
        console.log(`✅ ENVIADO vía ${r.via}. messageId: ${r.messageId || '(sin id)'}`);
        if (r.via === 'texto_libre') {
            console.log('\n⚠️ Salió por TEXTO LIBRE, o sea que la ventana de 24 h está abierta ahora mismo.');
            console.log('   Eso no garantiza nada el día de la caída real: si para entonces está cerrada,');
            console.log('   la alerta no llega. Configura una plantilla aprobada para no depender de esto.');
        }
        process.exit(0);
    } catch (e) {
        console.error(`❌ NO SE PUDO ENVIAR:\n   ${e.message}\n`);
        console.error('Si el motivo es el 131047, la ventana de 24 h está cerrada: hoy la alerta real');
        console.error('tampoco llegaría. Configura una plantilla aprobada en FIREBASE_WATCHDOG_TEMPLATE.');
        process.exit(1);
    }
})();
