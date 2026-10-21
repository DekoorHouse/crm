'use strict';
// Lámpara de personaje hecha por el SISTEMA con el editor v2 (primer caso: DH17220, Broly).
// Sigue los mismos pasos que hace una persona en el editor, sin nadie frente a la pantalla:
//   1. toma el pedido (nombre) y la imagen del personaje que mandó el cliente por WhatsApp (la IA
//      descarta la imagen del anuncio, comprobantes de pago y capturas);
//   2. la convierte a grabado con "Convertir a raster" (mismo modelo y prompt que el editor), cuadrada
//      para que el personaje quepa completo en el círculo;
//   3. arma el proyecto del editor (composeLamp.mjs): marco con base blanca, grabado en el PowerClip,
//      nombre en Rows of Sunflowers con su silueta;
//   4. lo guarda en "Proyectos en Firebase" (se abre y corrige en /editor-v2), más la vista previa PNG y
//      el SVG de corte en Storage, y deja el resultado en el pedido (campo autoLamp).
//
// BETA "Diseño IA" (oct-2026): el mismo armado para CUALQUIER pedido que hoy se diseña a mano (foto del
// cliente, personaje sin plantilla, especiales), con VARIAS lámparas por pedido (autoLamp.lamps[]). Una sola
// lectura de la IA (designBriefOrder) decide, por lámpara, de dónde sale su diseño:
//   - "mockup": un mockup que YA le mandamos al cliente (se graba tal cual, con el nombre como viene);
//   - "cliente": una imagen que mandó el cliente;
//   - "ilustracion": una ilustración nueva del estudio de /imagenes (Qwen; gpt-image si la GPU está apagada).
// Después:
//   - si TODAS salen de un mockup y el pedido ya está pagado -> directo a Drive (SVG Corte), sin cliente;
//   - si no -> se le manda a el cliente un previo POR LÁMPARA y su "sí" sube a Drive (designApproval).
// Se dispara a mano, pedido por pedido, desde Pendientes de Diseño (botón "IA BETA").
const crypto = require('crypto');
const sharp = require('sharp');
const { db, bucket, admin } = require('../../config');
const imageStudio = require('../../imagenes/imageStudioService');

const RASTER_MODEL = 'openai/gpt-image-2.5-sunburst';
// BETA: el diseño IA usa Qwen Image 2.1 (GPU propia de /imagenes, mucho más barata). La GPU solo está prendida
// en su horario (qwenPod); si está apagada se usa gpt-image para que el diseño no se quede sin hacer.
const BETA_MODEL = 'dekoor/qwen-image-2.1';
// Qwen alojado en OpenRouter (no necesita prender GPU): el respaldo cuando la GPU propia está apagada, ANTES que
// gpt-image, que tiene problemas con personajes con derechos de autor (Chris, 20-oct-2026).
const QWEN_CLOUD_MODELS = ['qwen/qwen-image-3-pro', 'qwen/qwen-image-3'];
// Sube cuando cambia cómo se ve el previo para el cliente: los ya guardados se vuelven a armar.
const CLIENT_PREVIEW_STYLE = 4;
const RASTER_PROMPT = 'dame el diseño de la imagen con rellenos blancos y fondos negros. En raster engrave con degradado en trama';
// Mockup (foto/render de la lámpara prendida que ya vio el cliente) -> el grabado TAL CUAL, con su texto.
const MOCKUP_PROMPT = 'Esta imagen es un mockup de una lámpara LED de acrílico redonda, encendida. Extrae SOLO el diseño grabado dentro del círculo de acrílico: el dibujo y el texto/nombre EXACTAMENTE como están (mismas letras, misma tipografía, misma pose y posición), centrado y ocupando el cuadro como ocupa el círculo. Quita la base, la mesa, el fondo, los reflejos y el color de la luz. Solo blanco y negro, sin colores: el diseño en BLANCO sobre un fondo NEGRO uniforme de orilla a orilla, sin círculos, marcos ni bordes. En raster engrave con degradado en trama.';
// SIN EL ARO (Chris, 20-oct-2026, unicornio «Mia Valentina»): el modelo copiaba la orilla circular del acrílico que
// brilla en el mockup como una línea alrededor del dibujo; el contorno de la lámpara lo pone el marco, no el grabado.
const NO_RING = 'MUY IMPORTANTE: NO dibujes la línea circular del contorno ni la orilla del acrílico (el aro que brilla alrededor de la lámpara), ni ningún círculo, aro, marco o borde alrededor del diseño: SOLO la imagen del centro (el dibujo y su texto), con el fondo negro liso hasta las orillas.';
// ESTILO (Chris, 20-oct-2026): hay diseños PLANOS (siluetas y rellenos sólidos, tipo vector: el unicornio de
// DH18198) y diseños con TRAMA (dibujos con sombreado, fotos: el T-Rex). A los planos NO se les pide "degradado en
// trama" (el modelo les inventaba sombreado y el brillo de la luz salía como degradado) y se pasan a 1 bit por
// umbral, sin difuminado.
const FLAT_STYLE = 'Diseño PLANO: rellenos SÓLIDOS en blanco y negro puro (tipo silueta / vector), SIN degradados, SIN trama, SIN sombreado y SIN el brillo ni el resplandor de la luz.';
// Pedirlo en la indicación de Rehacer: «solo blanco y negro», «sin degradado»… (o al revés, «con degradado»).
const FLAT_HINT = /sin\s+(degradad|trama|sombread)|solo\s+blanco\s+y\s+negro|blanco\s+y\s+negro\s+puro|\bplan[oa]\b|s[oó]lid[oa]s?/i;
const TRAMA_HINT = /con\s+(degradad|trama|sombread)/i;
// Modelos del catálogo que son de rellenos sólidos (siempre «plano»).
const FLAT_MODELS = /unicornio/i;
const styled = (prompt, estilo) => estilo === 'plano'
    ? (/raster engrave con degradado en trama/i.test(prompt) ? prompt.replace(/en raster engrave con degradado en trama\.?/i, FLAT_STYLE) : `${prompt}. ${FLAT_STYLE}`)
    : prompt;
// Mockup cuyo TEXTO cambió después de que lo vio el cliente (DH18191: "el apellido es…"): solo el dibujo, sin
// letras; el texto final lo pone composeLamp con la fuente de siempre.
const MOCKUP_NO_TEXT_PROMPT = MOCKUP_PROMPT.replace('Extrae SOLO el diseño grabado dentro del círculo de acrílico: el dibujo y el texto/nombre EXACTAMENTE como están (mismas letras, misma tipografía, misma pose y posición)', 'Extrae SOLO el DIBUJO grabado dentro del círculo de acrílico, EXACTAMENTE como está (misma pose y posición), SIN NINGÚN TEXTO NI LETRAS: borra el nombre y rellena ese hueco con el fondo');
// Último paso del equipo: "Convertir a mapa de bits" en difuminado (1 bit, Floyd–Steinberg) a la
// resolución de la láser, al tamaño real que la imagen tiene en el marco.
const BITMAP = { dpi: 254, method: 'diffusion', threshold: 128 };
let bitmapModule = null;
const bitmapTools = () => (bitmapModule ||= import('../../../public/editor-v2/bitmap.mjs'));
const FONT_PATH = 'editor-v2/fonts/rows-of-sunflowers.ttf';
const VISION_MODEL = 'gemini-3-flash-preview';
const BRIEF_FALLBACK_MODELS = ['gemini-3.1-pro-preview'];
const ACTOR = { uid: 'auto-lamp' };
const STORAGE_DIR = 'auto-lamp';

const now = () => admin.firestore.FieldValue.serverTimestamp();
let composer = null;
const composerModule = () => (composer ||= import('./composeLamp.mjs'));
let fontCache = null;

async function findOrder(dh) {
    const snapshot = await db.collection('pedidos').where('consecutiveOrderNumber', '==', Number(dh)).limit(1).get();
    if (snapshot.empty) throw Object.assign(new Error(`No encontré el pedido DH${dh}.`), { status: 404 });
    return snapshot.docs[0];
}

// El nombre a grabar: "Nombre: MAURICIO | Personaje: Broly | ...".
function orderName(order) {
    const datos = (Array.isArray(order.items) ? order.items.map(item => item.datosProducto).filter(Boolean).join(' | ') : '') || order.datosProducto || '';
    const match = datos.match(/nombres?\s*:\s*([^|\n]+)/i);
    const name = (match ? match[1] : '').trim();
    if (!name) throw Object.assign(new Error('El pedido no trae "Nombre:" en sus datos.'), { status: 422 });
    return { name, datos };
}

// Las lámparas del pedido: una por producto (items[]); la cantidad son copias del MISMO diseño.
function orderLamps(order) {
    const items = Array.isArray(order.items) && order.items.length ? order.items
        : [{ producto: order.producto || '', datosProducto: order.datosProducto || '', cantidad: order.cantidad || 1 }];
    return items.map((item, index) => {
        const datos = String(item.datosProducto || '').trim();
        const name = (datos.match(/nombres?\s*:\s*([^|\n]+)/i) || [])[1];
        // El personaje va en el nombre de la lámpara cuando el producto no lo dice ("Lámpara infantil" ×2 con
        // rana y Stitch se llamaban igual y la IA las confundía, DH18186).
        const producto = String(item.producto || '').trim(), personaje = ((datos.match(/personaje\s*:\s*([^|\n]+)/i) || [])[1] || '').trim();
        const conPersonaje = personaje && !producto.toLowerCase().includes(personaje.toLowerCase()) ? personaje : '';
        return { index, producto, datos, personaje, copies: Math.max(1, parseInt(item.cantidad, 10) || 1),
            label: [producto, conPersonaje, name && name.trim()].filter(Boolean).join(' · ') || `Lámpara ${index + 1}` };
    });
}

// Las lámparas ya diseñadas (los pedidos de antes de oct-2026 guardaban UNA sola en la raíz de autoLamp).
function lampsOf(autoLamp) {
    if (!autoLamp) return [];
    if (Array.isArray(autoLamp.lamps)) return autoLamp.lamps;
    if (!autoLamp.projectId) return [];
    return [{ index: 0, label: autoLamp.name || '', copies: 1, status: 'ready', projectId: autoLamp.projectId, projectRevision: autoLamp.projectRevision || 1,
        previewUrl: autoLamp.previewUrl || null, brief: autoLamp.brief || null, rasterUrl: autoLamp.rasterUrl || null,
        rasterModel: autoLamp.rasterModel || null, clientPreviewUrl: autoLamp.clientPreviewUrl || null,
        clientPreviewRevision: autoLamp.clientPreviewRevision || null, clientPreviewStyle: autoLamp.clientPreviewStyle || null }];
}

// ¿Pagado? (comprobante validado o estatus de pago/producción).
const isPaid = order => !!order.comprobanteValidadoAt || /^(pagado|fabricar|diseñado|dise[ñn]ado por ia)$/i.test(String(order.estatus || '').trim());

// Imágenes que mandó el CLIENTE (no las nuestras: anuncios, respuestas automáticas).
async function customerImages(contactId) {
    const ours = process.env.PHONE_NUMBER_ID;
    const snapshot = await db.collection('contacts_whatsapp').doc(String(contactId)).collection('messages').orderBy('timestamp', 'asc').get();
    // Además de las fotos, el modelo que eligió del CATÁLOGO del sitio ("quiero personalizar este modelo…" trae el
    // link de la imagen, no una foto; DH18289 «Amigo de la Creación»): esa imagen cuenta como suya.
    return snapshot.docs.map(doc => doc.data())
        .filter(m => m.status !== 'sent' && (!ours || m.from !== ours))
        .flatMap(m => {
            const at = m.timestamp?.toDate?.() || null;
            if (m.fileUrl && /^image\//.test(m.fileType || '')) return [{ url: m.fileUrl, text: m.text || '', at }];
            const links = String(m.text || '').match(CATALOG_IMAGE) || [];
            const model = (String(m.text || '').match(/"([^"]{2,80})"/) || [])[1];
            return links.map(url => ({ url, text: `modelo del CATÁLOGO que eligió el cliente${model ? `: «${model}»` : ''}`, at, catalog: true }));
        });
}
const CATALOG_IMAGE = /https:\/\/app\.dekoormx\.com\/sitio\/img\/[^\s"'<>]+\.(?:webp|jpe?g|png)/gi;

// Imágenes que mandamos NOSOTROS (aquí van los mockups que ya vio el cliente, y también datos de pago, etc.).
async function ourImages(contactId) {
    // Lo que manda el cliente trae from = su id (así lo consulta designApproval); lo demás es nuestro.
    // TODO el chat, no los últimos mensajes: en un reenvío o una conversación larga el mockup quedaba fuera
    // (DH17854: 206 mensajes, los mockups eran el 47 y 48 y solo se veían los últimos 150). Los anuncios y los
    // datos de pago (respuestas rápidas con imagen) nunca son el diseño: se quitan para no gastar lugar.
    const snapshot = await db.collection('contacts_whatsapp').doc(String(contactId)).collection('messages').orderBy('timestamp', 'asc').get();
    return snapshot.docs.map(doc => doc.data())
        .filter(m => m.fileUrl && /^image\//.test(m.fileType || '') && String(m.from || '') !== String(contactId) && !NOT_A_DESIGN.test(String(m.text || '')))
        .map(m => ({ url: m.fileUrl, text: m.text || '', at: m.timestamp?.toDate?.() || null }));
}
const NOT_A_DESIGN = /últimas lámparas disponibles|información del pago|info(rmaci[oó]n)? para (el )?pago|datos (bancarios|de pago)|recuerda enviar tu comprobante|tu pago sea por|clabe/i;

// Conversación reciente (texto de los dos lados) para que la IA entienda qué pidió el cliente.
async function chatHistory(contactId, limit = 200) {
    const ours = process.env.PHONE_NUMBER_ID;
    const snapshot = await db.collection('contacts_whatsapp').doc(String(contactId)).collection('messages').orderBy('timestamp', 'desc').limit(limit).get();
    return snapshot.docs.reverse().map(doc => doc.data()).filter(m => !m.internal && (m.text || m.fileUrl)).map(m => {
        const client = m.status !== 'sent' && (!ours || m.from !== ours);
        const media = m.fileUrl ? `[${/^image\//.test(m.fileType || '') ? 'imagen' : 'archivo'}] ` : '';
        return `${client ? 'CLIENTE' : 'NOSOTROS'}: ${media}${String(m.text || '').replace(/\s+/g, ' ').slice(0, 400)}`;
    }).join('\n').slice(-20000);
}

async function geminiJson(parts) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_IMAGE_KEY;
    if (!apiKey) throw new Error('Falta GEMINI_API_KEY para leer el pedido.');
    // Gemini a veces responde 429/500/503 (saturado): reintenta y luego prueba un modelo de respaldo.
    const body = JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } });
    // Una respuesta que no se puede leer (cortada, con texto alrededor, vacía porque se bloqueó) ya no tumba el
    // pedido a la primera (DH18289, 20-oct-2026): se rescata el JSON si se puede y si no se reintenta.
    const parse = data => {
        const candidate = data.candidates?.[0] || {};
        const text = (candidate.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
        try { return { json: JSON.parse(text) }; } catch (_) { /* se intenta rescatar */ }
        const start = text.indexOf('{'), end = text.lastIndexOf('}');
        if (start >= 0 && end > start) { try { return { json: JSON.parse(text.slice(start, end + 1)) }; } catch (_) { /* nada */ } }
        const why = data.promptFeedback?.blockReason ? `bloqueada (${data.promptFeedback.blockReason})`
            : candidate.finishReason && candidate.finishReason !== 'STOP' ? `cortada (${candidate.finishReason})` : text ? 'no era JSON' : 'vacía';
        return { why };
    };
    let lastProblem = '';
    for (const model of [VISION_MODEL, VISION_MODEL, VISION_MODEL, ...BRIEF_FALLBACK_MODELS]) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(120000),
        }).catch(() => null);
        if (response?.ok) {
            const data = await response.json().catch(() => ({}));
            const { json, why } = parse(data);
            if (json) return json;
            // Bloqueo del filtro de Gemini (PROHIBITED_CONTENT, DH18289): reintentar igual no sirve; quien llama
            // puede quitar la imagen que lo provoca.
            if (data.promptFeedback?.blockReason) throw Object.assign(new Error(`La IA no pudo leer el pedido (respuesta ${why}).`), { blocked: true });
            lastProblem = `respuesta ${why}`;
            console.warn(`[AUTO-LAMP] ${model}: ${lastProblem}; reintento.`);
            continue;
        }
        lastProblem = `error ${response?.status || 'sin respuesta'}`;
        if (response && ![429, 500, 502, 503, 504].includes(response.status)) break;
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error(`La IA no pudo leer el pedido (${lastProblem}). Intenta de nuevo en unos minutos.`);
}

// ¿Gemini bloquea esta imagen sola? (para quitarla de la lectura del pedido).
async function imageBlocked(part) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_IMAGE_KEY;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Describe esta imagen en 3 palabras.' }, part] }] }),
    }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => ({})) : {};
    return !!data.promptFeedback?.blockReason || /PROHIBITED|SAFETY|BLOCKLIST|SPII/.test(data.candidates?.[0]?.finishReason || '');
}

