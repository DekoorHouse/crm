const mockDb = require('./helpers/paymentFirestore')();
const mockSend = jest.fn(), mockMessenger = jest.fn(), mockProduction = jest.fn();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() }, Timestamp: { fromMillis: n => new Date(n) } } } }));
jest.mock('../server/services', () => ({ sendAdvancedWhatsAppMessage: (...a) => mockSend(...a), sendMessengerMessage: (...a) => mockMessenger(...a) }));
jest.mock('../server/payments/paymentProduction', () => ({ reconcilePaymentProduction: (...a) => mockProduction(...a) }));
const { saveShippingData, deliverShippingConfirmation, recoverShippingConfirmations } = require('../server/payments/shippingConfirmation');
const order = () => mockDb.read('pedidos/order');
const form = { numeroPedido: 'DH16978', nombreCompleto: 'Cliente de prueba', direccion: 'Dirección de prueba' };
beforeEach(() => {
    mockDb.reset(); jest.clearAllMocks();
    mockDb.seed('pedidos/order', { contactId: 'customer', consecutiveOrderNumber: 16978, estatus: 'Foto enviada', precio: 2400 });
    mockDb.seed('contacts_whatsapp/customer', { botActive: false, lastClientMsgAt: new Date() });
    mockSend.mockReset().mockResolvedValue({ id: 'wa.confirmation' });
    mockMessenger.mockReset().mockResolvedValue({ messages: [{ id: 'meta.confirmation' }] });
    mockProduction.mockReset().mockResolvedValue({ status: 'unchanged' });
});

test('DH16978: saving the form with AI off confirms receipt without approving the payment', async () => {
    await saveShippingData(form);
    expect(mockDb.all('datos_envio')).toHaveLength(1);
    expect(order()).toMatchObject({ shippingDataConfirmationStatus: 'sent', estatus: 'Foto enviada' });
    expect(order().shippingDataReceivedAt).toBeTruthy();
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(order().paymentReceivedCents).toBeUndefined();
    expect(mockSend).toHaveBeenCalledWith('customer', { text: expect.stringContaining('DH16978 quedaron registrados correctamente') });
    expect(mockSend.mock.calls[0][1].text).not.toMatch(/pagado|pago|preparamos|guía/);
    expect(mockDb.read('contacts_whatsapp/customer/messages/shipping_data_order')).toMatchObject({ status: 'sent', isAutoReply: true, id: 'wa.confirmation' });
});

test('concurrent submissions and recovery send only one confirmation per order', async () => {
    await Promise.all([saveShippingData(form), saveShippingData(form)]);
    await recoverShippingConfirmations();
    await saveShippingData(form);
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('address and pending confirmation roll back together on a storage failure', async () => {
    mockDb.failNext('commit', 'datos_envio');
    await expect(saveShippingData(form)).rejects.toThrow('storage unavailable');
    expect(mockDb.all('datos_envio')).toHaveLength(0);
    expect(order().shippingDataReceivedAt).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
});

test('a provider rejection preserves the form and retries later', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { response: { status: 503 } }));
    await saveShippingData(form);
    expect(mockDb.all('datos_envio')).toHaveLength(1);
    expect(order().shippingDataConfirmationStatus).toBe('retry');
    await recoverShippingConfirmations();
    expect(mockSend).toHaveBeenCalledTimes(1);
    mockDb.seed('pedidos/order', { ...order(), shippingDataConfirmationNextAttemptAt: new Date(0) });
    await recoverShippingConfirmations();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(order().shippingDataConfirmationStatus).toBe('sent');
});

test.each(['timeout', 'after-send-storage'])('ambiguous delivery is not repeated: %s', async failure => {
    mockSend.mockImplementationOnce(async () => {
        if (failure === 'timeout') throw new Error('timeout');
        mockDb.failNext('commit', 'contacts_whatsapp/customer/messages');
        return { id: 'accepted' };
    });
    await saveShippingData(form);
    expect(order().shippingDataConfirmationStatus).toBe('review');
    await recoverShippingConfirmations(); await saveShippingData(form);
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('recovery resumes a pending job, but never repeats a send interrupted by restart', async () => {
    mockDb.seed('pedidos/order', { ...order(), shippingDataReceivedAt: new Date(), shippingDataConfirmationStatus: 'pending' });
    await recoverShippingConfirmations();
    expect(mockSend).toHaveBeenCalledTimes(1);
    mockDb.seed('pedidos/order', { ...order(), shippingDataConfirmationStatus: 'sending', shippingDataConfirmationLeaseUntil: new Date(0) });
    await recoverShippingConfirmations();
    expect(order().shippingDataConfirmationStatus).toBe('review');
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test.each([undefined, new Date(Date.now() - 2 * 86400000)])('waits for a customer message when the messaging window is unknown or expired', async lastClientMsgAt => {
    mockDb.seed('contacts_whatsapp/customer', { botActive: false, lastClientMsgAt });
    await saveShippingData(form);
    expect(mockSend).not.toHaveBeenCalled();
    expect(order().shippingDataConfirmationWaitingForCustomer).toBe(true);
    mockDb.seed('contacts_whatsapp/customer', { botActive: false, lastClientMsgAt: new Date() });
    await recoverShippingConfirmations();
    expect(order().shippingDataConfirmationStatus).toBe('sent');
});

test.each(['messenger', 'instagram'])('confirms using the original %s conversation, not the shipping phone number', async channel => {
    mockDb.seed('contacts_whatsapp/customer', { channel, psid: 'original-recipient', botActive: false, lastClientMsgAt: new Date() });
    await saveShippingData({ ...form, telefono: '5555555555' });
    expect(mockMessenger).toHaveBeenCalledWith('original-recipient', { text: expect.stringContaining('DH16978'), channel });
    expect(mockSend).not.toHaveBeenCalled();
});

test('existing message marker prevents a resend even if the order status is pending', async () => {
    mockDb.seed('pedidos/order', { ...order(), shippingDataReceivedAt: new Date(), shippingDataConfirmationStatus: 'pending' });
    mockDb.seed('contacts_whatsapp/customer/messages/shipping_data_order', { timestamp: new Date(), id: 'already-sent' });
    await deliverShippingConfirmation('order');
    expect(mockSend).not.toHaveBeenCalled();
    expect(order().shippingDataConfirmationStatus).toBe('sent');
});
