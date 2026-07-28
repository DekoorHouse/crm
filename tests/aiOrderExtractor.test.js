/**
 * Pruebas del extractor de pedidos por IA (server/orders/aiOrderRegistration.js):
 * el reintento y el motivo de falla. Gemini y Firestore van simulados.
 */

jest.mock('../server/config.js', () => ({ db: {}, admin: {}, app: null, bucket: null }));

const mockGemini = jest.fn();
jest.mock('../server/services.js', () => ({ generateGeminiResponse: (...a) => mockGemini(...a) }));
jest.mock('../server/aiUsage.js', () => ({ logAiUsage: async () => {} }));

const { extractOrderDetailed, saneaExtraccion } = require('../server/orders/aiOrderRegistration');

const CONVERSACION = [
    'Cliente: Me interesa una lámpara',
    'Asistente: ¿Qué nombres quieres que lleve?',
    'Cliente: Lupita y Joel',
    'Asistente: ¿Y la fecha?',
    'Cliente: 28 de septiembre del 2022',
    'Asistente: Producto: Lámpara de corazones. Total: $750. ¿Correcto?',
    'Cliente: Si son correctos',
].join('\n');

const JSON_BUENO = JSON.stringify({
    listo: true,
    items: [{ producto: 'Lámpara de corazones', cantidad: 1, precio: 750, datosProducto: 'Nombres: Lupita y Joel | Fecha: 28-Septiembre-2022' }],
    esAdicional: false,
    total: 750,
    confianza: 95,
    faltante: '',
});

const args = () => ({ conversationText: CONVERSACION, name: 'Flaco Avila', catalogText: '- "Lámpara de corazones" — $750' });

beforeEach(() => mockGemini.mockReset());

describe('extractOrderDetailed — camino feliz', () => {
    test('con JSON válido al primer intento, no reintenta', async () => {
        mockGemini.mockResolvedValue({ text: JSON_BUENO });

        const { extraction, motivo } = await extractOrderDetailed(args());

        expect(motivo).toBeNull();
        expect(mockGemini).toHaveBeenCalledTimes(1);
        expect(extraction.listo).toBe(true);
        expect(extraction.total).toBe(750);
        expect(extraction.items).toHaveLength(1);
        expect(extraction.items[0].precio).toBe(750);
    });

    test('acepta el JSON envuelto en ```json (lo que suele devolver el modelo)', async () => {
        mockGemini.mockResolvedValue({ text: '```json\n' + JSON_BUENO + '\n```' });

        const { extraction } = await extractOrderDetailed(args());

        expect(extraction).not.toBeNull();
        expect(extraction.confianza).toBe(95);
    });
});

describe('extractOrderDetailed — el reintento', () => {
    test('si la 1a respuesta no es JSON, la 2a salva el pedido', async () => {
        mockGemini
            .mockResolvedValueOnce({ text: 'Claro, con gusto te ayudo con ese pedido.' })
            .mockResolvedValueOnce({ text: JSON_BUENO });

        const { extraction, motivo } = await extractOrderDetailed(args());

        expect(mockGemini).toHaveBeenCalledTimes(2);
        expect(motivo).toBeNull();
        expect(extraction.items[0].producto).toBe('Lámpara de corazones');
    });

    test('si la 1a llamada truena, la 2a salva el pedido', async () => {
        mockGemini
            .mockRejectedValueOnce(new Error('503 Service Unavailable'))
            .mockResolvedValueOnce({ text: JSON_BUENO });

        const { extraction, motivo } = await extractOrderDetailed(args());

        expect(mockGemini).toHaveBeenCalledTimes(2);
        expect(motivo).toBeNull();
        expect(extraction.total).toBe(750);
    });

    test('no reintenta más de dos veces', async () => {
        mockGemini.mockResolvedValue({ text: 'no es json' });

        await extractOrderDetailed(args());

        expect(mockGemini).toHaveBeenCalledTimes(2);
    });
});

describe('extractOrderDetailed — el motivo distingue los dos modos de falla', () => {
    test('la API que truena se reporta como falla de Gemini, con su mensaje', async () => {
        mockGemini.mockRejectedValue(new Error('429 quota exceeded'));

        const { extraction, motivo } = await extractOrderDetailed(args());

        expect(extraction).toBeNull();
        expect(motivo).toContain('la API de Gemini falló');
        expect(motivo).toContain('429 quota exceeded');
    });

    test('la respuesta no parseable se reporta distinto y con eco de lo que dijo', async () => {
        mockGemini.mockResolvedValue({ text: 'Perdón, no entendí bien el pedido.' });

        const { extraction, motivo } = await extractOrderDetailed(args());

        expect(extraction).toBeNull();
        expect(motivo).toContain('no es JSON');
        expect(motivo).toContain('Perdón, no entendí');
        expect(motivo).not.toContain('la API de Gemini falló');
    });

    test('respuesta vacía lo dice explícitamente', async () => {
        mockGemini.mockResolvedValue({ text: '' });

        const { motivo } = await extractOrderDetailed(args());

        expect(motivo).toContain('respuesta vacía');
    });

    test('conversación vacía ni siquiera llama al modelo', async () => {
        const { extraction, motivo } = await extractOrderDetailed({ ...args(), conversationText: '   ' });

        expect(extraction).toBeNull();
        expect(motivo).toBe('la conversación llegó vacía');
        expect(mockGemini).not.toHaveBeenCalled();
    });
});

describe('saneaExtraccion', () => {
    test('quita < > de los datos que el cliente escribió (van a innerHTML del CRM)', () => {
        const r = saneaExtraccion({
            listo: true,
            items: [{ producto: 'Lámpara', cantidad: 1, precio: 750, datosProducto: '<img onerror=alert(1)>' }],
            total: 750, confianza: 90,
        });

        expect(r.items[0].datosProducto).not.toContain('<');
        expect(r.items[0].datosProducto).not.toContain('>');
    });

    test('acota cantidades absurdas y confianza fuera de rango', () => {
        const r = saneaExtraccion({
            listo: true,
            items: [{ producto: 'Lámpara', cantidad: 500, precio: 750, datosProducto: '' }],
            total: 750, confianza: 500,
        });

        expect(r.items[0].cantidad).toBe(20);
        expect(r.confianza).toBe(100);
    });

    test('descarta items sin producto', () => {
        const r = saneaExtraccion({
            listo: true,
            items: [{ cantidad: 1, precio: 750 }, { producto: 'Lámpara', cantidad: 1, precio: 750 }],
            total: 750, confianza: 90,
        });

        expect(r.items).toHaveLength(1);
    });
});
