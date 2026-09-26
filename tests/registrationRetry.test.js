const { retryActive, isMissingDataFailure, retryNote, RETRY_MAX_ATTEMPTS } = require('../server/orders/registrationRetry');

const now = Date.parse('2026-09-26T12:00:00Z');
const since = new Date(now - 60 * 60 * 1000);

test('DH17366: un comprobante sin datos completos deja el reintento vigente', () => {
    expect(retryActive({ registrationRetry: { since, attempts: 0 } }, now)).toBe(true);
    expect(retryActive({}, now)).toBe(false);
});

test('el reintento se agota por intentos o por tiempo', () => {
    expect(retryActive({ registrationRetry: { since, attempts: RETRY_MAX_ATTEMPTS } }, now)).toBe(false);
    expect(retryActive({ registrationRetry: { since: new Date(now - 49 * 3600 * 1000), attempts: 1 } }, now)).toBe(false);
});

test('solo "faltan datos" se reintenta; lo demás sigue yendo al equipo', () => {
    expect(isMissingDataFailure('el extractor no lo ve listo: Falta el texto de la segunda lámpara')).toBe(true);
    expect(isMissingDataFailure('el total no cuadra: los items suman $1500 pero el total acordado es $1200')).toBe(false);
    expect(isMissingDataFailure('cambio_no_aplicado: DH17262 ya no es editable')).toBe(false);
});

test('la nota le dice a la IA qué falta, sin volver a pedir el pago', () => {
    const note = retryNote({ registrationRetry: { since: new Date(), attempts: 1, faltante: 'el extractor no lo ve listo: Falta el texto de la segunda lámpara' } });
    expect(note).toMatch(/Falta el texto de la segunda lámpara/);
    expect(note).not.toMatch(/el extractor no lo ve listo/);
    expect(note).toMatch(/NO le pidas otra vez el comprobante/);
    expect(retryNote({})).toBe('');
});
