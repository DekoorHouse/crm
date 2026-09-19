// Compartido por el panel, el perfil y los reportes programados del checador.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ChecadorPayroll = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_RATE = 70;
    function validRate(value) {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000
            && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
    }
    // Las fechas de asistencia son días civiles, no instantes UTC.
    function parseDate(value) {
        if (value instanceof Date) return new Date(value.getTime());
        const text = String(value || '');
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        const log = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
        if (!iso && !log) return null;
        const [year, month, day] = iso ? [+iso[1], +iso[2], +iso[3]] : [+log[3], +log[2], +log[1]];
        const date = new Date(year, month - 1, day, 12);
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
    }
    function weekKey(value) {
        const date = parseDate(value);
        if (!date || !Number.isFinite(date.getTime())) return null;
        date.setDate(date.getDate() - (date.getDay() + 6) % 7);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function rateForDate(rates, date) {
        const rate = (rates || {})[weekKey(date)];
        return validRate(rate) ? rate : DEFAULT_RATE;
    }
    function payForMinutes(minutes, date, rates) {
        return minutes / 60 * rateForDate(rates, date);
    }
    const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
    return { DEFAULT_RATE, validRate, weekKey, rateForDate, payForMinutes, roundMoney };
});
