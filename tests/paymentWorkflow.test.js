const mockDb = require('./helpers/paymentFirestore')();
const mockOcr = jest.fn(), mockSend = jest.fn(), mockMessenger = jest.fn(), mockCancel = jest.fn(), mockDesign = jest.fn();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() }, Timestamp: { fromMillis: n => new Date(n) } } } }));
jest.mock('../server/services', () => ({ extractReceiptData: (...a) => mockOcr(...a), sendAdvancedWhatsAppMessage: (...a) => mockSend(...a), sendMessengerMessage: (...a) => mockMessenger(...a) }));
jest.mock('../server/leads/scheduledReminderScheduler', () => ({ cancelReminderForContact: (...a) => mockCancel(...a) }));
jest.mock('../server/design/designPending', () => ({ recomputeForContact: (...a) => mockDesign(...a) }));
const flow = require('../server/payments/paymentWorkflow');
const { runPaymentSweep } = require('../server/payments/paymentScheduler');
const { DAY, receiptKeys, claimsPayment, validateReceipt } = require('../server/payments/paymentPolicy');
const now = () => Date.now();
const ocr = (extra = {}) => ({ esComprobante: true, monto: 1200, fecha: new Date().toISOString().slice(0, 10), cuentaDestino: '3262', referencia: '12345678', moneda: 'MXN', pagoRealizado: true, imageHash: 'sample-image', ...extra });
const order = () => mockDb.read('pedidos/order');
const job = id => mockDb.read('payment_receipts/' + id);
async function enqueue(id = 'message', extra = {}) {
    return flow.enqueueReceipt('customer', id, { from: 'customer', id, timestamp: new Date(), type: 'image', fileUrl: 'https://test.invalid/receipt.png', fileType: 'image/png', ...extra }, { historical: true });
}
beforeEach(() => {
    mockDb.reset(); jest.clearAllMocks();
    mockDb.seed('pedidos/order', { contactId: 'customer', consecutiveOrderNumber: 16368, precio: 1200, estatus: 'Foto enviada', createdAt: new Date(now() - 6 * DAY) });
    mockDb.seed('contacts_whatsapp/customer', { botActive: false, lastClientMsgAt: new Date() });
    mockOcr.mockReset().mockResolvedValue(ocr()); mockSend.mockReset().mockResolvedValue({ id: 'wamid.1' });
    mockMessenger.mockReset().mockResolvedValue({ messages: [{ id: 'mid.1' }] });
    mockCancel.mockResolvedValue(); mockDesign.mockResolvedValue();
});

test('DH16368: worker processes a receipt five days later with chat IA off', async () => {
    const received = new Date(now() - 5 * DAY);
    const id = await enqueue('old', { timestamp: received });
    mockOcr.mockResolvedValue(ocr({ fecha: received.toISOString().slice(0, 10) }));
    await runPaymentSweep();
    expect(job(id).status).toBe('applied');
    expect(order()).toMatchObject({ paymentReceivedCents: 120000, shippingFormStatus: 'sent' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1].text).toContain('/datos-estafeta/DH16368');
});

test('DH16328: unknown cancellation remains visible and cannot auto-reactivate', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16328, estatus: 'Cancelado' });
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id)).toMatchObject({ status: 'review', open: true });
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect((await flow.pendingPayments()).pago_cancelado).toHaveLength(1);
    expect(mockSend).not.toHaveBeenCalled();
    await flow.processReceipt(id, { manual: true, amount: 1200, reactivate: true });
    expect(order()).toMatchObject({ estatus: 'Pagado', shippingFormStatus: 'sent' });
});

test('only an automatic cancellation reactivates with a verified full payment', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Cancelado', canceladoPorCobranza: true });
    await flow.processReceipt(await enqueue());
    expect(order()).toMatchObject({ estatus: 'Pagado', shippingFormStatus: 'sent' });
});

test('manual review of 300 + 900 reactivates a cancelled order only after both receipts are credited', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Cancelado' });
    mockOcr.mockResolvedValueOnce(ocr({ monto: 300 })).mockResolvedValueOnce(ocr({ monto: 900, referencia: 'other12345678', imageHash: 'remaining' }));
    await flow.processReceipt(await enqueue('deposit'), { manual: true, amount: 300, reactivate: true });
    expect(order()).toMatchObject({ estatus: 'Cancelado', paymentReceivedCents: 30000 });
    expect(mockSend).not.toHaveBeenCalled();
    await flow.processReceipt(await enqueue('remainder'), { manual: true, amount: 900, reactivate: true });
    expect(order()).toMatchObject({ estatus: 'Pagado', paymentReceivedCents: 120000, shippingFormStatus: 'sent' });
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('DH16295: receipt after 20h is not expired, but 2100 versus 1950 requires review', async () => {
    const received = new Date(now() - 20 * 3600000);
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16295, precio: 1950 });
    mockOcr.mockResolvedValue(ocr({ monto: 2100, fecha: received.toISOString().slice(0, 10) }));
    const id = await enqueue('amount-difference', { timestamp: received });
    await flow.processReceipt(id);
    expect(job(id).reason).toMatch(/supera el total/);
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    await flow.processReceipt(id, { manual: true, amount: 2100 });
    expect(order().shippingFormStatus).toBe('sent');
});

