const { weekKey, rateForDate, payForMinutes, roundMoney, validRate } = require('../functions/checadorPayroll');
const { createSaveWeeklyRate } = require('../server/checador/weeklyRates');
const makeDb = require('./helpers/paymentFirestore');

test.each([
    ['14/9/2026', '2026-09-14'], ['20/9/2026', '2026-09-14'],
    ['21/9/2026', '2026-09-21'], ['1/1/2027', '2026-12-28'],
    ['2026-09-14', '2026-09-14'], ['2026-02-30', null], ['bad', null],
])('la fecha %s pertenece a la semana %s', (date, key) => expect(weekKey(date)).toBe(key));

test('cada semana tiene su tarifa; las semanas sin guardar conservan 70 y no heredan otra', () => {
    const rates = { '2026-09-07': 80.5, '2026-09-14': 95 };
    expect(rateForDate(rates, '1/9/2026')).toBe(70);
    expect(rateForDate(rates, '9/9/2026')).toBe(80.5);
    expect(rateForDate(rates, '19/9/2026')).toBe(95);
    expect(rateForDate(rates, '21/9/2026')).toBe(70);
    expect(roundMoney(payForMinutes(90, '9/9/2026', rates) + payForMinutes(60, '15/9/2026', rates))).toBe(215.75);
});

test.each([null, '', '80', 0, -1, Infinity, NaN, 100001, 80.123])('rechaza tarifa inválida %s', rate => {
    expect(validRate(rate)).toBe(false);
});

describe('guardar tarifa semanal con PIN admin', () => {
    let db, handler, res;
    beforeEach(() => {
        db = makeDb();
        handler = createSaveWeeklyRate({ db, admin: { firestore: { FieldValue: { serverTimestamp: () => 123 } } }, isAdmin: pin => pin === 'test-admin' });
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });
    test('guarda y edita una sola semana sin cambiar las demás', async () => {
        db.seed('checador_weekly_rates/2026-09-07', { hourlyRate: 77 });
        for (const hourlyRate of [80, 85.5]) {
            await handler({ body: { adminPin: 'test-admin', weekStart: '2026-09-14', hourlyRate } }, res);
        }
        expect(db.read('checador_weekly_rates/2026-09-14').hourlyRate).toBe(85.5);
        expect(db.read('checador_weekly_rates/2026-09-07').hourlyRate).toBe(77);
        expect(db.all('checador_weekly_rates')).toHaveLength(2);
    });
    test.each([
        [{ adminPin: 'wrong', weekStart: '2026-09-14', hourlyRate: 80 }, 403],
        [{ adminPin: 'test-admin', weekStart: '2026-09-15', hourlyRate: 80 }, 400],
        [{ adminPin: 'test-admin', weekStart: '2026-02-30', hourlyRate: 80 }, 400],
        [{ adminPin: 'test-admin', weekStart: '../other', hourlyRate: 80 }, 400],
        [{ adminPin: 'test-admin', weekStart: '2026-09-14', hourlyRate: '80' }, 400],
        [{ adminPin: 'test-admin', weekStart: '2026-09-14', hourlyRate: -1 }, 400],
    ])('rechaza entradas inválidas antes de escribir', async (body, code) => {
        await handler({ body }, res);
        expect(res.status).toHaveBeenCalledWith(code);
        expect(db.all('checador_weekly_rates')).toHaveLength(0);
    });
    test('un error de guardado no reporta éxito ni altera la tarifa previa', async () => {
        db.seed('checador_weekly_rates/2026-09-14', { hourlyRate: 75 });
        db.failNext('set', 'checador_weekly_rates');
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await handler({ body: { adminPin: 'test-admin', weekStart: '2026-09-14', hourlyRate: 80 } }, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(db.read('checador_weekly_rates/2026-09-14').hourlyRate).toBe(75);
        } finally { log.mockRestore(); }
    });
});