async function imagePart(url) {
    const { buffer } = await download(url);
    const small = await sharp(buffer).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } };
}

/**
 * BETA: la IA lee el pedido COMPLETO (todas sus lámparas) + el chat + las imágenes del cliente y las nuestras,
 * y decide el diseño de CADA lámpara. note: indicación del equipo o cambio que pidió el cliente; con
 * `previous` (lo ya diseñado) también dice qué lámparas hay que rehacer ("cambia").
 */
async function designBriefOrder({ order, lamps, history, clientImages, sentImages, note, previous = [] }) {
    const client = clientImages.slice(-6), sent = sentImages.slice(-10);
    const lampList = lamps.map(l => `L${l.index}: ${l.producto || 'Lámpara'} — datos: "${l.datos || '(sin datos)'}"${l.copies > 1 ? ` — cantidad ${l.copies} (iguales)` : ''}`).join('\n');
    const prevList = previous.length ? previous.map(p => `L${p.index}: ya diseñada (${p.brief?.resumen || p.label || ''})`).join('\n') : '';
    const parts = [{ text: `Eres el diseñador de DekoorHouse. Hacemos lámparas LED de acrílico grabado con láser: un marco redondo con base, y dentro se GRABA una imagen en blanco y negro (raster con trama) y, si el cliente lo pidió, un NOMBRE/TEXTO.
Este pedido trae ${lamps.length} lámpara(s) DISTINTAS; decide el diseño de CADA una por separado:
${lampList}

${note ? `INDICACIÓN / CAMBIO PEDIDO (tiene prioridad sobre todo lo demás): "${note}"\n` : ''}${prevList ? `Lo que ya está diseñado:\n${prevList}\n` : ''}
Conversación reciente (lo más nuevo al final):
${history || '(sin mensajes)'}

Abajo van las imágenes. Las del CLIENTE se llaman C0, C1…; las que mandamos NOSOTROS se llaman N0, N1… (entre las nuestras puede haber MOCKUPS: imágenes de la lámpara terminada o prendida con el diseño y el nombre que ya le enseñamos al cliente; también hay datos de pago, catálogo, etc.).
OJO: el cliente puede cambiar de opinión varias veces (pedir otro personaje y luego regresar al primero). Las lámparas que hay que diseñar son SOLO las de la lista de arriba (lo que quedó registrado): un mockup de una opción que el cliente DESCARTÓ no se usa para nada. Busca el mockup que corresponda al PERSONAJE de cada lámpara aunque sea de antes.
Para CADA lámpara decide:
- "fuente": "mockup" si entre las imágenes N hay un mockup de ESA lámpara (mismo personaje/diseño y nombre), o si la imagen es una C marcada «modelo del CATÁLOGO» de ese personaje (es la foto de muestra de la lámpara, con un nombre de ejemplo que NO es el del cliente); "cliente" si hay que grabar una foto/imagen que mandó el cliente; "ilustracion" si no hay imagen que sirva y hay que dibujarla desde cero.
- "imagen": la imagen elegida ("N2", "C0"…), o VARIAS separadas por coma si hay que JUNTAR fotos en una sola escena (ej. "C1,C2" para unir a dos personas que vienen en fotos distintas; máximo 4), o "" si es ilustración desde cero. NUNCA comprobantes de pago, capturas de transferencias, datos bancarios, tickets ni capturas de chat. Un mockup solo vale para la lámpara cuyo nombre/diseño coincide.
- "prompt": si es ilustración, describe en español la ilustración a generar (personaje, pose, estilo), SIN texto ni letras. Si es foto del cliente, qué conservar o ajustar (ej. "solo las dos personas, sin el fondo") o "". Si es mockup, "" SALVO que haya que CAMBIAR algo del dibujo (por la INDICACIÓN o porque el cliente lo pidió: «que tenga solo dos pies», «sin la corona», «con los ojos abiertos»): entonces escribe SOLO ese cambio, claro y concreto. NUNCA pidas escribir el nombre ni ningún texto en la imagen: el nombre lo agrega el sistema aparte (si la imagen trae letras, pide quitarlas). ÚNICA excepción: "textoEnImagen" true.
- "nombre": el texto FINAL a grabar (nombre(s), apellidos, fecha, frase) con lo ÚLTIMO que pidió el cliente: si después del mockup o de registrar el pedido escribió algo como "el apellido es…", "agrégale…", "ponle también…", "mejor que diga…", eso CAMBIA o SE SUMA al texto. Cada nombre y apellido con inicial mayúscula y sus acentos (ej. "Domínguez Quintana"). "" si no lleva texto. NUNCA pongas marcadores o huecos como "(Fecha de fallecimiento)", "XX/XX" o "[nombre]": si el cliente pidió un dato que todavía no da, déjalo FUERA del texto y anótalo en "advertencias". Si es largo, pártelo en renglones con " · " (ej. "Victor Emilio · Domínguez Quintana").
- "textoEnImagen": true SOLO si la INDICACIÓN (o el cliente) pide que la IA integre/escriba el texto DENTRO de la imagen, todo junto como un solo diseño; entonces el texto de "nombre" lo dibuja el modelo de imágenes y el sistema no agrega otro. false en cualquier otro caso.
- "textoCambia": SOLO para fuente "mockup": true si el texto final es DISTINTO del que se ve en el mockup (el cliente pidió agregar o cambiar algo del texto después de verlo); false si el mockup ya trae exactamente el texto final.
- "tipo": "foto", "personaje" o "especial".
- "estilo": "plano" si el diseño es de siluetas y rellenos SÓLIDOS (tipo vector o calcomanía, sin sombreado: p. ej. un unicornio con estrellas y nubes en negro sólido); "trama" si es un dibujo con sombreado, textura o mucho detalle, o una foto (p. ej. un T-Rex grabado con puntitos, un luchador, una familia). En un mockup prendido IGNORA el brillo/resplandor de la luz: juzga el dibujo.
- "resumen": una línea para el equipo con lo que entendiste de ESA lámpara.
- "advertencias": dudas que no puedes resolver de ESA lámpara (ej. "la foto es muy oscura", "no queda claro el nombre", "no encontré el mockup de esta lámpara"); [] si nada.
- "cambia": ${prevList ? 'true si por la INDICACIÓN/CAMBIO hay que rehacer ESTA lámpara; false si se queda como está.' : 'true.'}
Responde SOLO este JSON: {"lamparas": [{"lampara": 0, "fuente": "...", "imagen": "...", "prompt": "...", "nombre": "...", "textoEnImagen": false, "textoCambia": false, "tipo": "...", "estilo": "...", "resumen": "...", "advertencias": [], "cambia": true}]}` }];
    const kinds = new Map();   // parte de imagen -> { prefix C|N, catalog } (Gemini no acepta campos extra en las partes)
    for (const [prefix, list] of [['C', client], ['N', sent]]) {
        for (const [i, image] of list.entries()) {
            try { const part = await imagePart(image.url); kinds.set(part, { prefix, catalog: !!image.catalog }); parts.push({ text: `Imagen ${prefix}${i}${image.text ? ` (mensaje: "${image.text.slice(0, 200)}")` : ''}:` }, part); }
            catch (_) { parts.push({ text: `Imagen ${prefix}${i}: (no se pudo descargar)` }); }
        }
    }
    // El filtro de Gemini puede bloquear TODA la lectura (PROHIBITED_CONTENT, DH18289) por una imagen o por la
    // mezcla de chat + imágenes. Se reintenta quitando cosas por pasos y se avisa al equipo qué se omitió.
    const omit = (k, why) => { parts[k] = { text: `(imagen omitida: ${why})` }; };
    const fallbacks = [
        ['imágenes que el filtro bloquea solas', async () => { for (let k = 0; k < parts.length; k++) if (parts[k].inlineData && await imageBlocked(parts[k])) omit(k, 'el filtro de la IA no la deja ver'); }],
        ['imágenes que mandamos nosotros', () => parts.forEach((p, k) => { if (kinds.get(p)?.prefix === 'N') omit(k, 'se quitó por el filtro de la IA'); })],
        ['la conversación', () => { parts[0] = { text: parts[0].text.replace(history || '(sin mensajes)', '(conversación omitida por el filtro de la IA: decide con los datos del pedido y las imágenes)') }; }],
        ['fotos del cliente (solo quedó el modelo del catálogo)', () => parts.forEach((p, k) => { if (p.inlineData && !kinds.get(p)?.catalog) omit(k, 'se quitó por el filtro de la IA'); })],
    ];
    let answer;
    const omitted = [];
    for (let step = 0; !answer; step++) {
        try { answer = await geminiJson(parts); }
        catch (error) {
            if (!error.blocked || step >= fallbacks.length) throw error;
            const [label, apply] = fallbacks[step];
            console.warn(`[AUTO-LAMP] Gemini bloqueó la lectura del pedido; se omiten: ${label}.`);
            omitted.push(label);
            await apply();
        }
    }
    const filterNote = omitted.length ? [`El filtro de la IA bloqueó la lectura; se omitieron: ${omitted.join(', ')}. Revisa que el diseño corresponda.`] : [];
    const rows = Array.isArray(answer.lamparas) ? answer.lamparas : [];
    return lamps.map(lamp => {
        const row = rows.find(r => Number(r.lampara) === lamp.index) || rows[lamp.index] || {};
        // Una o VARIAS imágenes ("C1,C2" para juntar a dos personas en una escena, DH18288; máximo 4).
        const picks = (String(Array.isArray(row.imagen) ? row.imagen.join(',') : row.imagen || '').toUpperCase().match(/[CN]\d+/g) || []).slice(0, 4);
        const references = picks.map(p => (p[0] === 'C' ? client : sent)[Number(p.slice(1))]).filter(Boolean);
        const reference = references[0] || null, pick = picks[0] ? [picks[0], picks[0][0]] : null;
        let fuente = ['mockup', 'cliente', 'ilustracion'].includes(row.fuente) ? row.fuente : (reference ? 'cliente' : 'ilustracion');
        if (fuente !== 'ilustracion' && !reference) fuente = 'ilustracion';
        if (fuente === 'mockup' && pick && pick[1] !== 'N' && !reference?.catalog) fuente = 'cliente';
        // Fotos del cliente para juntar: aunque la IA lo llame "ilustración", va con sus fotos de referencia.
        if (fuente === 'ilustracion' && references.length) fuente = 'cliente';
        // Huecos que no deben grabarse nunca («(Fecha de fallecimiento)», «[nombre]», «XX/XX/XX», DH18305): fuera y a dudas.
        const holes = [];
        row.nombre = String(row.nombre || '').replace(/\s*(?:\((?:[^)]*\b(?:fecha|nombre|aqu[ií]|pendiente|falta)\b[^)]*)\)|\[[^\]]*\]|\bX{2,}(?:[\/-]X{2,})+)\s*/gi, m => { holes.push(m.trim()); return ' '; })
            .replace(/(?:\s*·\s*)+$|^(?:\s*·\s*)+/g, '').replace(/\s*·\s*·\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim();
        if (holes.length) row.advertencias = [...(Array.isArray(row.advertencias) ? row.advertencias : []), `Faltaba un dato y no se grabó: ${holes.join(', ')}`];
        return {
            fuente, reference, references,
            tipo: ['foto', 'personaje', 'especial'].includes(row.tipo) ? row.tipo : 'especial',
            // Frases largas también (DH18288 se cortó a 80 letras): renglones con " · ".
            nombre: String(row.nombre || '').trim().slice(0, 400),
            prompt: String(row.prompt || '').trim().slice(0, 1500),
            resumen: String(row.resumen || '').trim().slice(0, 400),
            advertencias: (Array.isArray(row.advertencias) ? row.advertencias : []).map(String).slice(0, 6).concat(filterNote),
            cambia: row.cambia !== false,
            // La foto del catálogo trae un nombre de muestra («Miguel»): siempre se saca sin letras y va el del cliente.
            textoCambia: fuente === 'mockup' && (row.textoCambia === true || !!reference?.catalog),
            // La frase dibujada por el modelo como parte de la imagen (Chris, DH18288): sin texto aparte del armado.
            textoEnImagen: fuente !== 'mockup' && !!String(row.nombre || '').trim() && (row.textoEnImagen === true || TEXT_IN_IMAGE.test(note || '')),
            // Solo blanco y negro (sin degradado ni trama) si la IA lo ve así, si la indicación lo pide o si es un modelo
            // del catálogo que es de rellenos sólidos (Chris, 20-oct-2026: el unicornio de DH18256 salió con degradado).
            estilo: TRAMA_HINT.test(note || '') ? 'trama'
                : row.estilo === 'plano' || FLAT_HINT.test(note || '') || FLAT_MODELS.test(`${lamp.producto || ''} ${lamp.datos || ''} ${lamp.label || ''}`) ? 'plano' : 'trama',
        };
    });
}

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo descargar una imagen (${response.status}).`);
    return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') || '' };
}

// La IA elige cuál imagen del cliente es la del diseño a grabar (lámpara automática del editor, sin Beta).
async function pickReference(images, datos) {
    if (!images.length) throw Object.assign(new Error('El cliente no ha mandado ninguna imagen.'), { status: 422 });
    const candidates = images.slice(-6);
    const parts = [{ text: `Un cliente pidió una lámpara grabada con un personaje o imagen. Datos del pedido: "${datos}".
