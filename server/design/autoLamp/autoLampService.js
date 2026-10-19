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
// Sube cuando cambia cómo se ve el previo para el cliente: los ya guardados se vuelven a armar.
const CLIENT_PREVIEW_STYLE = 4;
const RASTER_PROMPT = 'dame el diseño de la imagen con rellenos blancos y fondos negros. En raster engrave con degradado en trama';
// Mockup (foto/render de la lámpara prendida que ya vio el cliente) -> el grabado TAL CUAL, con su texto.
const MOCKUP_PROMPT = 'Esta imagen es un mockup de una lámpara LED de acrílico redonda, encendida. Extrae SOLO el diseño grabado dentro del círculo de acrílico: el dibujo y el texto/nombre EXACTAMENTE como están (mismas letras, misma tipografía, misma pose y posición), centrado y ocupando el cuadro como ocupa el círculo. Quita la base, la mesa, el fondo, los reflejos y el color de la luz. Solo blanco y negro, sin colores: el diseño en BLANCO sobre un fondo NEGRO uniforme de orilla a orilla, sin círculos, marcos ni bordes. En raster engrave con degradado en trama.';
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
        return { index, producto: String(item.producto || '').trim(), datos, copies: Math.max(1, parseInt(item.cantidad, 10) || 1),
            label: [String(item.producto || '').trim(), name && name.trim()].filter(Boolean).join(' · ') || `Lámpara ${index + 1}` };
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
    return snapshot.docs.map(doc => doc.data())
        .filter(m => m.fileUrl && /^image\//.test(m.fileType || '') && m.status !== 'sent' && (!ours || m.from !== ours))
        .map(m => ({ url: m.fileUrl, text: m.text || '', at: m.timestamp?.toDate?.() || null }));
}

