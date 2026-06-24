/**
 * Administración del seguimiento de "pedido en proceso".
 * Uso:
 *   node scripts/order-followup-admin.js status     # config + conteo por status
 *   node scripts/order-followup-admin.js dry-run    # simula el sweep (no envía nada)
 *   node scripts/order-followup-admin.js enable      # activa el feature
 *   node scripts/order-followup-admin.js disable     # desactiva el feature
 *
 * El feature viene DESACTIVADO por defecto. Actívalo solo cuando estés listo.
 */
const { db } = require('../server/config');
const {
    getOrderFollowupConfig,
    saveOrderFollowupConfig,
    runOrderFollowupSweep
} = require('../server/leads/orderFollowupScheduler');

async function status() {
    const cfg = await getOrderFollowupConfig(true);
    console.log('=== Config (crm_settings/order_followup) ===');
    console.log(JSON.stringify(cfg, null, 2));

    console.log('\n=== order_followups por status ===');
    const snap = await db.collection('order_followups').get();
    const byStatus = {};
    snap.forEach(d => { const s = d.data().status || '?'; byStatus[s] = (byStatus[s] || 0) + 1; });
    console.log('Total docs:', snap.size);
    console.log(JSON.stringify(byStatus, null, 2));
}

async function dryRun() {
    const cfg = await getOrderFollowupConfig(true);
    if (!cfg.enabled) {
        console.log('⚠️  El feature está DESACTIVADO (enabled=false). El sweep no evaluará nada.');
        console.log('   Actívalo con: node scripts/order-followup-admin.js enable');
    }
    const summary = await runOrderFollowupSweep({ dryRun: true });
    console.log('=== Resultado del sweep (dry-run, NO envía) ===');
    console.log(JSON.stringify(summary, null, 2));
}

async function setEnabled(enabled) {
    const saved = await saveOrderFollowupConfig({ enabled });
    console.log(`Feature ${enabled ? 'ACTIVADO ✅' : 'DESACTIVADO ⛔'}.`);
    console.log(JSON.stringify(saved, null, 2));
}

(async () => {
    const cmd = process.argv[2];
    try {
        switch (cmd) {
            case 'status': await status(); break;
            case 'dry-run': await dryRun(); break;
            case 'enable': await setEnabled(true); break;
            case 'disable': await setEnabled(false); break;
            default:
                console.log('Comandos: status | dry-run | enable | disable');
        }
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
})();
