const mockDb = require('./helpers/paymentFirestore')();
const mockOcr = jest.fn(), mockSend = jest.fn(), mockMessenger = jest.fn(), mockCancel = jest.fn(), mockDesign = jest.fn();
const mockInventory = jest.fn(), mockPurchase = jest.fn();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() }, Timestamp: { fromMillis: n => new Date(n) } } } }));
jest.mock('../server/services', () => ({ extractReceiptData: (...a) => mockOcr(...a), sendAdvancedWhatsAppMessage: (...a) => mockSend(...a), sendMessengerMessage: (...a) => mockMessenger(...a), sendPurchaseEventOnFabricar: (...a) => mockPurchase(...a) }));
jest.mock('../server/inventario/inventarioService', () => ({ descontarInventarioPorPedido: (...a) => mockInventory(...a) }));
jest.mock('../server/leads/scheduledReminderScheduler', () => ({ cancelReminderForContact: (...a) => mockCancel(...a) }));
jest.mock('../server/design/designPending', () => ({ recomputeForContact: (...a) => mockDesign(...a) }));
const flow = require('../server/payments/paymentWorkflow');
const { runPaymentSweep } = require('../server/payments/paymentScheduler');
const { DAY, receiptKeys, claimsPayment, validateReceipt } = require('../server/payments/paymentPolicy');
const now = () => Date.now();
const ocr = (extra = {}) => ({ sourceIdentityVersion: 1, esComprobante: true, monto: 1200, fecha: new Date().toISOString().slice(0, 10), cuentaDestino: '3262', referencia: '12345678', moneda: 'MXN', pagoRealizado: true, imageHash: 'sample-image', ...extra });
const order = () => mockDb.read('pedidos/order');
const job = id => mockDb.read('payment_receipts/' + id);
async function enqueue(id = 'message', extra = {}) {
    return flow.enqueueReceipt('customer', id, { from: 'customer', id, timestamp: new Date(), type: 'image', fileUrl: 'https://test.invalid/receipt.png', fileType: 'image/png', ...extra }, { historical: true });
}
function verifiedPreview(p) {
    return { safetyToken: p.safetyToken, confirmedRisks: p.risks.map(r => r.code),
        bankVerified: true, bankEvidence: 'Folio bancario TEST-12345, ingreso confirmado' };
}
async function reviewedReceipt(id, options) {
    const preview = await flow.previewReceiptReview(id, options);
    return flow.processReceipt(id, { ...options, verification: verifiedPreview(preview) });
}
async function reviewViaApi(id, body) {
    const { data } = await post(`/receipts/${id}/preview`, body);
    expect(data.success).toBe(true);
    return post(`/receipts/${id}/review`, { ...body, verification: verifiedPreview(data.preview) });
}
beforeEach(() => {
    mockDb.reset(); jest.clearAllMocks();
    mockDb.seed('pedidos/order', { contactId: 'customer', consecutiveOrderNumber: 16368, precio: 1200, estatus: 'Foto enviada', createdAt: new Date(now() - 6 * DAY) });
    mockDb.seed('contacts_whatsapp/customer', { botActive: false, lastClientMsgAt: new Date() });
    mockOcr.mockReset().mockResolvedValue(ocr()); mockSend.mockReset().mockResolvedValue({ id: 'wamid.1' });
    mockMessenger.mockReset().mockResolvedValue({ messages: [{ id: 'mid.1' }] });
    mockCancel.mockResolvedValue(); mockDesign.mockResolvedValue();
    mockInventory.mockReset().mockResolvedValue({ ok: true }); mockPurchase.mockReset().mockResolvedValue();
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

test('DH16328: asks shipping data while cancellation remains pending, approval does not resend', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16328, estatus: 'Cancelado' });
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id)).toMatchObject({ status: 'review', open: true });
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect((await flow.pendingPayments()).pago_cancelado).toHaveLength(1);
    expect(order()).toMatchObject({ estatus: 'Cancelado', shippingFormStatus: 'sent', shippingFormRequestedBeforeApproval: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1].text).not.toMatch(/validamos|preparamos el envío/);
    await reviewedReceipt(id, { manual: true, amount: 1200, reactivate: true });
    expect(order()).toMatchObject({ estatus: 'Fabricar', shippingFormStatus: 'sent' });
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('only an automatic cancellation reactivates with a verified full payment', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Cancelado', canceladoPorCobranza: true });
    await flow.processReceipt(await enqueue());
    expect(order()).toMatchObject({ estatus: 'Fabricar', shippingFormStatus: 'sent' });
});

test('manual review of 300 + 900 reactivates a cancelled order only after both receipts are credited', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Cancelado' });
    mockOcr.mockResolvedValueOnce(ocr({ monto: 300 })).mockResolvedValueOnce(ocr({ monto: 900, referencia: 'other12345678', imageHash: 'remaining' }));
    await reviewedReceipt(await enqueue('deposit'), { manual: true, amount: 300, reactivate: true });
    expect(order()).toMatchObject({ estatus: 'Cancelado', paymentReceivedCents: 30000 });
    expect(mockSend).not.toHaveBeenCalled();
    await reviewedReceipt(await enqueue('remainder'), { manual: true, amount: 900, reactivate: true });
    expect(order()).toMatchObject({ estatus: 'Fabricar', paymentReceivedCents: 120000, shippingFormStatus: 'sent' });
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
    expect(mockSend).toHaveBeenCalledTimes(1);
    await reviewedReceipt(id, { manual: true, amount: 2100 });
    expect(order().shippingFormStatus).toBe('sent');
    expect(mockSend).toHaveBeenCalledTimes(1);
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

test('DH16829: a second screenshot cannot turn one $300 deposit into $600 or ask for shipping after $150', async () => {
    mockDb.seed('pedidos/order', { ...order(), precio: 750 });
    mockOcr.mockResolvedValue(ocr({ monto: 300 }));
    await flow.processReceipt(await enqueue('original'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, imageHash: 'second-screen', fecha: null, referencia: null }));
    const copy = await enqueue('other-screen'); await flow.processReceipt(copy);
    const preview = await flow.previewReceiptReview(copy, { amount: 300 });
    expect(preview).toMatchObject({ receivedCents: 30000, afterCents: 60000 });
    expect(preview.risks.map(r => r.code)).toEqual(expect.arrayContaining(['possible_duplicate', 'missing_identity']));
    expect((await post(`/receipts/${copy}/review`, { amount: 300, verification: { safetyToken: preview.safetyToken } })).status).toBe(409);
    expect(order()).toMatchObject({ paymentReceivedCents: 30000, paymentReportedCents: 30000 });
    mockOcr.mockResolvedValue(ocr({ monto: 150, imageHash: 'later-150', referencia: '15012345' }));
    await flow.processReceipt(await enqueue('later-150'));
    expect(order()).toMatchObject({ paymentReceivedCents: 45000, paymentReportedCents: 45000 });
    expect(order().comprobanteValidadoAt).toBeUndefined(); expect(mockSend).not.toHaveBeenCalled();
});

