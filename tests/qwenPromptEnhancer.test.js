const mockFetch = jest.fn();
jest.mock('node-fetch', () => (...args) => mockFetch(...args));
const sharp = require('sharp');
const { enhancePrompt, parse } = require('../server/imagenes/qwenPromptEnhancer');

const answer = (content, cost = 0.0012) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: { cost } }) });
const rewritten = 'The image is a square cinematic action photograph of Spider-Man sprinting across a rooftop.';
let reference;
beforeAll(async () => {
    const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#2244aa' } }).png().toBuffer();
    reference = { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } };
});
beforeEach(() => { mockFetch.mockReset(); process.env.OPENROUTER_API_KEY = 'or-key'; delete process.env.QWEN_PROMPT_MODEL; });

test('lee el JSON oficial aunque venga con razonamiento o texto alrededor', () => {
    expect(parse(`<think>pienso…</think>\n{"rewritten_prompt": "${rewritten}", "wh_ratio": "3:2"}`)).toBe(rewritten);
    expect(() => parse('no json')).toThrow();
    expect(() => parse('{"rewritten_prompt": ""}')).toThrow();
});

test('crear: usa las instrucciones de texto a imagen y respeta el formato elegido', async () => {
    mockFetch.mockResolvedValue(answer(JSON.stringify({ rewritten_prompt: rewritten, wh_ratio: '1:1' })));
    await expect(enhancePrompt({ prompt: 'Spiderman corriendo', aspect_ratio: '16:9' })).resolves.toEqual({ prompt: rewritten, cost: 0.0012 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('google/gemini-3-flash-preview');
    expect(body.messages[0].content).toContain('Image Prompt Rewriting Expert');
    expect(body.messages[1].content).toEqual([{ type: 'text', text: 'Spiderman corriendo\n\nAspect ratio: 16:9' }]);
});

test('editar: usa las instrucciones de edición y le muestra las referencias reducidas', async () => {
    mockFetch.mockResolvedValue(answer(JSON.stringify({ rewritten_prompt: rewritten, wh_ratio: '', ratio_follow: '<image1>' })));
    await enhancePrompt({ prompt: 'Cambia el personaje por Elsa', references: [reference] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Edit Prompt Enhancer');
    const [image, text] = body.messages[1].content;
    expect(text).toEqual({ type: 'text', text: 'Cambia el personaje por Elsa' });
    const meta = await sharp(Buffer.from(image.image_url.url.split(',')[1], 'base64')).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1024, height: 683 });
});

test('si el mejorador falla o no hay llave, genera con el texto original', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(enhancePrompt({ prompt: 'Spiderman corriendo' })).resolves.toMatchObject({ prompt: 'Spiderman corriendo', cost: null });
    mockFetch.mockResolvedValue(answer('lo siento, no puedo'));
    await expect(enhancePrompt({ prompt: 'Spiderman corriendo' })).resolves.toMatchObject({ prompt: 'Spiderman corriendo' });
    delete process.env.OPENROUTER_API_KEY;
    mockFetch.mockClear();
    await expect(enhancePrompt({ prompt: 'Spiderman corriendo' })).resolves.toMatchObject({ prompt: 'Spiderman corriendo' });
    expect(mockFetch).not.toHaveBeenCalled();
});
