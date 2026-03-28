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
const TEMP_PROFILE_DIR = path.join(os.tmpdir(), 'wa-autopost-profile');

async function launchBrowser() {
    console.log(`[LOCAL] Preparando perfil de Chrome...`);

    // Matar cualquier Chrome residual
    try {
        const { execSync } = require('child_process');
        execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' });
        await delay(2000);
    } catch (e) {}

    // Copiar perfil de Chrome a ubicacion temporal (evita lock del singleton)
    const srcProfile = path.join(CHROME_USER_DATA, CHROME_PROFILE);
    const destProfile = path.join(TEMP_PROFILE_DIR, 'Default');

    if (fs.existsSync(TEMP_PROFILE_DIR)) {
        fs.rmSync(TEMP_PROFILE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(destProfile, { recursive: true });

    // Copiar solo los datos esenciales para la sesion de WhatsApp
    const essentialDirs = ['IndexedDB', 'Local Storage', 'Session Storage', 'databases'];
    const essentialFiles = ['Cookies', 'Cookies-journal', 'Preferences', 'Secure Preferences'];

    for (const dir of essentialDirs) {
        const src = path.join(srcProfile, dir);
        if (fs.existsSync(src)) {
            copyDirSync(src, path.join(destProfile, dir));
        }
    }
    for (const file of essentialFiles) {
        const src = path.join(srcProfile, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(destProfile, file));
        }
    }

    console.log(`[LOCAL] Abriendo Chrome con perfil temporal...`);
    browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir: TEMP_PROFILE_DIR,
        headless: false,
        defaultViewport: null,
        args: [
            '--no-first-run',
            '--disable-default-apps',
            '--start-maximized'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
}

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            try { fs.copyFileSync(srcPath, destPath); } catch (e) {}
        }
    }
}

async function navigateToWhatsApp() {
    console.log('[LOCAL] Navegando a WhatsApp Web...');
    await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('[LOCAL] Esperando carga de WhatsApp Web...');

    // Esperar a que cargue el panel de chats (varios selectores posibles)
    const chatListSelector = 'div[aria-label="Lista de chats"], div[aria-label="Chat list"], #pane-side';
    try {
        await page.waitForSelector(chatListSelector, { timeout: 30000 });
        console.log('[LOCAL] WhatsApp Web cargado (sesion activa)');
    } catch (e) {
        const ssPath = path.join(os.tmpdir(), 'wa-debug.png');
        await page.screenshot({ path: ssPath, fullPage: true });
        console.log(`[LOCAL] Screenshot guardado: ${ssPath}`);
        throw new Error('WhatsApp Web no cargo la sesion. Ver screenshot: ' + ssPath);
    }
    await delay(2000);
}

async function searchAndOpenGroup() {
    console.log(`[LOCAL] Buscando grupo: "${GROUP_NAME}"...`);

    // Buscar el campo de busqueda (INPUT o DIV con data-tab="3")
    const searchArea = await page.waitForSelector(
        'input[data-tab="3"], div[contenteditable="true"][data-tab="3"]',
        { timeout: 15000 }
    );
    await searchArea.click();
    await delay(500);

    // Limpiar y escribir
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await delay(300);

    await page.keyboard.type(GROUP_NAME, { delay: 80 });
    await delay(3000);

    // Screenshot para ver resultados de busqueda
    const ssSearch = path.join(os.tmpdir(), 'wa-search-results.png');
    await page.screenshot({ path: ssSearch, fullPage: true });
    console.log(`[DEBUG] Resultados de busqueda: ${ssSearch}`);

    // Buscar el resultado del grupo (intentar varios selectores)
    const groupResult = await page.waitForSelector(
        `span[title="${GROUP_NAME}"], span[title*="Referencias"]`,
        { timeout: 10000 }
    ).catch(() => null);

    if (!groupResult) {
        // Fallback: buscar por texto visible
        const found = await page.evaluate((name) => {
            const spans = document.querySelectorAll('span');
            for (const s of spans) {
                if (s.textContent?.includes(name) || s.textContent?.includes('Referencias')) {
                    s.click();
                    return s.textContent;
                }
            }
            return null;
        }, GROUP_NAME);
        if (!found) throw new Error(`Grupo "${GROUP_NAME}" no encontrado en la busqueda`);
        console.log(`[LOCAL] Grupo encontrado via texto: "${found}"`);
    } else {
        await groupResult.click();
    }
    await delay(1500);
    console.log(`[LOCAL] Grupo "${GROUP_NAME}" abierto`);
}

async function sendImageWithCaption(imagePath, caption) {
    console.log('[LOCAL] Enviando imagen...');

    // Buscar boton de adjuntar (+)
    const attachBtn = await page.waitForSelector(
        'span[data-icon="plus-rounded"], span[data-icon="plus"], ' +
        'span[data-icon="clip"], span[data-icon="attach-menu-plus"]',
        { timeout: 10000 }
    );
    await attachBtn.click();
    await delay(1000);

    const fileInput = await page.waitForSelector('input[accept*="image"], input[type="file"]', { timeout: 10000 });
    await fileInput.uploadFile(imagePath);
    await delay(3000);

    // Esperar el campo de caption (puede ser input o div contenteditable)
    const captionBox = await page.waitForSelector(
        'input[data-tab="10"], div[contenteditable="true"][data-tab="10"], ' +
        'div[contenteditable="true"][role="textbox"]:not([data-tab="3"])',
        { timeout: 15000 }
    );
    await captionBox.click();
    await delay(500);

    // Escribir caption
    const isInput = await captionBox.evaluate(el => el.tagName === 'INPUT');
    if (isInput) {
        await captionBox.evaluate((el, text) => {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, caption);
    } else {
        await page.evaluate((text) => {
            const el = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                       document.querySelector('div[contenteditable="true"][role="textbox"]:not([data-tab="3"])');
            if (el) {
                el.focus();
                document.execCommand('insertText', false, text);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, caption);
    }
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
    // Limpiar perfil temporal
    await delay(1000);
    if (fs.existsSync(TEMP_PROFILE_DIR)) {
        try { fs.rmSync(TEMP_PROFILE_DIR, { recursive: true, force: true }); } catch (e) {}
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
