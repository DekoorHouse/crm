const mockDb = require('./helpers/paymentFirestore')();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() } } } }));
const { descontarInventarioPorPedido } = require('../server/inventario/inventarioService');
beforeEach(() => {
    mockDb.reset();
    mockDb.seed('pedidos/order', { producto: 'lamp', consecutiveOrderNumber: 16832 });
    mockDb.seed('productos_bom/lamp', { componentes: [{ materialId: 'base', cantidad: 2 }] });
    mockDb.seed('materiales/base', { nombre: 'Base', stockActual: 10 });
});
test('concurrent payment and operator callbacks consume stock once despite stale order snapshots', async () => {
    const stale = mockDb.read('pedidos/order');
    await Promise.all([descontarInventarioPorPedido('order', stale, 'Fabricar'), descontarInventarioPorPedido('order', stale, 'Fabricar')]);
    expect(mockDb.read('materiales/base').stockActual).toBe(8);
    expect(mockDb.read('pedidos/order').inventarioDescontado).toBe(true);
    expect(mockDb.all('movimientos_inventario')).toHaveLength(1);
    await descontarInventarioPorPedido('order', stale, 'Fabricar');
    expect(mockDb.read('materiales/base').stockActual).toBe(8);
});