test('DH16722: failed OXXO operation is not credited through ordinary manual approval', async () => {
    mockDb.seed('pedidos/order', { ...order(), precio: 750 });
    mockOcr.mockResolvedValue(ocr({ monto: 312, pagoRealizado: false, referencia: null, imageHash: 'failed-oxxo' }));
    const failed = await enqueue('failed-oxxo'); await flow.processReceipt(failed);
    mockOcr.mockResolvedValue(ocr({ monto: 300, imageHash: 'real-transfer' }));
    await flow.processReceipt(await enqueue('real-transfer'));
    const { data } = await post(`/receipts/${failed}/preview`, { amount: 300 });
    expect(data.preview.risks.map(r => r.code)).toContain('unconfirmed_payment');
    expect((await post(`/receipts/${failed}/review`, { amount: 300 })).status).toBe(409);
    expect((await post(`/receipts/${failed}/review`, { amount: 300, verification: { safetyToken: data.preview.safetyToken } })).status).toBe(409);
    expect(order().paymentReceivedCents).toBe(30000);
    expect(job(failed).status).toBe('review');
    mockOcr.mockResolvedValue(ocr({ monto: 150, imageHash: 'rest', referencia: '15012345' }));
    await flow.processReceipt(await enqueue('rest'));
    expect(order()).toMatchObject({ paymentReceivedCents: 45000, paymentReportedCents: 45000 });
    expect(order().comprobanteValidadoAt).toBeUndefined(); expect(mockSend).not.toHaveBeenCalled();
});

test('a distinct deposit with incomplete evidence requires recorded bank verification, not just checked warnings', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300 }));
    await flow.processReceipt(await enqueue('first'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, referencia: null, imageHash: 'second-distinct' }));
    const second = await enqueue('second-distinct'); await flow.processReceipt(second);
    const preview = await flow.previewReceiptReview(second, { amount: 300 });
    const checked = { safetyToken: preview.safetyToken, confirmedRisks: preview.risks.map(r => r.code) };
    expect((await post(`/receipts/${second}/review`, { amount: 300, verification: checked })).status).toBe(409);
    expect(order().paymentReceivedCents).toBe(30000);
    expect((await reviewViaApi(second, { amount: 300 })).status).toBe(200);
    expect(order().paymentReceivedCents).toBe(60000);
    expect(job(second).manualVerification).toMatchObject({ previousReceivedCents: 30000, bankVerified: true, bankEvidence: expect.stringContaining('TEST-12345') });
});

test('two reviewers with the same old balance cannot both credit payments without a fresh review', async () => {
    const first = await enqueue('first'), second = await enqueue('second');
    mockDb.seed('payment_receipts/' + first, { ...job(first), ocr: ocr({ monto: 300 }) });
    mockDb.seed('payment_receipts/' + second, { ...job(second), ocr: ocr({ monto: 300, referencia: 'second-123', imageHash: 'second' }) });
    const a = await flow.previewReceiptReview(first, { amount: 300 });
    const b = await flow.previewReceiptReview(second, { amount: 300 });
    const results = await Promise.all([
        flow.processReceipt(first, { manual: true, amount: 300, verification: verifiedPreview(a) }),
        flow.processReceipt(second, { manual: true, amount: 300, verification: verifiedPreview(b) })
    ]);
    expect(results.filter(r => r.status === 'partial')).toHaveLength(1);
    expect(order().paymentReceivedCents).toBe(30000);
    const pending = job(first).status === 'review' ? first : second;
    await reviewedReceipt(pending, { manual: true, amount: 300 });
    expect(order().paymentReceivedCents).toBe(60000);
});

test('changing the amount after preview invalidates the approval', async () => {
    const id = await enqueue();
    const preview = await flow.previewReceiptReview(id, { amount: 300 });
    expect((await post(`/receipts/${id}/review`, { amount: 1200, verification: verifiedPreview(preview) })).status).toBe(409);
    expect(order().paymentReceivedCents).toBeUndefined();
});

test('preview shows the ledger without validating money, starting production or sending a form', async () => {
    const id = await enqueue();
    const before = order();
    const preview = await post(`/receipts/${id}/preview`, { amount: 1200 });
    expect(preview.data.preview).toMatchObject({ receivedCents: 0, afterCents: 120000, remainingCents: 0 });
    expect(order()).toEqual(before); expect(job(id).status).toBe('pending');
    expect(mockSend).not.toHaveBeenCalled(); expect(mockInventory).not.toHaveBeenCalled();
});

test('multiple ambiguous screenshots never inflate reported payment or trigger an early shipping form', async () => {
    mockDb.seed('pedidos/order', { ...order(), precio: 750 });
    mockOcr.mockResolvedValue(ocr({ monto: 450, referencia: null, fecha: null }));
    await flow.processReceipt(await enqueue('screen1'));
    mockOcr.mockResolvedValue(ocr({ monto: 450, referencia: null, fecha: null, imageHash: 'screen2' }));
    await flow.processReceipt(await enqueue('screen2'));
    expect(order().paymentReportedCents).toBe(45000);
    expect(mockSend).not.toHaveBeenCalled();
});

test('deduplication indexes both the bank reference and tracking code', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, claveRastreo: 'tracking123' }));
    await flow.processReceipt(await enqueue('full'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, imageHash: 'only-reference' }));
    const duplicate = await enqueue('only-reference'); await flow.processReceipt(duplicate);
    expect(job(duplicate).status).toBe('duplicate'); expect(order().paymentReceivedCents).toBe(30000);
});

function seedOtherPayment(reading) {
    mockDb.seed('pedidos/other', { contactId: 'other-customer', consecutiveOrderNumber: 16915, precio: reading.monto,
        paymentReceivedCents: Math.round(reading.monto * 100), comprobanteValidadoAt: new Date() });
    mockDb.seed('payment_receipts/other-paid', { contactId: 'other-customer', orderId: 'other', status: 'applied',
        orderNumber: 'DH16915', open: false, amountCents: Math.round(reading.monto * 100), ocr: reading });
    // Índices del despliegue anterior, sin el nuevo campo identity.
    for (const key of receiptKeys(reading)) mockDb.seed('payment_receipt_keys/' + key, {
        orderId: 'other', receiptId: 'other-paid', amountCents: Math.round(reading.monto * 100),
    });
}

