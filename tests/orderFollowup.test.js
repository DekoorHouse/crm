/**
 * Pruebas de la lógica de seguimiento de "pedido en proceso"
 * (server/leads/orderFollowupLogic.js). Solo lógica pura: no toca Firebase ni WhatsApp.
 */
const {
    normalizeOrderConfig,
    planSends,
    evaluateOrderFollowup,
    snapIntoBusinessHours,
    localHourOf,
    renderText,
    parseClassifierJson,
    normalizeClassification,
    buildConversationText,
    HOUR_MS,
    DAY_MS
} = require('../server/leads/orderFollowupLogic');

const OFFSET = -6; // México Centro
const cfg = normalizeOrderConfig({ enabled: true }); // defaults: 8h/16h, 8–21, 23.5h, gap 4h

// UTC ms cuya hora local (UTC-6) es `hour:min` en el día y-mo-d
function atLocal(y, mo, d, hour, min = 0) {
    return Date.UTC(y, mo, d, hour - OFFSET, min, 0, 0); // hour - (-6) = hour + 6
}

const localHour = ms => Math.round(localHourOf(ms, OFFSET));

describe('planSends — 2 envíos en horario laboral dentro de 24h', () => {
    const cases = [
        { label: '9am', t0: atLocal(2026, 5, 1, 9) },
        { label: '2pm (el caso difícil)', t0: atLocal(2026, 5, 1, 14) },
        { label: '6pm', t0: atLocal(2026, 5, 1, 18) },
        { label: '11pm', t0: atLocal(2026, 5, 1, 23) },
        { label: '8am justo', t0: atLocal(2026, 5, 1, 8) }
    ];

    test.each(cases)('caso $label: planea 2 envíos válidos', ({ t0 }) => {
        const sends = planSends(t0, cfg);
        const windowClose = t0 + cfg.windowHours * HOUR_MS;

        expect(sends.length).toBe(2);
        for (const s of sends) {
            const h = localHourOf(s, OFFSET);
            expect(h).toBeGreaterThanOrEqual(cfg.businessHours.start);
            expect(h).toBeLessThanOrEqual(cfg.businessHours.end);
            expect(s).toBeLessThanOrEqual(windowClose); // dentro de las 24h
            expect(s).toBeGreaterThanOrEqual(t0);       // nunca antes del mensaje
        }
        // separación mínima entre los dos
        expect(sends[1] - sends[0]).toBeGreaterThanOrEqual(cfg.minGapHours * HOUR_MS);
    });

    test('caso 2pm: 1er envío a las 9pm (antes de la noche), 2º a las 8am siguiente', () => {
        const t0 = atLocal(2026, 5, 1, 14);
        const sends = planSends(t0, cfg);
        expect(localHour(sends[0])).toBe(21);
        expect(localHour(sends[1])).toBe(8);
        expect(sends[1]).toBeGreaterThan(sends[0]); // al día siguiente
    });

    test('caso 9am: 1er envío a las 5pm, 2º a la mañana siguiente', () => {
        const t0 = atLocal(2026, 5, 1, 9);
        const sends = planSends(t0, cfg);
        expect(localHour(sends[0])).toBe(17);
        expect(localHour(sends[1])).toBe(8);
    });
});

describe('snapIntoBusinessHours', () => {
    test('hora diurna queda igual', () => {
        const t = atLocal(2026, 5, 1, 15);
        expect(snapIntoBusinessHours(t, cfg)).toBe(t);
    });
    test('tarde-noche (22h) se acomoda a las 21h del mismo día ("antes")', () => {
        const t = atLocal(2026, 5, 1, 22);
        expect(localHour(snapIntoBusinessHours(t, cfg))).toBe(21);
    });
    test('madrugada (3h) se acomoda a las 8h del mismo día ("temprano")', () => {
        const t = atLocal(2026, 5, 1, 3);
        expect(localHour(snapIntoBusinessHours(t, cfg))).toBe(8);
    });
});