Abajo van, numeradas desde 0, las imágenes que mandó por WhatsApp. Elige la que muestra el personaje/diseño que quiere grabar.
NO elijas comprobantes de pago, capturas de transferencias, tickets, capturas de chat ni fotos de otra lámpara ya hecha.
Responde SOLO este JSON: {"index": <número o -1 si ninguna sirve>, "motivo": "<breve>"}` }];
    for (const [i, image] of candidates.entries()) parts.push({ text: `Imagen ${i}${image.text ? ` (mensaje: "${image.text.slice(0, 200)}")` : ''}:` }, await imagePart(image.url));
    const choice = await geminiJson(parts).catch(() => { throw new Error('La IA no respondió cuál imagen usar.'); });
    const picked = candidates[Number(choice.index)];
    if (!picked) throw Object.assign(new Error(`Ninguna imagen del chat sirve para grabar: ${choice.motivo || 'sin motivo'}.`), { status: 422 });
    return { ...picked, motivo: choice.motivo || '' };
}

// "Convertir a raster" del editor, desde el servidor. Cuadrada si el modelo lo permite.
// Sin referencia (personaje sin imagen) el estudio de /imagenes ILUSTRA desde la descripción con el mismo
// acabado de grabado. extra: lo que la IA pidió conservar o ajustar de la foto. prompt: reemplaza todo (mockup).
// Cuando el nombre lo pone el armado (composeLamp), la imagen NO debe traer letras: DH18282 salió con «Patricia» dos
// veces porque la indicación de la IA pedía «integrar el nombre» y el modelo lo escribió.
// Indicación del equipo para que el texto vaya integrado en la imagen generada (no puesto aparte).
const textInImageRule = text => `Integra en el diseño, como parte de la misma composición, este texto en letras BLANCAS grandes, claras y legibles, escrito EXACTAMENTE así (mismas palabras, mayúsculas y acentos, sin agregar ni quitar nada), en renglones donde se lean bien: «${text.replace(/\s*·\s*/g, ' / ')}». Las letras no deben tapar las caras.`;
const TEXT_IN_IMAGE = /(frase|texto|nombre|letras?)[^.]{0,40}\b(integr|dibuj|incluy)|\b(integr|dibuj|incluy)\w*\s+(la\s+|el\s+)?(frase|texto|nombre|letras?)\b|todo\s+junto/i;
const NO_TEXT = 'IMPORTANTE: la imagen NO lleva ningún texto, letra, palabra ni nombre (el nombre se agrega después, aparte); si la imagen original trae letras, quítalas.';
async function rasterize(reference, { description = '', extra = '', prompt: override = '', model = RASTER_MODEL, estilo = 'trama', noText = false, textInImage = '', extraReferences = [] } = {}) {
    const files = [];
    // La principal y, si hay que juntar varias fotos (DH18288), las demás (hasta 4 en total).
    for (const [i, ref] of [reference, ...extraReferences].filter(Boolean).slice(0, 4).entries()) {
        const { buffer } = ref.buffer ? ref : await download(ref.url);
        // Qwen entrega la imagen con la forma de la referencia: se manda cuadrada (relleno blanco) para que el
        // diseño salga cuadrado y quepa completo en el círculo.
        const fit = /qwen/i.test(model) ? { fit: 'contain', background: '#ffffff' } : { fit: 'inside', withoutEnlargement: true };
        const jpeg = await sharp(buffer).rotate().resize(2048, 2048, fit).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
        files.push({ buffer: jpeg, mimetype: 'image/jpeg', originalname: `referencia-${i + 1}.jpg` });
    }
    const prompt = styled(override || (reference
        ? (extra ? `${RASTER_PROMPT}. ${extra}` : RASTER_PROMPT) + (/qwen/i.test(model) ? '. Solo blanco y negro, sin colores; fondo negro uniforme de orilla a orilla, sin círculos, marcos ni bordes.' : '')
        : `Ilustración para grabar con láser en una lámpara redonda: ${description}. Centrada y completa${textInImage ? '' : ', sin texto ni letras'}. Solo blanco y negro, sin colores. Rellenos y detalles en BLANCO sobre un fondo NEGRO uniforme de orilla a orilla: sin círculos, marcos, bordes ni viñetas. En raster engrave con degradado en trama.`), estilo) + (textInImage ? ` ${textInImageRule(textInImage)}` : noText ? ` ${NO_TEXT}` : '')
        // Sin el aro del contorno, salvo en las plantillas del taller («Cambia el nombre por…»: se edita tal cual).
        + (/^Cambia el nombre/i.test(override) ? '' : ` ${NO_RING}`);
    const fields = { requestId: crypto.randomUUID(), model, prompt, aspect_ratio: '1:1' };
    // VARIOS PEDIDOS A LA VEZ (Chris, 19-oct-2026): la GPU de Qwen hace una imagen a la vez; si está ocupada
    // con otra lámpara, se espera su turno (cada 10 s, hasta 15 min) en vez de pasarse a gpt-image.
    const create = async extra => {
        const waitStarted = Date.now();
        for (;;) {
            try { return await imageStudio.createGeneration({ ...fields, requestId: crypto.randomUUID(), ...extra }, files, ACTOR); }
            catch (error) {
                const busy = error.status === 409 && /en proceso/i.test(error.message || '');
                if (!busy || Date.now() - waitStarted > 15 * 60 * 1000) throw error;
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    };
    let job;
    try { job = await create({}); }
    catch (error) {
        if (!/aspect_ratio/.test(error.message)) throw error;
        job = await create({ aspect_ratio: undefined });
    }
    const started = Date.now();
    while (job.status === 'generating') {
        if (Date.now() - started > 6 * 60 * 1000) throw new Error('La conversión a grabado tardó demasiado.');
        await new Promise(resolve => setTimeout(resolve, 4000));
        job = await imageStudio.getJob(job.id);
    }
    const url = job.images?.[0]?.fullUrl;
    if (job.status !== 'completed' || !url) throw new Error(job.error || 'La IA no devolvió el grabado.');
    return { url, jobId: job.id, model };
}

// SIEMPRE Qwen (Chris, 19-oct-2026): si la GPU está apagada (fuera de su horario) se PRENDE y se espera a que
// esté lista; OpenAI rechaza fotos de personas reales (DH18253). Solo si la GPU no logra arrancar se usa el
// modelo de siempre como último recurso. Fuera de horario la GPU se queda prendida mientras se use (qwenPod).
const QWEN_BOOT_WAIT_MS = 20 * 60 * 1000;
async function ensureQwenReady(onStep) {
    const qwenPod = require('../../imagenes/qwenPod');
    if (!qwenPod.enabled()) return false;
    let status = await qwenPod.getStatus().catch(() => null);
    if (status?.status === 'ready') return true;
    if (!['starting'].includes(status?.status)) await qwenPod.startPod('Diseño IA (Beta)').catch(error => console.warn('[AUTO-LAMP] no pude prender Qwen:', error.message));
    const started = Date.now();
    let lastTry = Date.now();
    while (Date.now() - started < QWEN_BOOT_WAIT_MS) {
        onStep?.(`Prendiendo la GPU de Qwen (tarda unos 10 min · ${Math.round((Date.now() - started) / 60000)} min)`);
        await new Promise(resolve => setTimeout(resolve, 20000));
        status = await qwenPod.getStatus().catch(() => null);
        if (status?.status === 'ready') return true;
        // RunPod a veces no tiene GPU libre ("no tiene una GPU disponible ahora", DH18198): se vuelve a pedir cada
        // minuto mientras dura la espera, en vez de rendirse a la primera.
        if (['off', 'error'].includes(status?.status) && Date.now() - lastTry > 60000) {
            lastTry = Date.now();
            if (status.status === 'error') await qwenPod.stopPod('reintento del Diseño IA').catch(() => {});
            await qwenPod.startPod('Diseño IA (Beta), reintento').catch(error => console.warn('[AUTO-LAMP] Qwen sigue sin arrancar:', error.message));
        }
    }
    return false;
}
// Con la GPU apagada NO se espera (prender tarda 10+ min, y a veces RunPod no tiene GPU): el diseño sale con
// gpt-image y la GPU se pide en segundo plano para los que siguen. SOLO si OpenAI rechaza la imagen (fotos de
// personas reales, DH18253) se espera a que Qwen esté lista. (Chris, 20-oct-2026: «me preocupa este tiempo».)
async function rasterizeBeta(reference, options) {
    const qwenDown = error => error.status === 503 || /Qwen|GPU/i.test(error.message || '');
    const rejected = error => /safety|pol[ií]ticas|rechaz/i.test(error.message || '');
    let qwenError;
    try { return await rasterize(reference, { ...options, model: BETA_MODEL }); }
    catch (error) { if (!qwenDown(error)) throw error; qwenError = error; }
    const qwenPod = require('../../imagenes/qwenPod');
    if (qwenPod.enabled()) qwenPod.startPod('Diseño IA (Beta), para los siguientes').catch(() => {});
    // Primero Qwen alojado en OpenRouter (sin GPU que prender; sin los problemas de derechos de autor de gpt-image).
    for (const model of QWEN_CLOUD_MODELS) {
        try {
            options.onStep?.(`GPU apagada: generando con ${model.replace('qwen/', 'Qwen ').replace(/-/g, ' ')}`);
            return { ...(await rasterize(reference, { ...options, model })), fallback: qwenError.message };
        } catch (error) { console.warn(`[AUTO-LAMP] ${model} falló:`, error.message); qwenError = error; }
    }
    try { return { ...(await rasterize(reference, { ...options, model: RASTER_MODEL })), fallback: qwenError.message }; }
    catch (error) {
        if (!rejected(error)) throw error;
        // OpenAI no la acepta: aquí sí se espera a Qwen (la GPU propia no tiene esas restricciones).
        options.onStep?.('OpenAI rechazó la imagen: esperando la GPU de Qwen');
        if (!await ensureQwenReady(options.onStep)) throw Object.assign(new Error(`${error.message} — y la GPU de Qwen no pudo prender: intenta más tarde o prende la GPU en /imagenes.`), { status: error.status || 502 });
        options.onStep?.('GPU de Qwen lista: generando');
        return await rasterize(reference, { ...options, model: BETA_MODEL });
    }
}

// El modelo no siempre obedece "blanco sobre negro": a veces entrega negro sobre blanco o un círculo claro con
// esquinas negras (DH18250, 19-oct-2026). Esto deja la imagen SIEMPRE lista para grabar: diseño en negro sobre
// fondo blanco, sin colores, y sin manchas oscuras pegadas a la orilla (esquinas, círculos, marcos).
async function engravePolarity(buffer) {
    const { data, info } = await sharp(buffer).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, px = Buffer.from(data);
    // 1) Polaridad por el FONDO alrededor del diseño: un anillo entre 32 % y 44 % del lado, desde el centro.
    let sum = 0, n = 0;
    const cx = w / 2, cy = h / 2, side = Math.min(w, h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        const d = Math.hypot(x - cx, y - cy) / side;
        if (d > .32 && d < .44) { sum += px[y * w + x]; n++; }
    }
    if (n && sum / n < 128) for (let i = 0; i < px.length; i++) px[i] = 255 - px[i];
    // 2) Lo oscuro conectado con la orilla se vuelve blanco, salvo que llegue al centro (entonces es diseño).
    const seen = new Uint8Array(w * h), stack = [], region = [];
    const inCentre = i => { const x = i % w, y = (i / w) | 0; return x > w * .3 && x < w * .7 && y > h * .3 && y < h * .7; };
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    let reachesCentre = false;
    while (stack.length) {
        const i = stack.pop();
        if (seen[i] || px[i] >= 128) continue;
        seen[i] = 1; region.push(i);
        if (inCentre(i)) { reachesCentre = true; break; }
        const x = i % w;
        if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
        if (i >= w) stack.push(i - w); if (i < w * (h - 1)) stack.push(i + w);
    }
    if (!reachesCentre) {
        // También el halo gris (orilla suavizada) de lo que se limpió: 3 px alrededor.
        let edge = region;
        for (let step = 0; step < 3; step++) {
            const next = [];
            for (const i of edge) {
                const x = i % w;
                for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < px.length && !seen[j]) { seen[j] = 1; next.push(j); }
            }
            region.push(...next); edge = next;
        }
        for (const i of region) px[i] = 255;
    }
    // 3) Fondo blanco PURO y negros puros: un 252 se volvería puntitos sueltos grabados en todo el fondo al difuminar.
    for (let i = 0; i < px.length; i++) { if (px[i] >= 235) px[i] = 255; else if (px[i] <= 20) px[i] = 0; }
    return sharp(px, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

// MOCKUP -> que llene el círculo como en el mockup (DH18202, 19-oct-2026). Qwen respeta el encuadre de la foto,
// así que el diseño sale chico en un cuadro grande. Se recorta a lo que se graba (negro) y se reacomoda en un
// cuadro que composeLamp encaja en el marco: ahí el círculo queda con centro en (50 %, 48.1 %) y radio 48.1 %
// del lado, y la base empieza al 91 % (medidas del marco 160 × 166.3 mm, círculo de 80 mm de radio).
//  - Si el diseño trae su propio círculo (el acrílico del mockup, aunque sea un trazo tenue): ese círculo va justo
//    en la línea de corte (su orilla, del lado de afuera).
//  - Si va suelto: lo más grande posible midiendo sus pixeles, con ~2 mm de aire a la línea y a la base.
const LAMP_CIRCLE = { cx: .5, cy: .481, r: .481, baseTop: .905 };
// Aire entre el trazo y la línea de corte / la base (fracción del lado del cuadro ≈ 166 mm): ~2 mm.
const FIT_GAP = .012;
/**
 * Borra el ARO del acrílico que el modelo copia del mockup (una línea delgada casi completa alrededor del dibujo,
 * a veces con la base abajo) aunque el prompt diga que no (Chris, 20-oct-2026, DH18239 «Mía Carolina»). Entra el
 * grabado (negro = tinta) y sale igual, sin el aro ni lo que quede afuera de él; si no hay aro, sale tal cual.
 */
async function removeRing(buffer) {
    const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, inkAt = (x, y) => x >= 0 && x < w && y >= 0 && y < h && data[y * w + x] < 128;
    // Caja de la tinta: el aro marca su ancho; su centro está a medio ancho desde arriba (la base cuelga abajo).
    let x0 = w, x1 = -1, y0 = h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; }
    if (x1 - x0 < w * .2) return buffer;
    const R = (x1 - x0) / 2, cx = (x0 + x1) / 2, cy = y0 + R;
    // Un aro deja vacías las esquinas de su caja; una foto que llena el cuadro no (DH18264 se recortaba en círculo).
    const corner = R * .25;
    for (const [qx, qy] of [[x0, y0], [x1 - corner, y0]]) {
        let ink = 0, n = 0;
        for (let y = Math.round(qy); y < qy + corner; y++) for (let x = Math.round(qx); x < qx + corner; x++) { n++; if (inkAt(x, y)) ink++; }
        if (!n || ink / n > .02) return buffer;
    }
    // Por cada ángulo (sin el sector de abajo, donde puede ir la base): ¿hay un trazo DELGADO en la orilla y luego
    // aire hacia adentro? Se mide su grosor.
    let hits = 0, total = 0;
    const thick = [];
    for (let k = 0; k < 360; k += 2) {
        const t = k * Math.PI / 180;
        if (Math.sin(t) > .7) continue;   // abajo (y crece hacia abajo): base
        total++;
        let r = R + 2, outer = null;
        for (; r > R * .9; r -= .5) if (inkAt(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r))) { outer = r; break; }
        if (outer == null) continue;
        let inner = outer;
        while (inner > R * .85 && inkAt(Math.round(cx + Math.cos(t) * inner), Math.round(cy + Math.sin(t) * inner))) inner -= .5;
        const width = outer - inner;
        // Trazo delgado (menos del 3 % del radio) seguido de aire: es el aro, no un relleno del dibujo.
        let gap = 0;
        for (let r2 = inner; r2 > inner - R * .02; r2 -= .5) if (!inkAt(Math.round(cx + Math.cos(t) * r2), Math.round(cy + Math.sin(t) * r2))) gap++;
        if (width > 0 && width < R * .03 && gap >= R * .02) { hits++; thick.push(width); }
    }
    if (!total || hits / total < .7) return buffer;   // no hay aro
    thick.sort((a, b) => a - b);
    const ringWidth = thick[Math.floor(thick.length / 2)];
    // Todo lo que esté del aro hacia afuera (con un margen) se vuelve blanco.
    const cut = R - ringWidth - Math.max(2, R * .012);
    const out = Buffer.from(data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) > cut) out[y * w + x] = 255;
    // La orilla de arriba de la base (una raya recta larga y delgada abajo del dibujo, DH18276) también se va.
    const thin = Math.max(3, Math.ceil(ringWidth * 2 + 2)), dark = (x, y) => x >= 0 && x < w && y >= 0 && y < h && out[y * w + x] < 128;
    for (let y = Math.round(cy + R * .6); y < Math.min(h, Math.round(cy + R)); y++) {
        for (let x = 0; x < w;) {
            if (!dark(x, y)) { x++; continue; }
            let end = x; while (end < w && dark(end, y)) end++;
            if (end - x > R * .35) {
                // Raya y no relleno: arriba y abajo de ella (a más de su grosor) casi no hay tinta.
                let near = 0;
                for (let xx = x; xx < end; xx += 3) if (dark(xx, y - thin) || dark(xx, y + thin)) near++;
                if (near / ((end - x) / 3) < .2) for (let yy = y - thin + 1; yy < y + thin; yy++) for (let xx = x; xx < end; xx++) if (yy >= 0 && yy < h) out[yy * w + xx] = 255;
            }
            x = end;
        }
    }
    console.log(`[AUTO-LAMP] Aro del acrílico borrado (radio ${Math.round(R)} px, grosor ${ringWidth.toFixed(1)} px, ${hits}/${total} ángulos).`);
    return sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

async function fitToLampCircle(buffer, side = 2000, { loose = false } = {}) {
    const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    // Caja de lo que tiene tinta (aunque sea un trazo tenue, como el círculo del acrílico) y de lo negro.
    const boxOf = limit => {
        const rows = new Uint32Array(h), cols = new Uint32Array(w);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < limit) { rows[y]++; cols[x]++; }
        const minRun = Math.max(2, Math.round(Math.min(w, h) * .002));
        const first = arr => arr.findIndex(v => v >= minRun), last = arr => arr.length - 1 - [...arr].reverse().findIndex(v => v >= minRun);
        const b = { x0: first(cols), x1: last(cols), y0: first(rows), y1: last(rows) };
        return b.x0 < 0 || b.y0 < 0 || b.x1 <= b.x0 || b.y1 <= b.y0 ? null : { ...b, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
    };
    const ink = boxOf(250), dark = boxOf(128);
    if (!ink || !dark) return buffer;   // nada que acomodar
    // ¿El diseño trae su propio círculo (el acrílico del mockup)? Caja de tinta casi cuadrada y con trazo en su
    // orilla (franja 93–100 % del radio) en casi toda la vuelta.
    let ringHits = 0;
    for (let k = 0; k < 360; k++) {
        const t = k * Math.PI / 180;
        for (let f = .93; f <= 1.0001; f += .005) {
            const x = Math.round(ink.x0 + ink.w / 2 + Math.cos(t) * (ink.w / 2 - 1) * f), y = Math.round(ink.y0 + ink.h / 2 + Math.sin(t) * (ink.h / 2 - 1) * f);
            if (x >= 0 && x < w && y >= 0 && y < h && data[y * w + x] < 250) { ringHits++; break; }
        }
    }
    const isCircle = !loose && ink.w / ink.h > .9 && ink.w / ink.h < 1.1 && ringHits / 360 > .75;
    const R = LAMP_CIRCLE.r * side, cx = LAMP_CIRCLE.cx * side, cy = LAMP_CIRCLE.cy * side;
    let box, scale, left, top;
    if (isCircle) {
        // Su círculo justo en la línea de corte (4 % más grande: su orilla queda del lado de afuera aunque no sea redondo perfecto).
        box = ink; scale = (2 * R * 1.04) / Math.max(ink.w, ink.h);
        left = cx - box.w * scale / 2; top = cy - box.h * scale / 2;
    } else {
        // Diseño suelto: lo más grande posible midiendo los PIXELES del dibujo (no la caja), con ~2 mm de aire
        // a la línea y a la base. Se prueba un poco recorrido a los lados por si así cabe más grande.
        box = dark;
        const step = Math.max(1, Math.ceil(Math.max(box.w, box.h) / 220)), pts = [];
        for (let gy = box.y0; gy <= box.y1; gy += step) for (let gx = box.x0; gx <= box.x1; gx += step) {
            let hit = false;
            for (let y = gy; y < Math.min(gy + step, box.y1 + 1) && !hit; y++) for (let x = gx; x < Math.min(gx + step, box.x1 + 1); x++) if (data[y * w + x] < 128) { hit = true; break; }
            if (hit) for (const [px, py] of [[gx, gy], [gx + step, gy], [gx, gy + step], [gx + step, gy + step]]) pts.push(px - box.x0, py - box.y0);
        }
        const Rm = R - FIT_GAP * side, maxBottom = (LAMP_CIRCLE.baseTop - FIT_GAP) * side;
        // Con escala s y recorrido dx: ¿qué "top" deja todo dentro? Devuelve [mín, máx] o null.
        const topRange = (s, dx) => {
            let lo = -Infinity, hi = Infinity;
            const l = cx - box.w * s / 2 + dx;
            for (let i = 0; i < pts.length; i += 2) {
                const ddx = l + pts[i] * s - cx;
                if (Math.abs(ddx) > Rm) return null;
                const hh = Math.sqrt(Rm * Rm - ddx * ddx), py = pts[i + 1] * s;
                lo = Math.max(lo, cy - hh - py); hi = Math.min(hi, Math.min(cy + hh, maxBottom) - py);
                if (lo > hi) return null;
            }
            return [lo, hi];
        };
        let best = { s: 0, dx: 0, range: null };
        for (const dx of [0, -.03, .03, -.06, .06].map(f => f * R)) {
            let lo = 0, hi = (2 * R) / Math.min(box.w, box.h);
            if (!topRange(lo + 1e-6, dx)) continue;
            for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (topRange(mid, dx)) lo = mid; else hi = mid; }
            if (lo > best.s * 1.01) best = { s: lo, dx, range: topRange(lo, dx) };
        }
        if (!best.range) return buffer;
        scale = best.s; left = cx - box.w * scale / 2 + best.dx; top = (best.range[0] + best.range[1]) / 2;
    }
    const piece = await sharp(buffer).extract({ left: box.x0, top: box.y0, width: box.w, height: box.h })
        .resize(Math.max(1, Math.round(box.w * scale)), Math.max(1, Math.round(box.h * scale)), { kernel: 'lanczos3' }).png().toBuffer();
    const pm = await sharp(piece).metadata();
    // Lo que se sale del cuadro se recorta (el círculo del mockup un poco más grande que el lienzo).
    const L = Math.round(left), T = Math.round(top);
    const cut = { left: Math.max(0, -L), top: Math.max(0, -T) };
    const cw = Math.min(pm.width - cut.left, side - Math.max(0, L)), ch = Math.min(pm.height - cut.top, side - Math.max(0, T));
    const input = await sharp(piece).extract({ left: cut.left, top: cut.top, width: cw, height: ch }).png().toBuffer();
    return sharp({ create: { width: side, height: side, channels: 3, background: '#ffffff' } })
        .composite([{ input, left: Math.max(0, L), top: Math.max(0, T) }]).png().toBuffer();
}

// PLANTILLAS DEL TALLER (Chris, 19-oct-2026): personajes que ya tienen su grabado hecho por el equipo. La
// lámpara usa ESE grabado (sin IA) y solo se le agrega el nombre. El PNG está normalizado al marco: cuadro
// donde el círculo tiene centro (50 %, 48.1 %) y radio 48.1 % del lado (ver LAMP_CIRCLE).
const TEMPLATES = {
    spiderman: { file: 'spiderman-grabado.png', match: /spider|hombre\s*ara[ñn]a/i, label: 'Spiderman (plantilla del taller)' },
    // El nombre viene DENTRO del dibujo con su propia letra: Qwen lo cambia ("Cambia el nombre por …", como lo hace
    // el equipo en /imagenes) sobre la referencia, que trae "Matías".
    dino_premium: { file: 'dino-premium-referencia.png', match: /dino\s*premium/i, label: 'Dino premium (plantilla del taller)', rename: true },
};
const templateCache = {};
// La plantilla se usa solo si el PERSONAJE cuadra: un producto «Dino premium» con «Personaje: flores» (DH18179,
// la clienta pidió flores para Regina) no lleva el T-Rex; va por el camino normal de la IA.
TEMPLATES.spiderman.character = /spider|ara[ñn]a/i;
TEMPLATES.dino_premium.character = /dino|rex|saurio/i;
const templateFor = lamp => Object.entries(TEMPLATES).find(([, t]) => {
    if (!t.match.test(`${lamp.producto} ${lamp.datos}`)) return false;
    const personaje = lamp.personaje || ((String(lamp.datos || '').match(/personaje\s*:\s*([^|\n]+)/i) || [])[1] || '').trim();
    return !personaje || t.character.test(personaje) || t.match.test(personaje);
})?.[0] || null;
const templateImage = key => (templateCache[key] ||= require('fs').promises.readFile(require('path').join(__dirname, 'assets', TEMPLATES[key].file)));

// Dónde va el nombre en una plantilla: arriba a la IZQUIERDA (como en los mockups), lo más grande posible sin
// salirse del círculo y pisando el dibujo cuando mucho un 5 % (la silueta blanca del nombre lo despega). Mide el grabado en una cuadrícula de 1 mm del marco (160 × 166.3 mm).
async function freeNameSlot(imageBuffer, text, font) {
    const FRAME = { w: 160, h: 166.3 }, side = FRAME.h;   // el cuadro cubre el marco por su alto
    const { data, info } = await sharp(imageBuffer).greyscale().resize(Math.round(side), Math.round(side), { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const n = info.width, off = (side - FRAME.w) / 2;   // el cuadro se sale (side - 160) / 2 mm por cada lado
    // Celdas con trazo, ensanchadas 2.5 mm (silueta del nombre + aire).
    const W = Math.ceil(FRAME.w), H = Math.ceil(FRAME.h), dark = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.round(x + off); if (sx >= 0 && sx < n && y < n && data[y * n + sx] < 128) dark[y * W + x] = 1; }
    const grown = new Uint8Array(W * H), G = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark[y * W + x])
        for (let dy = -G; dy <= G; dy++) for (let dx = -G; dx <= G; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) grown[yy * W + xx] = 1; }
    const sum = new Uint32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum[(y + 1) * (W + 1) + x + 1] = grown[y * W + x] + sum[y * (W + 1) + x + 1] + sum[(y + 1) * (W + 1) + x] - sum[y * (W + 1) + x];
    const darkShare = (x0, y0, x1, y1) => {
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
        const area = Math.max(1, (x1 - x0) * (y1 - y0));
        return (sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0]) / area;
    };
    const R = 80 - 3, C = { x: 80, y: 80 };   // círculo del marco con 3 mm de aire
    const lines = String(text).split(/\s*·\s*|\n+/).filter(Boolean);
    const units = lines.map(l => font.getPath(l, 0, 0, 1).getBoundingBox());
    const inkW = Math.max(...units.map(u => u.x2 - u.x1)), lineH = Math.max(...units.map(u => u.y2 - u.y1));
    const boxOf = s => ({ w: inkW * s, h: lineH * s + (lines.length - 1) * 1.05 * s });
    const fits = (cx, cy, s) => {
        const { w, h } = boxOf(s), x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
        if ([[x0, y0], [x1, y0], [x0, y1], [x1, y1]].some(([x, y]) => Math.hypot(x - C.x, y - C.y) > R)) return false;
        return darkShare(x0, y0, x1, y1) <= .05;
    };
    let best = null;
    for (let cy = 14; cy <= 90; cy += 2) for (let cx = 12; cx <= 80; cx += 2) {
        let lo = 0, hi = Math.min(62 / inkW, 26 / lineH);   // tope: 62 mm de ancho, 26 mm de alto
        if (!fits(cx, cy, 1)) continue;
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fits(cx, cy, mid)) lo = mid; else hi = mid; }
        if (!best || lo > best.s * 1.02) best = { cx, cy, s: lo };
    }
    if (!best) return null;
    const { w, h } = boxOf(best.s * .97);
    return { cx: best.cx, cy: best.cy, maxWidth: w, maxHeight: h };
}

async function loadFont() {
    if (!fontCache) {
        const [bytes] = await bucket.file(FONT_PATH).download();
        fontCache = (await composerModule()).loadFont(bytes);
    }
    return fontCache;
}

// Sube un archivo con URL de descarga (la misma forma que usa el editor para sus imágenes).
async function saveFile(path, buffer, contentType) {
    const token = crypto.randomUUID();
    await bucket.file(path).save(buffer, { resumable: false, metadata: { contentType, cacheControl: 'private, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } } });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function setStatus(orderRef, patch) {
    await orderRef.set({ autoLamp: { ...patch, updatedAt: now() } }, { merge: true });
}

// Cambia los datos de UNA lámpara (Firestore no actualiza un elemento de arreglo por ruta: se reescribe).
async function updateLamp(orderRef, index, patch) {
    await db.runTransaction(async tx => {
        const autoLamp = (await tx.get(orderRef)).data()?.autoLamp;
        const lamps = lampsOf(autoLamp).map(l => l.index === index ? { ...l, ...patch } : l);
        tx.update(orderRef, { 'autoLamp.lamps': lamps, ...(index === 0 && patch.clientPreviewUrl ? { 'autoLamp.clientPreviewUrl': patch.clientPreviewUrl } : {}) });
    });
}

/**
 * Arma UNA lámpara: grabado (mockup / foto / ilustración) -> mapa de bits -> proyecto del editor + vistas.
 * plan: { fuente, reference, prompt, nombre, ... } (de designBriefOrder). Devuelve los datos de la lámpara.
 */
async function buildLamp(dh, lamp, plan, { beta, onStep }) {
    const started = Date.now();
    const step = text => onStep(text);
    let raster;
    if (plan.fuente === 'propia') {
        // IMAGEN DEL EQUIPO (Chris, 20-oct-2026, DH18183 KATSEYE): ya viene lista en negro sobre blanco; sin IA.
        step('Usando la imagen del equipo');
        raster = { url: null, jobId: null, model: 'Imagen del equipo (sin IA)', buffer: plan.imageBuffer };
    } else if (plan.template) {
        // Plantilla del taller (p. ej. Spiderman): su grabado tal cual, sin IA; solo se le agrega el nombre.
        step('Usando la plantilla del taller');
        const tpl = TEMPLATES[plan.template], image = await templateImage(plan.template);
        const nombre = plan.nombre || (lamp.datos.match(/nombres?\s*:\s*([^|\n]+)/i) || [])[1]?.trim() || '';
        raster = tpl.rename && nombre
            ? await rasterizeBeta({ buffer: image, url: null }, { prompt: `Cambia el nombre por ${nombre.replace(/\s*·\s*/g, ' ')}`, onStep: step })
            : { url: null, jobId: null, model: tpl.label, buffer: image };
    } else if (plan.fuente === 'mockup') {
        step('Convirtiendo el mockup a grabado');
        // Un CAMBIO al dibujo del mockup («solo dos pies», DH18249) va junto: antes se pedía copiarlo tal cual y el
        // cambio nunca le llegaba al modelo.
        const base = plan.textoCambia ? MOCKUP_NO_TEXT_PROMPT : MOCKUP_PROMPT;
        const prompt = plan.prompt ? `${base} ÚNICO CAMBIO que SÍ debes hacer al dibujo (todo lo demás igual que en el mockup): ${plan.prompt}.` : base;
        raster = await rasterizeBeta(plan.reference, { prompt, estilo: plan.estilo, onStep: step });
        // Texto cambiado: el del mockup se debe ir (va el nuevo aparte). Qwen a veces lo deja y salía DOS veces
        // (DH18305): se revisa y, si sigue, se pide otra vez con más insistencia; si aún así queda, se avisa.
        if (plan.textoCambia) {
            const hasText = async r => {
                const img = await sharp(r.buffer || (await download(r.url)).buffer).resize(768, 768, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
                const a = await geminiJson([{ text: 'Mira esta imagen. ¿Tiene letras, palabras, nombres, frases o números escritos (texto legible, aunque sea parcial)? Responde SOLO este JSON: {"texto": true|false}' },
                    { inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } }]).catch(() => ({}));
                return a.texto === true;
            };
            if (await hasText(raster)) {
                step('Quitando el texto que dejó el modelo');
                raster = await rasterizeBeta(plan.reference, { prompt: `${prompt} MUY IMPORTANTE: la imagen final NO debe tener NINGUNA letra, palabra, nombre, frase ni número: borra TODO el texto del mockup y rellena esos huecos con el fondo o con el dibujo, sin dejar rastro.`, estilo: plan.estilo, onStep: step });
                if (await hasText(raster)) plan.advertencias = [...(plan.advertencias || []), 'el grabado todavía trae texto del mockup y el texto nuevo va aparte: puede salir DOBLE; bórralo en el editor o rehazlo'];
            }
        }
    } else if (beta) {
        step(plan.reference ? 'Convirtiendo la imagen del cliente a grabado' : 'Ilustrando con el estudio de imágenes');
        // Foto del cliente o ilustración: el nombre lo pone el armado, así que la imagen va SIN letras.
        raster = await rasterizeBeta(plan.reference, { description: plan.prompt, extra: plan.reference ? plan.prompt : '', estilo: plan.estilo, noText: !!plan.nombre, textInImage: plan.textoEnImagen ? plan.nombre : '', extraReferences: (plan.references || []).slice(1), onStep: step });
    } else {
        step('Convirtiendo a grabado');
        raster = await rasterize(plan.reference);
    }
    const downloaded = raster.buffer || (await download(raster.url)).buffer;
    // Grabado listo (negro sobre blanco); el del mockup además se reacomoda para llenar el círculo.
    // La imagen del equipo ya es negro sobre blanco (no se adivina la polaridad: un logo con aro la confunde).
    const engraved = plan.fuente === 'propia' ? await sharp(downloaded).flatten({ background: '#ffffff' }).greyscale().png().toBuffer() : await engravePolarity(downloaded);
    const cleanTemplate = plan.template && !TEMPLATES[plan.template].rename;   // el grabado del taller tal cual (Spiderman)
    // Del mockup: sin el aro del acrílico que el modelo copia (removeRing) y acomodado para llenar el círculo.
    // La del equipo: acomodada como diseño suelto (su aro es parte del logo, no el del acrílico).
    const buffer = cleanTemplate ? downloaded : plan.template ? engraved : plan.fuente === 'mockup' ? await fitToLampCircle(await removeRing(engraved))
        : plan.fuente === 'propia' ? await fitToLampCircle(engraved, 2000, { loose: true }) : engraved;
    const meta = await sharp(buffer).metadata();
    const font = await loadFont();
    const { composeLamp, renderPreview, pictureSizeMm, rdworksPiece } = await composerModule();

    step('Convirtiendo a mapa de bits');
    const { bitmapSize, toBitmap, pngWithDpi } = await bitmapTools();
    const mm = pictureSizeMm({ width: meta.width, height: meta.height });
    const size = bitmapSize(mm.width, mm.height, BITMAP.dpi);
    // Para GRABAR va el diseño en negro sobre fondo blanco (lo negro es lo que graba la láser); el modelo
    // suele entregar blanco sobre negro: engravePolarity lo normaliza (Chris, 19-oct-2026). El previo del cliente es al revés.
    const rgba = await sharp(buffer).flatten({ background: '#ffffff' }).resize(size.width, size.height, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
    // La plantilla ya es de trazos limpios: umbral (sin puntitos de difuminado en las orillas).
    const bits = toBitmap(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), size.width, size.height, cleanTemplate || plan.estilo === 'plano' ? { ...BITMAP, method: 'threshold' } : BITMAP);
    const png = Buffer.from(pngWithDpi(await sharp(Buffer.from(bits.buffer), { raw: { width: size.width, height: size.height, channels: 4 } }).png({ palette: true, colours: 2 }).toBuffer(), BITMAP.dpi));

    step('Armando el diseño');
    // El mockup ya trae el nombre dentro de la imagen (tal cual lo vio el cliente): no se le agrega otro. Si el
    // texto cambió, el mockup se sacó SIN letras y aquí va el texto final.
    // Plantilla a la que Qwen ya le escribió el nombre (Dino premium): no se le pone otro encima.
    const engraveName = plan.template && TEMPLATES[plan.template].rename ? ''
        : plan.template ? (plan.nombre || (lamp.datos.match(/nombres?\s*:\s*([^|\n]+)/i) || [])[1]?.trim() || '')
        : plan.fuente === 'mockup' && !plan.textoCambia ? '' : plan.textoEnImagen ? '' : plan.nombre;
    const title = [`DH${dh}`, lamp.label].filter(Boolean).join(' · ');
    const dataUrl = 'data:image/png;base64,' + png.toString('base64');
    // En la plantilla el nombre va en el hueco que deja el dibujo (arriba a la izquierda), no abajo.
    const nameSlot = plan.template && engraveName ? await freeNameSlot(buffer, engraveName, font) : null;
    const { document } = composeLamp({ image: { dataUrl, width: size.width, height: size.height, pixelated: true }, name: engraveName, font, title, nameSlot });

    const folder = `${STORAGE_DIR}/DH${dh}/L${lamp.index + 1}`;
    const imageHash = crypto.createHash('sha256').update(dataUrl).digest('hex');
    const imageUrl = await saveFile(`editor-v2/images/${ACTOR.uid}/${imageHash}`, png, 'image/png');
    // Cuánto del marco se graba en el diseño original: sirve para notar después si se recortó en el editor.
    const inkShare = (await rdworksPiece(document, font)).inkShare;
    const previewUrl = await saveFile(`${folder}/vista-previa-${Date.now().toString(36)}.png`, renderPreview(document, font), 'image/png');
    // Proyecto del editor: la imagen va por URL (como guarda el editor), no incrustada.
    const documentJson = JSON.stringify(document, (key, value) => key === 'src' && value === dataUrl ? imageUrl : value);
    const project = await db.collection('editor_v2_projects').add({
        name: title, documentJson, revision: 1, objectCount: document.objects.length,
        createdAt: now(), createdBy: ACTOR.uid, updatedAt: now(), updatedBy: ACTOR.uid, orderNumber: Number(dh), lampIndex: lamp.index,
    });
    return {
        index: lamp.index, label: lamp.label, copies: lamp.copies, status: 'ready', source: plan.fuente, textChanged: !!plan.textoCambia, template: plan.template || null, estilo: plan.estilo || 'trama',
        brief: { tipo: plan.tipo || null, fuente: plan.fuente, estilo: plan.estilo || 'trama', nombre: plan.nombre || '', prompt: plan.prompt || '', resumen: plan.resumen || '',
            advertencias: plan.advertencias || [], textoEnImagen: !!plan.textoEnImagen, referenceUrl: plan.reference?.url || null, referenceUrls: (plan.references || []).map(r => r.url).filter(Boolean) },
        projectId: project.id, projectRevision: 1, previewUrl, name: engraveName, inkShare,
        rasterUrl: raster.url, rasterJobId: raster.jobId || null, rasterModel: raster.model || null, ...(raster.fallback ? { rasterFallback: raster.fallback } : {}),
        durationMs: Date.now() - started, changed: true,
    };
}

/**
 * Genera las lámparas de un pedido.
 * options.beta: Diseño IA BETA (la IA decide todo; si no, la lámpara automática del editor: una sola, foto del cliente).
 * options.note: indicación del equipo o cambio pedido por el cliente. options.keepClient: conserva autoLamp.client.
 * options.lamps: índices a rehacer (los demás se conservan). options.auth: sesión de quien aprieta (envío al cliente).
 */
async function generate(dh, options = {}) {
    const started = Date.now();
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data(), ref = orderDoc.ref;
    const beta = !!options.beta;
    // Un diseño ya aprobado solo se rehace si el cliente pidió un cambio después de aprobar (se reabrió).
    const reopened = order.autoLamp?.client?.status === 'change_after_approval';
    if (order.autoLamp?.status === 'uploading' || (order.autoLamp?.status === 'approved' && !reopened))
        throw Object.assign(new Error('Este diseño ya se aprobó o se está subiendo a Drive.'), { status: 409 });
    const contactId = order.contactId || order.telefono;
    const lamps = beta ? orderLamps(order) : orderLamps(order).slice(0, 1);
    const previous = lampsOf(order.autoLamp).filter(l => l.status === 'ready' && l.projectId);
    // Se rehace todo salvo que sea un cambio (del cliente o del equipo sobre lámparas concretas).
    const partial = !!(options.keepClient || (Array.isArray(options.lamps) && options.lamps.length)) && previous.length > 0;
    await ref.update({ autoLamp: { status: 'working', step: beta ? 'Leyendo el pedido y el chat' : 'Eligiendo la imagen del chat', beta,
        lamps: partial ? previous : [],
        ...(options.note ? { note: String(options.note).slice(0, 500) } : {}),
        // Rehacer a mano también recuerda cuántas versiones ya vio el cliente (el saludo va solo la primera vez).
        ...(options.keepClient && order.autoLamp?.client ? { client: order.autoLamp.client }
            : order.autoLamp?.client?.rounds ? { client: { rounds: order.autoLamp.client.rounds } } : {}),
        startedAt: now(), updatedAt: now() } });
    try {
        let plans;
        if (beta) {
            const briefInput = { order, lamps, history: await chatHistory(contactId), clientImages: await customerImages(contactId),
                sentImages: await ourImages(contactId), note: options.note, previous: partial ? previous : [] };
            plans = await designBriefOrder(briefInput);
            // Lámparas que se quedaron sin imagen NI descripción (la IA se confundió, DH18186): se le pregunta otra
            // vez SOLO por ellas; si sigue sin encontrarla, se ilustra con su personaje y queda como duda (no se
            // manda sola). Así un pedido de varias lámparas ya no falla completo por una.
            const empty = lamps.filter(l => !templateFor(l) && !plans[l.index]?.reference && !plans[l.index]?.prompt);
            if (empty.length) {
                await setStatus(ref, { status: 'working', step: 'Revisando de nuevo las lámparas sin imagen' });
                const retry = await designBriefOrder({ ...briefInput, note: [options.note, `Revisa otra vez SOLO estas lámparas, que se quedaron sin imagen ni descripción: ${empty.map(l => `L${l.index} (${l.label})`).join(', ')}. Busca entre las imágenes N el mockup de su personaje; si no hay, describe la ilustración.`].filter(Boolean).join(' · ') }).catch(() => null);
                for (const l of empty) {
                    const again = retry && retry[l.index];
                    if (again && (again.reference || again.prompt)) { plans[l.index] = again; continue; }
                    plans[l.index] = { cambia: true, tipo: 'personaje', ...(plans[l.index] || {}), fuente: 'ilustracion', reference: null,
                        nombre: plans[l.index]?.nombre || ((l.datos.match(/nombres?\s*:\s*([^|\n]+)/i) || [])[1] || '').trim(),
                        prompt: `${l.personaje || l.producto || 'personaje'}, tierno, de cuerpo completo`,
                        advertencias: [...(plans[l.index]?.advertencias || []), 'no encontré su mockup ni imagen en el chat; la ilustré con su personaje: revisa que sea lo que pidió'] };
                }
            }
        } else {
            const { name, datos } = orderName(order);
            plans = [{ fuente: 'cliente', reference: await pickReference(await customerImages(contactId), datos), nombre: name, prompt: '', advertencias: [] }];
        }
        const results = [];
        for (const lamp of lamps) {
            // Personaje con plantilla del taller (Spiderman…): se usa su grabado; la IA solo aporta el nombre.
            const basePlan = plans[lamp.index] || plans[0], template = beta ? templateFor(lamp) : null;
            const plan = template ? { ...basePlan, template } : { ...basePlan };
            // Rehacer un diseño de mockup con indicación: si la IA no escribió el cambio, va la indicación tal cual.
            // Solo si la indicación es de ESTA lámpara (pedido de una, o «Rehacer esta»): con «Rehacer todo» decide la IA.
            const noteIsForThis = lamps.length === 1 || (Array.isArray(options.lamps) && options.lamps.includes(lamp.index));
            if (!template && plan.fuente === 'mockup' && !plan.prompt && options.note && noteIsForThis && !TEXT_IN_IMAGE.test(options.note)) plan.prompt = String(options.note).slice(0, 500);
            const before = previous.find(p => p.index === lamp.index);
            const redo = !partial || !before || (Array.isArray(options.lamps) && options.lamps.length ? options.lamps.includes(lamp.index) : plan.cambia);
            if (!redo) { results.push({ ...before, changed: false }); continue; }
            if (!plan.template && plan.fuente === 'ilustracion' && !plan.prompt) throw Object.assign(new Error(`La IA no encontró imagen ni descripción para ${lamp.label}.`), { status: 422 });
            const prefix = lamps.length > 1 ? `Lámpara ${lamp.index + 1} de ${lamps.length} · ` : '';
            results.push(await buildLamp(dh, lamp, plan, { beta, onStep: text => setStatus(ref, { status: 'working', step: prefix + text }).catch(() => {}) }));
        }
        // Modo mockup: TODAS salen de un mockup que ya vio el cliente y el pedido está pagado -> directo a corte.
        // Un mockup al que el cliente le cambió el texto ya no es "tal cual": va a su aprobación.
        const mode = beta && results.every(l => l.source === 'mockup' && !l.textChanged) ? 'mockup' : 'client';
        const first = results[0];
        const result = { status: 'ready', step: 'Listo para revisar', mode, lamps: results,
            // La raíz repite la primera lámpara (tarjeta y pedidos de antes).
            name: first.name || '', projectId: first.projectId, projectRevision: first.projectRevision, previewUrl: first.previewUrl, brief: first.brief,
            rasterModel: first.rasterModel || null, finishedAt: now(), durationMs: Date.now() - started };
        await setStatus(ref, result);
        if (beta) await afterReady(dh, results, mode, options.auth).catch(error => console.warn(`[AUTO-LAMP] después de diseñar DH${dh}:`, error.message));
        return result;
    } catch (error) {
        await setStatus(ref, { status: 'error', error: error.message || String(error) }).catch(() => {});
        throw error;
    }
}

/**
 * Diseño con una IMAGEN DEL EQUIPO (sin IA): cuando la IA no logra el diseño, una persona da la imagen ya lista
 * (negro sobre blanco) y se arma igual que el Beta: grabado 1 bit, acomodado para llenar el círculo, nombre aparte
 * solo si se da. Queda en «Revisar diseño» (no se manda ni se sube solo). Chris, 20-oct-2026, DH18183.
 */
async function buildFromImage(dh, buffer, { lampIndex = 0, nombre = '', estilo, actor = null, asIs = false } = {}) {
    // CON IA (lo normal, Chris 20-oct-2026): la imagen se trata IGUAL que si viniera del chat: mockup de lámpara
    // encendida -> Qwen saca el dibujo (sin aro, acomodado); foto o dibujo -> grabado. asIs: tal cual (ya lista).
    if (!asIs) return buildFromImageAi(dh, buffer, { lampIndex, nombre, estilo, actor });
    // Sin estilo: un logo/silueta en blanco y negro va «plano» (umbral); con muchos grises (foto, sombreado), «trama».
    if (!estilo) {
        const { data } = await sharp(buffer).flatten({ background: '#ffffff' }).greyscale().resize(300, 300, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
        let mid = 0; for (const v of data) if (v > 40 && v < 215) mid++;
        estilo = mid / data.length > .08 ? 'trama' : 'plano';
    }
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data(), ref = orderDoc.ref;
    if (['uploading', 'working'].includes(order.autoLamp?.status) || (order.autoLamp?.status === 'approved' && !order.autoLamp?.queued && order.autoLamp?.client?.status !== 'change_after_approval'))
        throw Object.assign(new Error('Este diseño ya se aprobó, se está subiendo o se está generando.'), { status: 409 });
    const lamp = orderLamps(order).find(l => l.index === Number(lampIndex));
    if (!lamp) throw Object.assign(new Error(`El pedido no tiene la lámpara ${Number(lampIndex) + 1}.`), { status: 404 });
    const others = lampsOf(order.autoLamp).filter(l => l.index !== lamp.index && l.status === 'ready' && l.projectId);
    await setStatus(ref, { status: 'working', step: 'Armando con la imagen del equipo', beta: true, lamps: others, startedAt: now() });
    try {
        const png = await sharp(buffer).png().toBuffer();
        const referenceUrl = await saveFile(`${STORAGE_DIR}/DH${dh}/L${lamp.index + 1}/imagen-equipo-${Date.now().toString(36)}.png`, png, 'image/png');
        const plan = { fuente: 'propia', imageBuffer: png, reference: { url: referenceUrl }, nombre, estilo, tipo: 'especial', prompt: '', advertencias: [],
            resumen: `Diseño con la imagen del equipo, sin IA${actor?.email ? ` (${actor.email})` : ''}.` };
        const built = await buildLamp(dh, lamp, plan, { beta: true, onStep: text => setStatus(ref, { status: 'working', step: text }).catch(() => {}) });
        const lamps = [...others, built].sort((a, b) => a.index - b.index), first = lamps[0];
        await setStatus(ref, { status: 'ready', step: 'Listo para revisar', mode: 'client', lamps, error: admin.firestore.FieldValue.delete(),
            name: first.name || '', projectId: first.projectId, projectRevision: first.projectRevision, previewUrl: first.previewUrl, brief: first.brief, rasterModel: first.rasterModel || null, finishedAt: now() });
        return built;
    } catch (error) {
        await setStatus(ref, { status: 'error', error: error.message || String(error) }).catch(() => {});
        throw error;
    }
}

// «Usar mi imagen» con IA: Gemini dice si es un mockup (lámpara encendida) o una foto/dibujo, y se arma con el mismo
// camino que las imágenes del chat (rasterizeBeta con Qwen, removeRing y acomodo en el círculo para los mockups).
async function buildFromImageAi(dh, buffer, { lampIndex = 0, nombre = '', estilo, actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data(), ref = orderDoc.ref;
    if (['uploading', 'working'].includes(order.autoLamp?.status) || (order.autoLamp?.status === 'approved' && !order.autoLamp?.queued && order.autoLamp?.client?.status !== 'change_after_approval'))
        throw Object.assign(new Error('Este diseño ya se aprobó, se está subiendo o se está generando.'), { status: 409 });
    const lamp = orderLamps(order).find(l => l.index === Number(lampIndex));
    if (!lamp) throw Object.assign(new Error(`El pedido no tiene la lámpara ${Number(lampIndex) + 1}.`), { status: 404 });
    const others = lampsOf(order.autoLamp).filter(l => l.index !== lamp.index && l.status === 'ready' && l.projectId);
    await setStatus(ref, { status: 'working', step: 'Revisando la imagen del equipo', beta: true, lamps: others, startedAt: now() });
    try {
        const png = await sharp(buffer).rotate().png().toBuffer();
        const referenceUrl = await saveFile(`${STORAGE_DIR}/DH${dh}/L${lamp.index + 1}/imagen-equipo-${Date.now().toString(36)}.png`, png, 'image/png');
        const small = await sharp(png).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        const kind = await geminiJson([{ text: `Esta imagen la subió el equipo de DekoorHouse para diseñar una lámpara LED de acrílico grabada con láser ("${lamp.label}").
