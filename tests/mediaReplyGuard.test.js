const mockDb = require('./helpers/paymentFirestore')();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() } } } }));
const { unsupportedMediaClaim, protectMediaReply } = require('../server/mediaReplyGuard');
beforeEach(() => {
    mockDb.reset();
    mockDb.seed('contacts_whatsapp/customer', { name: 'Cliente', needsAttention: false });
});

test.each([
    'Aquí te comparto el diseño previo del León. [imagen]',
    '[archivo adjunto: previo_leon_santy.jpg]',
    '[archivo adjunto: previo_leon_santy.png]',
    '¡Hola! Ya tengo aquí la imagen lista en formato normal. ¿Te la puedo compartir?',
    'Aquí te mando por fin la imagen directa del diseño de León para Santy.',
    'Ya tengo listo el diseño de León para la lámpara de Santy.',
    'Aquí tienes el diseño previo digital del León con su melena.',
    'Ya está lista la imagen del diseño.',
    'Mañana mismo te comparto el previo digital.',
    'Voy a preparar la foto. Te la envío sin falta.',
    'Ya pedí al equipo humano que te manden la imagen.',
    'Mis compañeros te enviarán la imagen del diseño.',
])('blocks unsupported attachment/promise: %s', text => {
    expect(unsupportedMediaClaim(text, null)).toBe(true);
});

test.each([
    '¿Qué nombre quieres en el diseño?',
    '¿Me mandas una foto de referencia?',
    'No tengo una imagen disponible para adjuntar.',
    'Tus datos de envío quedaron registrados.',
    'Gracias por enviar tu foto.',
    'El diseño cuesta $750.',
    'El equipo está revisando la imagen de tu comprobante.',
    'Ya tengo la imagen de tu comprobante y estamos revisando el importe.',
    'Ya te enviamos las fotos de tu pedido.',
    'No te mando la imagen hasta que esté revisada.',
])('allows ordinary text: %s', text => expect(unsupportedMediaClaim(text)).toBe(false));

test('allows a real quick reply attachment, but never a fictitious marker beside it', () => {
    expect(unsupportedMediaClaim('Aquí te comparto la imagen.', 'https://example.com/photo.jpg')).toBe(false);
    expect(unsupportedMediaClaim('[imagen]', 'https://example.com/photo.jpg')).toBe(true);
    expect(unsupportedMediaClaim('Aquí te comparto la imagen.', 'previo_santy.jpg')).toBe(true);
});

test('persists human attention before acknowledging, and acknowledges only once while pending', async () => {
    const request = { contactId: 'customer', text: 'Aquí te mando la imagen de Santy.' };
    const results = await Promise.all([protectMediaReply(request), protectMediaReply(request)]);
    expect(results.filter(x => x.text)).toHaveLength(1);
    expect(mockDb.read('contacts_whatsapp/customer')).toMatchObject({ needsAttention: true, needsAttentionReason: 'equipo', mediaRequestPending: true,
        mediaRequest: { requestedText: request.text, source: 'ai' } });
    expect(results[0].text).not.toMatch(/ya tengo|te mando/i);
});

test('blocks scheduled promises without sending the client another message', async () => {
    const result = await protectMediaReply({ contactId: 'customer', text: 'Ya tengo listo el diseño de Santy.', source: 'order_followup' });
    expect(result).toEqual({ blocked: true, text: null });
    expect(mockDb.read('contacts_whatsapp/customer').needsAttention).toBe(true);
});

test('cannot claim a handoff if saving the request failed', async () => {
    mockDb.failNext('commit', 'contacts_whatsapp/customer');
    await expect(protectMediaReply({ contactId: 'customer', text: '[imagen]' })).rejects.toThrow('storage unavailable');
    expect(mockDb.read('contacts_whatsapp/customer').needsAttention).toBe(false);
});

test('ordinary replies do not create human attention', async () => {
    expect(await protectMediaReply({ contactId: 'customer', text: '¿Qué nombre quieres?' })).toEqual({ blocked: false, text: '¿Qué nombre quieres?' });
    expect(mockDb.read('contacts_whatsapp/customer').needsAttention).toBe(false);
});

test('DH17117: preserves receipt acknowledgment without requesting a missing design', async () => {
    const text = 'Recibimos tu comprobante y el equipo está revisando que el importe se haya acreditado. No necesitas volver a mandar la misma imagen.';
    expect(await protectMediaReply({ contactId: 'customer', text })).toEqual({ blocked: false, text });
    expect(mockDb.read('contacts_whatsapp/customer')).toEqual({ name: 'Cliente', needsAttention: false });
    expect(unsupportedMediaClaim(text + ' Aquí te mando la foto del diseño.')).toBe(true);
    expect(unsupportedMediaClaim(text + ' [imagen]')).toBe(true);
});

test('includes previously sent files and latest order without treating them as a new attachment', async () => {
    const prefix = 'contacts_whatsapp/customer/messages/';
    mockDb.seed(prefix + 'photo', { from: 'business', fileUrl: 'https://example.com/photo.jpg', timestamp: new Date(10), status: 'delivered' });
    mockDb.seed(prefix + 'receipt', { from: 'customer', fileUrl: 'https://example.com/receipt.jpg', timestamp: new Date(20) });
    mockDb.seed(prefix + 'failed', { from: 'business', fileUrl: 'https://example.com/failed.jpg', timestamp: new Date(30), status: 'failed' });
    mockDb.seed(prefix + 'scheduled', { from: 'business', fileUrl: 'https://example.com/scheduled.jpg', timestamp: new Date(40), status: 'scheduled' });
    mockDb.seed('pedidos/old', { contactId: 'customer', createdAt: new Date(1), estatus: 'Cancelado' });
    mockDb.seed('pedidos/current', { contactId: 'customer', createdAt: new Date(2), estatus: 'Foto enviada' });
    const result = await protectMediaReply({ contactId: 'customer', text: 'Aquí te mando la imagen de Santy.' });
    expect(result.blocked).toBe(true);
    expect(result.text).not.toMatch(/no tengo|no existe|falta el diseño/i);
    expect(mockDb.read('contacts_whatsapp/customer').mediaRequest).toMatchObject({
        priorAttachmentIds: ['photo'], orderId: 'current', orderStatus: 'Foto enviada',
        reason: expect.stringContaining('Ya hay archivos enviados'),
    });
});
