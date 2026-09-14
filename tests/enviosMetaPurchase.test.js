const fs = require('fs');
const vm = require('vm');
const path = require('path');

let ui, active, icons, counter, rejectedCounter, container;
const success = { success: true, metaPurchaseSentAt: '2026-09-14T12:00:00Z' };
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const row = id => ({ orderDocId: id, orderNumber: `DH${id}`, metaPurchaseSentAt: null });

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00Z'));
    active = true;
    icons = new Map();
    counter = { textContent: '' };
    rejectedCounter = { textContent: '' };
    container = { innerHTML: '' };
    ui = {
        window: { addEventListener() {}, _enviosData: [] },
        document: {
            addEventListener() {},
            getElementById: id => id === 'envios-container' && active ? container : id === 'envios-meta-pendientes' ? counter : id === 'envios-meta-rechazadas' ? rejectedCounter : null,
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
    ui.showError = jest.fn();
});

test('un orgánico se resuelve en azul sin afirmar que fue enviado y conserva el estado al refrescar', async () => {
    ui.window._enviosData = [row('1'), row('1')];
    ui.fetch.mockResolvedValue(reply({ success: true, metaPurchaseSentAt: null,
        metaPurchaseResolvedAt: success.metaPurchaseSentAt, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'organico' }));
    await ui._enviosEnviarPurchasePendientes();
    expect(icons.get('1').style.color).toBe('#2563eb');
    expect(icons.get('1').title).toContain('No se envió Purchase a Meta');
    expect(ui.window._enviosData.every(e => e.metaPurchaseResolvedAt && !e.metaPurchaseSentAt)).toBe(true);
    expect(counter.textContent).toBe(0);
    ui.window._enviosData = [row('1')];
    ui._enviosRestaurarEstadoMeta();
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch).toHaveBeenCalledTimes(1);
    expect(ui.window._enviosData[0].metaPurchaseMotivo).toBe('organico');
});

test('un rechazo automático queda rojo, muestra motivo y espera revisión sin bloquear otras compras', async () => {
    ui.window._enviosData = [row('1'), row('2')];
    ui.fetch.mockResolvedValueOnce(reply({ success: false, rechazado: true, metaPurchaseRejectedAt: success.metaPurchaseSentAt, message: 'Página no conectada' }, 409));
    await ui._enviosEnviarPurchasePendientes();
    expect(icons.get('1').style.color).toBe('#dc2626');
    expect(icons.get('1').title).toContain('Página no conectada');
    expect(icons.get('2').style.color).toBe('#16a34a');
    expect(ui.showConfirmModal).not.toHaveBeenCalled();
    expect(rejectedCounter.textContent).toBe(1);
    expect(counter.textContent).toBe(0);
    ui.window._enviosData[0] = row('1');
    ui._enviosRestaurarEstadoMeta();
    await jest.advanceTimersByTimeAsync(600000);
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch).toHaveBeenCalledTimes(2);
});

test.each([false, true])('revisión de una roja, confirmar=%s: solo cambia a verde al guardar en el servidor', async confirm => {
    ui.window._enviosData = [row('1')];
    ui._marcarPalomitaMetaRechazada('1', { metaPurchaseRejectedAt: success.metaPurchaseSentAt, metaPurchaseError: 'Página no conectada' });
    ui.showConfirmModal.mockResolvedValue(confirm);
    ui.fetch.mockResolvedValue(reply({ success: true, metaPurchaseSentAt: null, metaPurchaseResolvedAt: success.metaPurchaseSentAt,
        metaPurchaseNoAplica: true, metaPurchaseMotivo: 'revisado' }));
    await ui.sendMetaPurchase('1');
    expect(ui.showConfirmModal.mock.calls[0][0]).toContain('Página no conectada');
    expect(ui.showConfirmModal.mock.calls[0][1]).toMatchObject({ confirmText: 'Ya la revisé, marcar verde', cancelText: 'Dejar en rojo' });
    if (!confirm) {
        expect(ui.fetch).not.toHaveBeenCalled();
        expect(icons.get('1').style.color).toBe('#dc2626');
    } else {
        expect(JSON.parse(ui.fetch.mock.calls[0][1].body)).toEqual({ docId: '1', force: true });
        expect(icons.get('1').style.color).toBe('#16a34a');
        expect(icons.get('1').title).toContain('Revisada manualmente');
        expect(icons.get('1').title).toContain('No se reportó a Meta');
        expect(ui.window._enviosData[0].metaPurchaseSentAt).toBeNull();
        expect(ui.window._enviosData[0].metaPurchaseRejectedAt).toBeNull();
        expect(rejectedCounter.textContent).toBe(0);
        await ui._enviosEnviarPurchasePendientes();
        expect(ui.fetch).toHaveBeenCalledTimes(1);
    }
});

test('si falla guardar la revisión, conserva la palomita roja', async () => {
    ui.window._enviosData = [row('1')];
    ui._marcarPalomitaMetaRechazada('1', { metaPurchaseRejectedAt: success.metaPurchaseSentAt, metaPurchaseError: 'rechazo' });
    ui.showConfirmModal.mockResolvedValue(true);
    ui.fetch.mockRejectedValue(new Error('red caída'));
    await ui.sendMetaPurchase('1');
    expect(icons.get('1').style.color).toBe('#dc2626');
    expect(ui.window._enviosData[0].metaPurchaseResolvedAt).toBeUndefined();
    expect(ui.showError).toHaveBeenCalledWith(expect.stringContaining('red caída'));
    ui.window._enviosData = [row('1')];
    ui._enviosRestaurarEstadoMeta();
    expect(icons.get('1').style.color).toBe('#dc2626');
    expect(icons.get('1').title).toContain('rechazo');
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch).toHaveBeenCalledTimes(1);
});