test('DH17033: date reference shared with DH17032 allows a different source account', async () => {
    mockDb.seed('pedidos/order', { ...order(), precio: 750, consecutiveOrderNumber: 17033 });
    seedOtherPayment(ocr({ monto: 750, referencia: '2109260', cuentaOrigen: '****1234', imageHash: 'first', claveRastreo: 'tracking-first' }));
    mockOcr.mockResolvedValue(ocr({ monto: 750, referencia: '2109260', cuentaOrigen: '****5678', imageHash: 'second', claveRastreo: null }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('applied');
    expect(order().paymentReceivedCents).toBe(75000);
    expect(mockDb.read('pedidos/other').paymentReceivedCents).toBe(75000);
});

test('shared reference retains the second source identity and blocks another photo of that payment', async () => {
    seedOtherPayment(ocr({ monto: 300, cuentaOrigen: '****1234', imageHash: 'other' }));
    mockOcr.mockResolvedValue(ocr({ monto: 300, cuentaOrigen: '****5678', imageHash: 'second' }));
    await flow.processReceipt(await enqueue('second'));
    expect(order().paymentReceivedCents).toBe(30000);
    mockOcr.mockResolvedValue(ocr({ monto: 300, cuentaOrigen: '001122335678', imageHash: 'second-rephoto' }));
    const copy = await enqueue('copy'); await flow.processReceipt(copy);
    expect(job(copy).status).toBe('duplicate');
    expect(order().paymentReceivedCents).toBe(30000);
    mockDb.seed('pedidos/third', { contactId: 'customer', consecutiveOrderNumber: 17034, precio: 1200, estatus: 'Foto enviada', createdAt: new Date() });
    const third = await enqueue('third');
    mockDb.seed('payment_receipts/' + third, { ...job(third), orderId: 'third' });
    await flow.processReceipt(third);
    expect(job(third).reason).toContain('otro pedido');
    expect(mockDb.read('pedidos/third').paymentReceivedCents).toBeUndefined();
});

test('two installments from distinct sources count without a possible duplicate alert', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, cuentaOrigen: '****1234', imageHash: 'first' }));
    await flow.processReceipt(await enqueue('first'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, cuentaOrigen: '****5678', imageHash: 'second' }));
    const id = await enqueue('second');
    const preview = await flow.previewReceiptReview(id, { amount: 300 });
    expect(preview.risks).toEqual([]);
    await flow.processReceipt(id, { manual: true, amount: 300, verification: verifiedPreview(preview) });
    expect(order()).toMatchObject({ paymentReceivedCents: 60000, paymentReportedCents: 60000 });
});

test.each(['same-image', 'same-tracking', 'missing-source', 'same-suffix', 'short-source'])('source comparison preserves duplicate protection: %s', async kind => {
    const first = ocr({ cuentaOrigen: '001122331234', claveRastreo: 'tracking-first' });
    seedOtherPayment(first);
    mockOcr.mockResolvedValue(ocr({
        cuentaOrigen: kind === 'missing-source' ? null : kind === 'same-suffix' ? '****1234' : kind === 'short-source' ? '**678' : '****5678',
        imageHash: kind === 'same-image' ? first.imageHash : 'second',
        claveRastreo: kind === 'same-tracking' ? first.claveRastreo : null,
    }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).reason).toContain('otro pedido');
    expect((await reviewViaApi(id, { amount: 1200 })).status).toBe(409);
    expect(order().paymentReceivedCents).toBeUndefined();
});

test('manual preview enriches legacy source accounts without changing historical payment or OCR amounts', async () => {
    const first = ocr({ monto: 750, imageHash: 'first', sourceIdentityVersion: undefined });
    seedOtherPayment(first);
    mockDb.seed('payment_receipts/other-paid', { ...job('other-paid'), fileUrl: 'https://test.invalid/old.png' });
    // The previous index schema stored tracking only.
    for (const key of receiptKeys(first)) {
        const path = 'payment_receipt_keys/' + key;
        mockDb.seed(path, { ...mockDb.read(path), identity: { claveRastreo: null } });
    }
    const id = await enqueue();
    mockDb.seed('payment_receipts/' + id, { ...job(id), status: 'review', ocr: ocr({ imageHash: 'second', sourceIdentityVersion: undefined }) });
    mockOcr.mockImplementation(async url => ocr({ monto: 9999, cuentaOrigen: url.endsWith('old.png') ? '****1234' : '****5678', imageHash: url.endsWith('old.png') ? 'first' : 'second' }));
    const result = await reviewViaApi(id, { amount: 1200 });
    expect(result.status).toBe(200);
    expect(job(id).status).toBe('applied');
    expect(order().paymentReceivedCents).toBe(120000);
    expect(job('other-paid')).toMatchObject({ status: 'applied', amountCents: 75000, ocr: { monto: 750, cuentaOrigen: '****1234' } });
    expect(mockDb.read('pedidos/other').paymentReceivedCents).toBe(75000);
    expect(mockOcr).toHaveBeenCalledTimes(2);
});

test('DH16798: shared bank reference with DH16915 cannot block a distinct tracking code', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16798, shippingFormStatus: 'sent', shippingFormSentAt: new Date() });
    const first = ocr({ monto: 750, cuentaDestino: '***670', referencia: '0690670', claveRastreo: '2609180110389829782H', imageHash: 'first-transfer' });
    seedOtherPayment(first);
    const originalKeys = mockDb.all('payment_receipt_keys');
    mockOcr.mockResolvedValue(ocr({ cuentaDestino: '***670', referencia: '0690670', claveRastreo: '2609180110779917031', imageHash: 'second-transfer' }));
    const id = await enqueue();
    await flow.processReceipt(id);
    expect(job(id).status).toBe('review'); // la cuenta abreviada aún requiere revisión manual
    expect(order()).toMatchObject({ paymentReportedCents: 120000, paymentReportedComplete: true });
    expect(order().paymentReceivedCents).toBeUndefined();
    expect((await reviewViaApi(id, { amount: 1200 })).status).toBe(200);
    expect(order().paymentReceivedCents).toBe(120000);
    expect(job(id).status).toBe('applied');
    expect(mockDb.read('pedidos/other').paymentReceivedCents).toBe(75000);
    for (const { path, ...value } of originalKeys) expect(mockDb.read(path)).toEqual(value);
    expect(mockSend).not.toHaveBeenCalled();
});

test('same-amount installments with a shared reference but different tracking codes both count', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, claveRastreo: 'tracking-first', imageHash: 'first-deposit' }));
    await flow.processReceipt(await enqueue('first-deposit'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, claveRastreo: 'tracking-second', imageHash: 'second-deposit' }));
    const id = await enqueue('second-deposit');
    await flow.processReceipt(id);
    expect(job(id).status).toBe('applied');
    expect(order()).toMatchObject({ paymentReceivedCents: 60000, paymentReportedCents: 60000 });
    // Otra captura de ese segundo ingreso sigue bloqueada aunque su referencia cambie.
    mockOcr.mockResolvedValue(ocr({ monto: 300, referencia: 'other-reference', claveRastreo: 'tracking-second', imageHash: 'second-deposit-copy' }));
    const copy = await enqueue('second-deposit-copy'); await flow.processReceipt(copy);
    expect(job(copy).status).toBe('duplicate');
    expect(order().paymentReceivedCents).toBe(60000);
});

