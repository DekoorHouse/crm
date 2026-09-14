// Registro completo con Gemini, Firestore y WhatsApp simulados: ninguna llamada de producción.
const mockDocs = new Map();
const mockWrites = [];
const mockFailures = [];
const mockTimestamp = ms => ({ toMillis: () => ms });
const mockSnapshot = path => ({ exists: mockDocs.has(path), data: () => ({ ...mockDocs.get(path) }) });
function mockRef(path) {
    return {
        id: path.split('/').pop(), path,
        get: async () => mockSnapshot(path),
        update: async fields => {
            mockWrites.push({ path, fields });
            const doc = mockDocs.get(path);
            if (!doc) throw new Error(`Documento inexistente: ${path}`);
            for (const [key, value] of Object.entries(fields)) {
                if (value === '__DELETE__') delete doc[key];
                else doc[key] = value;
            }
        },
    };
}
jest.mock('../server/config', () => ({
    db: {
        collection: name => ({
            doc: id => mockRef(`${name}/${id}`),
            add: async fields => mockFailures.push(fields),
            where: (field, op, value) => ({ get: async () => ({
                forEach: fn => {
                    for (const [path, data] of mockDocs) {
                        if (path.startsWith(`${name}/`) && data[field] === value) {
                            fn({ id: path.split('/').pop(), ref: mockRef(path), data: () => ({ ...data }) });
                        }
                    }
                },
            }) }),
        }),
        runTransaction: async callback => callback({ get: ref => ref.get(), update: (ref, fields) => ref.update(fields) }),
    },
    admin: { firestore: { FieldValue: {
        serverTimestamp: () => mockTimestamp(Date.now()), delete: () => '__DELETE__',
    } } },
}));
jest.mock('../server/services', () => ({
    generateGeminiResponse: jest.fn(), sendAdvancedWhatsAppMessage: jest.fn().mockResolvedValue({}),
}));
jest.mock('../server/aiUsage', () => ({ logAiUsage: async () => {} }));
jest.mock('../server/orders/createOrderCore', () => ({
    ...jest.requireActual('../server/orders/createOrderCore'), createOrder: jest.fn(),
}));

