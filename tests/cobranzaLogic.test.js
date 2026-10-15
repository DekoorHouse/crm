/**
 * Tests de la lógica pura de cobranza automática (server/cobranza/cobranzaLogic.js).
 * Regla de negocio (15-oct-2026, versión de 2 cobros):
 *   - 2 cobros máx por pedido: día 0 (tarde de la foto) y día 3 (última llamada).
 *   - Al día siguiente de la última llamada sin pago (~día 4) se CANCELA el pedido.
 *   - Nunca se cancela sin última llamada: los pedidos que venían del ciclo de 4 la reciben primero.
 *   - Promesas de pago con fecha pausan TODO (ni cobra ni cancela) y re-anclan
 *     el reloj de los 10 días al vencer.
 *   - El corte de 10 días → revisión manual aplica solo a silencio sin promesa.
 */
const { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS, GAP_AFTER_ATTEMPT } = require('../server/cobranza/cobranzaLogic');

const DAY_MS = 24 * 60 * 60 * 1000;

// Fechas de referencia: "hoy" es 2026-07-17.
const TODAY = '2026-07-17';
const NOW = Date.parse('2026-07-17T18:00:00Z');
const dstr = (daysFromToday) => new Date(Date.parse(TODAY + 'T12:00:00Z') + daysFromToday * DAY_MS).toISOString().slice(0, 10);

// Helper: arma un pedido con su estado de cobranza automática
const order = ({ attempts, firstDaysAgo, lastDaysAgo, futureDate, finalNotice } = {}) => ({
    cobranzaAuto: {
        ...(attempts != null ? { attempts } : {}),
        ...(firstDaysAgo != null ? { firstAt: { toMillis: () => NOW - firstDaysAgo * DAY_MS } } : {}),
        ...(lastDaysAgo != null ? { lastDate: dstr(-lastDaysAgo) } : {}),
        ...(futureDate ? { futureDate } : {}),
        ...(finalNotice ? { finalNoticeAt: { toMillis: () => NOW - DAY_MS } } : {})
    }
});

describe('constantes del ciclo', () => {
    test('2 cobros máximo, 10 días, cobro 2 a los 3 días', () => {
        expect(MAX_ATTEMPTS).toBe(2);
        expect(MAX_DAYS).toBe(10);
        expect(GAP_AFTER_ATTEMPT[1]).toBe(3);
    });
});

describe('decideCobranzaAction — ciclo de 2 cobros', () => {
    test('pedido nuevo (sin intentos): se cobra', () => {
        expect(decideCobranzaAction([{}], TODAY, NOW).action).toBe('collect');
    });

    test('tras el cobro 1: espera 3 días (2 días = wait, 3 días = collect)', () => {
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 2, lastDaysAgo: 2 })], TODAY, NOW).action).toBe('wait');
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 3, lastDaysAgo: 3 })], TODAY, NOW).action).toBe('collect');
    });

    test('con los 2 cobros y la última llamada hecha: se CANCELA', () => {
        const d = decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 4, lastDaysAgo: 1, finalNotice: true })], TODAY, NOW);
        expect(d.action).toBe('cancel');
        expect(d.reason).toContain('2 cobros');
    });

    test('pedido que venía del ciclo de 4 con 2 o 3 cobros: primero recibe la última llamada, no se cancela', () => {
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 3, lastDaysAgo: 1 })], TODAY, NOW).action).toBe('collect');
        expect(decideCobranzaAction([order({ attempts: 3, firstDaysAgo: 6, lastDaysAgo: 1 })], TODAY, NOW).action).toBe('collect');
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 3, lastDaysAgo: 0 })], TODAY, NOW).action).toBe('wait');
    });

    test('con 4 cobros del ciclo anterior: se cancela (ya tuvieron su última llamada)', () => {
        expect(decideCobranzaAction([order({ attempts: 4, firstDaysAgo: 10, lastDaysAgo: 1 })], TODAY, NOW).action).toBe('cancel');
    });

    test('varios pedidos del mismo cliente: manda el MÁXIMO de intentos', () => {
        const d = decideCobranzaAction(
            [order({ attempts: 1, firstDaysAgo: 2, lastDaysAgo: 2 }), order({ attempts: 2, firstDaysAgo: 4, lastDaysAgo: 1, finalNotice: true })],
            TODAY, NOW
        );
        expect(d.action).toBe('cancel');
    });

    test('sin lastDate registrada (dato legado): no bloquea, se cobra', () => {
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 5 })], TODAY, NOW).action).toBe('collect');
    });
});

