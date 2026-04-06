const functions = require('firebase-functions');
const admin = require('firebase-admin');
const twilio = require('twilio');

admin.initializeApp();
const db = admin.firestore();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function getTwilioClient() {
    const cfg = functions.config().twilio;
    return {
        client: twilio(cfg.sid, cfg.token),
        from: `whatsapp:${cfg.from}`
    };
}

function parseLogDate(dateStr) {
    const [d, m, y] = dateStr.split('/').map(Number);
    return new Date(y, m - 1, d);
}

function getPeriodRange(period) {
    const now = new Date();
    let start, end;
    if (period === 'semanal') {
        const day = now.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day;
        start = new Date(now);
        start.setDate(now.getDate() + diffToMonday);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
    } else if (period === 'mensual') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
    return { start, end };
}

function fmtDate(d) {
    return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtPeriodLabel(period) {
    const { start, end } = getPeriodRange(period);
    const fmt = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    if (period === 'semanal') return `${fmt(start)} – ${fmt(end)}`;
    if (period === 'mensual') return start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return String(start.getFullYear());
}

// ------------------------------------------------------------
// Core: generate & send reports
// ------------------------------------------------------------

async function buildAndSendReports(period = 'semanal') {
    const { start, end } = getPeriodRange(period);

    // Load employees
    const empSnap = await db.collection('checador_employees').get();
    const employees = empSnap.docs.map(d => ({ _docId: d.id, ...d.data() }));

    // Load logs in the period
    const logsSnap = await db.collection('checador_logs').get();
    const periodLogs = logsSnap.docs
        .map(d => d.data())
        .filter(log => {
            const d = parseLogDate(log.date);
            return d && d >= start && d <= end;
        });

    const { client, from } = getTwilioClient();
    const periodLabel = fmtPeriodLabel(period);

    let sent = 0, skipped = 0, errors = 0;

    for (const emp of employees) {
        if (!emp.phone) { skipped++; continue; }

        // Build per-employee summary
        const empLogs = periodLogs.filter(l => l.id === emp.id);
        if (empLogs.length === 0) { skipped++; continue; }

        // Group by day
        const dayGroups = {};
        empLogs.forEach(log => {
            if (!dayGroups[log.date]) dayGroups[log.date] = [];
            dayGroups[log.date].push(log);
        });

        let totalMinutes = 0, daysWorked = 0;
        for (const events of Object.values(dayGroups)) {
            const sorted = events.sort((a, b) => a.timestamp - b.timestamp);
            let lastIn = null, hasIn = false;
            sorted.forEach(e => {
                if (e.type === 'IN') { lastIn = e.timestamp; hasIn = true; }
                else if (e.type === 'OUT' && lastIn) {
                    totalMinutes += Math.floor((e.timestamp - lastIn) / 60000);
                    lastIn = null;
                }
            });
            if (hasIn) daysWorked++;
        }

        const hrs = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const payment = (totalMinutes / 60) * 70;
        const firstName = emp.name.split(' ')[0];

        const body =
            `Hola ${firstName} 👋\n\n` +
            `Aquí está tu reporte de asistencia *${period}*:\n` +
            `📅 *${periodLabel}*\n\n` +
            `▸ Días trabajados: *${daysWorked}*\n` +
            `▸ Total horas: *${hrs}h ${mins}m*\n` +
            `▸ Pago estimado: *$${payment.toFixed(0)}*\n\n` +
            `¡Gracias por tu trabajo! 💼\n_— Dekoor House_`;

        try {
            await client.messages.create({ from, to: `whatsapp:${emp.phone}`, body });
            sent++;
            console.log(`Reporte enviado a ${emp.name} (${emp.phone})`);
        } catch (err) {
            errors++;
            console.error(`Error enviando a ${emp.name}:`, err.message);
        }
    }

    return { sent, skipped, errors };
}

// ------------------------------------------------------------
// 1. Automático: cada domingo a las 6pm hora Ciudad de México
// ------------------------------------------------------------
exports.sendWeeklyReports = functions
    .region('us-central1')
    .pubsub
    .schedule('0 18 * * 0')
    .timeZone('America/Mexico_City')
    .onRun(async () => {
        const result = await buildAndSendReports('semanal');
        console.log('Reporte semanal automático:', result);
        return null;
    });

// ------------------------------------------------------------
// 2. Manual desde el panel admin (callable con Firebase Auth)
// ------------------------------------------------------------
exports.sendReportManual = functions
    .region('us-central1')
    .https
    .onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado.');
        }
        const period = (data && data.period) || 'semanal';
        const result = await buildAndSendReports(period);
        console.log(`Reporte manual (${period}):`, result);
        return result;
    });