Responde SOLO este JSON: {"tipo": "mockup" si es una foto o render de una lámpara de acrílico (encendida o no) con el diseño ya grabado; "foto" si es una foto de personas/mascotas/lugares; "dibujo" si es un dibujo, logo o ilustración, "estilo": "plano" si el diseño es de siluetas y rellenos sólidos, "trama" si tiene sombreado, textura o es foto}` },
            { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } }]).catch(() => ({}));
        const tipo = ['mockup', 'foto', 'dibujo'].includes(kind.tipo) ? kind.tipo : 'foto';
        const style = estilo || (FLAT_MODELS.test(`${lamp.producto || ''} ${lamp.datos || ''} ${lamp.label || ''}`) ? 'plano' : kind.estilo === 'plano' ? 'plano' : 'trama');
        const plan = {
            fuente: tipo === 'mockup' ? 'mockup' : 'cliente', reference: { buffer: png, url: referenceUrl }, references: [], nombre, estilo: style, tipo: 'especial', prompt: '', advertencias: [],
            // Del mockup: si se dio un texto, se quita el del mockup y va el nuestro aparte (si no, el del mockup tal cual).
            textoCambia: tipo === 'mockup' && !!nombre,
            resumen: `Imagen subida por el equipo${actor?.email ? ` (${actor.email})` : ''}: ${tipo === 'mockup' ? 'mockup de lámpara, se sacó el dibujo' : tipo === 'foto' ? 'foto convertida a grabado' : 'dibujo convertido a grabado'} con IA.`,
        };
        const built = await buildLamp(dh, lamp, plan, { beta: true, onStep: text => setStatus(ref, { status: 'working', step: text }).catch(() => {}) });
        const lamps = [...others, built].sort((a, b) => a.index - b.index), first = lamps[0];
        await setStatus(ref, { status: 'ready', step: 'Listo para revisar', mode: 'client', lamps, error: admin.firestore.FieldValue.delete(),
            name: first.name || '', projectId: first.projectId, projectRevision: first.projectRevision, previewUrl: first.previewUrl, brief: first.brief, rasterModel: first.rasterModel || null, finishedAt: now() });
        return built;
    } catch (error) {
        await setStatus(ref, { status: 'error', error: error.message || String(error) }).catch(() => {});
        throw error;
    }
}

async function status(dh) {
    const orderDoc = await findOrder(dh);
    return orderDoc.data().autoLamp || null;
}

// Las imágenes del proyecto se guardan por URL (como el editor); para pintarlas en el servidor se incrustan.
async function hydrateImages(objects) {
    for (const item of objects) {
        if (item.powerClip?.objects) await hydrateImages(item.powerClip.objects);
        if (item.type === 'image' && /^https?:/.test(item.src || '')) {
            const { buffer, type } = await download(item.src);
            item.src = `data:${/^image\//.test(type) ? type.split(';')[0] : 'image/png'};base64,${buffer.toString('base64')}`;
        }
    }
}

