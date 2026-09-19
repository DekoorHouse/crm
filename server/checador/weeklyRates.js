const { validRate, weekKey } = require('../../functions/checadorPayroll');

function createSaveWeeklyRate({ db, admin, isAdmin }) {
    return async (req, res) => {
        if (!isAdmin(req.body && req.body.adminPin)) {
            return res.status(403).json({ ok: false, message: 'PIN de admin inválido.' });
        }
        const { weekStart, hourlyRate } = req.body || {};
        if (typeof weekStart !== 'string' || weekKey(weekStart) !== weekStart) {
            return res.status(400).json({ ok: false, message: 'La semana debe comenzar en lunes (AAAA-MM-DD).' });
        }
        if (!validRate(hourlyRate)) {
            return res.status(400).json({ ok: false, message: 'Ingresa un precio mayor a 0 y hasta $100,000, con máximo dos decimales.' });
        }
        try {
            await db.collection('checador_weekly_rates').doc(weekStart).set({
                hourlyRate, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            res.json({ ok: true, weekStart, hourlyRate });
        } catch (e) {
            console.error('[CHECADOR/weekly-rate]', e.message);
            res.status(500).json({ ok: false, message: 'No se pudo guardar el precio. Intenta de nuevo.' });
        }
    };
}
module.exports = { createSaveWeeklyRate };
