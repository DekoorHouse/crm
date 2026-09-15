const { db } = require('../config');
const { ms } = require('./paymentPolicy');
const { processReceipt, deliverForm } = require('./paymentWorkflow');
let timer, running = false;

async function runPaymentSweep() {
    if (running) return;
    running = true;
    try {
        const pending = await db.collection('payment_receipts').where('status', 'in', ['pending', 'processing']).get();
        const due = pending.docs.filter(d => ms(d.data().leaseUntil) <= Date.now() && ms(d.data().nextAttemptAt) <= Date.now())
            .sort((a, b) => ms(a.data().receivedAt) - ms(b.data().receivedAt));
        // Una sola generación por vez: evita picos de consumo al recuperar una caída.
        for (const r of due.slice(0, 30)) await processReceipt(r.id);
        const forms = await db.collection('pedidos').where('shippingFormStatus', 'in', ['pending', 'retry', 'sending']).get();
        for (const d of forms.docs) {
            const p = d.data();
            if (p.shippingFormStatus === 'sending' && ms(p.shippingFormLeaseUntil) < Date.now()) {
                // Un reinicio pudo ocurrir después del envío y antes del sello. Revisión evita duplicados.
                await db.runTransaction(async tx => {
                    const current = (await tx.get(d.ref)).data();
                    if (current?.shippingFormStatus !== 'sending' || ms(current.shippingFormLeaseUntil) > Date.now()) return;
                    tx.update(d.ref, { shippingFormStatus: 'review', shippingFormReason: 'El servidor se reinició durante el envío; revisar el chat antes de reintentar.', shippingFormLeaseUntil: null });
                });
            } else await deliverForm(d.id);
        }
    } finally { running = false; }
}

function startPaymentScheduler() {
    if (timer) return;
    const run = () => runPaymentSweep().catch(e => console.error('[PAYMENTS] Recuperar pendientes:', e.message));
    timer = setInterval(run, 30000);
    timer.unref?.();
    void run();
    console.log('[PAYMENTS] Comprobantes y formularios persistentes: recuperación cada 30 segundos.');
}
module.exports = { startPaymentScheduler, runPaymentSweep };