async function projectDocument(projectId) {
    const project = projectId ? (await db.collection('editor_v2_projects').doc(projectId).get()).data() : null;
    if (!project) throw Object.assign(new Error('No encontré el proyecto del diseño.'), { status: 404 });
    const document = JSON.parse(project.documentJson);
    await hydrateImages(document.objects);
    return { document, revision: project.revision };
}

/**
 * PREVIO PARA EL CLIENTE de una lámpara (la versión invertida del grabado). Se arma desde la versión ACTUAL del
 * proyecto del editor (incluye lo que alguien haya corregido) y se guarda en la lámpara.
 */
async function clientPreview(dh, index = 0) {
    const orderDoc = await findOrder(dh);
    const lamp = lampsOf(orderDoc.data().autoLamp).find(l => l.index === Number(index));
    if (!lamp?.projectId) throw Object.assign(new Error('Esta lámpara no tiene diseño de la IA.'), { status: 404 });
    const project = (await db.collection('editor_v2_projects').doc(lamp.projectId).get()).data();
    if (!project) throw Object.assign(new Error('No encontré el proyecto del diseño.'), { status: 404 });
    if (lamp.clientPreviewUrl && Number(lamp.clientPreviewRevision) === Number(project.revision) && lamp.clientPreviewStyle === CLIENT_PREVIEW_STYLE)
        return { url: lamp.clientPreviewUrl, revision: project.revision };
    const { document } = await projectDocument(lamp.projectId);
    if (!document.objects.some(item => item.powerClip)) throw Object.assign(new Error(NO_FRAME), { status: 422, code: 'DESIGN_BROKEN' });
    const { renderClientPreview } = await composerModule();
    const { raw, width, height } = renderClientPreview(document, await loadFont());
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const url = await saveFile(`${STORAGE_DIR}/DH${dh}/L${lamp.index + 1}/previo-cliente-r${project.revision}-v${CLIENT_PREVIEW_STYLE}-${Date.now().toString(36)}.png`, png, 'image/png');
    await updateLamp(orderDoc.ref, lamp.index, { clientPreviewUrl: url, clientPreviewRevision: project.revision, clientPreviewStyle: CLIENT_PREVIEW_STYLE });
    return { url, revision: project.revision };
}

