// Pruebas del navegador con Firebase y reportes simulados: no toca datos ni envía mensajes reales.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

(chrome ? describe : describe.skip)('tarifa por semana en el checador', () => {
    let browser, page;
    beforeAll(async () => { browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] }); });
    afterAll(async () => { await browser?.close(); }, 30000);
    beforeEach(async () => {
        page = await browser.newPage();
        await page.setViewport({ width: 1100, height: 850 });
        await page.setContent(read('public/checador/panel.html').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
        const css = read('public/checador/style.css').replace(/^@import[^\r\n]*[\r\n]*/, '');
        await page.evaluate(css => { const style = document.createElement('style'); style.textContent = css; document.head.prepend(style); }, css);
        await page.evaluate(() => {
            const NativeDate = Date;
            window.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : [2026, 8, 19, 12])); }
                static now() { return new NativeDate(2026, 8, 19, 12).getTime(); }
            };
            window.listeners = {};
            window.posts = [];
            window.firebase = {
                initializeApp() {}, auth: () => ({ onAuthStateChanged() {} }),
                firestore: () => ({ collection: name => {
                    const collection = { orderBy: () => collection, onSnapshot: cb => { listeners[name] = cb; return () => {}; } };
                    return collection;
                } }),
            };
            window.confirm = () => true;
            window.fetch = async (url, options) => {
                const body = JSON.parse(options.body);
                posts.push({ url, body });
                if (url.endsWith('weekly-rate')) {
                    if (window.failSave) return { ok: false, json: async () => ({ ok: false, message: 'Sin conexión' }) };
                    return { ok: true, json: async () => ({ ok: true, ...body }) };
                }
                return { ok: true, json: async () => ({ ok: true, pins: {} }) };
            };
            window.snapshot = (collection, rows) => listeners[collection]({ docs: rows.map(row => ({ id: row._id, data: () => row })) });
        });
        await page.addScriptTag({ content: read('functions/checadorPayroll.js') });
        await page.addScriptTag({ content: read('public/checador/panel.js') });
        await page.evaluate(() => {
            document.getElementById('pin-view').style.display = 'none';
            document.getElementById('panel-content').style.display = 'block';
            // Solo fixtures, sin credenciales ni conexiones de producción.
            startPanelData();
            snapshot('checador_weekly_rates', [{ _id: '2026-09-07', hourlyRate: 80 }, { _id: '2026-09-14', hourlyRate: 90 }]);
            snapshot('checador_employees', [{ _id: 'ana', id: 'ana', name: 'Ana', phone: 'fixture', vacaciones: true, vacacionesDesde: '2026-09-08', vacacionesHasta: '2026-09-08' }]);
            snapshot('checador_logs', [
                { id: 'ana', name: 'Ana', date: '14/9/2026', time: '10:00', timestamp: new Date(2026, 8, 14, 10).getTime(), type: 'OUT' },
                { id: 'ana', name: 'Ana', date: '14/9/2026', time: '9:00', timestamp: new Date(2026, 8, 14, 9).getTime(), type: 'IN' },
                { id: 'ana', name: 'Ana', date: '7/9/2026', time: '10:00', timestamp: new Date(2026, 8, 7, 10).getTime(), type: 'OUT' },
                { id: 'ana', name: 'Ana', date: '7/9/2026', time: '9:00', timestamp: new Date(2026, 8, 7, 9).getTime(), type: 'IN' },
            ]);
            snapshot('checador_holidays', [{ date: '2026-09-15', label: 'Prueba', customMinutes: 120 }]);
        });
    });
    afterEach(async () => { await page?.close(); });

    test('suma por fecha en resumen, CSV y reportes, incluyendo vacaciones e inhábiles', async () => {
        const result = await page.evaluate(() => ({ summary: getResumenData('mensual'), daily: getGroupedData(), week: buildWeekReportData() }));
        // 1h a 80 + 6h de vacaciones a 80 + 1h a 90 + 2h inhábiles a 90.
        expect(result.summary[0]).toMatchObject({ minutes: 600, payment: 830 });
        expect(result.daily.map(d => d.payment).sort()).toEqual([80, 90]);
        expect(result.week[0].totalMins).toBe(180);
        await page.evaluate(() => { window.csvBlob = null; URL.createObjectURL = blob => { window.csvBlob = blob; return '#'; }; HTMLAnchorElement.prototype.click = () => {}; exportToCSV(); });
        const csv = await page.evaluate(() => csvBlob.text());
        expect(csv).toContain('Precio por Hora'); expect(csv).toContain('$80.00'); expect(csv).toContain('$90.00');
        await page.click('#send-week-whatsapp');
        expect(await page.$eval('#wa-checklist', e => e.textContent)).toContain('$270');
        await page.click('#wa-send-btn');
        await page.waitForFunction(() => posts.some(p => p.url.endsWith('whatsapp-report')));
        expect(await page.evaluate(() => posts.find(p => p.url.endsWith('whatsapp-report')).body.report)).toContain('$270');
        await page.click('[data-tab="tab-resumen"]');
        await page.click('[data-period="mensual"]');
        await page.click('#send-whatsapp-btn');
        await page.waitForFunction(() => posts.filter(p => p.url.endsWith('whatsapp-report')).length === 2);
        expect(await page.evaluate(() => posts.filter(p => p.url.endsWith('whatsapp-report'))[1].body.report)).toContain('$830');
    });

    test('guarda la semana elegida, conserva borradores ante cambios en vivo y al navegar', async () => {
        await page.$eval('#weekly-rate', e => { e.value = '95.50'; e.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.evaluate(() => renderAdminLogs());
        expect(await page.$eval('#weekly-rate', e => e.value)).toBe('95.50');
        await page.click('#prev-week');
        expect(await page.$eval('#weekly-rate', e => e.value)).toBe('80');
        await page.click('#next-week');
        expect(await page.$eval('#weekly-rate', e => e.value)).toBe('95.50');
        await page.click('#weekly-rate-save');
        await page.waitForFunction(() => document.getElementById('weekly-rate-status').textContent.includes('Guardado: $95.50'));
        expect(await page.evaluate(() => posts.find(p => p.url.endsWith('weekly-rate')).body)).toMatchObject({ weekStart: '2026-09-14', hourlyRate: 95.5 });
        await page.click('#prev-week');
        expect(await page.$eval('#weekly-rate', e => e.value)).toBe('80');
        await page.click('#prev-week');
        expect(await page.$eval('#weekly-rate', e => e.value)).toBe('70');
    });

    test('error de guardado conserva el borrador y los importes guardados', async () => {
        await page.evaluate(() => { window.failSave = true; });
        await page.$eval('#weekly-rate', e => { e.value = '100'; e.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.click('#weekly-rate-save');
        await page.waitForFunction(() => !document.getElementById('weekly-rate-save').disabled);
        expect(await page.$eval('#weekly-rate', e => e.value)).toBe('100');
        expect(await page.evaluate(() => getResumenData('mensual')[0].payment)).toBe(830);
    });

    test('el formulario es visible en escritorio y cabe en móvil', async () => {
        await page.screenshot({ path: path.join(require('os').tmpdir(), 'codex-checador-weekly-rate-desktop.png'), fullPage: true });
        await page.setViewport({ width: 390, height: 844 });
        const fits = await page.$eval('#weekly-rate-form', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth; });
        expect(fits).toBe(true);
        await page.screenshot({ path: path.join(require('os').tmpdir(), 'codex-checador-weekly-rate-mobile.png'), fullPage: true });
    });

    test('el perfil del empleado usa las mismas tarifas al cambiar de semana', async () => {
        await page.close(); page = await browser.newPage();
        await page.setContent(read('public/checador/mi-perfil.html').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
        await page.evaluate(() => {
            const NativeDate = Date;
            window.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : [2026, 8, 19, 12])); }
                static now() { return new NativeDate(2026, 8, 19, 12).getTime(); }
            };
            window.firebase = { initializeApp() {}, auth: () => ({ onAuthStateChanged() {} }), firestore: () => ({}) };
            Object.defineProperty(window, 'localStorage', { value: { removeItem() {} } });
        });
        await page.addScriptTag({ content: read('functions/checadorPayroll.js') });
        await page.addScriptTag({ content: read('public/checador/mi-perfil.js') });
        await page.evaluate(() => {
            currentEmployee = { id: 'ana', name: 'Ana' };
            weeklyRates = { '2026-09-07': 80, '2026-09-14': 90 };
            weeklyRatesReady = true;
            holidaysCache = [{ date: '2026-09-15', customMinutes: 120 }, { date: '2026-09-08', customMinutes: 120 }];
            document.getElementById('pin-login-view').style.display = 'none';
            document.getElementById('profile-content').style.display = 'block';
            renderProfile();
        });
        expect(await page.$eval('#stat-pay', e => e.textContent)).toBe('$180');
        await page.click('#prev-week');
        expect(await page.$eval('#stat-pay', e => e.textContent)).toBe('$160');
    });
});
