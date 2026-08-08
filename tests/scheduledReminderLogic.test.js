/**
 * Tests de los parámetros de plantilla de los recordatorios programados.
 *
 * Contexto (8-ago-2026): durante ~5 semanas la config apuntaba a la plantilla
 * `recordatorio_lead`, que nunca existió en Meta. Resultado: 699 recordatorios de pago
 * murieron en "plantilla no aprobada" — justo los clientes que YA habían dicho "te pago
 * el viernes". El código además asumía que la plantilla traía UNA variable; si la nueva
 * trae dos, el cliente recibía un guion suelto.
 *
 * De ahí estas dos garantías, que es lo que impide repetir el bug:
 *   1. Los parámetros se arman según cuántas variables trae LA PLANTILLA, no según lo
 *      que el código suponga.
 *   2. El mensaje siempre cae en la última variable, y nunca se manda vacío.
 */
const { buildReminderParams, isUsableName } = require('../server/leads/scheduledReminderLogic');

const MSG = 'Pasamos a recordarte tu lámpara ✨';

describe('buildReminderParams — se adapta a la forma de la plantilla', () => {
    test('1 variable: solo el mensaje (sin nombre, a propósito)', () => {
        expect(buildReminderParams(1, { name: 'Ana', message: MSG })).toEqual([MSG]);
    });

    test('2 variables: saludo + mensaje', () => {
        expect(buildReminderParams(2, { name: 'Ana Sofía', message: MSG })).toEqual(['Ana', MSG]);
    });

    test('3 variables: el mensaje SIEMPRE va al final', () => {
        const p = buildReminderParams(3, { name: 'Ana', message: MSG });
        expect(p).toHaveLength(3);
        expect(p[p.length - 1]).toBe(MSG);
    });

    test('0 variables: no se mandan parámetros (Meta rechaza componentes vacíos)', () => {
        expect(buildReminderParams(0, { name: 'Ana', message: MSG })).toEqual([]);
    });

    test('ningún parámetro sale vacío: Meta rechaza el envío', () => {
        for (const n of [1, 2, 3]) {
            const p = buildReminderParams(n, { name: '', message: '' });
            expect(p).toHaveLength(n);
            p.forEach(v => expect(String(v).trim().length).toBeGreaterThan(0));
        }
    });

    test('nombre basura de WhatsApp → saludo neutro, nunca "¡Hola ds65834!"', () => {
        for (const basura of ['ds65834', '...', '5214771234567', '🙂', 'a']) {
            const [saludo] = buildReminderParams(2, { name: basura, message: MSG });
            expect(saludo).toBe('de nuevo');   // "¡Hola de nuevo!" — natural en cualquier plantilla
        }
    });

    test('el mensaje se sanitiza (sin saltos de línea) antes de ir a Meta', () => {
        const [texto] = buildReminderParams(1, { message: 'hola\n\nqué    tal' });
        expect(texto).toBe('hola qué tal');
    });
});

describe('isUsableName — filtro de nombres de WhatsApp', () => {
    test('acepta nombres reales, incluidos acentos y compuestos', () => {
        ['Ana', 'José Luis', "O'Brien", 'María-Fernanda', 'Ñuño'].forEach(n =>
            expect(isUsableName(n)).toBe(true));
    });

    test('rechaza basura', () => {
        ['', '   ', 'ds65834', '5214771234567', '...', '🙂', 'x', 'a'.repeat(41)].forEach(n =>
            expect(isUsableName(n)).toBe(false));
    });

    test('cualquier dígito descalifica: "Ana 2" suele ser un contacto duplicado, no un nombre', () => {
        expect(isUsableName('Ana 2')).toBe(false);
        expect(isUsableName('Ana')).toBe(true);
    });
});