// En el editor se puede borrar o extraer el marco por accidente (DH18179, Regina): sin él no hay lámpara que cortar.
const NO_FRAME = 'La versión guardada en el editor ya no tiene el marco de la lámpara (se borró o se sacó el contenido del PowerClip). Corrígela en el editor o dale «Rehacer esta».';

/**
 * Vista «Grabado» (la del equipo) de una lámpara desde la versión ACTUAL del proyecto: si alguien la corrigió en el
 * editor, la ventana de revisión muestra lo corregido y no lo que armó la IA (DH18267, 20-oct-2026).
 */
async function teamPreview(dh, index = 0) {
    const orderDoc = await findOrder(dh);
    const lamp = lampsOf(orderDoc.data().autoLamp).find(l => l.index === Number(index));
    if (!lamp?.projectId) throw Object.assign(new Error('Esta lámpara no tiene diseño de la IA.'), { status: 404 });
    const project = (await db.collection('editor_v2_projects').doc(lamp.projectId).get()).data();
    if (!project) throw Object.assign(new Error('No encontré el proyecto del diseño.'), { status: 404 });
    const current = Number(project.revision) || 1;
    // Sin cambios desde que se armó (o desde la última vez): la misma imagen.
    if (lamp.previewUrl && Number(lamp.previewRevision || lamp.projectRevision || 1) === current) return { url: lamp.previewUrl, revision: current };
    const { document } = await projectDocument(lamp.projectId);
    if (!document.objects.some(item => item.powerClip)) throw Object.assign(new Error(NO_FRAME), { status: 422, code: 'DESIGN_BROKEN' });
    const { renderPreview } = await composerModule();
    const url = await saveFile(`${STORAGE_DIR}/DH${dh}/L${lamp.index + 1}/vista-previa-r${current}-${Date.now().toString(36)}.png`, renderPreview(document, await loadFont()), 'image/png');
    await updateLamp(orderDoc.ref, lamp.index, { previewUrl: url, previewRevision: current });
    if (lamp.index === 0) await orderDoc.ref.update({ 'autoLamp.previewUrl': url }).catch(() => {});
    return { url, revision: current };
}

/**
 * «Quitar aro» a un diseño YA hecho (Chris, 20-oct-2026): limpia la imagen de grabado guardada en el proyecto
 * (con lo que se haya corregido en el editor) con removeRing, sin regenerar el dibujo. Guarda una versión nueva
 * del proyecto y rehace la vista. Solo diseños sin subir (para uno ya en Drive: «Reabrir para corregir» primero).
 */
async function removeRingFromLamp(dh, index = 0, { actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const autoLamp = orderDoc.data().autoLamp || {};
    if (autoLamp.status !== 'ready') throw Object.assign(new Error(autoLamp.status === 'approved' ? 'Ya está aprobado/subido: primero «Reabrir para corregir».' : 'El diseño no está listo para revisar.'), { status: 409 });
    const lamp = lampsOf(autoLamp).find(l => l.index === Number(index));
    if (!lamp?.projectId) throw Object.assign(new Error('Esta lámpara no tiene diseño de la IA.'), { status: 404 });
    const ref = db.collection('editor_v2_projects').doc(lamp.projectId);
    const project = (await ref.get()).data();
    if (!project) throw Object.assign(new Error('No encontré el proyecto del diseño.'), { status: 404 });
    const document = JSON.parse(project.documentJson);
    const frame = document.objects.find(item => item.powerClip);
    const picture = frame?.powerClip.objects.find(item => item.type === 'image');
    if (!picture) throw Object.assign(new Error('No encontré la imagen de grabado dentro del marco.'), { status: 422 });
    const original = /^data:/.test(picture.src) ? Buffer.from(picture.src.split(',')[1], 'base64') : (await download(picture.src)).buffer;
    const cleaned = await removeRing(original);
    if (cleaned === original) return { changed: false };
    const { pngWithDpi } = await bitmapTools();
    const png = Buffer.from(pngWithDpi(await sharp(cleaned).greyscale().threshold(128).png({ palette: true, colours: 2 }).toBuffer(), BITMAP.dpi));
    picture.src = await saveFile(`editor-v2/images/${ACTOR.uid}/${crypto.createHash('sha256').update(png).digest('hex')}`, png, 'image/png');
    const revision = (Number(project.revision) || 1) + 1;
    await ref.update({ documentJson: JSON.stringify(document), revision, updatedAt: now(), updatedBy: actor?.uid || ACTOR.uid });
    const preview = await teamPreview(dh, lamp.index);
    return { changed: true, revision, previewUrl: preview.url };
}

// Hojas para RDWorks del pedido (2 lámparas por hoja, cada una tantas veces como su cantidad) desde la
// última versión guardada de cada proyecto.
async function rdworksSheetsFor(dh, autoLamp) {
    const { rdworksSheets } = await composerModule();
    return await rdworksSheets((await piecesFor(autoLamp)).map(piece => ({ piece, copies: 1 })), `DH${dh}`);
}

// Las piezas de corte del pedido, una por lámpara Y por cada copia (en el orden de las hojas), ya revisadas.
async function piecesFor(autoLamp) {
    const lamps = lampsOf(autoLamp);
    if (!lamps.length) throw Object.assign(new Error('No hay lámparas diseñadas.'), { status: 409 });
    const { rdworksPiece } = await composerModule();
    const font = await loadFont();
    const pieces = [], problems = [];
    for (const lamp of lamps) {
        const { document } = await projectDocument(lamp.projectId);
        if (!document.objects.some(item => item.powerClip)) { problems.push(`${lamps.length > 1 ? (lamp.label || `Lámpara ${lamp.index + 1}`) + ': ' : ''}no tiene el marco de la lámpara (se borró en el editor)`); continue; }
        const piece = await rdworksPiece(document, font);
        problems.push(...designProblems(document, piece, lamp).map(p => `${lamps.length > 1 ? (lamp.label || `Lámpara ${lamp.index + 1}`) + ': ' : ''}${p}`));
        pieces.push({ piece, copies: lamp.copies || 1 });
    }
    // REVISIÓN antes de subir (DH18191, 19-oct-2026: se movió en el editor y se subió recortada): si el diseño
    // guardado quedó mal armado, no se sube; hay que corregirlo en el editor.
    if (problems.length) throw Object.assign(new Error(`El diseño guardado no está listo para cortar: ${problems.join('; ')}. Corrígelo en el editor y vuelve a aprobar.`), { status: 422, code: 'DESIGN_BROKEN' });
    return pieces.flatMap(({ piece, copies }) => Array.from({ length: Math.max(1, Number(copies) || 1) }, () => piece));
}

// ¿El diseño de una lámpara quedó mal armado? (en el editor se puede arrastrar el marco o sacar cosas de él)
function designProblems(document, piece, lamp) {
    const problems = [];
    const frame = document.objects.find(item => item.powerClip);
    if (!frame) return ['no tiene el marco de la lámpara'];
    // Lo que queda FUERA del marco no se graba: un nombre o una silueta sueltos quiere decir que se salieron.
    const loose = document.objects.filter(item => item.id !== frame.id && !item.hidden);
    if (loose.length) problems.push(`hay ${loose.length} objeto(s) fuera del marco (${loose.map(o => o.name || o.type).slice(0, 3).join(', ')})`);
    if (piece.inkShare < .005) problems.push('el marco quedó casi vacío');
    // Mucho menos grabado que cuando se diseñó: el contenido se recortó (el marco se movió sin su contenido).
    else if (lamp.inkShare && piece.inkShare < lamp.inkShare * .6) problems.push(`el grabado quedó recortado (${Math.round(piece.inkShare * 1000) / 10} % del marco contra ${Math.round(lamp.inkShare * 1000) / 10} % del diseño original)`);
    return problems;
}

// --- BETA: mandar el previo al CLIENTE y esperar su respuesta. ----------------------------------------
// Reutiliza el flujo de aprobación de diseños especiales (designApproval): el contacto queda en modo
// aprobación y el clasificador decide aprobado / cambios / no claro (ver handleBetaDecision).
// Saludo SIN nombre: el "name" de WhatsApp suele ser un alias raro (Chris, 2026-07-20).
const CLIENT_MESSAGE = '¡Hola! 😊 Antes de fabricar tu lámpara, te comparto el diseño para que lo revises con calma ✨\n¿Lo aprobamos así o te gustaría que le ajustemos algo? 🙌';
// El saludo va SOLO la primera vez; los reenvíos dicen que ya van los cambios, con otras palabras cada vez
// (Chris, 20-oct-2026: DH18288 recibió el mismo saludo en cada versión).
const CLIENT_MESSAGE_AGAIN = [
    'Te dejo los cambios que nos solicitaste 😊✨\n¿Lo aprobamos así o le ajustamos algo más? 🙌',
    'Listo, aquí está tu diseño con el nuevo ajuste ✨\n¿Cómo lo ves? ¿Así lo mandamos a fabricar? 😊',
    'Ya quedó el cambio que nos pediste 🙌 Te comparto cómo se ve ahora ✨\n¿Te gusta así o le movemos algo más?',
];
// Varias lámparas: un previo POR LÁMPARA (Chris, 19-oct-2026), entre un saludo y la pregunta.
const MULTI_INTRO = '¡Hola! 😊 Antes de fabricar tus lámparas, te comparto los diseños para que los revises con calma ✨';
const MULTI_INTRO_AGAIN = [
    'Te dejo los cambios que nos solicitaste 😊✨',
    'Listo, aquí están tus diseños con el nuevo ajuste ✨',
    'Ya quedaron los cambios que nos pediste 🙌 Te comparto cómo se ven ahora ✨',
];
const againText = (list, rounds) => list[(rounds - 1) % list.length];
const MULTI_QUESTION = '¿Los aprobamos así o te gustaría que le ajustemos algo a alguno? 🙌';
// Envíos automáticos por pedido (el primero + rehechos por cambio del cliente); después pasa a una persona.
const MAX_CLIENT_SENDS = 3;

async function postMessage(contactId, auth, payload) {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/contacts/${encodeURIComponent(contactId)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload),
    });
    const sent = await response.json().catch(() => ({}));
    if (!response.ok || sent.success === false) throw Object.assign(new Error(sent.message || sent.error || `No se pudo mandar el mensaje (${response.status}).`), { status: 502 });
}

/**
 * Manda al cliente el previo de cada lámpara (only: índices; sin ella, todas) y deja el chat esperando su
 * respuesta. auth: sesión de quien aprieta el botón; sin ella (envío automático), la llave WORKER_API_KEY.
 */
async function sendToClient(dh, { auth = {}, actor = null, only = null } = {}) {
    if (!auth.Authorization && !auth.Cookie && process.env.WORKER_API_KEY) auth = { 'x-worker-key': process.env.WORKER_API_KEY };
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data(), autoLamp = order.autoLamp, lamps = lampsOf(autoLamp);
    if (!autoLamp || autoLamp.status !== 'ready' || !lamps.length) throw Object.assign(new Error('Solo se puede mandar un diseño listo para revisar.'), { status: 409 });
    const contactId = String(order.contactId || order.telefono || '');
    if (!contactId) throw Object.assign(new Error('El pedido no tiene contacto.'), { status: 422 });
    const toSend = lamps.filter(l => !only || only.includes(l.index));
    if (!toSend.length) throw Object.assign(new Error('No hay lámparas para mandar.'), { status: 409 });
    const ensureJpeg = require('../../mockups/mockupsService').ensureJpeg;   // WhatsApp no acepta todo formato
    const images = [];
    for (const lamp of toSend) { const pv = await clientPreview(dh, lamp.index); images.push({ lamp, url: await ensureJpeg(pv.url), revision: pv.revision }); }
    // Qué versión de cada lámpara vio el cliente: su "sí" solo sube ESA versión (ver handleBetaDecision).
    const seen = { ...(autoLamp.client?.revisions || {}) };
    for (const { lamp, revision } of images) seen[lamp.index] = revision;
    const rounds = Number(autoLamp.client?.rounds) || 0;
    // Ya vio una versión antes (pidió cambios, también después de aprobar): no se repite el saludo.
    const again = rounds > 0;
    if (lamps.length === 1) {
        await postMessage(contactId, auth, { text: again ? againText(CLIENT_MESSAGE_AGAIN, rounds) : CLIENT_MESSAGE, fileUrl: images[0].url, fileType: 'image/jpeg' });
    } else {
        await postMessage(contactId, auth, { text: again ? againText(MULTI_INTRO_AGAIN, rounds) : MULTI_INTRO });
        for (const { lamp, url } of images) {
            const caption = `${again ? 'Diseño corregido' : `Diseño ${lamp.index + 1} de ${lamps.length}`}: ${lamp.label}`;
            await postMessage(contactId, auth, { text: caption, fileUrl: url, fileType: 'image/jpeg' });
        }
        await postMessage(contactId, auth, { text: MULTI_QUESTION });
    }
    const designText = lamps.map(l => `${l.label}${l.brief?.nombre ? ` (texto: ${l.brief.nombre})` : ''}`).join(' | ');
    await orderDoc.ref.update({
        designApproval: { status: 'pending', source: 'auto-lamp-beta', sentAt: now(), captureUrl: images[0].url, designText, unclearRounds: 0,
            sentBy: actor?.email || actor?.uid || null },
        'autoLamp.client': { status: 'sent', sentAt: now(), previewUrls: images.map(i => i.url), lampsSent: toSend.map(l => l.index), revisions: seen,
            rounds: rounds + 1, auto: !actor || !!actor.auto },
        'autoLamp.autoSendHeld': admin.firestore.FieldValue.delete(),
    });
    await db.collection('contacts_whatsapp').doc(contactId).update({
        designApprovalPending: true, designApprovalOrderId: orderDoc.id,
        botActive: true,   // el clasificador de aprobación corre dentro del flujo de IA
    });
    return { previewUrls: images.map(i => i.url) };
}

async function notifyAdmin(text) {
    try { await require('../../services').sendAdvancedWhatsAppMessage(process.env.ADMIN_ALERT_PHONE || '5216182297167', { text }); }
    catch (e) { console.warn('[AUTO-LAMP] no pude avisar al admin:', e.message); }
}

/**
 * Lo que sigue en cuanto el diseño queda listo (Chris, 19-oct-2026):
 *  - modo mockup + pagado -> directo a Drive (SVG Corte), sin cliente;
 *  - si no -> previo al cliente en automático (solo las lámparas que cambiaron).
 * Se detiene (queda en "Revisar diseño" y avisa) si la IA anotó dudas, si se llegó al tope de envíos o si el
 * interruptor está apagado: crm_settings/general.designBetaAutoSendActive / designBetaMockupDirectActive = false.
 */