test('300 deposit + duplicate + 900 remainder sends exactly one form', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300 }));
    await flow.processReceipt(await enqueue('deposit'));
    expect(order().paymentReceivedCents).toBe(30000);
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    const duplicate = await enqueue('resent-deposit');
    await flow.processReceipt(duplicate);
    expect(job(duplicate).status).toBe('duplicate');
    mockOcr.mockResolvedValue(ocr({ monto: 900, referencia: '87654321', imageHash: 'remaining' }));
    const remainder = await enqueue('remaining');
    await Promise.all([flow.processReceipt(remainder), flow.processReceipt(remainder)]);
    await runPaymentSweep();
    expect(order().paymentReceivedCents).toBe(120000);
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('same transaction photographed again is deduplicated; cannot finance another order', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300 }));
    await flow.processReceipt(await enqueue('deposit'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, imageHash: 'rephotographed' }));
    await flow.processReceipt(await enqueue('rephoto'));
    expect(order().paymentReceivedCents).toBe(30000);
    const id = await enqueue('cross-order');
    mockDb.seed('pedidos/other', { ...order(), paymentReceivedCents: 0, consecutiveOrderNumber: 16369 });
    mockDb.seed('payment_receipts/' + id, { ...job(id), orderId: 'other' });
    await flow.processReceipt(id);
    expect(job(id)).toMatchObject({ status: 'review', open: true });
    expect(mockDb.read('pedidos/other').paymentReceivedCents).toBe(0);
});

test('transient send rejection retains payment and retries without duplicating', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('rate limit'), { response: { status: 429 } }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('applied');
    expect(order()).toMatchObject({ paymentReceivedCents: 120000, shippingFormStatus: 'retry' });
    mockDb.seed('pedidos/order', { ...order(), shippingFormNextAttemptAt: new Date(0) });
    await runPaymentSweep(); await runPaymentSweep();
    expect(order().shippingFormStatus).toBe('sent');
    expect(mockSend).toHaveBeenCalledTimes(2);
});

test.each(['timeout', 'storage-after-ack'])('ambiguous delivery %s goes to manual review without automatic resending', async failure => {
    if (failure === 'timeout') mockSend.mockRejectedValueOnce(new Error('timeout'));
    else mockSend.mockImplementationOnce(async () => { mockDb.failNext('commit', 'payment_form_'); return { id: 'delivered' }; });
    await flow.processReceipt(await enqueue());
    expect(order().comprobanteValidadoAt).toBeTruthy();
    expect(order().shippingFormStatus).toBe('review');
    await runPaymentSweep(); await flow.deliverForm('order');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await flow.pendingPayments()).pago_formulario).toHaveLength(1);
});

test('failed payment transaction never records validation or sends a confirmation', async () => {
    const id = await enqueue();
    mockDb.failNext('update', 'pedidos/order');
    await flow.processReceipt(id);
    expect(job(id).open).toBe(true);
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockDb.all('payment_receipt_keys')).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
});

test('form failure after committed payment cannot reopen or re-credit the receipt', async () => {
    mockOcr.mockImplementationOnce(async () => { mockDb.failNext('get', 'contacts_whatsapp/customer'); return ocr(); });
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('applied');
    expect(order().paymentReceivedCents).toBe(120000);
});

test('closed messaging window keeps form visible and a new inbound message wakes it', async () => {
    mockDb.seed('contacts_whatsapp/customer', { lastClientMsgAt: new Date(now() - 2 * DAY) });
    await flow.processReceipt(await enqueue());
    expect(order().shippingFormStatus).toBe('retry'); expect(mockSend).not.toHaveBeenCalled();
    mockDb.seed('contacts_whatsapp/customer', { lastClientMsgAt: new Date() });
    await runPaymentSweep();
    expect(order().shippingFormStatus).toBe('sent'); expect(mockSend).toHaveBeenCalledTimes(1);
});

test('Messenger acknowledgement also seals and stores form delivery', async () => {
    mockDb.seed('contacts_whatsapp/customer', { channel: 'messenger', psid: 'test-psid', lastClientMsgAt: new Date() });
    await flow.processReceipt(await enqueue());
    expect(order().shippingFormMessageId).toBe('mid.1');
    expect(mockSend).not.toHaveBeenCalled(); expect(mockMessenger).toHaveBeenCalledTimes(1);
});