describe('decideCobranzaAction — simulación del calendario completo (día por día)', () => {
    test('cliente en silencio total: cobros en días 0 y 3 y cancelación el día 4', () => {
        const state = { attempts: 0, firstDay: null, lastDay: null, final: false };
        const actions = [];
        for (let day = 0; day <= 10; day++) {
            const today = dstr(day);
            const now = Date.parse(today + 'T17:00:00-06:00');
            const o = {
                cobranzaAuto: {
                    attempts: state.attempts,
                    ...(state.firstDay != null ? { firstAt: { toMillis: () => Date.parse(dstr(state.firstDay) + 'T19:00:00-06:00') } } : {}),
                    ...(state.lastDay != null ? { lastDate: dstr(state.lastDay) } : {}),
                    ...(state.final ? { finalNoticeAt: { toMillis: () => now } } : {})
                }
            };
            const d = decideCobranzaAction([o], today, now);
            actions.push(`día ${day}: ${d.action}`);
            if (d.action === 'collect') {
                state.attempts++;
                if (state.firstDay == null) state.firstDay = day;
                state.lastDay = day;
                if (state.attempts >= MAX_ATTEMPTS) state.final = true; // el scheduler sella finalNoticeAt
            }
            if (d.action === 'cancel') break;
        }
        expect(actions).toEqual([
            'día 0: collect',  // cobro 1 (tarde de la foto)
            'día 1: wait',
            'día 2: wait',
            'día 3: collect',  // cobro 2 (última llamada)
            'día 4: cancel'    // se cumple el aviso
        ]);
    });
});

describe('decideCobranzaAction — corte de 10 días (sin promesa de por medio)', () => {
    test('pasados los 10 días SIN promesa y con menos cobros del tope: sale a revisión manual (expire)', () => {
        const d = decideCobranzaAction([order({ attempts: 1, firstDaysAgo: MAX_DAYS + 1, lastDaysAgo: 8 })], TODAY, NOW);
        expect(d.action).toBe('expire');
    });

    test('viejo Y con la última llamada hecha: cancelar gana sobre expirar', () => {
        const d = decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 12, lastDaysAgo: 2, finalNotice: true })], TODAY, NOW);
        expect(d.action).toBe('cancel');
    });
});

describe('decideCobranzaAction — promesas de pago a fecha futura', () => {
    test('promesa vigente: no se cobra ni se cancela (aunque ya tenga la última llamada)', () => {
        const d = decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 5, lastDaysAgo: 1, futureDate: '2026-07-20', finalNotice: true })], TODAY, NOW);
        expect(d.action).toBe('skip_future');
        expect(d.reason).toContain('2026-07-20');
    });

    test('promesa a 15 días que vence hoy (pedido de hace 15): RETOMA el cobro, no expira', () => {
        const d = decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 15, lastDaysAgo: 14, futureDate: TODAY })], TODAY, NOW);
        expect(d.action).toBe('collect');
    });

    test('promesa vencida hace 12 días y puro silencio después: expira a revisión manual', () => {
        const d = decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 20, lastDaysAgo: 19, futureDate: dstr(-12) })], TODAY, NOW);
        expect(d.action).toBe('expire');
    });

    test('promesa vencida + ya tuvo la última llamada: se cancela (el tope siempre manda)', () => {
        const d = decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 15, lastDaysAgo: 1, futureDate: dstr(-2), finalNotice: true })], TODAY, NOW);
        expect(d.action).toBe('cancel');
    });
});
