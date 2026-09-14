const fs = require('fs');
const vm = require('vm');
const path = require('path');

let ui, active, icons, counter;
const success = { success: true, metaPurchaseSentAt: '2026-09-14T12:00:00Z' };
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const row = id => ({ orderDocId: id, orderNumber: `DH${id}`, metaPurchaseSentAt: null });

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00Z'));
    active = true;
    icons = new Map();
    counter = { textContent: '' };
    ui = {
        window: { addEventListener() {}, _enviosData: [] },
        document: {
            addEventListener() {},
            getElementById: id => id === 'envios-container' && active ? {} : id === 'envios-meta-pendientes' ? counter : null,
            querySelectorAll: selector => {
                const id = selector.match(/data-meta-order="([^"]+)"/)?.[1];
                if (!icons.has(id)) icons.set(id, { style: {}, removeAttribute() {} });
                return [icons.get(id)];
            },
        },
        Date, setTimeout, clearTimeout,
        requestAnimationFrame: jest.fn(),
        fetch: jest.fn().mockResolvedValue(reply(success)),
        showConfirmModal: jest.fn(), showError: jest.fn(),
        copyFormattedText() {}, copyToClipboard() {}, setActiveTab() {}, toggleEditNote() {},
        API_BASE_URL: '', escapeHtml: value => String(value),
        console: { log() {}, warn() {}, error() {} },
    };
    // Se carga el archivo real del navegador, sin Firebase, credenciales ni conexiones.
    vm.createContext(ui);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/modules/ui-manager.js'), 'utf8'), ui);
});
afterEach(() => jest.useRealTimers());

test('envía todos los pendientes una vez aunque haya filtros y líneas duplicadas', async () => {
    ui.window._enviosFilter = 'pendiente';
    ui.window._enviosData = [row('1'), row('1'), { ...row('2'), guiaEnvio: { guia: 'guia' } },
        { ...row('3'), metaPurchaseSentAt: success.metaPurchaseSentAt }, { manualId: 'manual-sin-pedido' }];
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body))).toEqual([
        { docId: '1', automatic: true }, { docId: '2', automatic: true },
    ]);
    expect(ui.window._enviosData.slice(0, 4).every(e => e.metaPurchaseSentAt)).toBe(true);
    expect(counter.textContent).toBe(0);
    expect(icons.get('1').className).toBe('fas fa-check-circle');
    expect(ui.showConfirmModal).not.toHaveBeenCalled();
});

test('la carga inicial y el refresco en vivo arrancan la recuperación automática', async () => {
    ui._paintEnvios = jest.fn();
    ui._enviosSuscribir = jest.fn();
    ui.fetch.mockImplementation(async (url, opts) => opts
        ? reply(success)
        : reply({ success: true, envios: [row(url === '/api/envios' && ui.fetch.mock.calls.length > 2 ? '2' : '1')] }));
    await ui.renderEnviosView();
    await jest.advanceTimersByTimeAsync(0);
    expect(ui.fetch.mock.calls.some(([, opts]) => opts && JSON.parse(opts.body).docId === '1')).toBe(true);
    await ui._enviosRefetchSilencioso('pedidos');
    await jest.advanceTimersByTimeAsync(0);
    expect(ui.fetch.mock.calls.some(([, opts]) => opts && JSON.parse(opts.body).docId === '2')).toBe(true);
});

test('el error de un pedido no bloquea los demás ni abre modales, y se reintenta con espera', async () => {
    ui.window._enviosData = [row('1'), row('2')];
    ui.fetch.mockResolvedValueOnce(reply({ success: false, message: 'Sin señal de anuncio', retryAfterMs: 300000 }, 409));
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.window._enviosData[0].metaPurchaseSentAt).toBeNull();
    expect(ui.window._enviosData[1].metaPurchaseSentAt).toBeTruthy();
    expect(icons.get('1').title).toBe('Sin señal de anuncio');
    expect(ui.showConfirmModal).not.toHaveBeenCalled();
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(300000);
    expect(ui.fetch).toHaveBeenCalledTimes(3);
    expect(ui.window._enviosData[0].metaPurchaseSentAt).toBeTruthy();
});

test('un refresco durante el envío incorpora nuevos pedidos sin duplicar la petición en vuelo', async () => {
    let release;
    ui.window._enviosData = [row('1')];
    ui.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const sending = ui._enviosEnviarPurchasePendientes();
    expect(icons.get('1').className).toContain('fa-spinner');
    ui.window._enviosData = [row('1'), row('2')];
    await ui._enviosEnviarPurchasePendientes();
    release(reply(success));
    await sending;
    expect(ui.fetch).toHaveBeenCalledTimes(2);
    expect(ui.window._enviosData.every(e => e.metaPurchaseSentAt)).toBe(true);
});

test('salir de Envíos detiene la cola y sus reintentos', async () => {
    let release;
    ui.window._enviosData = [row('1'), row('2')];
    ui.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const sending = ui._enviosEnviarPurchasePendientes();
    active = false;
    ui._enviosDesuscribir();
    release(reply({ success: false }, 502));
    await sending;
    await jest.advanceTimersByTimeAsync(600000);
    expect(ui.fetch).toHaveBeenCalledTimes(1);
});

test('un fallo de red no borra una confirmación que llegó desde otra pestaña', async () => {
    let reject;
    ui.window._enviosData = [row('1')];
    ui.fetch.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail; }));
    const sending = ui._enviosEnviarPurchasePendientes();
    ui.window._enviosData = [{ ...row('1'), metaPurchaseSentAt: success.metaPurchaseSentAt }];
    reject(new Error('conexión interrumpida'));
    await sending;
    expect(icons.get('1').style.color).toBe('#16a34a');
    expect(ui.window._enviosData[0].metaPurchaseSentAt).toBe(success.metaPurchaseSentAt);
});

test('no pinta verde sin sello ni pierde una confirmación frente a una respuesta vieja', async () => {
    ui.window._enviosData = [row('1')];
    ui._marcarPalomitaMeta('1', null);
    expect(ui.window._enviosData[0].metaPurchaseSentAt).toBeNull();
    await ui._enviosEnviarPurchasePendientes();
    ui.window._enviosData = [row('1')];
    ui._enviosRestaurarEstadoMeta();
    expect(ui.window._enviosData[0].metaPurchaseSentAt).toBe(success.metaPurchaseSentAt);
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch).toHaveBeenCalledTimes(1);
});
