// Persist the failed send and its human task together: a chat reply must not hide it.
function isWindowClosed(error) {
    const e = error?.response?.data?.error || {};
    return Number(e.error_subcode) === 2018278 || Number(e.code) === 131047;
}

async function recordDeliveryFailure({ db, admin, messageRef, contactRef, data, error, maxAttempts = 3 }) {
    const closed = isWindowClosed(error);
    const attempts = (Number(data.attempts) || 0) + 1;
    const terminal = closed || attempts >= maxAttempts;
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    const batch = db.batch();
    batch.update(messageRef, {
        attempts, lastError: String(detail || '').slice(0, 500),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(terminal ? { status: 'failed' } : {}),
    });
    if (terminal && data.fileUrl) {
        batch.update(contactRef, {
            mediaDeliveryPending: true,
            mediaDeliveryFailure: {
                messageId: messageRef.id, channel: data.channel || 'whatsapp',
                reason: closed ? 'window_closed' : 'send_failed',
                at: admin.firestore.FieldValue.serverTimestamp(),
            },
        });
    }
    await batch.commit();
}

module.exports = { isWindowClosed, recordDeliveryFailure };
