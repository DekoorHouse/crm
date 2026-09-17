// Navegador real y datos locales: no se conecta a Firebase ni escribe en el CRM.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && fs.existsSync(p));
const handlers = fs.readFileSync(require.resolve('../public/js/modules/pendientes-handlers.js'), 'utf8');
const live = fs.readFileSync(require.resolve('../public/js/modules/pendientes-live.js'), 'utf8');

(chrome ? describe : describe.skip)('Pendientes en vivo, con edición en el navegador', () => {
    let browser, page;
    beforeAll(async () => { browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] }); });
    afterAll(async () => { await browser?.close(); });
    beforeEach(async () => {
        page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 700 });
        await page.setContent('<html><body style="font:14px Arial;margin:16px"><main id="app"></main><textarea id="chat-draft"></textarea><button id="outside">Afuera</button></body></html>');
        await page.evaluate(() => {
            window.API_BASE_URL = ''; window.state = { activeView: 'pendientes' };
            window.escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            window.payload = { mockup: Array.from({ length: 15 }, (_, i) => ({ id: 'order' + i, orderNumber: 'DH' + (19000 + i), motivo: 'mockup', producto: 'Lámpara', datos: 'Nombre: Prueba', comentario: i ? '' : 'Nota anterior' })) };
            window.gets = 0; window.posts = []; window.listeners = []; window.pendingPosts = []; window.pendingGets = [];
            window.fetch = async (url, options = {}) => {
                if (options.method === 'POST') {
                    const body = JSON.parse(options.body || '{}'); window.posts.push(body);
                    if (window.failPost) return { ok: false, status: 503, json: async () => ({ message: 'Sin conexión' }) };
                    if (window.pausePost) await new Promise(resolve => window.pendingPosts.push(resolve));
                    const id = url.split('/').at(-2), row = window.payload.mockup?.find(o => o.id === id);
                    if (row) row.comentario = body.comentario;
                    return { ok: true, json: async () => ({ success: true }) };
                }
                window.gets++;
                const snapshot = structuredClone(window.payload);
                if (window.pauseGet) await new Promise(resolve => window.pendingGets.push(resolve));
                if (window.failGet) throw new Error('Offline');
                return { ok: true, json: async () => ({ success: true, buckets: snapshot }) };
            };
            const query = path => ({
                where: () => query(path), limit: () => query(path), orderBy: () => query(path), doc: id => query(path + '/' + id),
                onSnapshot: (next, error) => {
                    const listener = { path, next, error, active: true }; window.listeners.push(listener);
                    queueMicrotask(() => { if (listener.active) next({ docs: [], docChanges: () => [] }); });
                    return () => { listener.active = false; };
                },
            });
            window.db = { collection: query };
            window.emitChange = (path, docs = []) => window.listeners.filter(l => l.active && l.path === path).forEach(l => l.next({ docs: docs.map(d => ({ id: d.id, data: () => d })), docChanges: () => [{}] }));
        });
        await page.addScriptTag({ content: handlers });
        await page.addScriptTag({ content: live });
        await page.evaluate(async () => { document.getElementById('app').innerHTML = PendientesViewTemplate(); await renderPendientesView(); });
    });
    afterEach(async () => { await page?.close(); });

    test('un cambio actualiza las demás tarjetas sin tocar el nodo, selección, texto ni scroll de la nota', async () => {
        await page.focus('[data-note-order="order0"]');
        await page.keyboard.type(' + borrador');
        await page.evaluate(() => {
            window.noteBefore = document.activeElement; noteBefore.setSelectionRange(3, 8);
            document.querySelector('.pd-board').scrollLeft = 270;
            window.payload.mockup[1].datos = 'Nombre: Actualizado';
            window.payload.pago_revision = [{ id: 'receipt1', name: 'DH19050', amount: 300 }];
            emitChange('payment_receipts');
        });
        await page.waitForSelector('[data-pend="receipt1"]');
        expect(await page.evaluate(() => ({
            sameNode: noteBefore === document.querySelector('[data-note-order="order0"]'), focused: document.activeElement === noteBefore,
            text: noteBefore.value, selection: [noteBefore.selectionStart, noteBefore.selectionEnd], scroll: document.querySelector('.pd-board').scrollLeft,
            updated: document.querySelector('[data-pend="order1"]').textContent.includes('Actualizado'),
        }))).toEqual({ sameNode: true, focused: true, text: ' + borradorNota anterior', selection: [3, 8], scroll: 270, updated: true });
    });

    test('si el pedido sale de pendientes conserva la tarjeta hasta guardar el texto', async () => {
        await page.focus('[data-note-order="order0"]'); await page.keyboard.type('Borrador ');
        await page.evaluate(async () => { payload.mockup.shift(); await renderPendientesView(true); });
        expect(await page.$('.pd-note-retained')).toBeTruthy();
        await page.focus('#outside');
        await page.waitForFunction(() => !document.querySelector('[data-note-order="order0"]'));
        expect(await page.evaluate(() => posts.map(p => p.comentario))).toEqual(['Borrador Nota anterior']);
    });

    test('chat y formulario de aprobación siguen abiertos y conservan sus campos durante el refresco', async () => {
        await page.evaluate(() => {
            state.chatModalOpen = true;
            const modal = document.createElement('dialog'); modal.id = 'payment-dialog'; modal.innerHTML = '<input id="payment-amount" value="300">'; document.body.appendChild(modal); modal.showModal();
            document.querySelector('#chat-draft').value = 'Mensaje aún no enviado';
            document.getElementById('payment-amount').focus();
            payload.pago_revision = [{ id: 'receipt1', name: 'DH19050' }]; emitChange('payment_receipts');
        });
        await page.waitForSelector('[data-pend="receipt1"]');
        expect(await page.evaluate(() => [document.querySelector('#payment-dialog').open, document.activeElement.id, document.querySelector('#payment-amount').value, document.querySelector('#chat-draft').value])).toEqual([true, 'payment-amount', '300', 'Mensaje aún no enviado']);
    });

    test('fallar el guardado y la recarga no borra la nota; permite reintentar', async () => {
        await page.focus('[data-note-order="order0"]'); await page.keyboard.type('Local ');
        await page.evaluate(() => { window.failPost = true; }); await page.focus('#outside');
        await page.waitForSelector('.pd-note-error');
        await page.evaluate(async () => { window.failGet = true; await renderPendientesView(true); });
        expect(await page.$eval('[data-note-order="order0"]', el => el.value)).toBe('Local Nota anterior');
        await page.evaluate(async () => { window.failGet = false; await renderPendientesView(true); window.failPost = false; });
        await page.click('.pd-note-error');
        await page.waitForFunction(() => !document.querySelector('.pd-note-error'));
        expect(await page.evaluate(() => payload.mockup[0].comentario)).toBe('Local Nota anterior');
    });

    test('guardados consecutivos se serializan y una lectura vieja no pisa la versión reciente', async () => {
        await page.evaluate(() => { window.pausePost = true; });
        await page.focus('[data-note-order="order0"]'); await page.keyboard.type('A'); await page.focus('#outside');
        await page.focus('[data-note-order="order0"]'); await page.keyboard.type('B'); await page.focus('#outside');
        expect(await page.evaluate(() => posts.length)).toBe(1);
        await page.evaluate(async () => { await renderPendientesView(true); pendingPosts.shift()(); });
        await page.waitForFunction(() => posts.length === 2);
        await page.evaluate(() => { pendingPosts.shift()(); });
        await page.waitForFunction(() => payload.mockup[0].comentario.includes('B'));
        expect(await page.$eval('[data-note-order="order0"]', el => el.value)).toBe(await page.evaluate(() => posts[1].comentario));
    });

    test('suscripciones cubren pagos y dependencias; salir cancela todas y descarta respuestas atrasadas', async () => {
        expect(await page.evaluate(() => [...new Set(listeners.filter(l => l.active).map(l => l.path))])).toEqual(expect.arrayContaining(['pedidos', 'contacts_whatsapp', 'payment_receipts', 'ai_order_failures']));
        await page.evaluate(() => emitChange('payment_receipts', [{ id: 'r1', orderId: 'order0', contactId: 'customer' }]));
        expect(await page.evaluate(() => listeners.filter(l => l.active).map(l => l.path))).toEqual(expect.arrayContaining(['pedidos/order0', 'contacts_whatsapp/customer']));
        await page.evaluate(() => { window.pauseGet = true; renderPendientesView(true); });
        await page.waitForFunction(() => pendingGets.length > 0);
        await page.evaluate(() => { state.activeView = 'chats'; _pendStopLive(); document.getElementById('app').innerHTML = '<p>Chats</p>'; pendingGets.shift()(); });
        expect(await page.evaluate(() => listeners.filter(l => l.active).length)).toBe(0);
        expect(await page.$eval('#app', el => el.textContent)).toBe('Chats');
    });

    test('volver al texto original durante un guardado lento también persiste la última edición', async () => {
        await page.evaluate(() => { window.pausePost = true; });
        await page.focus('[data-note-order="order0"]'); await page.keyboard.type('A'); await page.focus('#outside');
        await page.focus('[data-note-order="order0"]');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.type('Nota anterior'); await page.focus('#outside');
        await page.evaluate(() => pendingPosts.shift()());
        await page.waitForFunction(() => posts.length === 2);
        await page.evaluate(() => pendingPosts.shift()());
        await page.waitForFunction(() => payload.mockup[0].comentario === 'Nota anterior');
        expect(await page.$eval('[data-note-order="order0"]', el => el.value)).toBe('Nota anterior');
    });

    test('enfocar sin escribir no sobrescribe una nota actualizada por otra persona', async () => {
        await page.focus('[data-note-order="order0"]');
        await page.evaluate(async () => { payload.mockup[0].comentario = 'Nota del equipo'; await renderPendientesView(true); });
        await page.focus('#outside');
        expect(await page.evaluate(() => posts.length)).toBe(0);
        expect(await page.$eval('[data-note-order="order0"]', el => el.value)).toBe('Nota del equipo');
    });
});
