/**
 * Tests de la lógica pura de cobranza automática (server/cobranza/cobranzaLogic.js).
 * Regla de negocio (17-jul-2026): Andrea cobra pedidos en "Foto enviada"/"Esperando pago"
 * máximo 3 veces (una por día); al tocar el 4º cobro se cancela el pedido; a los 10 días
 * en automatización sin resolverse, sale para revisión manual. Las promesas de pago a
 * fecha futura pausan todo (ni cobra ni cancela).
 */
const { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS } = require('../server/cobranza/cobranzaLogic');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-17T18:00:00Z');
const TODAY = '2026-07-17';

// Helper: arma un pedido con su estado de cobranza automática
const order = ({ attempts, firstDaysAgo, futureDate } = {}) => ({
    cobranzaAuto: {
        ...(attempts != null ? { attempts } : {}),
        ...(firstDaysAgo != null ? { firstAt: { toMillis: () => NOW - firstDaysAgo * DAY_MS } } : {}),
        ...(futureDate ? { futureDate } : {})
    }
});

describe('decideCobranzaAction — flujo 3 cobros, uno por día', () => {
    test('pedido nuevo (sin intentos): se cobra', () => {
        expect(decideCobranzaAction([{}], TODAY, NOW).action).toBe('collect');
    });

    test('con 1 y 2 cobros hechos: se sigue cobrando', () => {
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 1 })], TODAY, NOW).action).toBe('collect');
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 2 })], TODAY, NOW).action).toBe('collect');
    });

    test('con 3 cobros hechos (tocaría el 4º): se CANCELA, no se cobra', () => {
        const d = decideCobranzaAction([order({ attempts: MAX_ATTEMPTS, firstDaysAgo: 3 })], TODAY, NOW);
        expect(d.action).toBe('cancel');
        expect(d.reason).toContain('3 cobros');
    });

    test('varios pedidos del mismo cliente: manda el MÁXIMO de intentos', () => {
        const d = decideCobranzaAction(
            [order({ attempts: 1, firstDaysAgo: 2 }), order({ attempts: 3, firstDaysAgo: 3 })],
            TODAY, NOW
        );
        expect(d.action).toBe('cancel');
    });
});

describe('decideCobranzaAction — corte de 10 días', () => {
    test('a los 9 días con menos de 3 cobros: aún se cobra', () => {
        expect(decideCobranzaAction([order({ attempts: 2, firstDaysAgo: 9 })], TODAY, NOW).action).toBe('collect');
    });

    test('pasados los 10 días con menos de 3 cobros: sale a revisión manual (expire), NO se cancela', () => {
        const d = decideCobranzaAction([order({ attempts: 1, firstDaysAgo: MAX_DAYS + 1 })], TODAY, NOW);
        expect(d.action).toBe('expire');
    });

    test('viejo Y con 3 cobros: cancelar gana sobre expirar (3 cobros sin pago = no va a pagar)', () => {
        const d = decideCobranzaAction([order({ attempts: 3, firstDaysAgo: 12 })], TODAY, NOW);
        expect(d.action).toBe('cancel');
    });
});

describe('decideCobranzaAction — promesas de pago a fecha futura', () => {
    test('promesa vigente: no se cobra ni se cancela (aunque ya haya 3 intentos)', () => {
        const d = decideCobranzaAction([order({ attempts: 3, firstDaysAgo: 5, futureDate: '2026-07-20' })], TODAY, NOW);
        expect(d.action).toBe('skip_future');
        expect(d.reason).toContain('2026-07-20');
    });

    test('promesa ya vencida (fecha pasada o de hoy): el flujo continúa normal', () => {
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 3, futureDate: '2026-07-15' })], TODAY, NOW).action).toBe('collect');
        expect(decideCobranzaAction([order({ attempts: 1, firstDaysAgo: 3, futureDate: TODAY })], TODAY, NOW).action).toBe('collect');
    });

    test('promesa vencida + 3 cobros: se cancela', () => {
        expect(decideCobranzaAction([order({ attempts: 3, firstDaysAgo: 5, futureDate: '2026-07-10' })], TODAY, NOW).action).toBe('cancel');
    });
});