test('multiple active orders require selecting the exact order and never assume latest paid', async () => {
    mockDb.seed('pedidos/other', { ...order(), consecutiveOrderNumber: 16369, comprobanteValidadoAt: new Date() });
    const p = await flow.paymentContext('customer');
    expect(p).toMatchObject({ ambiguous: true, hasPaid: false });
    expect(await flow.paymentContext('customer', { orderNumber: 'DH16369' })).toMatchObject({ hasPaid: true, orderId: 'other' });
    await expect(flow.manualValidateAndSend('customer', { force: true })).rejects.toThrow(/exacto/);
});

test('two different concurrent deposits sum atomically and send one form', async () => {
    const first = await enqueue('first'), second = await enqueue('second');
    mockDb.seed('payment_receipts/' + first, { ...job(first), ocr: ocr({ monto: 600 }) });
    mockDb.seed('payment_receipts/' + second, { ...job(second), ocr: ocr({ monto: 600, referencia: '87654321', imageHash: 'second' }) });
    await Promise.all([flow.processReceipt(first), flow.processReceipt(second)]);
    expect(order().paymentReceivedCents).toBe(120000); expect(mockSend).toHaveBeenCalledTimes(1);
});

test('approved OXXO provider deposits use the same ledger without requiring an image', async () => {
    await flow.recordProviderPayment('customer', 'DH16368', 300, 'mp-one');
    await flow.recordProviderPayment('customer', 'DH16368', 300, 'mp-one');
    expect(order().paymentReceivedCents).toBe(30000); expect(mockSend).not.toHaveBeenCalled();
    await flow.recordProviderPayment('customer', 'DH16368', 900, 'mp-two');
    expect(order().shippingFormStatus).toBe('sent'); expect(mockOcr).not.toHaveBeenCalled();
});

test.each([{ cuentaDestino: '9999' }, { moneda: 'USD' }, { pagoRealizado: false }, { referencia: null }, { fecha: '2020-01-01' }, { monto: 0 }])('unverifiable receipt remains visible: %j', async changes => {
    mockOcr.mockResolvedValue(ocr(changes));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('review'); expect(mockSend).not.toHaveBeenCalled();
});

test('design image and unpaid reference are not payments', async () => {
    mockOcr.mockResolvedValue(ocr({ esComprobante: false }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('ignored'); expect(order().paymentReceivedCents).toBeUndefined();
});

test.each(['Ya validamos su depósito', 'Gracias por tu pago', 'Tu pedido está liquidado', 'Ya confirmamos la transferencia'])('confirmation guard recognizes %s', text => expect(claimsPayment(text)).toBe(true));
test('stable folio key survives a corrected OCR amount', () => expect(receiptKeys(ocr({ monto: 900 }))[1]).toBe(receiptKeys(ocr())[1]));
test('receipt date is checked against arrival, not the time IA is enabled', () => {
    const received = new Date(now() - 5 * DAY);
    expect(validateReceipt(order(), ocr({ fecha: received.toISOString().slice(0, 10) }), received).status).toBe('valid');
});

let httpServer, api;
beforeAll(async () => {
    const express = require('express'), app = express();
    app.use(express.json()); app.use('/api/payments', require('../server/payments/paymentRoutes'));
    await new Promise(resolve => { httpServer = app.listen(0, '127.0.0.1', resolve); });
    api = 'http://127.0.0.1:' + httpServer.address().port + '/api/payments';
});
afterAll(async () => { await new Promise(resolve => httpServer.close(resolve)); });
async function post(path, body) {
    const r = await fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
}
test('manual review API records a deposit without marking the order fully paid', async () => {
    const id = await enqueue();
    expect((await post(`/receipts/${id}/review`, { amount: 300 })).status).toBe(200);
    expect(order().paymentReceivedCents).toBe(30000); expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
});
test('operator can close an ambiguous delivery after checking the chat without resending', async () => {
    mockDb.seed('pedidos/order', { ...order(), comprobanteValidadoAt: new Date(), shippingFormStatus: 'review' });
    expect((await post('/forms/order/confirm-sent')).status).toBe(200);
    expect(order().shippingFormStatus).toBe('sent'); expect(mockSend).not.toHaveBeenCalled();
});
test('manual API cannot rebind a receipt or approve an invalid amount', async () => {
    const id = await enqueue();
    mockDb.seed('pedidos/other', { ...order(), contactId: 'someone-else' });
    expect((await post(`/receipts/${id}/review`, { amount: 0 })).status).toBe(400);
    expect((await post(`/receipts/${id}/review`, { amount: 1200, orderId: 'other' })).status).toBe(400);
    expect(job(id).open).toBe(true); expect(order().comprobanteValidadoAt).toBeUndefined();
});
test('discard is durable and a rejected receipt cannot later run automatically', async () => {
    const id = await enqueue();
    expect((await post(`/receipts/${id}/review`, { action: 'reject' })).status).toBe(200);
    await runPaymentSweep();
    expect(job(id)).toMatchObject({ status: 'rejected', open: false }); expect(mockSend).not.toHaveBeenCalled();
});
test('unclear OCR classification stays visible instead of being discarded', async () => {
    mockOcr.mockResolvedValue(ocr({ esComprobante: null }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('review');
});
