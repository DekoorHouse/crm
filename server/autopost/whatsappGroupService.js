const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { generateGeminiResponse } = require('../services');
const { db } = require('../config');

// --- Configuracion ---
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_USER_DATA = 'C:/Users/chris/AppData/Local/Google/Chrome/User Data';
const CHROME_PROFILE = process.env.WA_CHROME_PROFILE || 'Profile 2';
const PHOTOS_FOLDER = process.env.WA_PHOTOS_FOLDER || 'C:/Users/chris/Pictures/IA Dekoor/Grupo';
const GROUP_NAME = process.env.WA_GROUP_NAME || 'Referencias Dekoor';
const WA_LOG_COLLECTION = 'wa_group_post_log';

const WHATSAPP_CAPTION_PROMPT = `Eres el community manager de Dekoor, una tienda mexicana de decoracion y hogar con grabado laser personalizado.
Analiza esta imagen de producto y genera un mensaje para publicar en un grupo de WhatsApp de clientes.

Reglas:
- Escribe en espanol mexicano, tono amigable, calido y cercano (como hablando con amigos)
- Usa emojis relevantes (5-8 emojis)
- Maximo 250 caracteres
- Incluye un llamado a la accion directo (ej: "Escribenos para personalizar el tuyo", "Pide el tuyo por inbox", "Pregunta por precios")
- La marca SIEMPRE se escribe "Dekoor" (con doble o, k minuscula)
- NO incluyas hashtags
- NO uses formato de redes sociales, esto es WhatsApp - se casual y directo
- Si el producto tiene grabado laser, mencionalo como ventaja
- Si no identificas el producto, genera un mensaje generico sobre novedades de Dekoor

Responde SOLO con el mensaje, sin explicaciones adicionales.`;

let browserInstance = null;
let pageInstance = null;

// --- Gestion de fotos locales ---

function getAvailablePhotos() {
    if (!fs.existsSync(PHOTOS_FOLDER)) {
        console.log(`[WA-GROUP] Carpeta no encontrada: ${PHOTOS_FOLDER}`);
        return [];
    }
    const files = fs.readdirSync(PHOTOS_FOLDER);
    return files
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .map(f => ({
            filename: f,
            fullPath: path.join(PHOTOS_FOLDER, f),
            size: fs.statSync(path.join(PHOTOS_FOLDER, f)).size
        }));
}

async function pickUnpostedLocalPhoto() {
    const photos = getAvailablePhotos();
    if (!photos.length) return null;

    // Obtener fotos ya publicadas
    const logSnapshot = await db.collection(WA_LOG_COLLECTION)
        .where('status', '==', 'success')
        .select('photoFilename')
        .get();
    const postedFiles = new Set(logSnapshot.docs.map(d => d.data().photoFilename));

    const unposted = photos.filter(p => !postedFiles.has(p.filename));
    if (!unposted.length) return null;

    return unposted[0];
}

// --- Generar caption con Gemini ---