test('two unapproved transfers with different tracking codes are not grouped by their shared reference', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, cuentaDestino: '***670', claveRastreo: 'first-tracking', imageHash: 'first-pending' }));
    await flow.processReceipt(await enqueue('first-pending'));
    mockOcr.mockResolvedValue(ocr({ monto: 900, cuentaDestino: '***670', claveRastreo: 'second-tracking', imageHash: 'second-pending' }));
    await flow.processReceipt(await enqueue('second-pending'));
    expect(order()).toMatchObject({ paymentReportedCents: 120000, paymentReportedComplete: true, shippingFormStatus: 'sent' });
    expect(order().paymentReceivedCents).toBeUndefined();
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test.each(['same-image', 'same-tracking', 'missing-tracking'])('true or uncertain duplicate %s stays blocked across orders', async match => {
    const first = ocr({ monto: 750, claveRastreo: 'tracking-first' });
    seedOtherPayment(first);
    mockOcr.mockResolvedValue(ocr({ monto: 1200,
        claveRastreo: match === 'same-tracking' ? 'tracking-first' : match === 'missing-tracking' ? null : 'tracking-second',
        imageHash: match === 'same-image' ? first.imageHash : 'different-image' }));
    const id = await enqueue();
    await flow.processReceipt(id);
    expect(job(id)).toMatchObject({ status: 'review', reason: expect.stringContaining('otro pedido') });
    expect(order().paymentReceivedCents).toBeUndefined();
    expect(order().paymentReportedCents).toBe(0);
    expect((await reviewViaApi(id, { amount: 1200 })).status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
});

test('reference-only legacy owner remains a conflict even if the new image includes tracking', async () => {
    seedOtherPayment(ocr({ monto: 750 }));
    mockOcr.mockResolvedValue(ocr({ claveRastreo: 'new-tracking', imageHash: 'new-image' }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id)).toMatchObject({ status: 'review', reason: expect.stringContaining('otro pedido') });
    expect(order().paymentReceivedCents).toBeUndefined();
});

test('automatic processing holds a complete receipt if a partial screenshot was already credited', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, referencia: null, fecha: null, imageHash: 'partial-screen' }));
    await reviewedReceipt(await enqueue('partial-screen'), { manual: true, amount: 300 });
    mockOcr.mockResolvedValue(ocr({ monto: 300, imageHash: 'full-receipt' }));
    const duplicate = await enqueue('full-receipt'); await flow.processReceipt(duplicate);
    expect(job(duplicate)).toMatchObject({ status: 'review', reason: expect.stringContaining('Posible comprobante repetido') });
    expect(order().paymentReceivedCents).toBe(30000); expect(mockSend).not.toHaveBeenCalled();
});

test('a failed attempt of the same amount does not prevent crediting a later successful transfer', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, pagoRealizado: false, referencia: null, imageHash: 'failed' }));
    await flow.processReceipt(await enqueue('failed'));
    mockOcr.mockResolvedValue(ocr({ monto: 300, imageHash: 'successful' }));
    await flow.processReceipt(await enqueue('successful'));
    expect(order().paymentReceivedCents).toBe(30000);
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

test('failed payment transaction does not validate but still asks for shipping data', async () => {
    const id = await enqueue();
    mockDb.failNext('update', 'pedidos/order');
    await flow.processReceipt(id);
    expect(job(id).open).toBe(true);
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockDb.all('payment_receipt_keys')).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1].text).not.toMatch(/validamos tu pago/);
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