test('la tabla distingue los cuatro estados al cargar de nuevo', () => {
    const stamp = success.metaPurchaseSentAt;
    ui.window._enviosData = [row('pendiente'), { ...row('enviado'), metaPurchaseSentAt: stamp },
        { ...row('organico'), metaPurchaseResolvedAt: stamp, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'organico' },
        { ...row('rechazado'), metaPurchaseRejectedAt: stamp, metaPurchaseError: 'Página no conectada' },
        { ...row('revisado'), metaPurchaseResolvedAt: stamp, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'revisado' }];
    ui._paintEnvios();
    for (const [id, color] of [['pendiente', '#cbd5e1'], ['enviado', '#16a34a'], ['organico', '#2563eb'], ['rechazado', '#dc2626'], ['revisado', '#16a34a']]) {
        expect(container.innerHTML).toMatch(new RegExp(`data-meta-order="${id}"[^>]*color:${color}`));
    }
    expect(container.innerHTML).toContain('Página no conectada');
    expect(container.innerHTML).toContain('Revisada manualmente');
});

test('una respuesta de rechazo vieja no borra una revisión confirmada por otra pestaña', () => {
    ui.window._enviosData = [{ ...row('1'), metaPurchaseResolvedAt: success.metaPurchaseSentAt, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'revisado' }];
    ui._marcarPalomitaMetaRechazada('1', { rechazado: true, message: 'respuesta anterior' });
    expect(icons.get('1').style.color).toBe('#16a34a');
    expect(ui.window._enviosData[0].metaPurchaseRejectedAt).toBeNull();
});

test.each([false, true])('DH1663 sin contacto: rojo antes de Meta, se conserva al refrescar y aprobación=%s', async confirm => {
    ui.window._enviosData = [row('1663'), row('1663')];
    ui.fetch.mockResolvedValueOnce(reply({ success: false, needsReview: true, rechazado: false,
        metaPurchaseNeedsReviewAt: success.metaPurchaseSentAt, metaPurchaseError: 'DH1663 no tiene contacto ligado.',
        message: 'DH1663 no tiene contacto ligado.' }, 400));
    await ui._enviosEnviarPurchasePendientes();
    expect(icons.get('1663').style.color).toBe('#dc2626');
    expect(icons.get('1663').title).toContain('no tiene contacto ligado');
    expect(icons.get('1663').title).not.toContain('Rechazada por Meta');
    expect(ui.window._enviosData.every(e => e.metaPurchaseNeedsReviewAt && !e.metaPurchaseRejectedAt && !e.metaPurchaseSentAt)).toBe(true);
    expect(counter.textContent).toBe(0);
    expect(rejectedCounter.textContent).toBe(2);
    ui.window._enviosData = [row('1663')];
    ui._enviosRestaurarEstadoMeta();
    await jest.advanceTimersByTimeAsync(600000);
    await ui._enviosEnviarPurchasePendientes();
    expect(ui.fetch).toHaveBeenCalledTimes(1);
    expect(icons.get('1663').style.color).toBe('#dc2626');
    ui.showConfirmModal.mockResolvedValue(confirm);
    ui.fetch.mockResolvedValue(reply({ success: true, metaPurchaseSentAt: null,
        metaPurchaseResolvedAt: success.metaPurchaseSentAt, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'revisado' }));
    await ui.sendMetaPurchase('1663');
    expect(ui.showConfirmModal.mock.calls[0][0]).toContain('DH1663 no tiene contacto ligado.');
    expect(ui.showConfirmModal.mock.calls[0][1].confirmText).toBe('Ya la revisé, marcar verde');
    if (confirm) {
        expect(JSON.parse(ui.fetch.mock.calls[1][1].body)).toEqual({ docId: '1663', force: true });
        expect(icons.get('1663').style.color).toBe('#16a34a');
        expect(ui.window._enviosData[0].metaPurchaseNeedsReviewAt).toBeNull();
        expect(ui.window._enviosData[0].metaPurchaseSentAt).toBeNull();
    } else {
        expect(ui.fetch).toHaveBeenCalledTimes(1);
        expect(icons.get('1663').style.color).toBe('#dc2626');
    }
});

test('una sesión nueva muestra en rojo un error anterior a Meta almacenado en el servidor', () => {
    ui.window._enviosData = [{ ...row('1663'), metaPurchaseNeedsReviewAt: success.metaPurchaseSentAt,
        metaPurchaseError: 'DH1663 no tiene contacto ligado.' }];
    ui._paintEnvios();
    expect(container.innerHTML).toMatch(/data-meta-order="1663"[^>]*color:#dc2626/);
    expect(container.innerHTML).toContain('DH1663 no tiene contacto ligado.');
    expect(container.innerHTML).not.toContain('Rechazada por Meta:');
    expect(container.innerHTML).toContain('sendMetaPurchase');
});

test('un intento manual gris con error de datos se vuelve rojo y ofrece revisión al volver a tocarlo', async () => {
    ui.window._enviosData = [row('1663')];
    ui.showConfirmModal.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    ui.fetch.mockResolvedValueOnce(reply({ success: false, needsReview: true, rechazado: false,
        metaPurchaseNeedsReviewAt: success.metaPurchaseSentAt, message: 'DH1663 no tiene contacto ligado.' }, 400));
    await ui.sendMetaPurchase('1663');
    expect(icons.get('1663').style.color).toBe('#dc2626');
    await ui.sendMetaPurchase('1663');
    expect(ui.showConfirmModal.mock.calls[1][1].confirmText).toBe('Ya la revisé, marcar verde');
    expect(ui.fetch).toHaveBeenCalledTimes(1);
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