async function generateWhatsAppCaption(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    const base64Image = imageBuffer.toString('base64');
    const imageParts = [{ inlineData: { mimeType, data: base64Image } }];

    const result = await generateGeminiResponse(WHATSAPP_CAPTION_PROMPT, imageParts);
    let caption = result.text.replace(/^["']|["']$/g, '').trim();
    console.log(`[WA-GROUP] Caption generado (${result.inputTokens} in / ${result.outputTokens} out): ${caption}`);
    return caption;
}

// --- Automatizacion de WhatsApp Web ---

async function launchBrowser() {
    console.log(`[WA-GROUP] Abriendo Chrome con perfil: ${CHROME_PROFILE}`);

    try {
        browserInstance = await puppeteer.launch({
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
    } catch (err) {
        if (err.message.includes('Failed to launch') || err.message.includes('lock') || err.message.includes('already')) {
            throw new Error('Chrome ya esta abierto. Cierra todas las ventanas de Chrome e intenta de nuevo.');
        }
        throw err;
    }

    const pages = await browserInstance.pages();
    pageInstance = pages[0] || await browserInstance.newPage();
    return browserInstance;
}

async function closeBrowser() {
    if (browserInstance) {
        try {
            await browserInstance.close();
        } catch (e) {
            console.log('[WA-GROUP] Browser ya estaba cerrado');
        }
        browserInstance = null;
        pageInstance = null;
    }
}

async function navigateToWhatsApp() {
    if (!pageInstance) throw new Error('Browser no esta abierto');

    console.log('[WA-GROUP] Navegando a WhatsApp Web...');
    await pageInstance.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });

    // Esperar a que cargue WhatsApp (buscar el buscador de chats)
    console.log('[WA-GROUP] Esperando que WhatsApp Web cargue...');
    await pageInstance.waitForSelector('div[contenteditable="true"][data-tab="3"]', { timeout: 90000 });
    console.log('[WA-GROUP] WhatsApp Web cargado correctamente');
}

async function searchAndOpenGroup(groupName) {
    if (!pageInstance) throw new Error('Browser no esta abierto');

    console.log(`[WA-GROUP] Buscando grupo: "${groupName}"...`);

    // Click en el buscador de chats
    const searchBox = await pageInstance.waitForSelector('div[contenteditable="true"][data-tab="3"]', { timeout: 15000 });
    await searchBox.click();
    await new Promise(r => setTimeout(r, 500));

    // Limpiar y escribir el nombre del grupo
    await pageInstance.keyboard.down('Control');
    await pageInstance.keyboard.press('a');
    await pageInstance.keyboard.up('Control');
    await pageInstance.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 300));

    await searchBox.type(groupName, { delay: 80 });
    await new Promise(r => setTimeout(r, 2000));

    // Buscar el resultado del grupo y hacer click
    const groupResult = await pageInstance.waitForSelector(`span[title="${groupName}"]`, { timeout: 10000 });
    await groupResult.click();
    await new Promise(r => setTimeout(r, 1500));

    console.log(`[WA-GROUP] Grupo "${groupName}" abierto`);
}

async function sendImageWithCaption(imagePath, caption) {
    if (!pageInstance) throw new Error('Browser no esta abierto');

    console.log('[WA-GROUP] Enviando imagen con caption...');

    // Click en el boton de adjuntar (clip / +)
    const attachBtn = await pageInstance.waitForSelector('div[title="Adjuntar"], div[title="Adjunta"], span[data-icon="plus"], span[data-icon="clip"]', { timeout: 10000 });
    await attachBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // Buscar el input de archivo para fotos/videos
    const fileInput = await pageInstance.waitForSelector('input[accept*="image"]', { timeout: 10000 });
    await fileInput.uploadFile(imagePath);
    await new Promise(r => setTimeout(r, 3000));

    // Esperar la pantalla de preview y escribir caption
    const captionBox = await pageInstance.waitForSelector(
        'div[contenteditable="true"][data-tab="10"], div.copyable-text.selectable-text[contenteditable="true"]:not([data-tab="3"])',
        { timeout: 15000 }
    );
    await captionBox.click();
    await new Promise(r => setTimeout(r, 500));

    // Escribir caption caracter por caracter para manejar emojis
    await pageInstance.evaluate((text) => {
        const event = new Event('input', { bubbles: true });
        const el = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                   document.querySelectorAll('div.copyable-text.selectable-text[contenteditable="true"]')[1];
        if (el) {
            el.focus();
            document.execCommand('insertText', false, text);
            el.dispatchEvent(event);
        }
    }, caption);

    await new Promise(r => setTimeout(r, 1500));

    // Click en el boton de enviar
    const sendBtn = await pageInstance.waitForSelector('span[data-icon="send"], div[aria-label="Enviar"], div[aria-label="Send"]', { timeout: 10000 });
    await sendBtn.click();
    await new Promise(r => setTimeout(r, 3000));

    console.log('[WA-GROUP] Imagen enviada exitosamente');
}