// Imágenes que mandamos NOSOTROS (aquí van los mockups que ya vio el cliente, y también datos de pago, etc.).
async function ourImages(contactId) {
    // Lo que manda el cliente trae from = su id (así lo consulta designApproval); lo demás es nuestro.
    const snapshot = await db.collection('contacts_whatsapp').doc(String(contactId)).collection('messages').orderBy('timestamp', 'desc').limit(150).get();
    return snapshot.docs.reverse().map(doc => doc.data())
        .filter(m => m.fileUrl && /^image\//.test(m.fileType || '') && String(m.from || '') !== String(contactId))
        .map(m => ({ url: m.fileUrl, text: m.text || '', at: m.timestamp?.toDate?.() || null }));
}

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
    let response, lastStatus = 0;
    attempts: for (const model of [VISION_MODEL, VISION_MODEL, VISION_MODEL, ...BRIEF_FALLBACK_MODELS]) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(120000),
        }).catch(() => null);
        lastStatus = response?.status || 0;
        if (response?.ok) break attempts;
        if (response && ![429, 500, 502, 503, 504].includes(response.status)) break attempts;
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!response?.ok) throw new Error(`La IA no pudo leer el pedido (${lastStatus || 'sin respuesta'}). Intenta de nuevo en unos minutos.`);
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    try { return JSON.parse(text); } catch (_) { throw new Error('La IA no respondió en el formato esperado.'); }
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
    const client = clientImages.slice(-6), sent = sentImages.slice(-8);
    const lampList = lamps.map(l => `L${l.index}: ${l.producto || 'Lámpara'} — datos: "${l.datos || '(sin datos)'}"${l.copies > 1 ? ` — cantidad ${l.copies} (iguales)` : ''}`).join('\n');
    const prevList = previous.length ? previous.map(p => `L${p.index}: ya diseñada (${p.brief?.resumen || p.label || ''})`).join('\n') : '';
    const parts = [{ text: `Eres el diseñador de DekoorHouse. Hacemos lámparas LED de acrílico grabado con láser: un marco redondo con base, y dentro se GRABA una imagen en blanco y negro (raster con trama) y, si el cliente lo pidió, un NOMBRE/TEXTO.
Este pedido trae ${lamps.length} lámpara(s) DISTINTAS; decide el diseño de CADA una por separado:
${lampList}

${note ? `INDICACIÓN / CAMBIO PEDIDO (tiene prioridad sobre todo lo demás): "${note}"\n` : ''}${prevList ? `Lo que ya está diseñado:\n${prevList}\n` : ''}
Conversación reciente (lo más nuevo al final):
${history || '(sin mensajes)'}

Abajo van las imágenes. Las del CLIENTE se llaman C0, C1…; las que mandamos NOSOTROS se llaman N0, N1… (entre las nuestras puede haber MOCKUPS: imágenes de la lámpara terminada o prendida con el diseño y el nombre que ya le enseñamos al cliente; también hay datos de pago, catálogo, etc.).
Para CADA lámpara decide:
- "fuente": "mockup" si entre las imágenes N hay un mockup de ESA lámpara (mismo personaje/diseño y nombre); "cliente" si hay que grabar una foto/imagen que mandó el cliente; "ilustracion" si no hay imagen que sirva y hay que dibujarla desde cero.
- "imagen": la imagen elegida ("N2", "C0"…), o "" si es ilustración. NUNCA comprobantes de pago, capturas de transferencias, datos bancarios, tickets ni capturas de chat. Un mockup solo vale para la lámpara cuyo nombre/diseño coincide.
- "prompt": si es ilustración, describe en español la ilustración a generar (personaje, pose, estilo), SIN texto ni letras. Si es foto del cliente, qué conservar o ajustar (ej. "solo las dos personas, sin el fondo") o "". Si es mockup, "".
- "nombre": el texto FINAL a grabar (nombre(s), apellidos, fecha, frase) con lo ÚLTIMO que pidió el cliente: si después del mockup o de registrar el pedido escribió algo como "el apellido es…", "agrégale…", "ponle también…", "mejor que diga…", eso CAMBIA o SE SUMA al texto. Cada nombre y apellido con inicial mayúscula y sus acentos (ej. "Domínguez Quintana"). "" si no lleva texto. Si es largo, pártelo en renglones con " · " (ej. "Victor Emilio · Domínguez Quintana").
- "textoCambia": SOLO para fuente "mockup": true si el texto final es DISTINTO del que se ve en el mockup (el cliente pidió agregar o cambiar algo del texto después de verlo); false si el mockup ya trae exactamente el texto final.
- "tipo": "foto", "personaje" o "especial".
- "resumen": una línea para el equipo con lo que entendiste de ESA lámpara.
- "advertencias": dudas que no puedes resolver de ESA lámpara (ej. "la foto es muy oscura", "no queda claro el nombre", "no encontré el mockup de esta lámpara"); [] si nada.
- "cambia": ${prevList ? 'true si por la INDICACIÓN/CAMBIO hay que rehacer ESTA lámpara; false si se queda como está.' : 'true.'}
Responde SOLO este JSON: {"lamparas": [{"lampara": 0, "fuente": "...", "imagen": "...", "prompt": "...", "nombre": "...", "textoCambia": false, "tipo": "...", "resumen": "...", "advertencias": [], "cambia": true}]}` }];
    for (const [prefix, list] of [['C', client], ['N', sent]]) {
        for (const [i, image] of list.entries()) {
            try { parts.push({ text: `Imagen ${prefix}${i}${image.text ? ` (mensaje: "${image.text.slice(0, 200)}")` : ''}:` }, await imagePart(image.url)); }
            catch (_) { parts.push({ text: `Imagen ${prefix}${i}: (no se pudo descargar)` }); }
        }
    }
    const answer = await geminiJson(parts);
    const rows = Array.isArray(answer.lamparas) ? answer.lamparas : [];
    return lamps.map(lamp => {
        const row = rows.find(r => Number(r.lampara) === lamp.index) || rows[lamp.index] || {};
        const pick = String(row.imagen || '').trim().toUpperCase().match(/^([CN])(\d+)$/);
        const reference = pick ? (pick[1] === 'C' ? client : sent)[Number(pick[2])] || null : null;
        let fuente = ['mockup', 'cliente', 'ilustracion'].includes(row.fuente) ? row.fuente : (reference ? 'cliente' : 'ilustracion');
        if (fuente !== 'ilustracion' && !reference) fuente = 'ilustracion';
        if (fuente === 'mockup' && pick && pick[1] !== 'N') fuente = 'cliente';
        return {
            fuente, reference,
            tipo: ['foto', 'personaje', 'especial'].includes(row.tipo) ? row.tipo : 'especial',
            nombre: String(row.nombre || '').trim().slice(0, 80),
            prompt: String(row.prompt || '').trim().slice(0, 1500),
            resumen: String(row.resumen || '').trim().slice(0, 400),
            advertencias: (Array.isArray(row.advertencias) ? row.advertencias : []).map(String).slice(0, 6),
            cambia: row.cambia !== false,
            textoCambia: fuente === 'mockup' && row.textoCambia === true,
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
async function rasterize(reference, { description = '', extra = '', prompt: override = '', model = RASTER_MODEL } = {}) {
    const files = [];
    if (reference) {
        const { buffer } = await download(reference.url);
        // Qwen entrega la imagen con la forma de la referencia: se manda cuadrada (relleno blanco) para que el
        // diseño salga cuadrado y quepa completo en el círculo.
        const fit = model === BETA_MODEL ? { fit: 'contain', background: '#ffffff' } : { fit: 'inside', withoutEnlargement: true };
        const jpeg = await sharp(buffer).rotate().resize(2048, 2048, fit).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
        files.push({ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'referencia.jpg' });
    }
    const prompt = override || (reference
        ? (extra ? `${RASTER_PROMPT}. ${extra}` : RASTER_PROMPT) + (model === BETA_MODEL ? '. Solo blanco y negro, sin colores; fondo negro uniforme de orilla a orilla, sin círculos, marcos ni bordes.' : '')
        : `Ilustración para grabar con láser en una lámpara redonda: ${description}. Centrada y completa, sin texto ni letras. Solo blanco y negro, sin colores. Rellenos y detalles en BLANCO sobre un fondo NEGRO uniforme de orilla a orilla: sin círculos, marcos, bordes ni viñetas. En raster engrave con degradado en trama.`);
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

// Qwen si la GPU está lista; si no (fuera de horario o falla la GPU), el modelo de siempre.
async function rasterizeBeta(reference, options) {
    try { return await rasterize(reference, { ...options, model: BETA_MODEL }); }
    catch (error) {
        if (error.status !== 503 && !/Qwen|GPU/i.test(error.message || '')) throw error;
        console.warn('[AUTO-LAMP] Qwen no disponible, uso gpt-image:', error.message);
        return { ...(await rasterize(reference, { ...options, model: RASTER_MODEL })), fallback: error.message };
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
async function fitToLampCircle(buffer, side = 2000) {
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
    const isCircle = ink.w / ink.h > .9 && ink.w / ink.h < 1.1 && ringHits / 360 > .75;
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
};
const templateCache = {};
const templateFor = lamp => Object.entries(TEMPLATES).find(([, t]) => t.match.test(`${lamp.producto} ${lamp.datos}`))?.[0] || null;
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
    if (plan.template) {
        // Plantilla del taller (p. ej. Spiderman): su grabado tal cual, sin IA; solo se le agrega el nombre.
        step('Usando la plantilla del taller');
        raster = { url: null, jobId: null, model: TEMPLATES[plan.template].label, buffer: await templateImage(plan.template) };
    } else if (plan.fuente === 'mockup') {
        step('Convirtiendo el mockup a grabado');
        raster = await rasterizeBeta(plan.reference, { prompt: plan.textoCambia ? MOCKUP_NO_TEXT_PROMPT : MOCKUP_PROMPT });
    } else if (beta) {
        step(plan.reference ? 'Convirtiendo la imagen del cliente a grabado' : 'Ilustrando con el estudio de imágenes');
        raster = await rasterizeBeta(plan.reference, { description: plan.prompt, extra: plan.reference ? plan.prompt : '' });
    } else {
        step('Convirtiendo a grabado');
        raster = await rasterize(plan.reference);
    }
    const downloaded = raster.buffer || (await download(raster.url)).buffer;
    // Grabado listo (negro sobre blanco); el del mockup además se reacomoda para llenar el círculo.
    const engraved = await engravePolarity(downloaded);
    const buffer = plan.template ? downloaded : plan.fuente === 'mockup' ? await fitToLampCircle(engraved) : engraved;
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
    const bits = toBitmap(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), size.width, size.height, plan.template ? { ...BITMAP, method: 'threshold' } : BITMAP);
    const png = Buffer.from(pngWithDpi(await sharp(Buffer.from(bits.buffer), { raw: { width: size.width, height: size.height, channels: 4 } }).png({ palette: true, colours: 2 }).toBuffer(), BITMAP.dpi));

    step('Armando el diseño');
    // El mockup ya trae el nombre dentro de la imagen (tal cual lo vio el cliente): no se le agrega otro. Si el
    // texto cambió, el mockup se sacó SIN letras y aquí va el texto final.
    const engraveName = plan.template ? (plan.nombre || (lamp.datos.match(/nombres?\s*:\s*([^|\n]+)/i) || [])[1]?.trim() || '')
        : plan.fuente === 'mockup' && !plan.textoCambia ? '' : plan.nombre;
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
        index: lamp.index, label: lamp.label, copies: lamp.copies, status: 'ready', source: plan.fuente, textChanged: !!plan.textoCambia, template: plan.template || null,
        brief: { tipo: plan.tipo || null, fuente: plan.fuente, nombre: plan.nombre || '', prompt: plan.prompt || '', resumen: plan.resumen || '',
            advertencias: plan.advertencias || [], referenceUrl: plan.reference?.url || null },
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
        ...(options.note ? { note: String(options.note).slice(0, 500) } : {}), ...(options.keepClient && order.autoLamp?.client ? { client: order.autoLamp.client } : {}),
        startedAt: now(), updatedAt: now() } });
    try {
        let plans;
        if (beta) {
            plans = await designBriefOrder({ order, lamps, history: await chatHistory(contactId), clientImages: await customerImages(contactId),
                sentImages: await ourImages(contactId), note: options.note, previous: partial ? previous : [] });
        } else {
            const { name, datos } = orderName(order);
            plans = [{ fuente: 'cliente', reference: await pickReference(await customerImages(contactId), datos), nombre: name, prompt: '', advertencias: [] }];
        }
        const results = [];
        for (const lamp of lamps) {
            // Personaje con plantilla del taller (Spiderman…): se usa su grabado; la IA solo aporta el nombre.
            const basePlan = plans[lamp.index] || plans[0], template = beta ? templateFor(lamp) : null;
            const plan = template ? { ...basePlan, template } : basePlan;
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
    const { renderClientPreview } = await composerModule();
    const { raw, width, height } = renderClientPreview(document, await loadFont());
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const url = await saveFile(`${STORAGE_DIR}/DH${dh}/L${lamp.index + 1}/previo-cliente-r${project.revision}-v${CLIENT_PREVIEW_STYLE}-${Date.now().toString(36)}.png`, png, 'image/png');
    await updateLamp(orderDoc.ref, lamp.index, { clientPreviewUrl: url, clientPreviewRevision: project.revision, clientPreviewStyle: CLIENT_PREVIEW_STYLE });
    return { url, revision: project.revision };
}

// Hojas para RDWorks del pedido (2 lámparas por hoja, cada una tantas veces como su cantidad) desde la
// última versión guardada de cada proyecto.
async function rdworksSheetsFor(dh, autoLamp) {
    const lamps = lampsOf(autoLamp);
    if (!lamps.length) throw Object.assign(new Error('No hay lámparas diseñadas.'), { status: 409 });
    const { rdworksPiece, rdworksSheets } = await composerModule();
    const font = await loadFont();
    const pieces = [], problems = [];
    for (const lamp of lamps) {
        const { document } = await projectDocument(lamp.projectId);
        const piece = await rdworksPiece(document, font);
        problems.push(...designProblems(document, piece, lamp).map(p => `${lamps.length > 1 ? (lamp.label || `Lámpara ${lamp.index + 1}`) + ': ' : ''}${p}`));
        pieces.push({ piece, copies: lamp.copies || 1 });
    }
    // REVISIÓN antes de subir (DH18191, 19-oct-2026: se movió en el editor y se subió recortada): si el diseño
    // guardado quedó mal armado, no se sube; hay que corregirlo en el editor.
    if (problems.length) throw Object.assign(new Error(`El diseño guardado no está listo para cortar: ${problems.join('; ')}. Corrígelo en el editor y vuelve a aprobar.`), { status: 422, code: 'DESIGN_BROKEN' });
    return rdworksSheets(pieces, `DH${dh}`);
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
const CLIENT_MESSAGE_AGAIN = '¡Listo! 😊 Ya ajustamos tu diseño con lo que nos pediste ✨\n¿Lo aprobamos así o le cambiamos algo más? 🙌';
// Varias lámparas: un previo POR LÁMPARA (Chris, 19-oct-2026), entre un saludo y la pregunta.
const MULTI_INTRO = '¡Hola! 😊 Antes de fabricar tus lámparas, te comparto los diseños para que los revises con calma ✨';
const MULTI_INTRO_AGAIN = '¡Listo! 😊 Ya ajustamos lo que nos pediste ✨';
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
    const again = rounds > 0 && autoLamp.client?.status === 'changes';
    if (lamps.length === 1) {
        await postMessage(contactId, auth, { text: again ? CLIENT_MESSAGE_AGAIN : CLIENT_MESSAGE, fileUrl: images[0].url, fileType: 'image/jpeg' });
    } else {
        await postMessage(contactId, auth, { text: again ? MULTI_INTRO_AGAIN : MULTI_INTRO });
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
            await notifyAdmin(`✅ DH${dh} — diseño de la IA (BETA) sacado del mockup que ya pagó el cliente: se subió directo a Drive (SVG Corte)${r.driveUrls.length > 1 ? ` en ${r.driveUrls.length} hojas` : ''}: ${r.driveUrls.join(' ')}`);
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
        try { const r = await approve(dh, { actor: { email: 'cliente (aprobó por WhatsApp)' } }); return { uploaded: true, ...r, driveUrl: r.driveUrls.join(' ') }; }
        catch (error) { return { uploaded: false, error: error.message }; }
    }
    if (decision === 'changes') {
        const note = `El cliente pidió este cambio: ${changeSummary || clientText}`.slice(0, 500);
        await ref.update({ 'autoLamp.client': { ...(order.autoLamp?.client || {}), status: 'changes', answeredAt: now(), text: String(changeSummary || clientText).slice(0, 300) } });
        if (dh) generate(dh, { beta: true, note, keepClient: true }).catch(error => console.warn(`[AUTO-LAMP] rehacer DH${dh} por cambio del cliente:`, error.message));
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
    const dh = order.consecutiveOrderNumber ? `DH${order.consecutiveOrderNumber}` : orderId;
    const subido = order.svgCorteAt?.toMillis ? Math.round((Date.now() - order.svgCorteAt.toMillis()) / 60000) : null;
    const hace = subido == null ? '' : subido < 90 ? ` hace ${subido} min` : ` hace ${Math.round(subido / 60)} h`;
    const guia = order.guiaEnvio && order.guiaEnvio.guia;
    const links = (autoLamp.driveUrls && autoLamp.driveUrls.length ? autoLamp.driveUrls : [order.svgCorteUrl]).filter(Boolean).join(' ');
    await notifyAdmin(`✏️ ${dh} — el cliente pidió un CAMBIO después de aprobar el diseño de la IA (BETA): "${String(clientText).slice(0, 200)}".\n`
        + `• El archivo se subió a Drive (SVG Corte)${hace}: ${links || '(sin link)'}\n`
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

/**
 * Sube a Drive (SVG Corte) las hojas para RDWorks del pedido, armadas desde la última versión guardada de cada
 * proyecto. svg: solo indica que se aprobó desde el editor. force: subir aunque el pedido YA tenga un archivo
 * en Drive (solo una persona, después de ver el aviso; los caminos automáticos nunca lo mandan).
 */
async function approve(dh, { svg = null, actor = null, force = false } = {}) {
    const { uploadDrive } = require('../svgCutStorage');
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
                : current?.status === 'approved' ? (alreadyUploaded(data)?.text || 'Ya se aprobó y subió a Drive.') : 'No hay un diseño listo para aprobar.';
            throw Object.assign(new Error(why), { status: 409, code: current?.status === 'approved' ? 'ALREADY_UPLOADED' : undefined });
        }
        const before = alreadyUploaded(data);
        if (before && !force) throw Object.assign(new Error(`${before.text}. Para no cortarlo dos veces NO se volvió a subir.`), { status: 409, code: 'ALREADY_UPLOADED', previous: before });
        if (before) previous = { at: data.svgCorteAt, by: data.svgCorteBy || null, files: data.svgCorteFiles || (data.svgCorteUrl ? [{ url: data.svgCorteUrl }] : []) };
        tx.update(ref, { 'autoLamp.status': 'uploading', 'autoLamp.step': 'Subiendo a Drive', 'autoLamp.updatedAt': now() });
        return current;
    });
    let sent = false;
    const files = [];
    try {
        const sheets = await rdworksSheetsFor(dh, autoLamp);
        const folder = `${STORAGE_DIR}/DH${dh}`, stamp = Date.now().toString(36);
        const { Resvg } = require('@resvg/resvg-js');
        for (const [k, svgText] of sheets.entries()) {
            const suffix = sheets.length > 1 ? `-h${k + 1}` : '';
            const bytes = Buffer.from(svgText);
            const storageUrl = await saveFile(`${folder}/aprobado-${stamp}${suffix}.svg`, bytes, 'image/svg+xml');
            let preview = null;
            try { preview = await saveFile(`${folder}/aprobado-${stamp}${suffix}.png`, new Resvg(svgText, { fitTo: { mode: 'width', value: 1400 }, background: '#ffffff' }).render().asPng(), 'image/png'); }
            catch (_) { /* sin vista previa de la hoja */ }
            sent = true;
            const upload = await uploadDrive(`DH${dh}-ia-beta-${stamp}${suffix}.svg`, bytes);
            files.push({ name: upload.name, url: upload.webViewLink, svg: storageUrl, preview });
        }
        await ref.update({
            svgCorteAt: admin.firestore.Timestamp.now(), svgCorteBy: 'auto-lamp-beta', svgCorteUrl: files[0].url,
            svgCorteUrls: files.length > 1 ? files.map(f => f.url).join(',') : null,
            svgCorteFileName: files[0].name, svgCortePreviewUrl: files[0].preview || autoLamp.previewUrl || null, svgCorteStorageUrl: files[0].svg,
            svgCorteFiles: files,
            // Subida repetida confirmada por una persona: se guarda qué había antes.
            ...(previous ? { svgCorteHistory: admin.firestore.FieldValue.arrayUnion({ ...previous, replacedBy: actor?.email || actor?.uid || null, replacedAt: admin.firestore.Timestamp.now() }) } : {}),
            'autoLamp.status': 'approved', 'autoLamp.step': 'Aprobado y en Drive', 'autoLamp.driveUrl': files[0].url, 'autoLamp.driveUrls': files.map(f => f.url),
            'autoLamp.approvedAt': now(), 'autoLamp.approvedBy': actor?.email || actor?.uid || null,
            'autoLamp.approvedFromEditor': !!svg, 'autoLamp.error': admin.firestore.FieldValue.delete(), 'autoLamp.updatedAt': now(),
        });
        try { await require('../designPending').recomputeForContact(orderDoc.data().contactId || orderDoc.data().telefono); } catch (_) {}
        if (previous) await notifyAdmin(`⚠️ DH${dh} se subió OTRA VEZ a Drive (SVG Corte), confirmado por ${actor?.email || 'una persona'}. Ya tenía archivo de antes: revisa que no se corten los dos. Nuevo: ${files.map(f => f.url).join(' ')}`);
        return { driveUrl: files[0].url, driveUrls: files.map(f => f.url), fileName: files[0].name };
    } catch (error) {
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

// Descarta el diseño (no sube nada). Después se puede regenerar con una indicación.
async function reject(dh, { reason = '', actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const lamp = orderDoc.data().autoLamp;
    if (!lamp || !['ready', 'error'].includes(lamp.status)) throw Object.assign(new Error('No hay un diseño para descartar.'), { status: 409 });
    await orderDoc.ref.update({ 'autoLamp.status': 'rejected', 'autoLamp.step': 'Descartado', 'autoLamp.rejectedAt': now(),
        'autoLamp.rejectReason': String(reason).slice(0, 500), 'autoLamp.rejectedBy': actor?.email || actor?.uid || null, 'autoLamp.updatedAt': now() });
}

module.exports = { generate, status, approve, reject, alreadyUploaded, freeNameSlot, templateFor, clientPreview, engravePolarity, fitToLampCircle, sendToClient, handleBetaDecision, changeAfterApproval, orderName, orderLamps, lampsOf,
    pickReference, customerImages, ourImages, designBriefOrder, chatHistory, rdworksSheetsFor };
