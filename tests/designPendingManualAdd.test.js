jest.mock('../server/config', () => ({ db: {}, admin: {} }));
jest.mock('../server/design/svgAuto', () => ({ AUTO_DESDE_MS: Date.parse('2026-07-17T00:00:00Z'), boardTerminado: () => false, disenoYaHecho: () => false }));
const { reasonsForOrderData, pendienteRenovadoMs } = require('../server/design/designPending');
const ts = iso => ({ toMillis: () => Date.parse(iso) });

test('añadido a mano por número: aparece aunque ya estuviera marcado Diseñado', () => {
    const order = { estatus: 'Fabricar', guiaEnvio: { guia: '123' }, disenoListoAt: ts('2026-09-20T10:00:00Z') };
    expect(reasonsForOrderData(order)).toEqual([]);
    const added = { ...order, designForce: true, designForceAt: ts('2026-09-26T10:00:00Z') };
    expect(reasonsForOrderData(added)).toEqual(['manual']);
    expect(pendienteRenovadoMs(added)).toBe(Date.parse('2026-09-26T10:00:00Z'));
});

test('añadido a mano por número: aparece aunque su estatus sea terminal', () => {
    expect(reasonsForOrderData({ estatus: 'Entregado', designForce: true, designForceAt: ts('2026-09-26T10:00:00Z') })).toEqual(['manual']);
});

test('el "A Diseño" de Mockup (sin fecha) conserva el comportamiento de antes con estatus terminal', () => {
    expect(reasonsForOrderData({ estatus: 'Entregado', designForce: true })).toEqual([]);
});

test('marcarlo Diseñado después de añadirlo lo saca otra vez', () => {
    const order = { estatus: 'Entregado', designForce: false, designForceAt: ts('2026-09-26T10:00:00Z'), disenoListoAt: ts('2026-09-26T12:00:00Z') };
    expect(reasonsForOrderData(order)).toEqual([]);
});
