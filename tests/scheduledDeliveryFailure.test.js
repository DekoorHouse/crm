const makeDb = require('./helpers/paymentFirestore');
const { recordDeliveryFailure } = require('../server/scheduledMessages/deliveryFailure');
const admin = { firestore: { FieldValue: { serverTimestamp: () => new Date('2026-09-23') } } };
let db, messageRef, contactRef;
beforeEach(() => {
    db = makeDb();
    contactRef = db.collection('contacts_whatsapp').doc('fb_test');
    messageRef = contactRef.collection('messages').doc('photo');
    db.seed(contactRef.path, { needsAttention: true, needsAttentionReason: 'equipo' });
    db.seed(messageRef.path, { status: 'scheduled' });
});
const closed = { response: { data: { error: { code: 10, error_subcode: 2018278 } } } };
const run = (data, error = closed) => recordDeliveryFailure({ db, admin, contactRef, messageRef, data, error });
test('closed window immediately fails photo and preserves other attention reasons', async () => {
    await run({ fileUrl: 'https://example.com/photo.png', channel: 'messenger' });
    expect(db.read(messageRef.path)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(db.read(contactRef.path)).toMatchObject({ needsAttentionReason: 'equipo', mediaDeliveryPending: true,
        mediaDeliveryFailure: { messageId: 'photo', reason: 'window_closed', channel: 'messenger' } });
    await contactRef.update({ needsAttention: false });
    expect((await db.collection('contacts_whatsapp').where('mediaDeliveryPending', '==', true).get()).size).toBe(1);
});
test('transient media failure retries before creating a task', async () => {
    await run({ fileUrl: 'photo' }, new Error('timeout'));
    expect(db.read(messageRef.path).status).toBe('scheduled');
    expect(db.read(contactRef.path).mediaDeliveryPending).toBeUndefined();
    await run({ fileUrl: 'photo', attempts: 2 }, new Error('timeout'));
    expect(db.read(messageRef.path).status).toBe('failed');
    expect(db.read(contactRef.path).mediaDeliveryFailure.reason).toBe('send_failed');
});
test('failed text does not create a photo task', async () => {
    await run({ text: 'hello' });
    expect(db.read(contactRef.path).mediaDeliveryPending).toBeUndefined();
});
test('WhatsApp closed window creates the same task', async () => {
    await run({ fileUrl: 'photo' }, { response: { data: { error: { code: 131047 } } } });
    expect(db.read(contactRef.path).mediaDeliveryPending).toBe(true);
});
test('storage failure leaves message retryable so alert cannot be lost', async () => {
    db.failNext('update', contactRef.path);
    await expect(run({ fileUrl: 'photo' })).rejects.toThrow();
    expect(db.read(messageRef.path).status).toBe('scheduled');
    expect(db.read(contactRef.path).mediaDeliveryPending).toBeUndefined();
});
