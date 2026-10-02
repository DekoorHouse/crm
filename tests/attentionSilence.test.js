const { silenciadoPorAtendido } = require('../server/attentionSilence');
const now = Date.parse('2026-10-02T12:00:00Z');

test('Atendido silencia el MISMO motivo durante 12 h', () => {
    const c = { attendedAt: new Date(now - 2 * 3600000), attendedReason: 'equipo' };
    expect(silenciadoPorAtendido(c, 'equipo', now)).toBe(true);
    expect(silenciadoPorAtendido(c, 'reembolso', now)).toBe(false);          // otro motivo sí marca
    expect(silenciadoPorAtendido({ ...c, attendedAt: new Date(now - 13 * 3600000) }, 'equipo', now)).toBe(false);
    expect(silenciadoPorAtendido({}, 'equipo', now)).toBe(false);
});
