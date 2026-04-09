/**
 * Script local para publicar en grupo de Facebook via Puppeteer.
 * Publica como la pagina "AQ Decoraciones" en el grupo "Mujer-ON".
 *
 * Uso:
 *   node scripts/fb-group-publish.js              → publica en grupo
 *   node scripts/fb-group-publish.js --auto       → modo automatico con reintentos
 *   node scripts/fb-group-publish.js --test       → prueba sin mover foto ni reportar
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Configuracion ---
const SERVER_URL = process.env.FBG_SERVER_URL || 'https://app.dekoormx.com';
const CHROME_PATH = process.env.FBG_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_USER_DATA = process.env.FBG_CHROME_USER_DATA || path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data');
const CHROME_PROFILE = process.env.FBG_CHROME_PROFILE || 'Profile 1';
const PHOTOS_FOLDER = process.env.FBG_PHOTOS_FOLDER || 'C:/Users/chris/Pictures/IA AQ/Grupo';
const FB_GROUP_URL = process.env.FBG_GROUP_URL || 'https://www.facebook.com/groups/2280805615341135';
const FB_PAGE_NAME = process.env.FBG_PAGE_NAME || 'AQ Decoraciones';

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
    console.log(`[FB-GROUP] Foto seleccionada: ${filename} (${files.length} disponibles)`);
    return { filename, fullPath };
}

// --- Paso 2: Generar caption via servidor ---
async function generateCaption(imagePath) {
    console.log('[FB-GROUP] Generando caption con IA...');
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const base64 = imageBuffer.toString('base64');

    const res = await fetch(`${SERVER_URL}/api/fb-group/generate-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: mimeMap[ext] || 'image/jpeg' })
    });
    const data = await res.json();
    if (data.error) throw new Error(`Gemini: ${data.error}`);
    console.log(`[FB-GROUP] Caption: ${data.caption}`);
    return data.caption;
}

// --- Paso 3: Automatizar Facebook ---
const { extractFacebookCookies } = require('./chrome-cookies');
const AUTO_PROFILE_DIR = path.join(os.homedir(), '.fb-autopost-profile');

async function launchBrowser() {
    console.log(`[FB-GROUP] Abriendo Chrome...`);

    // Extraer cookies de Facebook del perfil original (NO cierra Chrome)
    console.log('[FB-GROUP] Extrayendo cookies de Facebook...');
    const fbCookies = extractFacebookCookies(CHROME_USER_DATA, CHROME_PROFILE);
    if (!fbCookies.length) throw new Error('No se encontraron cookies de Facebook. Inicia sesion en Chrome.');

    // Usar perfil separado para automatizacion (no conflicta con Chrome abierto)
    if (!fs.existsSync(AUTO_PROFILE_DIR)) {
        fs.mkdirSync(AUTO_PROFILE_DIR, { recursive: true });
    }

    browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir: AUTO_PROFILE_DIR,
        headless: false,
        defaultViewport: null,
        args: ['--no-first-run', '--disable-default-apps', '--start-maximized'],
        ignoreDefaultArgs: ['--enable-automation']
    });
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();

    // Inyectar cookies de Facebook
    console.log(`[FB-GROUP] Inyectando ${fbCookies.length} cookies...`);
    await page.setCookie(...fbCookies);
    console.log('[FB-GROUP] Cookies inyectadas');
}

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(srcPath, destPath);
        else { try { fs.copyFileSync(srcPath, destPath); } catch (e) {} }
    }
}

async function navigateToGroup() {
    console.log(`[FB-GROUP] Navegando al grupo...`);
    await page.goto(FB_GROUP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(3000);

    // Verificar que estamos en el grupo (buscar el feed)
    const feedLoaded = await page.$('div[role="main"], div[role="feed"]');
    if (!feedLoaded) {
        const ssPath = path.join(os.tmpdir(), 'fb-group-debug.png');
        await page.screenshot({ path: ssPath, fullPage: false });
        console.log(`[FB-GROUP] Screenshot: ${ssPath}`);
        throw new Error('No se pudo cargar el grupo de Facebook');
    }
    console.log('[FB-GROUP] Grupo cargado');
}

async function createPostWithPhoto(imagePath, caption) {
    console.log('[FB-GROUP] Creando publicacion...');

    // 1. Click en "Escribe algo..." para abrir el compositor
    // Debug: screenshot y textos disponibles
    const ssGroup = path.join(os.tmpdir(), 'fb-group-loaded.png');
    await page.screenshot({ path: ssGroup, fullPage: false });

    const composerClicked = await page.evaluate(() => {
        const candidates = [];
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
            const text = s.textContent?.trim().toLowerCase();
            if (text && (text.includes('escribe') || text.includes('write') || text.includes('comparte') || text.includes('qué estás pensando') || text.includes('publica algo'))) {
                candidates.push(text);
                s.click();
                return { clicked: true, text };
            }
        }
        // Fallback: buscar el area de publicacion por aria-label
        const composers = document.querySelectorAll('[aria-label*="Crea una publicación"], [aria-label*="Create a post"], [role="button"]');
        for (const c of composers) {
            const text = c.textContent?.trim();
            if (text && (text.includes('Escribe') || text.includes('pensando') || text.includes('Publica'))) {
                c.click();
                return { clicked: true, text };
            }
        }
        return { clicked: false, candidates };
    });
    if (!composerClicked.clicked) {
        console.log('[FB-GROUP] DEBUG: No se encontro compositor');
        console.log(`[FB-GROUP] Screenshot: ${ssGroup}`);
        throw new Error('No se encontro el compositor de publicacion');
    }
    console.log(`[FB-GROUP] Compositor abierto: "${composerClicked.text}"`);
    await delay(3000);

    // 2. Verificar/cambiar identidad a la pagina AQ Decoraciones
    await switchToPage();

    // 3. Subir foto: click en "Foto/video"
    const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const text = walker.currentNode.textContent.trim().toLowerCase();
                if (text === 'foto/video' || text === 'foto/vídeo' || text === 'photo/video') {
                    const el = walker.currentNode.parentElement;
                    const clickTarget = el.closest('[role="button"], button, [tabindex]') || el;
                    clickTarget.click();
                    return true;
                }
            }
            return false;
        })
    ]);
    console.log('[FB-GROUP] File chooser interceptado, subiendo foto...');
    await fileChooser.accept([imagePath]);
    await delay(5000);

    // 4. Escribir caption en el campo de texto del dialogo
    const captionWritten = await page.evaluate((text) => {
        // Buscar contenteditable dentro del dialogo de publicacion
        const dialog = document.querySelector('div[role="dialog"]');
        const container = dialog || document.body;
        const editables = container.querySelectorAll('div[contenteditable="true"]');
        for (const el of editables) {
            const br = el.querySelector('br');
            const placeholder = el.getAttribute('aria-label') || el.getAttribute('data-placeholder');
            if (placeholder || br || el.textContent === '') {
                el.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, text);
                return true;
            }
        }
        return false;
    }, caption);

    if (captionWritten) console.log('[FB-GROUP] Caption escrito');
    else console.log('[FB-GROUP] AVISO: No se pudo escribir el caption');

    await delay(2000);

    // Screenshot antes de publicar
    const ssPath = path.join(os.tmpdir(), 'fb-group-preview.png');
    await page.screenshot({ path: ssPath, fullPage: false });

    // 5. Click en "Publicar"
    const published = await page.evaluate(() => {
        const buttons = document.querySelectorAll('div[role="button"], button');
        for (const btn of buttons) {
            const text = btn.textContent?.trim();
            const label = btn.getAttribute('aria-label') || '';
            if (text === 'Publicar' || text === 'Post' || label === 'Publicar' || label === 'Post') {
                btn.click();
                return true;
            }
        }
        return false;
    });

    if (!published) throw new Error('No se encontro el boton "Publicar"');
    console.log('[FB-GROUP] Publicacion enviada, esperando confirmacion...');
    await delay(8000);
    console.log('[FB-GROUP] Publicacion completada!');
}

async function switchToPage() {
    console.log(`[FB-GROUP] Verificando identidad de publicacion (${FB_PAGE_NAME})...`);

    // Buscar si hay opcion para cambiar identidad en el dialogo
    const switched = await page.evaluate((pageName) => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return 'no-dialog';

        // Buscar boton/link que diga el nombre de la pagina o "Publicar como"
        const allElements = dialog.querySelectorAll('span, div[role="button"], img[alt]');
        for (const el of allElements) {
            const text = el.textContent?.trim();
            const alt = el.getAttribute('alt') || '';
            // Si ya dice AQ Decoraciones, ya estamos publicando como la pagina
            if (text?.includes(pageName) || alt?.includes(pageName)) {
                return 'already-page';
            }
        }

        // Buscar dropdown de identidad (icono de flecha o "Publicar como")
        const buttons = dialog.querySelectorAll('div[role="button"], [aria-haspopup]');
        for (const btn of buttons) {
            const ariaLabel = btn.getAttribute('aria-label') || '';
            if (ariaLabel.includes('Publicar como') || ariaLabel.includes('Post as')) {
                btn.click();
                return 'clicked-dropdown';
            }
        }

        return 'not-found';
    }, FB_PAGE_NAME);

    console.log(`[FB-GROUP] Identidad: ${switched}`);

    if (switched === 'clicked-dropdown') {
        await delay(1500);
        // Seleccionar la pagina del dropdown
        const selected = await page.evaluate((pageName) => {
            const items = document.querySelectorAll('div[role="menuitem"], div[role="option"], div[role="radio"], span');
            for (const item of items) {
                if (item.textContent?.includes(pageName)) {
                    item.click();
                    return true;
                }
            }
            return false;
        }, FB_PAGE_NAME);
        if (selected) {
            console.log(`[FB-GROUP] Cambiado a ${FB_PAGE_NAME}`);
            await delay(1000);
        }
    }
}

// --- Paso 4: Mover foto y reportar ---
function moveToPublished(filename) {
    const publishedDir = path.join(PHOTOS_FOLDER, 'publicados');
    if (!fs.existsSync(publishedDir)) fs.mkdirSync(publishedDir, { recursive: true });
    const src = path.join(PHOTOS_FOLDER, filename);
    const dest = path.join(publishedDir, filename);
    if (fs.existsSync(src)) fs.renameSync(src, dest);
    console.log('[FB-GROUP] Foto movida a publicados/');
}

async function reportPublished(filename, caption) {
    console.log('[FB-GROUP] Reportando al servidor...');
    try {
        const res = await fetch(`${SERVER_URL}/api/fb-group/mark-published`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, caption })
        });
        const data = await res.json();
        console.log(`[FB-GROUP] Servidor: ${data.status}`);
    } catch (e) {
        console.log(`[FB-GROUP] Aviso: no se pudo reportar al servidor (${e.message})`);
    }
}

// --- Utilidades ---
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function closeBrowser() {
    if (browser) {
        try { browser.disconnect(); } catch (e) {}
        browser = null;
        page = null;
    }
}

// --- Flujo principal ---
async function publish(isTest) {
    try {
        const photo = pickLocalPhoto();
        const caption = await generateCaption(photo.fullPath);

        await launchBrowser();
        await navigateToGroup();
        await createPostWithPhoto(photo.fullPath, caption);

        if (!isTest) {
            moveToPublished(photo.filename);
            await reportPublished(photo.filename, caption);
        } else {
            console.log('[FB-GROUP] Modo prueba: foto NO movida ni reportada');
        }

        console.log('\n[FB-GROUP] Publicacion completada exitosamente!');
        return true;
    } catch (error) {
        console.error(`\n[FB-GROUP] ERROR: ${error.message}`);
        return false;
    } finally {
        await closeBrowser();
    }
}

async function main() {
    const arg = process.argv[2];
    const isAuto = arg === '--auto';
    const isTest = arg === '--test';
    const isSetup = arg === '--setup';

    // Modo setup: abre Chrome en Facebook para que inicies sesion
    if (isSetup) {
        console.log('[FB-GROUP] Modo setup: verificando perfil de Chrome...');
        try {
            const { execSync } = require('child_process');
            if (!fs.existsSync(CHROME_SYMLINK)) {
                execSync(`mklink /J "${CHROME_SYMLINK}" "${CHROME_USER_DATA}"`, { stdio: 'ignore' });
            }
            const b = await puppeteer.launch({
                executablePath: CHROME_PATH,
                userDataDir: CHROME_SYMLINK,
                headless: false,
                defaultViewport: null,
                args: [`--profile-directory=${CHROME_PROFILE}`, '--no-first-run', '--start-maximized'],
                ignoreDefaultArgs: ['--enable-automation']
            });
            const p = (await b.pages())[0];
            await p.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
            console.log('[FB-GROUP] Chrome abierto en Facebook. Inicia sesion con la cuenta de Christian.');
            console.log('[FB-GROUP] Cuando termines, cierra Chrome y el setup se completa.');
            await b.waitForTarget(() => false, { timeout: 0 }).catch(() => {});
        } catch (e) {
            if (!e.message.includes('Target closed')) console.error('[FB-GROUP] Error:', e.message);
        }
        console.log('[FB-GROUP] Setup completado. Ahora puedes usar: node scripts/fb-group-publish.js --test');
        return;
    }
    const RETRY_INTERVAL = 60 * 60 * 1000;
    const MAX_RETRIES = 12;

    if (!isAuto) {
        const ok = await publish(isTest);
        if (!ok) process.exitCode = 1;
        return;
    }

    console.log('[AUTO] Modo automatico activado. Reintentara cada hora si falla.');
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`\n[AUTO] Intento ${attempt}/${MAX_RETRIES} - ${new Date().toLocaleString('es-MX')}`);
        const ok = await publish(false);
        if (ok) return;
        if (attempt < MAX_RETRIES) {
            console.log('[AUTO] Reintentando en 1 hora...');
            await delay(RETRY_INTERVAL);
        }
    }
    console.error('[AUTO] Se agotaron los reintentos.');
    process.exitCode = 1;
}

main();
