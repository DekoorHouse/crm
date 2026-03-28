/**
 * Script local para publicar en WhatsApp Web via Puppeteer.
 * Lee fotos de la carpeta local, genera caption via servidor (Gemini),
 * abre Chrome y envia al grupo de WhatsApp.
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
const PHOTOS_FOLDER = process.env.WA_PHOTOS_FOLDER || 'C:/Users/chris/Pictures/IA Dekoor/Grupo';

let browser = null;
let page = null;

// --- Paso 1: Seleccionar foto local ---
function pickLocalPhoto() {
    if (!fs.existsSync(PHOTOS_FOLDER)) throw new Error(`Carpeta no encontrada: ${PHOTOS_FOLDER}`);
    const files = fs.readdirSync(PHOTOS_FOLDER)
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (!files.length) throw new Error('No hay fotos en la carpeta');
    const filename = files[0];
    const fullPath = path.join(PHOTOS_FOLDER, filename);
    console.log(`[LOCAL] Foto seleccionada: ${filename} (${files.length} disponibles)`);
    return { filename, fullPath };
}

// --- Paso 2: Generar caption via servidor (Gemini) ---
async function generateCaption(imagePath) {
    console.log('[LOCAL] Generando caption con IA...');
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const base64 = imageBuffer.toString('base64');

    const res = await fetch(`${SERVER_URL}/api/wa-group/generate-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: mimeMap[ext] || 'image/jpeg' })
    });
    const data = await res.json();
    if (data.error) throw new Error(`Gemini: ${data.error}`);
    console.log(`[LOCAL] Caption: ${data.caption}`);
    return data.caption;
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

// --- Paso 4: Mover foto y reportar al servidor ---
function moveToPublished(filename) {
    const publishedDir = path.join(PHOTOS_FOLDER, 'publicados');
    if (!fs.existsSync(publishedDir)) fs.mkdirSync(publishedDir, { recursive: true });
    const src = path.join(PHOTOS_FOLDER, filename);
    const dest = path.join(publishedDir, filename);
    if (fs.existsSync(src)) fs.renameSync(src, dest);
    console.log(`[LOCAL] Foto movida a publicados/`);
}

async function reportPublished(filename, caption) {
    console.log('[LOCAL] Reportando al servidor...');
    try {
        const res = await fetch(`${SERVER_URL}/api/wa-group/mark-published`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, caption })
        });
        const data = await res.json();
        console.log(`[LOCAL] Servidor: ${data.status}`);
    } catch (e) {
        console.log(`[LOCAL] Aviso: no se pudo reportar al servidor (${e.message})`);
    }
}

// --- Utilidades ---
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function closeBrowser() {
    if (browser) {
        try { await browser.close(); } catch (e) {}
        browser = null;
        page = null;
    }
}

// --- Flujo principal ---
async function main() {
    try {
        // 1. Seleccionar foto local
        const photo = pickLocalPhoto();

        // 2. Generar caption via servidor
        const caption = await generateCaption(photo.fullPath);

        // 3. Abrir Chrome y enviar
        await launchBrowser();
        await navigateToWhatsApp();
        await searchAndOpenGroup();
        await sendImageWithCaption(photo.fullPath, caption);

        // 4. Mover foto y reportar
        moveToPublished(photo.filename);
        await reportPublished(photo.filename, caption);

        console.log('\n[LOCAL] Publicacion completada exitosamente!');
    } catch (error) {
        console.error(`\n[LOCAL] ERROR: ${error.message}`);
        process.exitCode = 1;
    } finally {
        await closeBrowser();
    }
}

main();