describe('evaluateOrderFollowup', () => {
    const T0 = atLocal(2026, 5, 1, 9);
    const sends = planSends(T0, cfg); // [17:00 D, 08:00 D+1]
    const base = (over = {}) => ({
        status: 'pending', stage: 0, lastInboundAt: T0, name: 'Karla López',
        scheduledSends: sends, classified: false, ...over
    });

    test('espera si aún no vence el primer envío', () => {
        const v = evaluateOrderFollowup(base(), {}, cfg, T0 + 2 * HOUR_MS);
        expect(v.action).toBe('wait');
    });

    test('envía cuando vence y está en horario laboral', () => {
        const v = evaluateOrderFollowup(base(), {}, cfg, sends[0] + 60 * 1000);
        expect(v.action).toBe('send');
        expect(v.stage).toBe(0);
    });

    test('cancela si el cliente registró pedido después de escribir', () => {
        const v = evaluateOrderFollowup(base(), { lastOrderDate: T0 + HOUR_MS }, cfg, sends[0] + 60 * 1000);
        expect(v.action).toBe('cancel');
        expect(v.reason).toBe('pedido_registrado');
    });

    test('cancela si el contacto ya está en "Pendientes de revisión IA"', () => {
        // La IA cerró la venta (status pendientes_ia) -> no enviar rescate aunque toque
        const v = evaluateOrderFollowup(base(), { status: 'pendientes_ia' }, cfg, sends[0] + 60 * 1000);
        expect(v.action).toBe('cancel');
        expect(v.reason).toBe('pendientes_revision_ia');
    });

    test('expira fuera de la ventana de 24h', () => {
        const v = evaluateOrderFollowup(base(), {}, cfg, T0 + 25 * HOUR_MS);
        expect(v.action).toBe('expire');
    });

    test('done cuando ya se enviaron todas las etapas', () => {
        const v = evaluateOrderFollowup(base({ stage: 2 }), {}, cfg, sends[1] + HOUR_MS);
        expect(v.action).toBe('done');
    });

    test('wait_hours si venció pero ahora es de madrugada', () => {
        // now = 23:00 del día D (>= sends[0]=17:00, dentro de ventana, pero fuera de horario)
        const now = atLocal(2026, 5, 1, 23);
        const v = evaluateOrderFollowup(base(), {}, cfg, now);
        expect(v.action).toBe('wait_hours');
    });

    test('cancela si no hay agenda', () => {
        const v = evaluateOrderFollowup(base({ scheduledSends: [] }), {}, cfg, T0 + HOUR_MS);
        expect(v.action).toBe('cancel');
    });

    test('respeta el espaciado mínimo entre envíos aunque ambos horarios estén vencidos', () => {
        // backlog: stage 1 vencido y dentro de ventana (10 min tras el 2º horario)
        const now = sends[1] + 10 * 60 * 1000;
        // el 1er mensaje se envió hace 1h (< minGap 4h) -> esperar
        const f = base({ stage: 1, lastSentAt: now - 1 * HOUR_MS });
        expect(evaluateOrderFollowup(f, {}, cfg, now).action).toBe('wait');
        // pasadas las 4h del espaciado -> enviar
        const f2 = base({ stage: 1, lastSentAt: now - 5 * HOUR_MS });
        expect(evaluateOrderFollowup(f2, {}, cfg, now).action).toBe('send');
    });
});

describe('normalizeOrderConfig', () => {
    test('por defecto está DESACTIVADO (envío saliente)', () => {
        expect(normalizeOrderConfig(null).enabled).toBe(false);
    });
    test('respeta enabled=true y ordena/recorta delays', () => {
        const c = normalizeOrderConfig({ enabled: true, delaysHours: [16, 8, 4] });
        expect(c.enabled).toBe(true);
        expect(c.delaysHours).toEqual([4, 8]); // ordenados y máx 2
    });
    test('businessHours inválido cae a 8–21', () => {
        const c = normalizeOrderConfig({ businessHours: { start: 22, end: 5 } });
        expect(c.businessHours).toEqual({ start: 8, end: 21 });
    });
});

describe('parseClassifierJson + normalizeClassification', () => {
    test('parsea JSON con fences ```json y texto extra', () => {
        const raw = 'Aquí tienes:\n```json\n{"enProceso": true, "pendiente": "foto", "datosDados": ["nombre: Sofía"], "mensajes": ["Hola"]}\n```';
        const parsed = parseClassifierJson(raw);
        const norm = normalizeClassification(parsed);
        expect(norm.enProceso).toBe(true);
        expect(norm.pendiente).toBe('foto');
        expect(norm.datosDados).toContain('nombre: Sofía');
        expect(norm.mensajes).toEqual(['Hola']);
    });
    test('texto no-JSON devuelve null', () => {
        expect(parseClassifierJson('no soy json')).toBe(null);
        expect(normalizeClassification(null)).toBe(null);
    });
});

describe('renderText y buildConversationText', () => {
    test('sustituye {{nombre}} y limpia el espacio si no hay nombre', () => {
        expect(renderText('¡Hola{{nombre}}!', 'Karla López')).toBe('¡Hola Karla!');
        expect(renderText('¡Hola{{nombre}}!', '')).toBe('¡Hola!');
        expect(renderText('¡Hola{{nombre}}!', 'Nuevo Contacto')).toBe('¡Hola!');
    });
    test('etiqueta Cliente/Asistente según el emisor', () => {
        const msgs = [
            { from: '521811', text: 'quiero una lámpara con el nombre Sofía' },
            { from: 'PHONE_ID', text: '¡claro! mándame la foto' },
            { from: '521811', type: 'image', text: '' }
        ];
        const txt = buildConversationText(msgs, '521811');
        expect(txt).toContain('Cliente: quiero una lámpara');
        expect(txt).toContain('Asistente: ¡claro!');
        expect(txt).toContain('Cliente: [image]');
    });
});
