/**
 * Script local para publicar en WhatsApp Web via Puppeteer.
 * Se ejecuta desde la PC local (donde esta Chrome + sesion de WhatsApp).
 *
 * Flujo:
 * 1. Llama al servidor para obtener preview (foto + caption generado por IA)
 * 2. Guarda la imagen temporalmente
 * 3. Abre Chrome con Puppeteer y envia al grupo de WhatsApp
 * 4. Reporta al servidor que la foto fue publicada
 *
 * Uso: node scripts/wa-publish.js
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Configuracion ---
const SERVER_URL = process.env.WA_SERVER_URL || 'https://app.dekoormx.com';
const CHROME_PATH = process.env.WA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_USER_DATA = process.env.WA_CHROME_USER_DATA || path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data');
const CHROME_PROFILE = process.env.WA_CHROME_PROFILE || 'Profile 2';
const GROUP_NAME = process.env.WA_GROUP_NAME || 'Referencias Dekoor';

let browser = null;
let page = null;

// --- Paso 1: Obtener preview del servidor ---
async function getPreview() {
    console.log('[LOCAL] Obteniendo preview del servidor...');
    const res = await fetch(`${SERVER_URL}/api/wa-group/preview`, { method: 'POST' });
    const data = await res.json();
    if (data.message) throw new Error(data.message);
    if (!data.caption || !data.imagePreview) throw new Error('No hay fotos disponibles');
    console.log(`[LOCAL] Foto: ${data.filename}`);
    console.log(`[LOCAL] Caption: ${data.caption}`);
    return data;
}

// --- Paso 2: Guardar imagen temporalmente ---
function saveImageLocally(base64DataUrl, filename) {
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const tempDir = path.join(os.tmpdir(), 'wa-autopost');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    console.log(`[LOCAL] Imagen guardada: ${filePath}`);
    return filePath;
}

// --- Paso 3: Automatizar WhatsApp Web ---
async function launchBrowser() {
    console.log(`[LOCAL] Abriendo Chrome (perfil: ${CHROME_PROFILE})...`);
    browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir: CHROME_USER_DATA,
        headless: false,
        defaultViewport: null,
        args: [
            `--profile-directory=${CHROME_PROFILE}`,
            '--no-first-run',
            '--disable-default-apps',
            '--start-maximized'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
}

async function navigateToWhatsApp() {
    console.log('[LOCAL] Navegando a WhatsApp Web...');
    await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('[LOCAL] Esperando carga de WhatsApp Web...');
    await page.waitForSelector('div[contenteditable="true"][data-tab="3"]', { timeout: 90000 });
    console.log('[LOCAL] WhatsApp Web cargado');
}

async function searchAndOpenGroup() {
    console.log(`[LOCAL] Buscando grupo: "${GROUP_NAME}"...`);
    const searchBox = await page.waitForSelector('div[contenteditable="true"][data-tab="3"]', { timeout: 15000 });
    await searchBox.click();
    await delay(500);

    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await delay(300);

    await searchBox.type(GROUP_NAME, { delay: 80 });
    await delay(2000);

    const groupResult = await page.waitForSelector(`span[title="${GROUP_NAME}"]`, { timeout: 10000 });
    await groupResult.click();
    await delay(1500);
    console.log(`[LOCAL] Grupo "${GROUP_NAME}" abierto`);
}

async function sendImageWithCaption(imagePath, caption) {
    console.log('[LOCAL] Enviando imagen...');

    const attachBtn = await page.waitForSelector('div[title="Adjuntar"], div[title="Adjunta"], span[data-icon="plus"], span[data-icon="clip"]', { timeout: 10000 });
    await attachBtn.click();
    await delay(1000);

    const fileInput = await page.waitForSelector('input[accept*="image"]', { timeout: 10000 });
    await fileInput.uploadFile(imagePath);
    await delay(3000);

    const captionBox = await page.waitForSelector(
        'div[contenteditable="true"][data-tab="10"], div.copyable-text.selectable-text[contenteditable="true"]:not([data-tab="3"])',
        { timeout: 15000 }
    );
    await captionBox.click();
    await delay(500);

    await page.evaluate((text) => {
        const el = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                   document.querySelectorAll('div.copyable-text.selectable-text[contenteditable="true"]')[1];
        if (el) {
            el.focus();
            document.execCommand('insertText', false, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, caption);
    await delay(1500);

    const sendBtn = await page.waitForSelector('span[data-icon="send"], div[aria-label="Enviar"], div[aria-label="Send"]', { timeout: 10000 });
    await sendBtn.click();
    await delay(3000);
    console.log('[LOCAL] Imagen enviada!');
}

// --- Paso 4: Reportar al servidor ---
async function reportPublished(filename, caption) {
    console.log('[LOCAL] Reportando al servidor...');
    const res = await fetch(`${SERVER_URL}/api/wa-group/mark-published`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, caption })
    });
    const data = await res.json();
    console.log(`[LOCAL] Servidor: ${data.status}`);
}

// --- Utilidades ---
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cleanup(imagePath) {
    if (browser) {
        try { await browser.close(); } catch (e) {}
        browser = null;
        page = null;
    }
    if (imagePath && fs.existsSync(imagePath)) {
        try { fs.unlinkSync(imagePath); } catch (e) {}
    }
}

// --- Flujo principal ---
async function main() {
    let imagePath = null;
    try {
        // 1. Obtener preview
        const preview = await getPreview();

        // 2. Guardar imagen local
        imagePath = saveImageLocally(preview.imagePreview, preview.filename);

        // 3. Abrir Chrome y enviar
        await launchBrowser();
        await navigateToWhatsApp();
        await searchAndOpenGroup();
        await sendImageWithCaption(imagePath, preview.caption);

        // 4. Reportar exito
        await reportPublished(preview.filename, preview.caption);

        console.log('\n[LOCAL] Publicacion completada exitosamente!');
    } catch (error) {
        console.error(`\n[LOCAL] ERROR: ${error.message}`);
        process.exitCode = 1;
    } finally {
        await cleanup(imagePath);
    }
}

main();
