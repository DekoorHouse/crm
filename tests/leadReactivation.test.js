/**
 * Pruebas de la lógica de reactivación de leads (server/leads/leadReactivationLogic.js)
 * Solo lógica pura: no toca Firebase ni WhatsApp.
 */
const {
    DEFAULT_CONFIG,
    evaluateFollowup,
    normalizeConfig,
    renderFollowupText,
    firstName
} = require('../server/leads/leadReactivationLogic');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const T0 = 1750000000000; // último mensaje entrante del cliente
const config = normalizeConfig(null); // defaults: 15 min y 240 min

const followup = (over = {}) => ({
    status: 'pending',
    stage: 0,
    lastInboundAt: T0,
    name: 'Karla López',
    ...over
});

describe('evaluateFollowup', () => {
    test('espera si aún no se cumple el delay del primer mensaje', () => {
        const v = evaluateFollowup(followup(), {}, config, T0 + 5 * MIN);
        expect(v.action).toBe('wait');
    });

    test('envía el primer seguimiento pasados los 15 minutos', () => {
        const v = evaluateFollowup(followup(), { name: 'Karla López' }, config, T0 + 16 * MIN);
        expect(v.action).toBe('send');
        expect(v.stage).toBe(0);
        expect(v.text).toContain('Karla');
    });

    test('envía el segundo seguimiento pasadas las 4 horas', () => {
        const v = evaluateFollowup(followup({ stage: 1 }), {}, config, T0 + 4 * HOUR + MIN);
        expect(v.action).toBe('send');
        expect(v.stage).toBe(1);
    });

    test('espera el segundo seguimiento aunque el primero ya se haya enviado', () => {
        const v = evaluateFollowup(followup({ stage: 1 }), {}, config, T0 + 30 * MIN);
        expect(v.action).toBe('wait');
    });

    test('marca done cuando ya se enviaron todos los seguimientos', () => {
        const v = evaluateFollowup(followup({ stage: 2 }), {}, config, T0 + 5 * HOUR);
        expect(v.action).toBe('done');
    });

    test('cancela si el cliente registró pedido después de escribir', () => {
        const contact = { lastOrderDate: T0 + 10 * MIN };
        const v = evaluateFollowup(followup(), contact, config, T0 + 16 * MIN);
        expect(v.action).toBe('cancel');
        expect(v.reason).toBe('pedido_registrado');
    });

    test('no molesta a clientes con pedido reciente (pregunta de seguimiento)', () => {
        const contact = { lastOrderDate: T0 - 5 * DAY };
        const v = evaluateFollowup(followup(), contact, config, T0 + 16 * MIN);
        expect(v.action).toBe('skip_recent');
    });

    test('sí envía si el último pedido es viejo (lead que regresa)', () => {
        const contact = { lastOrderDate: T0 - 30 * DAY };
        const v = evaluateFollowup(followup(), contact, config, T0 + 16 * MIN);
        expect(v.action).toBe('send');
    });

    test('expira fuera de la ventana de 24h de WhatsApp', () => {
        const v = evaluateFollowup(followup({ stage: 1 }), {}, config, T0 + 25 * HOUR);
        expect(v.action).toBe('expire');
    });

    test('cancela si el contacto ya no existe', () => {
        const v = evaluateFollowup(followup(), null, config, T0 + 16 * MIN);
        expect(v.action).toBe('cancel');
        expect(v.reason).toBe('contacto_inexistente');
    });

    test('ignora seguimientos que no están pendientes', () => {
        expect(evaluateFollowup(followup({ status: 'done' }), {}, config, T0 + DAY).action).toBe('none');
        expect(evaluateFollowup(null, {}, config, T0).action).toBe('none');
    });
});

describe('renderFollowupText', () => {
    test('sustituye {{nombre}} por el primer nombre', () => {
        expect(renderFollowupText('¡Hola{{nombre}}!', 'Karla López')).toBe('¡Hola Karla!');
    });

    test('quita el placeholder limpiamente cuando no hay nombre', () => {
        expect(renderFollowupText('¡Hola{{nombre}}!', null)).toBe('¡Hola!');
        expect(renderFollowupText('¡Hola{{nombre}}!', 'Nuevo Contacto (1234)')).toBe('¡Hola!');
    });

    test('los textos default renderizan bien con y sin nombre', () => {
        for (const f of DEFAULT_CONFIG.followups) {
            expect(renderFollowupText(f.text, 'Ana Ruiz')).toContain('Ana');
            expect(renderFollowupText(f.text, null)).not.toContain('{{');
        }
    });
});

describe('normalizeConfig', () => {
    test('usa defaults cuando no hay config guardada', () => {
        const c = normalizeConfig(null);
        expect(c.enabled).toBe(true);
        expect(c.followups).toHaveLength(2);
        expect(c.followups[0].delayMinutes).toBe(15);
        expect(c.followups[1].delayMinutes).toBe(240);
    });

    test('ordena los seguimientos por delay y descarta los inválidos', () => {
        const c = normalizeConfig({
            followups: [
                { delayMinutes: 300, text: 'segundo' },
                { delayMinutes: 0, text: 'inválido' },
                { delayMinutes: 10, text: 'primero' },
                { delayMinutes: 60, text: '' }
            ]
        });
        expect(c.followups.map(f => f.text)).toEqual(['primero', 'segundo']);
    });

    test('cae a defaults si todos los followups son inválidos', () => {
        const c = normalizeConfig({ followups: [{ delayMinutes: 'x', text: '' }] });
        expect(c.followups).toEqual(DEFAULT_CONFIG.followups);
    });

    test('respeta enabled=false', () => {
        expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
    });
});

describe('firstName', () => {
    test('extrae el primer nombre', () => {
        expect(firstName('Karla López')).toBe('Karla');
        expect(firstName('  ana  ')).toBe('ana');
    });
    test('descarta placeholders de contacto nuevo', () => {
        expect(firstName('Nuevo Contacto (1234)')).toBe('');
        expect(firstName('')).toBe('');
        expect(firstName(null)).toBe('');
    });
});