test('selects the single unpaid order instead of an older paid order; multiple unpaid remain ambiguous', async () => {
    mockDb.seed('pedidos/other', { ...order(), consecutiveOrderNumber: 16369, comprobanteValidadoAt: new Date() });
    const p = await flow.paymentContext('customer');
    expect(p).toMatchObject({ ambiguous: false, hasPaid: false, orderId: 'order' });
    expect(await flow.paymentContext('customer', { orderNumber: 'DH16369' })).toMatchObject({ hasPaid: true, orderId: 'other' });
    await expect(flow.manualValidateAndSend('customer', { force: true })).rejects.toThrow(/exacto/);
    mockDb.seed('pedidos/third', { ...order(), consecutiveOrderNumber: 16370 });
    expect(await flow.paymentContext('customer')).toMatchObject({ ambiguous: true, hasPaid: false });
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

test.each([{ moneda: 'USD' }, { pagoRealizado: false }, { monto: 0 }])('receipt without a usable paid amount remains pending without a form: %j', async changes => {
    mockOcr.mockResolvedValue(ocr(changes));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('review'); expect(mockSend).not.toHaveBeenCalled();
});

test.each([{ cuentaDestino: '9999' }, { referencia: null }, { fecha: null, referencia: null }, { fecha: '2020-01-01' }])('full reported amount asks data while preserving payment review: %j', async changes => {
    mockOcr.mockResolvedValue(ocr(changes));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('review');
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(order()).toMatchObject({ paymentReportedComplete: true, shippingFormStatus: 'sent' });
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('pending 300 + repeated 300 + 900 asks once, approvals do not double count or resend', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300, fecha: null, referencia: null }));
    const first = await enqueue('deposit'); await flow.processReceipt(first);
    await flow.processReceipt(await enqueue('repeated'));
    expect(order().paymentReportedCents).toBe(30000); expect(mockSend).not.toHaveBeenCalled();
    mockOcr.mockResolvedValue(ocr({ monto: 900, fecha: null, referencia: null, imageHash: 'remaining' }));
    const second = await enqueue('remaining'); await flow.processReceipt(second);
    expect(order()).toMatchObject({ paymentReportedCents: 120000, paymentReportedComplete: true, shippingFormStatus: 'sent' });
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(await flow.paymentContext('customer')).toMatchObject({ hasPaid: false, reportedComplete: true, formSent: true });
    await reviewedReceipt(first, { manual: true, amount: 300 });
    expect(order().paymentReportedCents).toBe(120000);
    await reviewedReceipt(second, { manual: true, amount: 900 });
    expect(order().paymentReceivedCents).toBe(120000);
    expect(order().comprobanteValidadoAt).toBeTruthy();
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('approved deposit plus pending remainder counts each payment once', async () => {
    mockOcr.mockResolvedValue(ocr({ monto: 300 }));
    await flow.processReceipt(await enqueue('deposit'));
    mockOcr.mockResolvedValue(ocr({ monto: 900, referencia: null, imageHash: 'remaining' }));
    await flow.processReceipt(await enqueue('remaining'));
    expect(order()).toMatchObject({ paymentReceivedCents: 30000, paymentReportedCents: 120000, shippingFormStatus: 'sent' });
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('a receipt credited to another order cannot trigger a preapproval form', async () => {
    const id = await enqueue();
    mockDb.seed('payment_receipt_keys/' + receiptKeys(ocr())[0], { orderId: 'other' });
    await flow.processReceipt(id);
    expect(job(id).status).toBe('review');
    expect(order().paymentReportedComplete).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
});

test('scheduler recovers preapproval data request after interrupted assessment', async () => {
    const id = await enqueue();
    mockDb.seed('payment_receipts/' + id, { ...job(id), status: 'review', ocr: ocr({ fecha: null }) });
    mockDb.seed('pedidos/order', { ...order(), paymentFormNeedsAssessment: true });
    await runPaymentSweep(); await runPaymentSweep();
    expect(order()).toMatchObject({ paymentFormNeedsAssessment: false, shippingFormStatus: 'sent' });
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('shipping data submission keeps cancellation and payment approval separate', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Cancelado' });
    await flow.processReceipt(await enqueue());
    await flow.recordShippingDataForOrder('DH16368');
    expect(order().shippingDataReceivedAt).toBeTruthy();
    expect(order().estatus).toBe('Cancelado');
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockDesign).not.toHaveBeenCalled();
    expect((await flow.pendingPayments()).pago_cancelado[0]).toMatchObject({ formSent: true, shippingDataReceived: true });
});

test('legacy manual approval preserves an already sent preapproval form', async () => {
    mockOcr.mockResolvedValue(ocr({ fecha: null }));
    await flow.processReceipt(await enqueue());
    await flow.manualValidateAndSend('customer', { orderNumber: 'DH16368', force: true });
    expect(order().comprobanteValidadoAt).toBeTruthy();
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('rejecting a receipt before the messaging window reopens removes form eligibility', async () => {
    mockDb.seed('contacts_whatsapp/customer', { lastClientMsgAt: new Date(now() - 2 * DAY) });
    mockOcr.mockResolvedValue(ocr({ fecha: null }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(order()).toMatchObject({ paymentReportedComplete: true, shippingFormStatus: 'retry' });
    expect((await post(`/receipts/${id}/review`, { action: 'reject' })).status).toBe(200);
    mockDb.seed('contacts_whatsapp/customer', { lastClientMsgAt: new Date() });
    await runPaymentSweep();
    expect(order().paymentReportedComplete).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
});

test('design image and unpaid reference are not payments', async () => {
    mockOcr.mockResolvedValue(ocr({ esComprobante: false }));
    const id = await enqueue(); await flow.processReceipt(id);
    expect(job(id).status).toBe('ignored'); expect(order().paymentReceivedCents).toBeUndefined();
});

test('DH16475: an old failed OXXO ticket is closed and does not reappear when history is recovered', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16475, precio: 750, estatus: 'Cancelado' });
    const received = new Date(now() - 5 * DAY);
    const message = { from: 'customer', id: 'old-failure', timestamp: received, type: 'image', fileUrl: 'https://test.invalid/receipt.png' };
    mockDb.seed('contacts_whatsapp/customer/messages/old-failure', message);
    mockOcr.mockResolvedValue(ocr({ monto: null, fecha: received.toISOString().slice(0, 10), pagoRealizado: false,
        estadoOperacion: 'rechazado', evidenciaEstado: 'TRANSACCION NO REALIZADA POR HABER EXCEDIDO SU LIMITE PERMITIDO', outcomeVersion: 1 }));
    flagReceipt();
    await flow.discoverReceipts('customer'); await runPaymentSweep();
    const [receipt] = mockDb.all('payment_receipts');
    expect(receipt).toMatchObject({ status: 'rejected', open: false, rejectionKind: 'failed_operation' });
    expect((await flow.pendingPayments()).pago_revision).toHaveLength(0);
    expect(order()).toMatchObject({ estatus: 'Cancelado', paymentReportedCents: 0 });
    expect(order().paymentReceivedCents).toBeUndefined(); expect(mockSend).not.toHaveBeenCalled();
    flagReceipt(); // Una respuesta atrasada de la IA no resucita la alerta.
    await flow.discoverReceipts('customer'); await runPaymentSweep();
    expect((await flow.pendingPayments()).pago_revision).toHaveLength(0);
    expect(mockDb.all('payment_receipts')).toHaveLength(1); expect(mockOcr).toHaveBeenCalledTimes(1);
});

test('a failed ticket sent with a new message ID remains closed even if its next OCR is ambiguous', async () => {
    mockOcr.mockResolvedValue(ocr({ pagoRealizado: false, estadoOperacion: 'rechazado', evidenciaEstado: 'La transaccion no fue realizada', outcomeVersion: 1 }));
    await flow.processReceipt(await enqueue('failed'));
    mockOcr.mockResolvedValue(ocr({ pagoRealizado: false, estadoOperacion: 'desconocido', outcomeVersion: 1 }));
    const copy = await enqueue('resend', { fileUrl: 'https://test.invalid/resent.png' });
    await flow.processReceipt(copy);
    expect(job(copy)).toMatchObject({ status: 'rejected', rejectionKind: 'failed_operation' });
    expect((await flow.pendingPayments()).pago_revision).toHaveLength(0); expect(mockSend).not.toHaveBeenCalled();
});

test('old false-only OCR is reread once, closes explicit failure and preserves genuinely pending payments', async () => {
    const failed = await enqueue('old-failure'), pending = await enqueue('old-pending', { fileUrl: 'https://test.invalid/pending.png' });
    mockDb.seed('payment_receipts/' + failed, { ...job(failed), status: 'review', ocr: ocr({ monto: null, pagoRealizado: false }) });
    mockDb.seed('payment_receipts/' + pending, { ...job(pending), status: 'review', ocr: ocr({ monto: 300, pagoRealizado: false, imageHash: 'pending' }) });
    mockOcr.mockImplementation(url => Promise.resolve(ocr(url.endsWith('/pending.png')
        ? { monto: 300, pagoRealizado: false, imageHash: 'pending', estadoOperacion: 'en_proceso', evidenciaEstado: 'En proceso', outcomeVersion: 1 }
        : { monto: null, pagoRealizado: false, estadoOperacion: 'rechazado', evidenciaEstado: 'Transaccion no realizada', outcomeVersion: 1 })));
    await runPaymentSweep(); await runPaymentSweep();
    expect(job(failed).status).toBe('rejected'); expect(job(pending).status).toBe('review');
    expect(mockOcr).toHaveBeenCalledTimes(2); expect(mockSend).not.toHaveBeenCalled();
    expect(order().paymentReceivedCents).toBeUndefined();
});

test('an unsuccessful historical reclassification keeps the item for review and backs off', async () => {
    const id = await enqueue();
    mockDb.seed('payment_receipts/' + id, { ...job(id), status: 'review', ocr: ocr({ pagoRealizado: false }) });
    mockOcr.mockRejectedValue(new Error('OCR unavailable'));
    await runPaymentSweep(); await runPaymentSweep();
    expect(job(id)).toMatchObject({ status: 'review', open: true, failureReviewAttempts: 1 });
    expect(mockOcr).toHaveBeenCalledTimes(1); expect(mockSend).not.toHaveBeenCalled();
});

test('rereading cannot undo an approval made by another operator', async () => {
    const id = await enqueue();
    mockDb.seed('payment_receipts/' + id, { ...job(id), status: 'review', ocr: ocr({ pagoRealizado: false }) });
    mockOcr.mockImplementation(async () => {
        mockDb.seed('payment_receipts/' + id, { ...job(id), status: 'applied', open: false, amountCents: 30000 });
        mockDb.seed('pedidos/order', { ...order(), paymentReceivedCents: 30000 });
        return ocr({ pagoRealizado: false, estadoOperacion: 'rechazado', evidenciaEstado: 'Transaccion no realizada', outcomeVersion: 1 });
    });
    await runPaymentSweep();
    expect(job(id).status).toBe('applied'); expect(order().paymentReceivedCents).toBe(30000);
});

test('preview archives an explicit failed receipt instead of allowing manual credit', async () => {
    mockOcr.mockResolvedValue(ocr({ pagoRealizado: false, estadoOperacion: 'rechazado', evidenciaEstado: 'Operacion rechazada', outcomeVersion: 1 }));
    const id = await enqueue();
    const response = await post(`/receipts/${id}/preview`, { amount: 300 });
    expect(response.status).toBe(409); expect(response.data.message).toContain('operación fallida');
    expect(job(id).status).toBe('rejected'); expect(order().paymentReceivedCents).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
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
    expect((await reviewViaApi(id, { amount: 300 })).status).toBe(200);
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

test.each([[16832, 3000, 1200], [16814, 1500, 500]])('DH%s: approved deposit starts production with IA off and no shipping form', async (number, total, deposit) => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: number, precio: total, estatus: 'Sin estatus' });
    mockOcr.mockResolvedValue(ocr({ monto: deposit }));
    await enqueue(); await runPaymentSweep(); await runPaymentSweep();
    expect(order()).toMatchObject({ estatus: 'Fabricar', paymentReceivedCents: deposit * 100, paymentProductionStatus: 'done', paymentProductionPending: false });
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled(); expect(mockInventory).toHaveBeenCalledTimes(1);
    expect(mockPurchase).toHaveBeenCalledTimes(1);
});

test('DH16821: transfer in progress stays outside mockups until operator confirms its $300', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16821, precio: 750, estatus: 'Sin estatus' });
    mockDb.seed('contacts_whatsapp/customer', { lastClientMsgAt: new Date(), suspiciousReceiptPending: true, suspiciousReceipt: { imageUrl: 'https://test.invalid/receipt.png' } });
    mockOcr.mockResolvedValue(ocr({ monto: 300, pagoRealizado: false }));
    const id = await enqueue(); await runPaymentSweep();
    expect(order()).toMatchObject({ estatus: 'Esperando anticipo', paymentProductionStatus: 'review' });
    expect(job(id).reason).toMatch(/en proceso/);
    expect(mockInventory).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled();
    expect((await reviewViaApi(id, { amount: 300, orderId: 'order' })).status).toBe(200);
    expect(order()).toMatchObject({ estatus: 'Fabricar', paymentReceivedCents: 30000, paymentProductionStatus: 'done' });
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
});

test('DH16816: approved full payment recovers production without resending an existing form', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16816, estatus: 'Sin estatus', paymentReceivedCents: 120000, comprobanteValidadoAt: new Date(), shippingFormSentAt: new Date(), shippingFormStatus: 'sent' });
    mockDb.seed('datos_envio/address', { numeroPedido: 'DH16816' });
    const result = await post('/orders/order/reconcile', {});
    expect(result.status).toBe(200);
    expect(order()).toMatchObject({ estatus: 'Fabricar', paymentProductionStatus: 'done' });
    expect(mockSend).not.toHaveBeenCalled();
});

