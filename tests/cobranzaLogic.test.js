/**
 * Tests de la lógica pura de cobranza automática (server/cobranza/cobranzaLogic.js).
 * Regla de negocio (17-jul-2026, versión 4 toques espaciados):
 *   - 4 cobros máx por pedido: día 0 (tarde de la foto), día 2, día 5, día 9.
 *   - Al día siguiente del 4º cobro sin pago (~día 10) se CANCELA el pedido.
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
const order = ({ attempts, firstDaysAgo, lastDaysAgo, futureDate } = {}) => ({
    cobranzaAuto: {
        ...(attempts != null ? { attempts } : {}),
        ...(firstDaysAgo != null ? { firstAt: { toMillis: () => NOW - firstDaysAgo * DAY_MS } } : {}),
        ...(lastDaysAgo != null ? { lastDate: dstr(-lastDaysAgo) } : {}),
        ...(futureDate ? { futureDate } : {})
    }
});

describe('constantes del ciclo', () => {
    test('4 cobros máximo, 10 días, gaps 2-3-4', () => {
        expect(MAX_ATTEMPTS).toBe(4);
        expect(MAX_DAYS).toBe(10);
        expect(GAP_AFTER_ATTEMPT).toEqual({ 1: 2, 2: 3, 3: 4 });
    });
});

describe('decideCobranzaAction — ciclo de 4 cobros espaciados', () => {
    test('pedido nuevo (sin intentos): se cobra', () => {
        expect(decideCobranzaAction([{}], TODAY, NOW).action).toBe('collect');
    });

    test('tras el cobro 1: espera 2 días (día 1 = wait, día 2 = collect)', () => {
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 1, lastDaysAgo: 1 })], TODAY, NOW).action).toBe('wait');
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 2, lastDaysAgo: 2 })], TODAY, NOW).action).toBe('collect');
    });

    test('tras el cobro 2: espera 3 días (2 días = wait, 3 días = collect)', () => {
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 4, lastDaysAgo: 2 })], TODAY, NOW).action).toBe('wait');
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 5, lastDaysAgo: 3 })], TODAY, NOW).action).toBe('collect');
    });

    test('tras el cobro 3: espera 4 días (3 días = wait, 4 días = collect)', () => {
        expect(decideCobranzaAction([order({ attempts: 3, firstDaysAgo: 8, lastDaysAgo: 3 })], TODAY, NOW).action).toBe('wait');
        expect(decideCobranzaAction([order({ attempts: 3, firstDaysAgo: 9, lastDaysAgo: 4 })], TODAY, NOW).action).toBe('collect');
    });

    test('con 4 cobros hechos: se CANCELA', () => {
        const d = decideCobranzaAction([order({ attempts: 4, firstDaysAgo: 10, lastDaysAgo: 1 })], TODAY, NOW);
        expect(d.action).toBe('cancel');
        expect(d.reason).toContain('4 cobros');
    });

    test('varios pedidos del mismo cliente: manda el MÁXIMO de intentos', () => {
        const d = decideCobranzaAction(
            [order({ attempts: 1, firstDaysAgo: 2, lastDaysAgo: 2 }), order({ attempts: 4, firstDaysAgo: 10, lastDaysAgo: 1 })],
            TODAY, NOW
        );
        expect(d.action).toBe('cancel');
    });

    test('sin lastDate registrada (dato legado): no bloquea, se cobra', () => {
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 5 })], TODAY, NOW).action).toBe('collect');
    });
});

describe('decideCobranzaAction — simulación del calendario completo (día por día)', () => {
    test('cliente en silencio total: cobros en días 0, 2, 5, 9 y cancelación el día 10', () => {
        // Simula el ciclo completo: cada "día" el sweep evalúa y, si toca, cobra.
        const state = { attempts: 0, firstDay: null, lastDay: null };
        const actions = [];
        for (let day = 0; day <= 10; day++) {
            const today = dstr(day);
            const now = Date.parse(today + 'T17:00:00-06:00');
            const o = {
                cobranzaAuto: {
                    attempts: state.attempts,
                    ...(state.firstDay != null ? { firstAt: { toMillis: () => Date.parse(dstr(state.firstDay) + 'T19:00:00-06:00') } } : {}),
                    ...(state.lastDay != null ? { lastDate: dstr(state.lastDay) } : {})
                }
            };
            const d = decideCobranzaAction([o], today, now);
            actions.push(`día ${day}: ${d.action}`);
            if (d.action === 'collect') {
                state.attempts++;
                if (state.firstDay == null) state.firstDay = day;
                state.lastDay = day;
            }
            if (d.action === 'cancel') break;
        }
        expect(actions).toEqual([
            'día 0: collect',  // cobro 1 (tarde de la foto)
            'día 1: wait',
            'día 2: collect',  // cobro 2
            'día 3: wait',
            'día 4: wait',
            'día 5: collect',  // cobro 3
            'día 6: wait',
            'día 7: wait',
            'día 8: wait',
            'día 9: collect',  // cobro 4 (última llamada)
            'día 10: cancel'   // se cumple el aviso
        ]);
    });
});

describe('decideCobranzaAction — corte de 10 días (sin promesa de por medio)', () => {
    test('pasados los 10 días SIN promesa y con menos de 4 cobros: sale a revisión manual (expire)', () => {
        const d = decideCobranzaAction([order({ attempts: 2, firstDaysAgo: MAX_DAYS + 1, lastDaysAgo: 8 })], TODAY, NOW);
        expect(d.action).toBe('expire');
    });

    test('viejo Y con 4 cobros: cancelar gana sobre expirar', () => {
        const d = decideCobranzaAction([order({ attempts: 4, firstDaysAgo: 12, lastDaysAgo: 2 })], TODAY, NOW);
        expect(d.action).toBe('cancel');
    });
});

describe('decideCobranzaAction — promesas de pago a fecha futura', () => {
    test('promesa vigente: no se cobra ni se cancela (aunque ya haya 4 intentos)', () => {
        const d = decideCobranzaAction([order({ attempts: 4, firstDaysAgo: 5, lastDaysAgo: 1, futureDate: '2026-07-20' })], TODAY, NOW);
        expect(d.action).toBe('skip_future');
        expect(d.reason).toContain('2026-07-20');
    });

    test('promesa a 15 días que vence hoy (pedido de hace 15): RETOMA el cobro, no expira', () => {
        // El reloj de 10 días se re-ancla en la promesa; el gap ya pasó de sobra → cobra hoy.
        const d = decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 15, lastDaysAgo: 14, futureDate: TODAY })], TODAY, NOW);
        expect(d.action).toBe('collect');
    });

    test('promesa vencida hace 12 días y puro silencio después: expira a revisión manual', () => {
        const d = decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 20, lastDaysAgo: 19, futureDate: dstr(-12) })], TODAY, NOW);
        expect(d.action).toBe('expire');
    });

    test('promesa vencida + ya lleva 4 cobros: se cancela (el tope siempre manda)', () => {
        const d = decideCobranzaAction([order({ attempts: 4, firstDaysAgo: 15, lastDaysAgo: 1, futureDate: dstr(-2) })], TODAY, NOW);
        expect(d.action).toBe('cancel');
    });
});
