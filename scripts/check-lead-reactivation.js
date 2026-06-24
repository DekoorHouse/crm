/**
 * Script de diagnóstico SOLO-LECTURA.
 * Revisa si el seguimiento de leads (lead_reactivation) está activo en producción
 * y si ha estado enviando mensajes. No escribe nada.
 */
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  const localPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  return JSON.parse(fs.readFileSync(localPath, 'utf8'));
}

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  const db = admin.firestore();

  // 1) Config de reactivación
  const cfgSnap = await db.collection('crm_settings').doc('lead_reactivation').get();
  console.log('=== crm_settings/lead_reactivation ===');
  if (!cfgSnap.exists) {
    console.log('(NO existe el doc -> se usan los DEFAULTS del código: enabled=true, 15min/4h)');
  } else {
    const c = cfgSnap.data();
    console.log(JSON.stringify({
      enabled: c.enabled,
      followups: (c.followups || []).map(f => ({ delayMinutes: f.delayMinutes })),
      cooldownHours: c.cooldownHours,
      minDaysSinceLastOrder: c.minDaysSinceLastOrder,
      maxPerSweep: c.maxPerSweep,
      updatedAt: c.updatedAt && c.updatedAt.toDate && c.updatedAt.toDate().toISOString()
    }, null, 2));
  }

  // 2) Config general (bot global)
  const genSnap = await db.collection('crm_settings').doc('general').get();
  console.log('\n=== crm_settings/general ===');
  console.log(genSnap.exists ? JSON.stringify(genSnap.data(), null, 2) : '(no existe)');

  // 3) Estado de lead_followups
  console.log('\n=== lead_followups (conteo por status) ===');
  const all = await db.collection('lead_followups').get();
  const byStatus = {};
  let withSends = 0;
  let recentSends = 0;
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  all.forEach(d => {
    const x = d.data();
    byStatus[x.status || 'undefined'] = (byStatus[x.status || 'undefined'] || 0) + 1;
    if (x.totalSent > 0) withSends++;
    const last = x.lastSentAt && x.lastSentAt.toMillis ? x.lastSentAt.toMillis() : null;
    if (last && (now - last) < sevenDays) recentSends++;
  });
  console.log('Total docs:', all.size);
  console.log('Por status:', JSON.stringify(byStatus, null, 2));
  console.log('Docs con al menos 1 envío (totalSent>0):', withSends);
  console.log('Docs con envío en los últimos 7 días:', recentSends);

  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