test('full payment starts production and sends exactly one form, independently of /datoscompletos', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Sin estatus' });
    await flow.processReceipt(await enqueue());
    await flow.recordShippingDataForOrder('DH16368');
    expect(order()).toMatchObject({ estatus: 'Fabricar', shippingFormStatus: 'sent', paymentProductionStatus: 'done' });
    expect(mockSend).toHaveBeenCalledTimes(1); expect(mockInventory).toHaveBeenCalledTimes(1);
});

test.each(['Foto enviada', 'Diseñado por IA', 'Corregir', 'Entregado', 'Cancelado'])('recovery preserves more advanced or blocked status %s', async estatus => {
    mockDb.seed('pedidos/order', { ...order(), estatus, paymentReceivedCents: 30000 });
    await post('/orders/order/reconcile', {});
    expect(order().estatus).toBe(estatus); expect(mockInventory).not.toHaveBeenCalled();
});

test('captured address never approves a legacy unpaid order or starts manufacturing', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Sin estatus' });
    await flow.recordShippingDataForOrder('DH16368');
    expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(order().estatus).toBe('Sin estatus'); expect(mockInventory).not.toHaveBeenCalled();
});

test('production failure is recovered from durable queue without crediting payment or sending messages again', async () => {
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Sin estatus' });
    mockOcr.mockResolvedValue(ocr({ monto: 300 }));
    mockInventory.mockRejectedValueOnce(new Error('unavailable'));
    await flow.processReceipt(await enqueue());
    expect(order()).toMatchObject({ paymentProductionStatus: 'retry', paymentProductionPending: true, paymentReceivedCents: 30000 });
    mockDb.seed('pedidos/order', { ...order(), paymentProductionNextAttemptAt: new Date(0) });
    await runPaymentSweep(); await runPaymentSweep();
    expect(order()).toMatchObject({ paymentProductionStatus: 'done', paymentProductionPending: false, paymentReceivedCents: 30000 });
    expect(mockInventory).toHaveBeenCalledTimes(2); expect(mockPurchase).toHaveBeenCalledTimes(1); expect(mockSend).not.toHaveBeenCalled();
});