async function afterReady(dh, lamps, mode, auth) {
    const settings = (await db.collection('crm_settings').doc('general').get()).data() || {};
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data();
    const hold = async (why, step) => {
        await orderDoc.ref.update({ 'autoLamp.step': step, 'autoLamp.autoSendHeld': why });
        await notifyAdmin(`🟡 DH${dh} — el diseño de la IA (BETA) no siguió solo: ${why}. Revísalo en Pendientes de Diseño → Revisar diseño.`);
    };
    // Pedido que YA tiene archivo en Drive: no se le manda al cliente ni se sube solo (no cortar dos veces).
    const before = alreadyUploaded(order);
    if (before) return hold(`${before.text}. Para no repetir el pedido, el diseño nuevo se quedó sin mandar ni subir; si sí hay que reponerlo, apruébalo a mano`, 'Listo · el pedido ya estaba en Drive');
    const doubts = lamps.flatMap(l => (l.brief?.advertencias || []).map(a => lamps.length > 1 ? `${l.label}: ${a}` : a));
    if (doubts.length) return hold(`la IA anotó dudas (${doubts.join('; ')})`, 'Listo · revisar dudas');
    if (mode === 'mockup') {
        if (settings.designBetaMockupDirectActive === false) return;
        if (!isPaid(order)) return hold('sale del mockup que ya vio el cliente pero el pago no está validado', 'Listo · esperando pago');
        try {
            const r = await approve(dh, { actor: { email: 'mockup pagado (directo a corte)' } });
            await notifyAdmin(`✅ DH${dh} — diseño de la IA (BETA) sacado del mockup que ya pagó el cliente: ${uploadSummary(r)}`);
        } catch (error) { await hold(`no se pudo subir a Drive (${error.message})`, 'Listo · no se pudo subir solo'); }
        return;
    }
    if (settings.designBetaAutoSendActive === false) return;
    const rounds = Number(order.autoLamp?.client?.rounds) || 0;
    if (rounds >= MAX_CLIENT_SENDS) return hold(`ya se le mandaron ${rounds} versiones; necesita una persona`, 'Listo · tope de envíos al cliente');
    const changed = lamps.filter(l => l.changed !== false).map(l => l.index);
    try { await sendToClient(dh, { auth: auth || {}, actor: { email: 'envío automático', auto: true }, only: rounds ? changed : null }); }
    catch (error) { await hold(`falló el envío al cliente (${error.message})`, 'Listo · no se pudo mandar solo'); }
}

/**
 * Lo que decidió el clasificador sobre la respuesta del cliente (lo llama designApproval.handleReply para
 * los pedidos del Beta). Aprobado: sube a Drive (SVG Corte). Cambios: la IA rehace SOLO las lámparas a las
 * que aplica el cambio y se las vuelve a mandar.
 */
async function handleBetaDecision(orderId, decision, { clientText = '', changeSummary = '' } = {}) {
    const ref = db.collection('pedidos').doc(String(orderId));
    const order = (await ref.get()).data() || {};
    const dh = order.consecutiveOrderNumber;
    if (decision === 'approved') {
        await ref.update({ 'autoLamp.client': { ...(order.autoLamp?.client || {}), status: 'approved', answeredAt: now(), text: String(clientText).slice(0, 300) } });
        // El "sí" del cliente sube las hojas de RDWorks a la carpeta SVG Corte de Drive (Chris, 19-oct-2026).
        // approve() tiene el candado contra doble subida; si algo falla, queda para subirlo a mano.
        if (!dh) return { uploaded: false, error: 'Pedido sin número.' };
        // Lo que se sube debe ser LO QUE VIO el cliente: si alguna lámpara se modificó en el editor después de
        // mandársela, no se sube sola (DH18191, 19-oct-2026: se movió en el editor y se subió recortada).
        const seen = order.autoLamp?.client?.revisions || {};
        const changed = [];
        for (const lamp of lampsOf(order.autoLamp)) {
            const rev = (await db.collection('editor_v2_projects').doc(lamp.projectId).get()).data()?.revision;
            if (seen[lamp.index] != null && Number(rev) !== Number(seen[lamp.index])) changed.push(`${lamp.label || 'lámpara ' + (lamp.index + 1)} (versión ${seen[lamp.index]} → ${rev})`);
        }
        if (changed.length) return { uploaded: false, error: `el diseño se modificó en el editor DESPUÉS de mandárselo al cliente: ${changed.join(', ')}. Revisa que siga igual a lo que aprobó y súbelo a mano` };
        // VERSIÓN CORREGIDA (DH18264, 20-oct-2026): si lo que había en Drive lo subió este mismo Beta y el cliente vio
        // un previo NUEVO después (pidió un cambio tras aprobar), su «sí» es para reemplazarlo: se sube aunque ya
        // hubiera archivo (approve avisa al equipo que el anterior NO se corte). Antes se quedaba frenado.
        const sentMs = order.autoLamp?.client?.sentAt?.toMillis?.() || 0, uploadedMs = order.svgCorteAt?.toMillis?.() || 0;
        const replacing = order.svgCorteBy === 'auto-lamp-beta' && uploadedMs > 0 && sentMs > uploadedMs;
        try { const r = await approve(dh, { force: replacing, actor: { email: replacing ? 'cliente (aprobó la versión corregida)' : 'cliente (aprobó por WhatsApp)' } }); return { uploaded: true, ...r, driveUrl: r.driveUrls.join(' '), summary: uploadSummary(r) + (replacing ? ' — REEMPLAZA al archivo anterior: que ese NO se corte' : '') }; }
        catch (error) { return { uploaded: false, error: error.message }; }
    }
    if (decision === 'changes') {
        const note = `El cliente pidió este cambio: ${changeSummary || clientText}`.slice(0, 500);
        // NO se rehace al instante (DH18305 y DH18289, 20-oct-2026): el cliente suele mandar el dato o la foto en los
        // mensajes siguientes («la fecha en que falleció» … «11/10/26»). Queda pendiente y runPendingRedos lo
        // rehace cuando el cliente lleva REDO_QUIET_MS sin escribir, leyendo ya todos sus mensajes.
        await ref.update({ 'autoLamp.client': { ...(order.autoLamp?.client || {}), status: 'changes', answeredAt: now(), text: String(changeSummary || clientText).slice(0, 300) },
            'autoLamp.pendingRedo': { note, at: Date.now() }, 'autoLamp.step': 'Esperando a que el cliente termine de escribir para rehacer' });
    }
}

const REDO_QUIET_MS = 3 * 60 * 1000, REDO_MAX_WAIT_MS = 20 * 60 * 1000;
// Rehace los cambios pendientes cuyo cliente ya dejó de escribir (lo llama un reloj en las rutas cada minuto).
async function runPendingRedos() {
    const snap = await db.collection('pedidos').where('autoLamp.pendingRedo.at', '>', 0).limit(20).get();
    for (const doc of snap.docs) {
        const order = doc.data(), pending = order.autoLamp.pendingRedo, dh = order.consecutiveOrderNumber;
        const contactId = String(order.contactId || order.telefono || '');
        // Último mensaje del CLIENTE (lo suyo trae from = su id).
        const recent = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'desc').limit(15).get().catch(() => null);
        const last = recent?.docs.map(d => d.data()).find(m => String(m.from || '') === contactId);
        const lastMs = Math.max(pending.at, last?.timestamp?.toMillis?.() || 0);
        if (Date.now() - lastMs < REDO_QUIET_MS && Date.now() - pending.at < REDO_MAX_WAIT_MS) continue;
        await doc.ref.update({ 'autoLamp.pendingRedo': admin.firestore.FieldValue.delete() });
        if (!dh || order.autoLamp.status !== 'ready') continue;   // alguien ya lo rehízo o lo aprobó a mano
        const note = `${pending.note}. Lee TODOS los mensajes del cliente después de su cambio: ahí pueden venir el dato (fecha, nombre) o la foto que pidió, y otros ajustes.`;
        generate(dh, { beta: true, note, keepClient: true }).catch(error => console.warn(`[AUTO-LAMP] rehacer DH${dh} por cambio del cliente:`, error.message));
    }
}

/**
 * El cliente pidió un CAMBIO después de aprobar (y de que el archivo ya se subió a corte). Lo llama la IA del
 * chat al escribir /corregir (services.js; esa parte regresa el pedido a Pendientes de Diseño y pausa la IA,
 * y al cliente ya se le dijo que lo vamos a checar). Aquí: se marca y se avisa con lo que el sistema sabe,
 * porque nada registra si la pieza ya pasó por la láser: eso se verifica en taller.
 */
async function changeAfterApproval(orderId, clientText = '') {
    const ref = db.collection('pedidos').doc(String(orderId));
    const order = (await ref.get()).data() || {};
    const autoLamp = order.autoLamp || {};
    await ref.update({ 'autoLamp.client': { ...(autoLamp.client || {}), status: 'change_after_approval', answeredAt: now(), text: String(clientText).slice(0, 300) } });
    // Si su lámpara esperaba pareja para la hoja, sale de la cola (todavía no se sube nada).
    const wasQueued = !!autoLamp.queued && !autoLamp.queued.claimedBy;
    if (wasQueued) await leaveQueue(ref).catch(() => {});
    const dh = order.consecutiveOrderNumber ? `DH${order.consecutiveOrderNumber}` : orderId;
    const subido = order.svgCorteAt?.toMillis ? Math.round((Date.now() - order.svgCorteAt.toMillis()) / 60000) : null;
    const hace = subido == null ? '' : subido < 90 ? ` hace ${subido} min` : ` hace ${Math.round(subido / 60)} h`;
    const guia = order.guiaEnvio && order.guiaEnvio.guia;
    const links = (autoLamp.driveUrls && autoLamp.driveUrls.length ? autoLamp.driveUrls : [order.svgCorteUrl]).filter(Boolean).join(' ');
    await notifyAdmin(`✏️ ${dh} — el cliente pidió un CAMBIO después de aprobar el diseño de la IA (BETA): "${String(clientText).slice(0, 200)}".\n`
        + (wasQueued ? `• Su lámpara estaba EN COLA esperando pareja: se sacó de la cola y NO se subió${links ? ` (lo que ya estaba en Drive: ${links})` : ''}\n`
            : `• El archivo se subió a Drive (SVG Corte)${hace}: ${links || '(sin link)'}\n`)
        + `• Estatus: ${order.estatus || '—'}${guia ? ` · YA TIENE GUÍA ${guia}` : ' · sin guía'}\n`
        + `👉 Revisa en taller si ya se cortó/grabó. Si no, sácalo de la fila de corte y corrígelo. Al cliente ya se le dijo que lo vamos a checar; el pedido regresó a Pendientes de Diseño y la IA quedó pausada en su chat.`);
}

// --- BETA: subida a Drive. Es el ÚNICO camino por el que algo de aquí sube a la carpeta de corte. ------

/**
 * Sube a Drive (SVG Corte) las hojas para RDWorks del pedido, armadas desde la última versión guardada de cada
 * proyecto. svg: solo indica que se aprobó desde el editor.
 */
// ¿El pedido YA tiene un archivo en la carpeta de corte (por el Beta, el corte automático, a mano…)? Para no
// cortar dos veces el mismo pedido (Chris, 19-oct-2026). Devuelve la descripción o null.
function alreadyUploaded(order) {
    if (!order || !order.svgCorteAt) return null;
    const at = order.svgCorteAt.toDate ? order.svgCorteAt.toDate() : null;
    const when = at ? at.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'antes';
    const by = { 'auto-lamp-beta': 'el Diseño IA (Beta)', 'server-svg-v1': 'el corte automático' }[order.svgCorteBy] || order.svgCorteBy || 'el equipo';
    const links = (Array.isArray(order.svgCorteFiles) && order.svgCorteFiles.length ? order.svgCorteFiles.map(f => f.url) : [order.svgCorteUrl]).filter(Boolean);
    return { when, by, links, text: `Este pedido YA se subió a Drive (SVG Corte) el ${when}, por ${by}${links.length ? `: ${links.join(' ')}` : ''}` };
}

// --- COLA DE LÁMPARAS SUELTAS (Chris, 20-oct-2026) -----------------------------------------------------------
// La hoja de las máquinas lleva DOS lámparas. Un pedido con un número impar de lámparas sube sus parejas y la que
// sobra espera en cola; cuando otro pedido deja una suelta, se juntan en una hoja «DHa-DHb» y quedan subidos los
// dos. «Subir sola» la sube sin esperar, y si en QUEUE_MAX_HOURS no llegó pareja sale sola (como los corazones del
// corte automático). La cola es UN lugar (si hay alguien esperando, el siguiente se junta con él).
const QUEUE_REF = () => db.collection('crm_settings').doc('design_beta_sheet_queue');
const QUEUE_MAX_HOURS = 12;

async function uploadSheet(folder, stamp, suffix, svgText, driveName) {
    const { uploadDrive } = require('../svgCutStorage');
    const { Resvg } = require('@resvg/resvg-js');
    const bytes = Buffer.from(svgText);
    const storageUrl = await saveFile(`${folder}/aprobado-${stamp}${suffix}.svg`, bytes, 'image/svg+xml');
    let preview = null;
    try { preview = await saveFile(`${folder}/aprobado-${stamp}${suffix}.png`, new Resvg(svgText, { fitTo: { mode: 'width', value: 1400 }, background: '#ffffff' }).render().asPng(), 'image/png'); }
    catch (_) { /* sin vista previa de la hoja */ }
    const upload = await uploadDrive(driveName, bytes);
    return { name: upload.name, url: upload.webViewLink, svg: storageUrl, preview };
}

// Deja el pedido como subido a Drive con sus hojas (los campos que leen el tablero, el candado y el chat).
function uploadedFields(files, { actor = null, svg = null, previous = null, pairedWith = null, previewUrl = null } = {}) {
    return {
        svgCorteAt: admin.firestore.Timestamp.now(), svgCorteBy: 'auto-lamp-beta', svgCorteUrl: files[0].url,
        svgCorteUrls: files.length > 1 ? files.map(f => f.url).join(',') : null,
        svgCorteFileName: files[0].name, svgCortePreviewUrl: files[0].preview || previewUrl || null, svgCorteStorageUrl: files[0].svg,
        svgCorteFiles: files,
        // Subida repetida confirmada por una persona: se guarda qué había antes.
        ...(previous ? { svgCorteHistory: admin.firestore.FieldValue.arrayUnion({ ...previous, replacedBy: actor?.email || actor?.uid || null, replacedAt: admin.firestore.Timestamp.now() }) } : {}),
        'autoLamp.status': 'approved', 'autoLamp.step': pairedWith ? `Aprobado y en Drive (en la hoja con DH${pairedWith})` : 'Aprobado y en Drive',
        'autoLamp.driveUrl': files[0].url, 'autoLamp.driveUrls': files.map(f => f.url),
        'autoLamp.queued': admin.firestore.FieldValue.delete(), 'autoLamp.queuedFiles': admin.firestore.FieldValue.delete(),
        ...(pairedWith ? { 'autoLamp.pairedWith': pairedWith } : {}),
        'autoLamp.approvedAt': now(), 'autoLamp.approvedBy': actor?.email || actor?.uid || null,
        'autoLamp.approvedFromEditor': !!svg, 'autoLamp.error': admin.firestore.FieldValue.delete(), 'autoLamp.updatedAt': now(),
    };
}

/**
 * Sube a Drive (SVG Corte) las hojas para RDWorks del pedido, armadas desde la última versión guardada de cada
 * proyecto. svg: solo indica que se aprobó desde el editor. force: subir aunque el pedido YA tenga un archivo
 * en Drive (solo una persona, después de ver el aviso; los caminos automáticos nunca lo mandan). alone: la
 * lámpara que sobra se sube sola en su hoja en vez de esperar pareja.
 * Devuelve { driveUrls, queued } (queued = una lámpara se quedó esperando pareja).
 */