const { registerOrderFromAI } = require('../server/orders/aiOrderRegistration');
const services = require('../server/services');
const { createOrder } = require('../server/orders/createOrderCore');
const order = () => mockDocs.get('pedidos/p1');
const contact = () => mockDocs.get('contacts_whatsapp/c1');
const items = () => [
    { producto: 'Lámpara infantil Five Nights at Freddy\'s', cantidad: 1, precio: 600, datosProducto: 'Nombre: Iker | Personaje: Five Nights at Freddy\'s | Especial: Personajes de marca' },
    { producto: 'Lámpara infantil ranita', cantidad: 1, precio: 600, datosProducto: 'Nombre: Imalay | Personaje: ranita | Especial: Figura fuera de catálogo' },
];
function extract(nextItems = items(), extra = {}) {
    services.generateGeminiResponse.mockResolvedValue({ text: JSON.stringify({
        listo: true, items: nextItems, total: nextItems.reduce((sum, it) => sum + it.precio * it.cantidad, 0),
        confianza: 100, esAdicional: false, ...extra,
    }) });
}
const run = (conversationText = 'Asistente: Recibimos su anticipo.\nCliente: Está bien\nAsistente: Ya arrancamos con sus lámparas. /anticipopagado') => registerOrderFromAI({
    contactId: 'c1', contactData: { name: 'Cliente de prueba', aiStage: 'venta' }, conversationText,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockDocs.clear(); mockWrites.length = 0; mockFailures.length = 0;
    mockDocs.set('crm_settings/ai_order_registration', { enabled: true });
    mockDocs.set('contacts_whatsapp/c1', { botActive: true });
    mockDocs.set('pedidos/p1', {
        contactId: 'c1', consecutiveOrderNumber: 16731, items: items(), precio: 1200,
        createdAt: mockTimestamp(Date.now() - 85000), estatus: 'Fabricar',
        registeredByAI: true, aiReviewStatus: 'pending',
    });
    createOrder.mockResolvedValue({ orderNumber: 16732, totalValue: 1800 });
    extract();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('DH16731: repetir el anticipo en Fabricar no pide atención ni bloquea producción', async () => {
    expect(await run()).toBe('DH16731');
    expect(await run()).toBe('DH16731');
    expect(contact().needsAttention).toBeUndefined();
    expect(order().datosReportadoAt).toBeUndefined();
    expect(order().estatus).toBe('Fabricar');
    expect(mockWrites.filter(w => w.path === 'pedidos/p1')).toEqual([]);
    expect(mockFailures).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
    expect(services.sendAdvancedWhatsAppMessage).not.toHaveBeenCalled();
    expect(contact().aiOrderRegInFlightAt).toBeUndefined();
});

test('ignora orden de piezas/campos, espacios y mayúsculas de la extracción', async () => {
    extract(items().reverse().map(it => ({ ...it, producto: `  ${it.producto.toUpperCase()}  `,
        datosProducto: it.datosProducto.split('|').reverse().join('  |  ').replace(/: /g, ' :   '),
    })));
    expect(await run()).toBe('DH16731');
    expect(contact().needsAttention).toBeUndefined();
    expect(services.sendAdvancedWhatsAppMessage).not.toHaveBeenCalled();
});

test('agrupación de filas conserva la cantidad total', async () => {
    const piece = items()[0];
    order().items = [{ ...piece, cantidad: 2 }];
    extract([{ ...piece }, { ...piece }]);
    expect(await run()).toBe('DH16731');
    expect(contact().needsAttention).toBeUndefined();
});

test('una confirmación idéntica de un pedido manual aprobado tampoco requiere revisión', async () => {
    Object.assign(order(), { estatus: 'Sin estatus', registeredByAI: false, aiReviewStatus: 'approved' });
    expect(await run()).toBe('DH16731');
    expect(mockWrites.filter(w => w.path === 'pedidos/p1')).toEqual([]);
    expect(services.sendAdvancedWhatsAppMessage).not.toHaveBeenCalled();
});

test('limpia registro pendiente repetido sin quitar alertas previas ni sus bloqueos', async () => {
    Object.assign(contact(), { status: 'pendientes_ia', needsAttention: true, needsAttentionReason: 'cambio_no_aplicado' });
    const reported = mockTimestamp(Date.now() - 10000);
    Object.assign(order(), { datosReportadoAt: reported, comentarios: 'Cambio real anterior pendiente' });
    expect(await run()).toBe('DH16731');
    expect(contact().status).toBeNull();
    expect(contact().needsAttention).toBe(true);
    expect(contact().needsAttentionReason).toBe('cambio_no_aplicado');
    expect(order().datosReportadoAt).toBe(reported);
    expect(order().comentarios).toBe('Cambio real anterior pendiente');
});

test.each(['nombre', 'acento', 'personaje', 'especial', 'cantidad', 'precio', 'quitar pieza', 'agregar pieza', 'fecha'])('un cambio real (%s) sigue pidiendo revisión y bloqueando el corte', async change => {
    const next = items();
    if (change === 'nombre') next[0].datosProducto = next[0].datosProducto.replace('Iker', 'Icker');
    if (change === 'acento') next[0].datosProducto = next[0].datosProducto.replace('Iker', 'Íker');
    if (change === 'personaje') next[1].producto = 'Lámpara infantil unicornio';
    if (change === 'especial') next[1].datosProducto += ' | Base roja';
    if (change === 'cantidad') { next[0].cantidad = 2; next[0].precio = 300; }
    if (change === 'precio') { next[0].precio = 500; next[1].precio = 700; }
    if (change === 'quitar pieza') { next.pop(); next[0].precio = 1200; }
    if (change === 'agregar pieza') { next.push({ ...next[0] }); next.forEach(it => { it.precio = 400; }); }
    if (change === 'fecha') next[1].datosProducto += ' | Fecha: 15-Septiembre-2026';
    extract(next);
    expect(await run('Cliente: Confirmo el pedido con el cambio.\nAsistente: /registrar')).toBeNull();
    expect(contact().needsAttentionReason).toBe('cambio_no_aplicado');
    expect(order().datosReportadoAt).toBeTruthy();
    expect(order().items).toEqual(items());
    expect(mockFailures[0].motivo).toContain('cambio_no_aplicado');
    expect(services.sendAdvancedWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();
});

test('sin detalle de piezas suficiente conserva revisión manual', async () => {
    delete order().items;
    expect(await run()).toBeNull();
    expect(contact().needsAttentionReason).toBe('cambio_no_aplicado');
});

test('un anticipo pendiente idéntico sigue avanzando al flujo de fabricación', async () => {
    order().estatus = 'Esperando anticipo';
    expect(await run()).toBe('DH16731');
    expect(order().estatus).toBe('Sin estatus'); // el llamador continúa con markOrderFabricarForContact
    expect(contact().needsAttention).toBeUndefined();
    expect(createOrder).not.toHaveBeenCalled();
});

test('un cambio editable todavía actualiza el mismo pedido', async () => {
    order().estatus = 'Sin estatus';
    const next = items(); next[0].datosProducto = 'Nombre: Otro nombre'; extract(next);
    expect(await run()).toBe('DH16731');
    expect(order().items).toEqual(next);
    expect(contact().needsAttention).toBeUndefined();
});

test('un pedido adicional con otra cantidad no se descarta como duplicado', async () => {
    extract([{ ...items()[0], cantidad: 3 }], { esAdicional: true });
    expect(await run()).toBe('DH16732');
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(contact().needsAttention).toBeUndefined();
});

test('sin pedido previo se registra normalmente', async () => {
    mockDocs.delete('pedidos/p1');
    expect(await run()).toBe('DH16732');
    expect(createOrder).toHaveBeenCalledTimes(1);
});