// --- Flujo completo ---

async function executeWhatsAppGroupPost() {
    const logEntry = {
        startedAt: new Date(),
        status: 'in_progress',
        groupName: GROUP_NAME
    };

    try {
        // 1. Seleccionar foto
        console.log('[WA-GROUP] Buscando foto no publicada...');
        const photo = await pickUnpostedLocalPhoto();
        if (!photo) {
            logEntry.status = 'skipped';
            logEntry.error = 'No hay fotos disponibles en la carpeta.';
            await saveLog(logEntry);
            return logEntry;
        }
        logEntry.photoFilename = photo.filename;
        logEntry.photoPath = photo.fullPath;
        console.log(`[WA-GROUP] Foto seleccionada: ${photo.filename}`);

        // 2. Generar caption
        console.log('[WA-GROUP] Generando caption con IA...');
        const caption = await generateWhatsAppCaption(photo.fullPath);
        logEntry.caption = caption;

        // 3. Abrir Chrome y WhatsApp
        await launchBrowser();
        await navigateToWhatsApp();

        // 4. Buscar y abrir el grupo
        await searchAndOpenGroup(GROUP_NAME);

        // 5. Enviar imagen con caption
        await sendImageWithCaption(photo.fullPath, caption);

        logEntry.status = 'success';
        logEntry.completedAt = new Date();
        await saveLog(logEntry);

        // 6. Mover foto a carpeta "publicados" para no repetir
        const publishedDir = path.join(PHOTOS_FOLDER, 'publicados');
        if (!fs.existsSync(publishedDir)) fs.mkdirSync(publishedDir, { recursive: true });
        const destPath = path.join(publishedDir, photo.filename);
        fs.renameSync(photo.fullPath, destPath);
        console.log(`[WA-GROUP] Foto movida a: ${destPath}`);

        // 7. Cerrar browser
        await closeBrowser();

        console.log('[WA-GROUP] Publicacion completada exitosamente!');
        return logEntry;

    } catch (error) {
        logEntry.status = 'failed';
        logEntry.error = error.message;
        logEntry.completedAt = new Date();
        await saveLog(logEntry);
        console.error(`[WA-GROUP] Error: ${error.message}`);

        await closeBrowser();
        return logEntry;
    }
}

async function previewWhatsAppPost() {
    const photo = await pickUnpostedLocalPhoto();
    if (!photo) {
        return { message: 'No hay fotos disponibles. Agrega fotos a la carpeta.' };
    }

    const caption = await generateWhatsAppCaption(photo.fullPath);
    const imageBuffer = fs.readFileSync(photo.fullPath);
    const ext = path.extname(photo.fullPath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const base64Image = imageBuffer.toString('base64');

    return {
        filename: photo.filename,
        caption,
        imagePreview: `data:${mimeMap[ext] || 'image/jpeg'};base64,${base64Image}`,
        totalPhotos: getAvailablePhotos().length
    };
}

async function saveLog(entry) {
    try {
        await db.collection(WA_LOG_COLLECTION).add(entry);
    } catch (err) {
        console.error('[WA-GROUP] Error guardando log:', err.message);
    }
}

async function getWhatsAppLog(limit = 20) {
    const snapshot = await db.collection(WA_LOG_COLLECTION)
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function getWhatsAppStatus() {
    const photos = getAvailablePhotos();
    return {
        photosFolder: PHOTOS_FOLDER,
        photosAvailable: photos.length,
        groupName: GROUP_NAME,
        chromeProfile: CHROME_PROFILE,
        browserOpen: browserInstance !== null
    };
}

module.exports = {
    executeWhatsAppGroupPost,
    previewWhatsAppPost,
    getWhatsAppLog,
    getWhatsAppStatus,
    getAvailablePhotos,
    closeBrowser
};
