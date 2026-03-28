const cron = require('node-cron');
const { executeWhatsAppGroupPost } = require('./whatsappGroupService');

let scheduledTask = null;

function startWhatsAppScheduler() {
    const enabled = process.env.WA_GROUP_ENABLED === 'true';
    // Default: 1 vez al dia a las 11am hora Mexico
    const cronExpression = process.env.WA_GROUP_CRON || '0 11 * * *';

    if (!enabled) {
        console.log('[WA-GROUP] Scheduler desactivado (WA_GROUP_ENABLED != true).');
        return;
    }

    if (!cron.validate(cronExpression)) {
        console.error(`[WA-GROUP] Expresion cron invalida: ${cronExpression}`);
        return;
    }

    scheduledTask = cron.schedule(cronExpression, async () => {
        console.log(`[WA-GROUP] Cron disparado: ${new Date().toISOString()}`);
        await executeWhatsAppGroupPost();
    }, {
        timezone: 'America/Mexico_City'
    });

    console.log(`[WA-GROUP] Scheduler iniciado. Cron: "${cronExpression}" (America/Mexico_City)`);
}

function stopWhatsAppScheduler() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('[WA-GROUP] Scheduler detenido.');
    }
}

module.exports = { startWhatsAppScheduler, stopWhatsAppScheduler };