test('DH16832: registration completes before looking up payment, leaving the earlier purchase intact', async () => {
    const previous = { ...order(), consecutiveOrderNumber: 14728, comprobanteValidadoAt: new Date(now() - DAY), shippingFormSentAt: new Date(now() - DAY), estatus: 'Pagado' };
    mockDb.seed('pedidos/order', previous);
    mockDb.seed('contacts_whatsapp/customer/messages/new-receipt', { from: 'customer', type: 'image', timestamp: new Date(), fileUrl: 'https://test.invalid/receipt.png' });
    mockOcr.mockResolvedValue(ocr({ monto: 1200 }));
    const result = await require('../server/payments/paymentConversation').preparePaymentTurn('customer', { register: async () => {
        await Promise.resolve();
        mockDb.seed('pedidos/new', { contactId: 'customer', consecutiveOrderNumber: 16832, precio: 3000, estatus: 'Sin estatus', createdAt: new Date() });
        return 'DH16832';
    } });
    expect(result.context).toMatchObject({ orderId: 'new', hasPaid: false, partialCents: 120000, productionStatus: 'Fabricar' });
    expect(order()).toEqual(previous); expect(mockSend).not.toHaveBeenCalled();
});

test('failed new registration or explicit new-order intent cannot borrow the previous paid order', async () => {
    mockDb.seed('pedidos/order', { ...order(), comprobanteValidadoAt: new Date(now() - DAY) });
    const result = await require('../server/payments/paymentConversation').preparePaymentTurn('customer', { register: async () => null });
    expect(result.context).toMatchObject({ registrationPending: true, hasPaid: false });
    expect(await flow.paymentContext('customer', { newOrderIntent: true })).toMatchObject({ hasPaid: false, registrationPending: true });
});

test('DH16809: a later image and subsequent complaint keep the validated payment and do not resend the form', async () => {
    mockDb.seed('pedidos/order', { ...order(), consecutiveOrderNumber: 16809, estatus: 'Pagado',
        paymentReceivedCents: 120000, comprobanteValidadoAt: new Date(now() - 3 * 3600000),
        shippingFormSentAt: new Date(now() - 4 * 3600000), shippingFormStatus: 'sent' });
    mockDb.seed('contacts_whatsapp/customer/messages/resent-image', { from: 'customer', type: 'image', timestamp: new Date(), fileUrl: 'https://test.invalid/resent.png' });
    const conversation = require('../server/payments/paymentConversation');
    const { context } = await conversation.preparePaymentTurn('customer');
    expect(context).toMatchObject({ hasPaid: true, partialCents: 120000, orderNumber: 'DH16809', formSent: true });
    const reply = conversation.paymentReply(context, { customerText: 'Esque ya no entiedo me mandan y me mandar que page',
        aiText: 'Para registrar el pago necesitamos la foto o el PDF del comprobante.' });
    expect(reply[0]).toContain('DH16809'); expect(reply[0]).toContain('ya está registrado');
    expect(mockSend).not.toHaveBeenCalled(); expect(order().paymentReceivedCents).toBe(120000);
});

test('a new-order request stays separate on following turns until the new order is registered', async () => {
    mockDb.seed('pedidos/order', { ...order(), comprobanteValidadoAt: new Date(now() - DAY) });
    const since = new Date(now() - 1000);
    mockDb.seed('contacts_whatsapp/customer', { paymentNewOrderRequestedAt: since });
    expect(await flow.paymentContext('customer')).toMatchObject({ hasPaid: false, registrationPending: true });
    mockDb.seed('pedidos/new', { contactId: 'customer', consecutiveOrderNumber: 19000, precio: 750, estatus: 'Sin estatus', createdAt: new Date() });
    expect(await flow.paymentContext('customer')).toMatchObject({ hasPaid: false, registrationPending: false, orderId: 'new' });
    expect(await flow.paymentContext('customer', { orderNumber: 'DH16368' })).toMatchObject({ hasPaid: true, orderId: 'order' });
});

test('two paid orders remain ambiguous after resending a receipt; the explicit number selects only its payment', async () => {
    mockDb.seed('pedidos/order', { ...order(), comprobanteValidadoAt: new Date(now() - DAY) });
    mockDb.seed('pedidos/other', { ...order(), consecutiveOrderNumber: 19000 });
    expect(await flow.paymentContext('customer')).toMatchObject({ ambiguous: true, hasPaid: false });
    expect(await flow.paymentContext('customer', { orderNumber: 'DH19000' })).toMatchObject({ hasPaid: true, orderId: 'other' });
    expect(await flow.paymentContext('customer', { orderNumber: 'DH99999' })).toMatchObject({ ambiguous: true, hasPaid: false });
});

test('a paid active order does not lose its payment by age, and an explicitly named delivered order remains paid', async () => {
    mockDb.seed('pedidos/order', { ...order(), createdAt: new Date(now() - 60 * DAY), comprobanteValidadoAt: new Date(now() - 50 * DAY) });
    expect(await flow.paymentContext('customer')).toMatchObject({ hasPaid: true, orderId: 'order' });
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Entregado' });
    expect(await flow.paymentContext('customer', { orderNumber: 'DH16368' })).toMatchObject({ hasPaid: true, orderId: 'order' });
});

test('simultaneous production workers hold a single claim, and a stale claim is recovered', async () => {
    const production = require('../server/payments/paymentProduction');
    mockDb.seed('pedidos/order', { ...order(), estatus: 'Sin estatus', paymentReceivedCents: 30000, paymentProductionPending: true });
    await Promise.all([production.reconcilePaymentProduction('order'), production.reconcilePaymentProduction('order')]);
    expect(mockInventory).toHaveBeenCalledTimes(1); expect(mockPurchase).toHaveBeenCalledTimes(1);
    mockDb.seed('pedidos/order', { ...order(), paymentProductionPending: true, paymentProductionStatus: 'processing', paymentProductionLeaseUntil: new Date(0) });
    await runPaymentSweep();
    expect(order()).toMatchObject({ paymentProductionPending: false, paymentProductionStatus: 'done' });
});

test('deposit for a new order does not clear an unrelated suspicious receipt', async () => {
    mockDb.seed('contacts_whatsapp/customer', { suspiciousReceiptPending: true, suspiciousReceipt: { imageUrl: 'https://test.invalid/different.png' } });
    await reviewedReceipt(await enqueue(), { manual: true, amount: 300 });
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(true);
});

function flagReceipt(extra = {}) {
    const suspiciousReceipt = { imageUrl: 'https://test.invalid/receipt.png', fileType: 'image/png',
        orderNumber: 'DH16368', at: new Date(), reason: 'Falta el folio', cotejo: { status: 'partial', monto: 300 }, ...extra };
    mockDb.seed('contacts_whatsapp/customer', { ...mockDb.read('contacts_whatsapp/customer'), suspiciousReceiptPending: true, suspiciousReceipt });
}

