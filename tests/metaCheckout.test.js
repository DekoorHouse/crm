const mockDocs = new Map();
const mockSnapshot = path => ({ exists: mockDocs.has(path), data: () => ({ ...mockDocs.get(path) }) });

jest.mock('../server/config', () => ({
    db: {
        collection: col => ({ doc: id => ({
            id, path: `${col}/${id}`,
            get: async () => mockSnapshot(`${col}/${id}`),
            update: async fields => Object.assign(mockDocs.get(`${col}/${id}`), fields),
        }) }),
    },
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'NOW' } } },
}));

jest.mock('../server/services', () => ({
    messagingContactInfo: jest.fn(contact => ({ wa_id: contact.wa_id })),
    pickAdReferralForConversion: jest.fn(() => ({ source_id: 'ad-1', ctwa_clid: 'clid' })),
    sendConversionEvent: jest.fn(),
}));

const { sendOrderInitiateCheckout } = require('../server/orders/metaPurchase');
const services = require('../server/services');
const order = () => mockDocs.get('pedidos/p1');

beforeEach(() => {
    mockDocs.clear();
    mockDocs.set('pedidos/p1', { contactId: 'c1', precio: 1200, attributedAdId: 'ad-1', createdAt: 'T' });
    mockDocs.set('contacts_whatsapp/c1', { wa_id: '5211234567890' });
    jest.clearAllMocks();
    services.sendConversionEvent.mockResolvedValue({ sent: true });
    services.pickAdReferralForConversion.mockReturnValue({ source_id: 'ad-1', ctwa_clid: 'clid' });
});

test('manda InitiateCheckout con el valor del pedido y lo sella', async () => {
    const result = await sendOrderInitiateCheckout('p1');
    expect(result.sent).toBe(true);
    expect(services.sendConversionEvent).toHaveBeenCalledWith('InitiateCheckout', { wa_id: '5211234567890' },
        { source_id: 'ad-1', ctwa_clid: 'clid' }, { value: 1200, currency: 'MXN' }, { eventId: 'InitiateCheckout_pedido_p1' });
    expect(order().metaCheckoutSentAt).toBe('NOW');
});

test('no lo repite si el pedido ya lo mandó', async () => {
    order().metaCheckoutSentAt = 'ANTES';
    const result = await sendOrderInitiateCheckout('p1');
    expect(result.already).toBe(true);
    expect(services.sendConversionEvent).not.toHaveBeenCalled();
});

test('no manda nada para un pedido orgánico', async () => {
    delete order().attributedAdId;
    services.pickAdReferralForConversion.mockReturnValue(null);
    const result = await sendOrderInitiateCheckout('p1');
    expect(result).toEqual({ sent: false, reason: 'orgánico' });
    expect(services.sendConversionEvent).not.toHaveBeenCalled();
});

test('si Meta no lo confirma, no sella el pedido', async () => {
    services.sendConversionEvent.mockResolvedValue({ sent: false, reason: 'sin atribución' });
    const result = await sendOrderInitiateCheckout('p1');
    expect(result.sent).toBe(false);
    expect(order().metaCheckoutSentAt).toBeUndefined();
});