async function approve(dh, { svg = null, actor = null, force = false, alone = false } = {}) {
    const orderDoc = await findOrder(dh);
    const ref = orderDoc.ref;
    // Candado contra doble subida: solo un 'ready' pasa a 'uploading'. Un 'uploading' que quedó colgado
    // (reinicio a media subida) NO se reintenta solo: Drive pudo haberlo recibido. Y si el pedido ya tiene un
    // archivo en Drive (por cualquier camino), no se vuelve a subir sin que una persona lo confirme.
    let previous = null;
    const autoLamp = await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data() || {}, current = data.autoLamp;
        if (!current || current.status !== 'ready') {
            const why = current?.status === 'uploading' ? 'Ya se está subiendo (o se cortó a media subida: revisa Drive antes de reintentar).'
                : current?.queued ? 'Ya se aprobó y está en cola esperando otra lámpara para la hoja (usa «Subir sola» si no quieres esperar).'
                : current?.status === 'approved' ? (alreadyUploaded(data)?.text || 'Ya se aprobó y subió a Drive.') : 'No hay un diseño listo para aprobar.';
            throw Object.assign(new Error(why), { status: 409, code: current?.status === 'approved' && !current?.queued ? 'ALREADY_UPLOADED' : undefined });
        }
        const before = alreadyUploaded(data);
        if (before && !force) throw Object.assign(new Error(`${before.text}. Para no cortarlo dos veces NO se volvió a subir.`), { status: 409, code: 'ALREADY_UPLOADED', previous: before });
        if (before) previous = { at: data.svgCorteAt, by: data.svgCorteBy || null, files: data.svgCorteFiles || (data.svgCorteUrl ? [{ url: data.svgCorteUrl }] : []) };
        tx.update(ref, { 'autoLamp.status': 'uploading', 'autoLamp.step': 'Subiendo a Drive', 'autoLamp.updatedAt': now() });
        return current;
    });
    let sent = false, partner = null;
    const files = [];
    try {
        const { rdworksSheets, rdworksSheet } = await composerModule();
        const pieces = await piecesFor(autoLamp);
        const leftover = !alone && pieces.length % 2 === 1 ? pieces.pop() : null;
        const folder = `${STORAGE_DIR}/DH${dh}`, stamp = Date.now().toString(36);
        // 1) Las parejas del propio pedido (y, con «subir sola», la que sobra en su hoja).
        const own = pieces.length ? await rdworksSheets(pieces.map(piece => ({ piece, copies: 1 })), `DH${dh}`) : [];
        for (const [k, svgText] of own.entries()) {
            const suffix = own.length > 1 ? `-h${k + 1}` : '';
            sent = true;
            files.push(await uploadSheet(folder, stamp, suffix, svgText, `DH${dh}-ia-beta-${stamp}${suffix}.svg`));
        }
        if (leftover) {
            // 2) La que sobra: ¿hay otra esperando? Si no, este pedido se queda en la cola (en la misma transacción).
            partner = await db.runTransaction(async tx => {
                const queue = (await tx.get(QUEUE_REF())).data();
                const waitingRef = queue?.orderId && queue.orderId !== orderDoc.id ? db.collection('pedidos').doc(queue.orderId) : null;
                const waiting = waitingRef ? (await tx.get(waitingRef)).data() : null;
                if (waiting?.autoLamp?.queued && !waiting.autoLamp.queued.claimedBy) {
                    tx.delete(QUEUE_REF());
                    tx.update(waitingRef, { 'autoLamp.queued.claimedBy': dh });
                    return { ref: waitingRef, dh: waiting.consecutiveOrderNumber, data: waiting };
                }
                tx.set(QUEUE_REF(), { orderId: orderDoc.id, dh, at: now() });
                tx.update(ref, { 'autoLamp.status': 'approved', 'autoLamp.queued': { at: now() }, 'autoLamp.queuedFiles': files,
                    'autoLamp.step': files.length ? `${files.length} hoja(s) en Drive; 1 lámpara en cola esperando otra para la hoja` : 'En cola: esperando otra lámpara para juntarla en la hoja',
                    'autoLamp.driveUrls': files.map(f => f.url), 'autoLamp.approvedAt': now(), 'autoLamp.approvedBy': actor?.email || actor?.uid || null,
                    'autoLamp.approvedFromEditor': !!svg, 'autoLamp.error': admin.firestore.FieldValue.delete(), 'autoLamp.updatedAt': now() });
                return null;
            });
            if (!partner) {
                try { await require('../designPending').recomputeForContact(orderDoc.data().contactId || orderDoc.data().telefono); } catch (_) {}
                return { queued: true, driveUrls: files.map(f => f.url), driveUrl: files[0]?.url || null };
            }
            // 3) Hoja compartida: la que esperaba arriba, esta abajo.
            const partnerPiece = (await piecesFor(partner.data.autoLamp)).pop();
            const pairSvg = await rdworksSheet([{ piece: partnerPiece, slot: 0 }, { piece: leftover, slot: 1 }], `DH${partner.dh} + DH${dh}`);
            sent = true;
            const shared = await uploadSheet(folder, stamp, '-par', pairSvg, `DH${partner.dh}-DH${dh}-ia-beta-${stamp}.svg`);
            files.push(shared);
            await partner.ref.update(uploadedFields([...(partner.data.autoLamp.queuedFiles || []), shared], { pairedWith: dh, actor: { email: `junto con DH${dh}` }, previewUrl: partner.data.autoLamp.previewUrl }));
            try { await require('../designPending').recomputeForContact(partner.data.contactId || partner.data.telefono); } catch (_) {}
        }
        await ref.update(uploadedFields(files, { actor, svg, previous, pairedWith: partner?.dh || null, previewUrl: autoLamp.previewUrl }));
        try { await require('../designPending').recomputeForContact(orderDoc.data().contactId || orderDoc.data().telefono); } catch (_) {}
        if (previous) await notifyAdmin(`⚠️ DH${dh} se subió OTRA VEZ a Drive (SVG Corte), confirmado por ${actor?.email || 'una persona'}. Ya tenía archivo de antes: revisa que no se corten los dos. Nuevo: ${files.map(f => f.url).join(' ')}`);
        return { driveUrl: files[0].url, driveUrls: files.map(f => f.url), fileName: files[0].name, pairedWith: partner?.dh || null };
    } catch (error) {
        // La que esperaba pareja y no se pudo juntar regresa a la cola (si nadie más la ocupó).
        if (partner) await db.runTransaction(async tx => {
            const queue = (await tx.get(QUEUE_REF())).data();
            tx.update(partner.ref, { 'autoLamp.queued.claimedBy': admin.firestore.FieldValue.delete() });
            if (!queue) tx.set(QUEUE_REF(), { orderId: partner.ref.id, dh: partner.dh, at: partner.data.autoLamp.queued.at || now() });
        }).catch(() => {});
        // Antes de mandar a Drive (o si Drive rechazó con error claro) vuelve a 'ready' para reintentar. Si ya
        // subió alguna hoja, o se mandó y no hubo confirmación, es ambiguo: se queda en 'uploading' para revisar
        // Drive a mano (reintentar subiría hojas repetidas).
        const ambiguous = files.length > 0 || (sent && (error.name === 'TimeoutError' || /no confirmó/.test(error.message || '')));
        await ref.update(ambiguous
            ? { 'autoLamp.step': `Revisar Drive: se subieron ${files.length} hoja(s) y falló la siguiente`, 'autoLamp.error': error.message,
                'autoLamp.driveUrls': files.map(f => f.url), 'autoLamp.updatedAt': now() }
            : { 'autoLamp.status': 'ready', 'autoLamp.step': 'Listo para revisar', 'autoLamp.error': error.message, 'autoLamp.updatedAt': now() }).catch(() => {});
        throw error;
    }
}

// Cómo quedó una aprobación, para los avisos al equipo.
function uploadSummary(r) {
    const links = (r.driveUrls || []).join(' ');
    if (r.queued) return links ? `se subieron ${r.driveUrls.length} hoja(s) a Drive (SVG Corte): ${links} — y 1 lámpara quedó en cola esperando otra para juntarla en la hoja`
        : 'quedó en cola esperando otra lámpara para juntarla en la hoja (o «Subir sola» en Pendientes de Diseño)';
    return `se subió a Drive (SVG Corte)${r.pairedWith ? ` en la hoja junto con DH${r.pairedWith}` : ''}: ${links}`;
}

// «Subir sola»: la lámpara de un pedido que espera pareja se sube en su hoja sin esperar (una persona, o sola
// tras QUEUE_MAX_HOURS).
async function uploadQueuedAlone(dh, { actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const ref = orderDoc.ref;
    const data = await db.runTransaction(async tx => {
        const order = (await tx.get(ref)).data() || {};
        if (!order.autoLamp?.queued) throw Object.assign(new Error('Este pedido no está en cola esperando pareja.'), { status: 409 });
        if (order.autoLamp.queued.claimedBy) throw Object.assign(new Error(`Ya se está juntando con DH${order.autoLamp.queued.claimedBy}.`), { status: 409 });
        const queue = (await tx.get(QUEUE_REF())).data();
        if (queue?.orderId === ref.id) tx.delete(QUEUE_REF());
        tx.update(ref, { 'autoLamp.queued.claimedBy': 'sola', 'autoLamp.step': 'Subiendo sola a Drive', 'autoLamp.updatedAt': now() });
        return order;
    });
    try {
        const { rdworksSheet } = await composerModule();
        const piece = (await piecesFor(data.autoLamp)).pop();
        const stamp = Date.now().toString(36);
        const file = await uploadSheet(`${STORAGE_DIR}/DH${dh}`, stamp, '-sola', await rdworksSheet([{ piece, slot: 0 }], `DH${dh}`), `DH${dh}-ia-beta-${stamp}.svg`);
        const files = [...(data.autoLamp.queuedFiles || []), file];
        await ref.update(uploadedFields(files, { actor, previewUrl: data.autoLamp.previewUrl }));
        try { await require('../designPending').recomputeForContact(data.contactId || data.telefono); } catch (_) {}
        return { driveUrl: files[0].url, driveUrls: files.map(f => f.url) };
    } catch (error) {
        await ref.update({ 'autoLamp.queued.claimedBy': admin.firestore.FieldValue.delete(), 'autoLamp.error': error.message, 'autoLamp.updatedAt': now() }).catch(() => {});
        await QUEUE_REF().set({ orderId: ref.id, dh, at: data.autoLamp.queued.at || now() }).catch(() => {});
        throw error;
    }
}

/**
 * «Reabrir para corregir» (Chris, 20-oct-2026, DH18256): un diseño ya subido cuyo archivo la persona BORRÓ de
 * Drive vuelve a «Revisar diseño» (rehacer, editor, aprobar). Si su hoja era compartida, el otro pedido también
 * se quedó sin archivo: regresa a «listo para aprobar» con su mismo diseño (no se rehace). Lo que había en Drive
 * queda en svgCorteHistory.
 */
async function reopen(dh, { actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data(), autoLamp = order.autoLamp || {};
    if (autoLamp.status !== 'approved' || autoLamp.queued) throw Object.assign(new Error(autoLamp.queued ? 'Está en cola esperando pareja: todavía no se sube, se puede rehacer con «Subir sola» o esperar.' : 'Este diseño no está subido a Drive.'), { status: 409 });
    const files = order.svgCorteFiles || (order.svgCorteUrl ? [{ url: order.svgCorteUrl, name: order.svgCorteFileName || '' }] : []);
    const who = actor?.email || actor?.uid || null;
    const cleared = (step, data) => ({
        svgCorteAt: admin.firestore.FieldValue.delete(), svgCorteBy: admin.firestore.FieldValue.delete(), svgCorteUrl: admin.firestore.FieldValue.delete(),
        svgCorteUrls: admin.firestore.FieldValue.delete(), svgCorteFileName: admin.firestore.FieldValue.delete(), svgCortePreviewUrl: admin.firestore.FieldValue.delete(),
        svgCorteStorageUrl: admin.firestore.FieldValue.delete(), svgCorteFiles: admin.firestore.FieldValue.delete(),
        svgCorteHistory: admin.firestore.FieldValue.arrayUnion({ at: data.svgCorteAt || null, by: data.svgCorteBy || null, files: data.svgCorteFiles || [], removedBy: who, removedAt: admin.firestore.Timestamp.now(), reason: 'borrado de Drive para corregir' }),
        'autoLamp.status': 'ready', 'autoLamp.step': step, 'autoLamp.driveUrl': admin.firestore.FieldValue.delete(), 'autoLamp.driveUrls': admin.firestore.FieldValue.delete(),
        'autoLamp.pairedWith': admin.firestore.FieldValue.delete(), 'autoLamp.error': admin.firestore.FieldValue.delete(), 'autoLamp.updatedAt': now(),
    });
    // El otro pedido de una hoja compartida: solo si esa hoja era todo lo suyo (si tenía más hojas, se avisa).
    const partners = [];
    for (const file of files) {
        const other = (String(file.name || '').match(/DH(\d+)-DH(\d+)-ia-beta/) || []).slice(1).map(Number).find(n => n && n !== Number(dh));
        if (!other) continue;
        const partnerDoc = await findOrder(other).catch(() => null);
        const p = partnerDoc?.data();
        if (!p) continue;
        const theirs = p.svgCorteFiles || [];
        if (p.autoLamp?.status === 'approved' && theirs.length === 1 && theirs[0].name === file.name) {
            await partnerDoc.ref.update(cleared(`Su hoja (compartida con DH${dh}) se borró de Drive: vuelve a aprobarla para subirla`, p));
            partners.push({ dh: other, reset: true });
        } else partners.push({ dh: other, reset: false });
        try { await require('../designPending').recomputeForContact(p.contactId || p.telefono); } catch (_) {}
    }
    await orderDoc.ref.update(cleared('Reabierto para corregir (se borró de Drive)', order));
    try { await require('../designPending').recomputeForContact(order.contactId || order.telefono); } catch (_) {}
    const manual = partners.filter(p => !p.reset).map(p => `DH${p.dh}`);
    await notifyAdmin(`↩️ DH${dh} se reabrió para corregir (su archivo se borró de Drive)${partners.some(p => p.reset) ? `. Su hoja era compartida: ${partners.filter(p => p.reset).map(p => `DH${p.dh}`).join(', ')} también regresó a «Revisar diseño» para volver a subirlo` : ''}${manual.length ? `. OJO: ${manual.join(', ')} compartía la hoja pero tiene más archivos; revisa a mano que su lámpara se vuelva a subir` : ''}.`);
    return { partners };
}

// Saca un pedido de la cola sin subirlo (el cliente pidió un cambio después de aprobar).
async function leaveQueue(ref) {
    await db.runTransaction(async tx => {
        const order = (await tx.get(ref)).data() || {};
        if (!order.autoLamp?.queued || order.autoLamp.queued.claimedBy) return;
        const queue = (await tx.get(QUEUE_REF())).data();
        if (queue?.orderId === ref.id) tx.delete(QUEUE_REF());
        tx.update(ref, { 'autoLamp.queued': admin.firestore.FieldValue.delete() });
    });
}

// La que lleva más de QUEUE_MAX_HOURS esperando pareja sale sola (lo llama un reloj en las rutas).
async function flushStaleQueue() {
    const queue = (await QUEUE_REF().get()).data();
    if (!queue?.at?.toMillis || Date.now() - queue.at.toMillis() < QUEUE_MAX_HOURS * 3600000) return null;
    const r = await uploadQueuedAlone(queue.dh, { actor: { email: `sin pareja en ${QUEUE_MAX_HOURS} h` } });
    await notifyAdmin(`🕒 DH${queue.dh} — su lámpara esperó ${QUEUE_MAX_HOURS} h otra para juntarla en la hoja y no llegó: se subió SOLA a Drive (SVG Corte): ${r.driveUrls.join(' ')}`);
    return r;
}

// Diseños que quedaron «working» de un proceso anterior del servidor (se reinició a media generación).
async function markInterrupted() {
    const snap = await db.collection('pedidos').where('autoLamp.status', 'in', ['working', 'uploading']).limit(50).get();
    for (const doc of snap.docs) {
        const a = doc.data().autoLamp || {};
        if (a.status === 'uploading') {
            // A media subida: Drive pudo haber recibido algo; NO se reintenta solo (approve lo explica).
            await doc.ref.update({ 'autoLamp.step': 'Revisar Drive: el servidor se reinició a media subida', 'autoLamp.updatedAt': now() });
            continue;
        }
        await doc.ref.update({ 'autoLamp.status': 'error', 'autoLamp.error': 'Se interrumpió porque el servidor se reinició (actualización). Dale «Rehacer».', 'autoLamp.updatedAt': now() });
        console.log(`[AUTO-LAMP] DH${doc.data().consecutiveOrderNumber}: diseño interrumpido por reinicio, marcado para rehacer.`);
    }
}

// Descarta el diseño (no sube nada). Después se puede regenerar con una indicación.
async function reject(dh, { reason = '', actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const lamp = orderDoc.data().autoLamp;
    if (!lamp || !['ready', 'error'].includes(lamp.status)) throw Object.assign(new Error('No hay un diseño para descartar.'), { status: 409 });
    await orderDoc.ref.update({ 'autoLamp.status': 'rejected', 'autoLamp.step': 'Descartado', 'autoLamp.rejectedAt': now(),
        'autoLamp.rejectReason': String(reason).slice(0, 500), 'autoLamp.rejectedBy': actor?.email || actor?.uid || null, 'autoLamp.updatedAt': now() });
}

module.exports = { generate, status, approve, reject, markInterrupted, teamPreview, alreadyUploaded, freeNameSlot, templateFor, clientPreview, engravePolarity, fitToLampCircle, sendToClient, handleBetaDecision, changeAfterApproval, orderName, orderLamps, lampsOf,
    pickReference, customerImages, ourImages, designBriefOrder, chatHistory, rdworksSheetsFor, uploadQueuedAlone, flushStaleQueue, leaveQueue, reopen, removeRing, removeRingFromLamp, buildFromImage, runPendingRedos };