test('unified review shows one card per image, keeps AI reason and does not merge different deposits', async () => {
    const id = await enqueue(); await enqueue('same-image');
    await enqueue('different', { fileUrl: 'https://test.invalid/other.png' }); flagReceipt();
    const before = mockDb.all('payment_receipts');
    const rows = (await flow.pendingPayments()).pago_revision;
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === id)).toMatchObject({ flagged: true, alertReason: 'Falta el folio', cotejo: { status: 'partial' }, suspiciousContactId: 'customer' });
    expect(mockDb.all('payment_receipts')).toEqual(before); expect(mockSend).not.toHaveBeenCalled();
});

test('one manual approval credits a deposit once and closes the matching AI alert and duplicate cards', async () => {
    const id = await enqueue(), copy = await enqueue('same-image'); flagReceipt();
    expect((await reviewViaApi(id, { amount: 300 })).status).toBe(200);
    expect(order().paymentReceivedCents).toBe(30000); expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(job(copy)).toMatchObject({ status: 'duplicate', open: false });
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(false);
    expect((await flow.pendingPayments()).pago_revision).toEqual([]);
    await runPaymentSweep(); expect(order().paymentReceivedCents).toBe(30000); expect(mockSend).not.toHaveBeenCalled();
});

test('discard resolves both sources and repeated images cannot reappear or run automatically', async () => {
    const id = await enqueue(), copy = await enqueue('same-image'); flagReceipt();
    expect((await post(`/receipts/${id}/review`, { action: 'reject' })).status).toBe(200);
    expect(job(copy)).toMatchObject({ status: 'rejected', open: false });
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(false);
    flagReceipt(); // Una respuesta atrasada de IA vuelve a escribir la alerta anterior.
    expect((await flow.pendingPayments()).pago_revision).toEqual([]);
    await runPaymentSweep(); expect(order().comprobanteValidadoAt).toBeUndefined(); expect(mockSend).not.toHaveBeenCalled();
});

test('discard does not clear a newer alert for another image', async () => {
    const id = await enqueue(); flagReceipt({ imageUrl: 'https://test.invalid/new.png' });
    expect((await post(`/receipts/${id}/review`, { action: 'reject' })).status).toBe(200);
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(true);
    expect((await flow.pendingPayments()).pago_revision).toHaveLength(1);
});

test('legacy alert uses the same amount review without creating an automatic payment on read', async () => {
    flagReceipt();
    const [row] = (await flow.pendingPayments()).pago_revision;
    expect(row).toMatchObject({ id: 'alert:customer', flagged: true });
    expect(mockDb.all('payment_receipts')).toEqual([]);
    expect((await reviewViaApi('alert%3Acustomer', { amount: 300, orderNumber: 'DH16368', reviewToken: row.reviewToken })).status).toBe(200);
    expect(order().paymentReceivedCents).toBe(30000); expect(order().comprobanteValidadoAt).toBeUndefined();
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(false);
    expect((await flow.pendingPayments()).pago_revision).toEqual([]); expect(mockSend).not.toHaveBeenCalled();
});

test('legacy alert rejected as not-receipt by OCR remains reviewable by an operator', async () => {
    const id = await enqueue(); mockOcr.mockResolvedValue(ocr({ esComprobante: false }));
    await flow.processReceipt(id); flagReceipt();
    const [row] = (await flow.pendingPayments()).pago_revision;
    expect(row.id).toBe('alert:customer');
    expect((await reviewViaApi('alert%3Acustomer', { amount: 300, orderNumber: 'DH16368', reviewToken: row.reviewToken })).status).toBe(200);
    expect(job(id).status).toBe('applied'); expect(order().paymentReceivedCents).toBe(30000);
    expect(mockSend).not.toHaveBeenCalled();
});

test('stale legacy dialog cannot approve or dismiss a different incoming receipt', async () => {
    flagReceipt(); const [row] = (await flow.pendingPayments()).pago_revision;
    flagReceipt({ imageUrl: 'https://test.invalid/new.png' });
    for (const action of [{ amount: 300, orderNumber: 'DH16368' }, { action: 'reject' }]) {
        expect((await post('/receipts/alert%3Acustomer/review', { ...action, reviewToken: row.reviewToken })).status).toBe(409);
    }
    expect(mockDb.all('payment_receipts')).toEqual([]);
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(true);
});

test('legacy alert with no image can be dismissed without crediting or sending messages', async () => {
    flagReceipt({ imageUrl: null }); const [row] = (await flow.pendingPayments()).pago_revision;
    expect((await post('/receipts/alert%3Acustomer/review', { action: 'reject', reviewToken: row.reviewToken })).status).toBe(200);
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(false);
    expect((await flow.pendingPayments()).pago_revision).toEqual([]); expect(mockSend).not.toHaveBeenCalled();
});

test('a late legacy approval uses a newly enqueued matching receipt instead of creating a second one', async () => {
    flagReceipt(); const [row] = (await flow.pendingPayments()).pago_revision;
    const id = await enqueue();
    expect((await reviewViaApi('alert%3Acustomer', { amount: 300, orderNumber: 'DH16368', reviewToken: row.reviewToken })).status).toBe(200);
    expect(mockDb.all('payment_receipts')).toHaveLength(1); expect(job(id).status).toBe('applied');
    expect(order().paymentReceivedCents).toBe(30000);
});

test('a full payment already registered clears its matching alert without crediting or resending', async () => {
    const id = await enqueue();
    mockDb.seed('pedidos/order', { ...order(), paymentReceivedCents: 120000, comprobanteValidadoAt: new Date(), shippingFormStatus: 'sent', shippingFormSentAt: new Date() });
    flagReceipt();
    expect((await reviewViaApi(id, { amount: 1200 })).status).toBe(200);
    expect(mockDb.read('contacts_whatsapp/customer').suspiciousReceiptPending).toBe(false);
    expect(order().paymentReceivedCents).toBe(120000); expect(mockSend).not.toHaveBeenCalled();
});

test('discarding a repeated image invalidates the pending form assessment on every affected order', async () => {
    const id = await enqueue();
    mockDb.seed('pedidos/other', { ...order(), consecutiveOrderNumber: 19000, paymentReportedComplete: true, shippingFormStatus: 'pending' });
    mockDb.seed('payment_receipts/copy', { ...job(id), orderId: 'other', orderNumber: 'DH19000' });
    expect((await post(`/receipts/${id}/review`, { action: 'reject' })).status).toBe(200);
    expect(mockDb.read('pedidos/other').paymentFormNeedsAssessment).toBe(true);
    await runPaymentSweep(); expect(mockSend).not.toHaveBeenCalled();
});
