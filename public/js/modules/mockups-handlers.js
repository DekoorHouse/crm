// ===================================================================
// Sección "Mockup" del CRM
// -------------------------------------------------------------------
// Lista los pedidos "Sin estatus", genera un preview de la lámpara con
// los datos del cliente (cambia SOLO nombres/fecha vía WaveSpeed GPT
// Image 2) y lo envía por WhatsApp para su aprobación.
// Funciones globales con prefijo mk* (el CRM no usa imports/módulos ES).
// Endpoints backend: /api/mockups/pending, /templates*, /generate-preview, /send
// ===================================================================
const MK_API = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';

// Prompt semilla para plantillas nuevas (clave: evita que la IA re-dibuje la lámpara).
const MK_SEED_PROMPT = 'Edita esta foto de la lámpara. NO modifiques la lámpara, su figura, base, acrílico, color, iluminación ni el fondo. ÚNICAMENTE reemplaza el texto grabado: el primer nombre por "{nombre1}", el segundo nombre por "{nombre2}", y la fecha por "{fecha}". Conserva exactamente la misma tipografía, tamaño, color y posición del texto. El resultado debe verse foto-realista e idéntico salvo por el texto.';

// Plantilla de aviso para conversaciones cerradas (+24h). 'foto_lista' es solo texto
// (sin variables ni header de imagen): avisa "tu foto está lista, respóndenos".
const MK_CLOSED_TEMPLATE = { name: 'foto_lista', language: 'es' };

// Ruta de la fuente manuscrita "Rows of Sunflowers" (ya vive en el editor). Se usa para
// rasterizar el diseño de referencia (2ª imagen) con el mismo tipo de letra del producto.
const MK_DESIGN_FONT_URL = '/editor/fonts/RowsOfSunflowers.ttf';
const MK_DESIGN_FONT_FAMILY = 'Rows of Sunflowers';

// SVG semilla del DISEÑO de referencia (2ª imagen) para lámparas de infinito/corazón.
// Texto EDITABLE con los mismos placeholders del prompt ({nombre1} {nombre2} {fecha}); el
// código los sustituye, rasteriza el SVG a PNG y lo manda como 2ª referencia a la IA. Es un
// punto de partida: se puede editar el arte del SVG en el editor de plantillas.
const MK_DESIGN_SEED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520">
  <rect x="0" y="0" width="900" height="520" fill="#000000"/>
  <path d="M 450 250 C 380 160 220 160 180 250 C 220 340 380 340 450 250 C 520 160 680 160 720 250 C 680 340 520 340 450 250 Z" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="312" y="250" fill="#ffffff" font-family="'Rows of Sunflowers'" font-size="66" text-anchor="middle" dominant-baseline="central">{nombre1}</text>
  <text x="588" y="250" fill="#ffffff" font-family="'Rows of Sunflowers'" font-size="66" text-anchor="middle" dominant-baseline="central">{nombre2}</text>
  <text x="372" y="300" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="32" letter-spacing="1" text-anchor="middle" dominant-baseline="central">{fecha}</text>
  <g fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
    <path transform="translate(566,306) scale(1.35)" d="M12 21 C12 21 3 14.5 3 8.5 C3 5.4 5.4 3 8.5 3 C10.4 3 12 4.7 12 4.7 C12 4.7 13.6 3 15.5 3 C18.6 3 21 5.4 21 8.5 C21 14.5 12 21 12 21 Z"/>
    <path transform="translate(614,306) scale(1.35)" d="M12 21 C12 21 3 14.5 3 8.5 C3 5.4 5.4 3 8.5 3 C10.4 3 12 4.7 12 4.7 C12 4.7 13.6 3 15.5 3 C18.6 3 21 5.4 21 8.5 C21 14.5 12 21 12 21 Z"/>
    <path transform="translate(662,306) scale(1.35)" d="M12 21 C12 21 3 14.5 3 8.5 C3 5.4 5.4 3 8.5 3 C10.4 3 12 4.7 12 4.7 C12 4.7 13.6 3 15.5 3 C18.6 3 21 5.4 21 8.5 C21 14.5 12 21 12 21 Z"/>
  </g>
</svg>`;

// results: URL de preview por blockId (en sesión). paymentSent/noticeSent: dedupe de
// envío por pedido (mandar /cuatro+/bbb o el aviso una sola vez aunque haya varias fotos).
// refFiles: 2ª referencia subida a mano por bloque (blockId -> File). pruebas: estado del
// banco de pruebas (pestaña "Pruebas").
const mkState = { tab: 'pendientes', pending: [], templates: [], results: {}, editing: null, newFile: null, paymentSent: {}, noticeSent: {}, refFiles: {}, refPasteTarget: null, lzPickByTemplate: {}, lzHydrated: {}, pruebas: { provider: 'wavespeed', values: {}, resultUrl: '', refFile: null, promptEdits: {} }, lienzo: { items: [], sel: null, selIds: [], seq: 1, designs: [], designId: null } };

// Cache (promesa) del data-URI de la fuente manuscrita, para embeberla en el SVG al rasterizar.
let mkFontDataUrlPromise = null;

// ---------- utilidades ----------
function mkEsc(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
function mkAttr(s) { return mkEsc(s).replace(/"/g, '&quot;'); }

// Capitaliza la primera letra de cada palabra de un nombre (aunque venga mal escrito):
// "melissa" -> "Melissa", "JORGE" -> "Jorge", "maria jose" -> "Maria Jose".
function mkTitleCase(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function mkToast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info'); return; }
    if (type === 'error') { console.error('[mockups]', msg); alert(msg); }
    else console.log('[mockups]', msg);
}

async function mkFetchJson(url, opts) {
    const res = await fetch(MK_API + url, opts);
    let data = {};
    try { data = await res.json(); } catch (_) { /* noop */ }
    if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || ('Error ' + res.status));
    }
    return data;
}

function mkFmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (_) { return ''; }
}

// Hora del último mensaje del cliente. Si cayó en un día distinto al del pedido, antepone la fecha
// corta para que no sea ambiguo (p. ej. "9 jul, 7:45 p.m."); si es el mismo día, solo la hora.
function mkFmtLastMsg(msgIso, orderIso) {
    if (!msgIso) return '';
    try {
        const d = new Date(msgIso);
        const time = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
        let sameDay = false;
        if (orderIso) { try { sameDay = d.toDateString() === new Date(orderIso).toDateString(); } catch (_) {} }
        const datePart = sameDay ? '' : (d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) + ', ');
        return datePart + time;
    } catch (_) { return ''; }
}

// Abre el modal de conversación del CRM (chat-handlers.js) para el cliente del pedido.
function mkOpenChat(orderId) {
    const o = mkState.pending.find(x => x.id === orderId);
    if (!o || !o.telefono) return;
    if (typeof openConversationPreview !== 'function') { mkToast('El chat no está disponible.', 'error'); return; }
    openConversationPreview({ stopPropagation() {} }, String(o.telefono), { id: String(o.telefono), name: o.clientName || '' });
}

// Quita un pedido de la lista de mockups (marca no destructiva; NO borra el pedido).
async function mkHideOrder(orderId) {
    const ok = await showConfirmModal('¿Quitar este pedido de la lista de Mockups?<br><span style="display:block;margin-top:6px;color:var(--color-text-light,#64748b);font-size:12.5px">El pedido NO se borra; solo deja de aparecer aquí.</span>', { icon: 'fa-eye-slash', confirmText: 'Quitar' });
    if (!ok) return;
    try {
        await db.collection('pedidos').doc(orderId).update({ mockupHidden: true });
        mkState.pending = mkState.pending.filter(o => o.id !== orderId);
        mkRenderPending();
        mkToast('Pedido quitado de la lista.', 'success');
    } catch (e) { mkToast('No se pudo quitar: ' + e.message, 'error'); }
}

// Heurística: intenta separar nombre1/nombre2/fecha del texto libre del pedido.
// Los campos quedan EDITABLES, así que basta con acercar; el operador confirma.
// Extrae la fecha: primero por la etiqueta "Fecha:" (soporta mes con letras, rangos,
// etc., ej. "6/ Nov/2005", "15 octubre 2023"); si no hay etiqueta, cae a una fecha
// numérica suelta (dd/mm/aaaa).
// ¿La "fecha" es en realidad "sin fecha" (el cliente NO quiere fecha)? -> tratarla como VACÍA para
// que la casilla quede en blanco y el mockup NO grabe "Sin Fecha". (Espejo de esSinFecha del backend.)
function mkEsSinFecha(v) {
    const s = String(v || '').toLowerCase().trim();
    if (!s) return false;
    return /sin\s*fecha/.test(s) || /\bno\b[^]*\bfecha\b/.test(s) || /^(ninguna?|n\s*\/\s*a|s\s*\/\s*f|-{1,}|—{1,})$/.test(s);
}
function mkExtractFecha(raw) {
    const labeled = raw.match(/fecha\s*:\s*([^|\n]+)/i);
    if (labeled) {
        const v = labeled[1].trim().replace(/[\s|,]+$/, '').trim();
        return mkEsSinFecha(v) ? '' : v;
    }
    const numeric = raw.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/);
    return numeric ? numeric[0] : '';
}

function mkParseDatos(text) {
    const raw = (text || '').trim();
    const fecha = mkExtractFecha(raw);
    // Para los NOMBRES: quitar la parte "Fecha: ..." (hasta | o salto) y fechas numéricas sueltas.
    const clean = s => s.replace(/^[\s|,&+]+|[\s|,&+]+$/g, '').trim();
    const rest = raw
        .replace(/fecha\s*:\s*[^|\n]*/ig, ' ')
        .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, ' ')
        .replace(/nombres?\s*:/ig, ' ').replace(/para\s*:/ig, ' ').replace(/personajes?\s*:/ig, ' ');
    const parts = rest
        .split(/\s+y\s+|\s*&\s*|\s*\+\s*|\s*\|\s*|,|\n|\s+and\s+/i)
        .map(clean)
        .filter(Boolean);
    return { nombre1: mkTitleCase(parts[0] || ''), nombre2: mkTitleCase(parts[1] || ''), fecha: clean(fecha), personalizacion: raw };
}

// ---------- init / tabs ----------
async function initializeMockupsHandlers() {
    mkState.tab = 'pendientes';
    mkState.editing = null;
    mkBindPaste();
    mkLoadAutoConfig();   // estado del toggle de auto-generación
    // Cargar plantillas ANTES que pendientes: la lista de pendientes las necesita
    // (selector de plantilla + mensaje de "crea la primera").
    try { await mkLoadTemplates(); } catch (e) { mkToast(e.message, 'error'); }
    await mkLzFetchDesigns();   // diseños del lienzo: los bloques ofrecen elegirlos como 2ª ref
    mkEnsureDesignFontLoaded(); // precarga la fuente (métricas correctas al generar referencias)
    try { await mkLoadPending(); } catch (e) { mkToast(e.message, 'error'); }
}

function mkSwitchTab(tab) {
    mkState.tab = tab;
    document.querySelectorAll('[data-mktab]').forEach(b => b.classList.toggle('active', b.dataset.mktab === tab));
    const panes = { pendientes: 'mk-pane-pendientes', plantillas: 'mk-pane-plantillas', pruebas: 'mk-pane-pruebas' };
    for (const [t, id] of Object.entries(panes)) {
        const el = document.getElementById(id);
        if (el) el.style.display = tab === t ? '' : 'none';
    }
    if (tab === 'plantillas') mkRenderTemplates();
    if (tab === 'pruebas') mkRenderPruebas();
}

// Toggle de auto-generación (scheduler del backend).
async function mkLoadAutoConfig() {
    try {
        const d = await mkFetchJson('/api/mockups/auto-config');
        const el = document.getElementById('mk-auto-toggle');
        if (el) el.checked = d.autoGenerate !== false;
    } catch (_) { /* noop */ }
}

async function mkToggleAuto(checked) {
    try {
        await mkFetchJson('/api/mockups/auto-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoGenerate: !!checked }) });
        mkToast(checked ? 'Auto-generación ENCENDIDA ✅' : 'Auto-generación apagada', 'success');
    } catch (e) {
        mkToast('No se pudo cambiar: ' + e.message, 'error');
        const el = document.getElementById('mk-auto-toggle'); if (el) el.checked = !checked;   // revertir
    }
}

async function mkReload() {
    try { await mkLoadTemplates(); } catch (e) { mkToast(e.message, 'error'); }
    await mkLzFetchDesigns();
    try { await mkLoadPending(); } catch (e) { mkToast(e.message, 'error'); }
}

// "Generar ahora": dispara YA una corrida de auto-generación en el servidor (corazones con
// nombres+fecha, sin preview). Ideal tras recargar saldo en WaveSpeed. El servidor responde de
// inmediato y sigue generando en segundo plano; refrescamos la lista de forma escalonada para que
// los previews vayan apareciendo solos, sin tener que darle a Actualizar a mano.
async function mkRunAutoNow(btn) {
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Iniciando…'; }
    try {
        await mkFetchJson('/api/mockups/auto-run', { method: 'POST' });
        mkToast('Generación iniciada ⚡ Los previews de corazones irán apareciendo en unos minutos.', 'success');
        [30000, 75000, 135000].forEach(ms => setTimeout(() => { mkLoadPending().catch(() => {}); }, ms));
    } catch (e) {
        mkToast('No se pudo iniciar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

// ---------- plantillas (carga) ----------
async function mkLoadTemplates() {
    const data = await mkFetchJson('/api/mockups/templates');
    mkState.templates = data.templates || [];
    if (mkState.tab === 'plantillas') mkRenderTemplates();
}

// Plantilla auto-sugerida por el producto del pedido (por productMatch).
function mkAutoTemplate(producto) {
    const prod = (producto || '').toLowerCase();
    for (const t of mkState.templates) {
        if ((t.productMatch || []).some(m => m && prod.includes(String(m).toLowerCase()))) return t.id;
    }
    return mkState.templates.length ? mkState.templates[0].id : '';
}

function mkTemplateOptionsSel(selectedId) {
    return mkState.templates.map(t =>
        `<option value="${mkAttr(t.id)}"${t.id === selectedId ? ' selected' : ''}>${mkEsc(t.nombre)}</option>`
    ).join('');
}

// Los CAMPOS de un bloque salen de los placeholders del prompt de la plantilla
// ({nombre1}, {fecha}, ...): la nube muestra solo "Nombre", corazones muestra 3.
function mkFieldLabel(key) {
    const map = { nombre1: 'Nombre 1', nombre2: 'Nombre 2', nombre: 'Nombre', fecha: 'Fecha' };
    return map[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

function mkTemplateFieldDefs(templateId) {
    const t = mkState.templates.find(x => x.id === templateId);
    const prompt = t ? (t.promptTemplate || '') : '';
    const keys = [];
    const re = /\{([a-zA-Z0-9_]+)\}/g; let m;
    while ((m = re.exec(prompt)) !== null) {
        const k = m[1].toLowerCase();
        if (k === 'personalizacion') continue;   // texto crudo del pedido, no es campo
        if (!keys.includes(k)) keys.push(k);
    }
    if (!keys.length) keys.push('nombre1');       // respaldo
    return keys.map(k => ({ key: k, label: mkFieldLabel(k) }));
}

function mkFieldsHtml(defs, values) {
    return defs.map(f => {
        const v = (values && values[f.key] != null) ? values[f.key] : '';
        // La fecha se muestra como área de texto: permite Enter para grabar varias fechas
        // (una debajo de la otra). El backend detecta los saltos de línea y se lo indica a la IA.
        if (f.key === 'fecha') {
            return `<div><label>${mkEsc(f.label)}</label><textarea class="mk-fld" data-key="fecha" rows="2" style="resize:vertical;min-height:38px;" title="Puedes usar Enter para poner varias fechas, una debajo de la otra">${mkEsc(v)}</textarea></div>`;
        }
        return `<div><label>${mkEsc(f.label)}</label><input type="text" class="mk-fld" data-key="${mkAttr(f.key)}" value="${mkAttr(v)}"></div>`;
    }).join('');
}

// ---------- pendientes ----------
async function mkLoadPending() {
    const cont = document.getElementById('mk-pendientes');
    if (cont && !mkState.pending.length) cont.innerHTML = '<p class="mk-muted">Cargando pendientes…</p>';
    const data = await mkFetchJson('/api/mockups/pending');
    mkState.pending = data.items || [];
    // Si hay una generación en curso, NO re-renderices: reconstruir el DOM destruiría el bloque que
    // está generando y su preview se guardaría como uno nuevo (DOBLE). Los datos ya quedaron frescos
    // para el próximo render (cuando termine la generación).
    if (mkState.busyGen > 0) return;
    mkRenderPending();
}

function mkRenderPending() {
    const cont = document.getElementById('mk-pendientes');
    if (!cont) return;

    // Contador de pendientes en la pestaña.
    const badge = document.getElementById('mk-pending-count');
    if (badge) { const n = mkState.pending.length; badge.textContent = n; badge.setAttribute('data-n', n); }

    if (!mkState.templates.length) {
        cont.innerHTML = '<div class="settings-card"><p class="mk-muted">Aún no tienes plantillas de lámpara. Ve a la pestaña <b>Plantillas</b> y crea la primera (sube la foto base y define el prompt).</p></div>';
        return;
    }
    if (!mkState.pending.length) {
        cont.innerHTML = '<div class="settings-card"><p class="mk-muted">No hay pedidos <b>Sin estatus</b> pendientes de preview. 🎉</p></div>';
        return;
    }

    const mkUsedBlockIds = new Set();   // ids de bloque únicos en TODA la lista (evita colisiones, ej. varios 'auto')
    cont.innerHTML = mkState.pending.map(o => {
        const datos = (o.items || []).map(it => it.datosProducto).filter(Boolean).join('\n') || (o.items?.[0]?.producto || '');
        const producto = o.producto || (o.items?.[0]?.producto || '');
        const num = o.consecutiveOrderNumber ? ('DH' + o.consecutiveOrderNumber) : '—';
        const lastMsg = mkFmtLastMsg(o.lastCustomerMsgAt, o.createdAt);
        const lastMsgHtml = lastMsg ? ` · <span class="mk-lastmsg" title="Hora del último mensaje del cliente"><i class="far fa-clock"></i> ${mkEsc(lastMsg)}</span>` : '';
        // Piloto preview: los del grupo A se marcan con ⚡ (revisar y enviar EN CUANTO se pueda).
        const pilotoBadge = o.pilotoPreview === 'A'
            ? '<span title="Piloto preview: revisar y enviar YA (el cliente espera su diseño en minutos)" style="background:#7c3aed;color:#fff;padding:2px 9px;border-radius:10px;font-size:.72rem;font-weight:700;margin-left:6px;white-space:nowrap;">⚡ Preview</span>'
            : '';
        o._prefill = mkPrefill(mkParseDatos(datos));   // valores sugeridos para el primer bloque
        // Bloques iniciales: uno por preview guardado, o uno vacío.
        const saved = Array.isArray(o.previews) ? o.previews : [];
        // Garantiza un id ÚNICO por bloque (el scheduler pudo guardar varios como 'auto').
        const uniqId = (want) => { let id = want || mkNewBlockId(); while (mkUsedBlockIds.has(id)) id = mkNewBlockId(); mkUsedBlockIds.add(id); return id; };
        const blocks = saved.length
            ? saved.map(pv => { const id = uniqId(pv.blockId); pv.blockId = id; return { id, templateId: pv.templateId, provider: 'wavespeed', values: mkMergeValues(o._prefill, pv.fields), previewUrl: pv.imageUrl }; })
            : [{ id: uniqId(), templateId: mkAutoTemplate(producto), provider: 'wavespeed', values: o._prefill, previewUrl: '' }];
        return `
        <div class="settings-card mk-card" data-order="${mkAttr(o.id)}" data-phone="${mkAttr(o.telefono)}" data-client="${mkAttr(o.clientName)}">
            <div class="mk-card-head">
                <div>
                    <span class="mk-order-num" style="cursor:pointer;" title="Ver conversación del cliente" onclick="mkOpenChat('${mkAttr(o.id)}')">${mkEsc(num)} <i class="fas fa-comments" style="font-size:.75em;opacity:.6;"></i></span>${pilotoBadge}
                    <span class="mk-client">${mkEsc(o.clientName || 'Sin nombre')}</span>
                    <span class="mk-phone"><i class="fab fa-whatsapp"></i> ${mkEsc(o.telefono || '')}</span>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <span class="mk-date">${mkEsc(mkFmtDate(o.createdAt))}${lastMsgHtml}${producto ? ' · ' + mkEsc(producto) : ''}</span>
                    <button class="mk-block-x" title="Quitar de la lista (no borra el pedido)" onclick="mkHideOrder('${mkAttr(o.id)}')"><i class="fas fa-eye-slash"></i></button>
                </div>
            </div>
            <div class="mk-raw">
                <label>Detalles del pedido</label>
                <textarea class="mk-datos" readonly>${mkEsc(datos)}</textarea>
            </div>
            <div class="mk-blocks" id="mk-blocks-${mkAttr(o.id)}">
                ${blocks.map((b, i) => mkBlockHtml(o, b, i + 1)).join('')}
            </div>
            <button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="mkAddBlock('${mkAttr(o.id)}')"><i class="fas fa-plus mr-2"></i>Otro preview</button>
        </div>`;
    }).join('');
    mkAutoGenRefThumbs();   // genera en 2º plano la miniatura de referencia de los bloques con diseño pre-seleccionado
}

// Genera (en segundo plano, de a uno) la imagen de referencia de cada bloque que ya tiene un
// diseño del lienzo pre-seleccionado y aún no muestra miniatura, para que el operador la vea
// sin tener que elegir/generar a mano.
async function mkAutoGenRefThumbs() {
    const picks = [...document.querySelectorAll('.mk-block .mk-lz-pick')];
    for (const pick of picks) {
        if (!pick.value) continue;
        const block = pick.closest('.mk-block');
        const blockId = block && block.dataset.block;
        if (!blockId || mkState.refFiles[blockId]) continue;                 // hay imagen subida a mano
        const thumb = document.getElementById('mk-ref-thumb-' + blockId);
        if (thumb && thumb.getAttribute('src')) continue;                    // ya tiene miniatura
        try { await mkGenRef2(blockId); } catch (_) { /* best-effort, no bloquea */ }
    }
}

// Mapea el texto parseado a los posibles campos (según cómo se llamen en la plantilla).
function mkPrefill(p) {
    return { nombre1: p.nombre1, nombre: p.nombre1, nombre2: p.nombre2, fecha: p.fecha };
}

// Combina el prefill (recalculado del pedido) con los valores guardados: usa el guardado si
// no está vacío, si no cae al prefill. Así los campos vacíos (ej. una fecha que antes no se
// parseaba) se llenan solos al recargar, aunque el preview ya estuviera generado.
function mkMergeValues(prefill, saved) {
    const out = Object.assign({}, prefill || {});
    for (const [k, v] of Object.entries(saved || {})) {
        if (v != null && String(v).trim() !== '') out[k] = v;
    }
    return out;
}

function mkNewBlockId() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// HTML de un bloque de preview: plantilla + modelo + campos adaptados + generar + resultado.
function mkBlockHtml(order, block, n) {
    const producto = order.producto || (order.items?.[0]?.producto || '');
    const tplId = block.templateId || mkAutoTemplate(producto);
    const provider = block.provider || 'wavespeed';
    const preview = block.previewUrl || mkState.results[block.id];
    return `
    <div class="mk-block" data-order="${mkAttr(order.id)}" data-block="${mkAttr(block.id)}">
        <div class="mk-block-head">
            <span class="mk-muted">Preview ${n}</span>
            ${n > 1 ? `<button class="mk-block-x" title="Quitar este preview" onclick="mkRemoveBlock('${mkAttr(block.id)}')"><i class="fas fa-times"></i></button>` : ''}
        </div>
        <div class="mk-block-body">
            <div>
                <div class="mk-inputs">
                    <div><label>Plantilla</label><select class="mk-tpl" onchange="mkOnBlockTemplateChange('${mkAttr(block.id)}')">${mkTemplateOptionsSel(tplId)}</select></div>
                    <div><label>Modelo</label><select class="mk-provider">
                        <option value="wavespeed"${provider === 'wavespeed' ? ' selected' : ''}>GPT Image 2 (WaveSpeed)</option>
                        <option value="gemini"${provider === 'gemini' ? ' selected' : ''}>Nano Banana (Gemini)</option>
                    </select></div>
                </div>
                <div class="mk-fields mk-inputs" style="margin-top:8px;">${mkFieldsHtml(mkTemplateFieldDefs(tplId), block.values)}</div>
                ${mkRef2Html(block.id, !!(mkGetTemplate(tplId) && mkGetTemplate(tplId).designSvg), tplId)}
                <div class="mk-extra-wrap" style="margin-top:10px;">
                    <label>Detalles adicionales (opcional)</label>
                    <textarea class="mk-extra" rows="2" placeholder="Instrucciones extra para la IA además de la plantilla: ej. agrégale un moño rojo, fondo más oscuro, la letra más grande…">${mkEsc(block.extra || '')}</textarea>
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary btn-sm mk-gen-btn" onclick="mkGenerate('${mkAttr(order.id)}','${mkAttr(block.id)}')"><i class="fas fa-wand-magic-sparkles mr-2"></i>Generar preview</button>
                </div>
            </div>
            <div class="mk-result" id="mk-result-${mkAttr(block.id)}">
                ${preview ? mkResultHtml(order.id, block.id, preview) : '<div class="mk-result-empty">El preview aparecerá aquí</div>'}
            </div>
        </div>
    </div>`;
}

function mkAddBlock(orderId) {
    const cont = document.getElementById('mk-blocks-' + orderId);
    const order = mkState.pending.find(o => o.id === orderId);
    if (!cont || !order) return;
    const n = cont.querySelectorAll('.mk-block').length + 1;
    const block = { id: mkNewBlockId(), templateId: mkAutoTemplate(order.producto || ''), provider: 'wavespeed', values: {}, previewUrl: '' };
    cont.insertAdjacentHTML('beforeend', mkBlockHtml(order, block, n));
}

function mkRemoveBlock(blockId) {
    const el = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (el) el.remove();
    delete mkState.results[blockId];
}

// Al cambiar la plantilla de un bloque, re-render de sus campos (conservando lo escrito por clave)
// y del panel de 2ª referencia (según la nueva plantilla tenga diseño o no).
function mkOnBlockTemplateChange(blockId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    const cur = {};
    block.querySelectorAll('.mk-fld').forEach(i => { cur[i.dataset.key] = i.value; });
    const tplId = block.querySelector('.mk-tpl').value;
    block.querySelector('.mk-fields').innerHTML = mkFieldsHtml(mkTemplateFieldDefs(tplId), cur);
    const ref2 = block.querySelector('.mk-ref2');
    if (ref2) {
        ref2.outerHTML = mkRef2Html(blockId, !!(mkGetTemplate(tplId) && mkGetTemplate(tplId).designSvg), tplId);
        mkRestoreRefThumb(blockId);   // conserva la miniatura de una imagen ya subida
    }
}

function mkResultHtml(orderId, blockId, imgUrl) {
    // Clic en la imagen (o en "Ampliar") la abre en el modal del CRM (openImageModal), no en pestaña nueva.
    return `
        <img src="${mkAttr(imgUrl)}" alt="Preview" title="Clic para ampliar" onclick="openImageModal(this.src)">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            <button class="btn btn-primary btn-sm mk-send-btn" onclick="mkSend('${mkAttr(orderId)}','${mkAttr(blockId)}')"><i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp</button>
            <button class="btn btn-outline btn-sm" onclick="openImageModal(this.closest('.mk-result').querySelector('img').src)"><i class="fas fa-expand mr-2"></i>Ampliar</button>
            <button class="btn btn-secondary btn-sm" onclick="mkGenerate('${mkAttr(orderId)}','${mkAttr(blockId)}')"><i class="fas fa-redo mr-2"></i>Regenerar</button>
        </div>`;
}

async function mkGenerate(orderId, blockId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    const box = document.getElementById('mk-result-' + blockId);
    const btn = block.querySelector('.mk-gen-btn');
    const templateId = block.querySelector('.mk-tpl').value;
    const provider = block.querySelector('.mk-provider').value;
    if (!templateId) { mkToast('Selecciona una plantilla.', 'error'); return; }

    // Campos del bloque (capitalizar los que sean nombres, aunque el cliente los escriba mal).
    const fields = {};
    block.querySelectorAll('.mk-fld').forEach(i => {
        let v = i.value.trim();
        if (/nombre/i.test(i.dataset.key)) { v = mkTitleCase(v); i.value = v; }
        fields[i.dataset.key] = v;
    });
    fields.personalizacion = (block.closest('.mk-card')?.querySelector('.mk-datos')?.value || '').trim();
    // Detalles adicionales que el operador escribe para sumar al prompt de la plantilla.
    const extraPrompt = (block.querySelector('.mk-extra')?.value || '').trim();

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generando…'; }
    // Bloquea el re-render de la lista mientras se genera: si mkLoadPending reconstruye el DOM a mitad
    // de la generación (p.ej. los refrescos de "Generar ahora"), este bloque se pierde y su preview se
    // guarda con un blockId huérfano, creando un preview DOBLE. Ver el guard en mkLoadPending.
    mkState.busyGen = (mkState.busyGen || 0) + 1;
    const setBox = (msg) => { if (box) box.innerHTML = `<div class="mk-spin"></div><div class="mk-result-empty">${mkEsc(msg)}</div>`; };
    const setProgress = (pct) => { if (box) box.innerHTML = `<div class="mk-progress"><div class="mk-progress-bar"><div class="mk-progress-fill" style="width:${pct}%"></div></div><div class="mk-result-empty">Generando… ${pct}%</div></div>`; };

    try {
        // 2ª referencia (diseño generado por código o imagen subida): se resuelve y sube ANTES
        // de llamar a la IA para obtener su URL pública.
        setBox('Preparando diseño…');
        const secondImageUrl = await mkResolveSecondRef(block, templateId, fields);

        setBox('Enviando a la IA…');
        const url = await mkRunGeneration({ templateId, provider, fields, extraPrompt, orderId, blockId, secondImageUrl }, setProgress);

        mkState.results[blockId] = url;
        if (box) box.innerHTML = mkResultHtml(orderId, blockId, url);
    } catch (e) {
        if (box) box.innerHTML = `<div class="mk-result-empty" style="color:#dc2626;">${mkEsc(e.message)}</div>`;
        mkToast('Error al generar: ' + e.message, 'error');
    } finally {
        mkState.busyGen = Math.max(0, (mkState.busyGen || 1) - 1);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generar preview'; }
    }
}

// Llamada de red compartida (Pendientes y Pruebas): POST /generate-preview y espera la imagen
// (Gemini síncrono o WaveSpeed asíncrono con polling). Devuelve la URL o lanza error.
async function mkRunGeneration(payload, setProgress) {
    const body = Object.assign({}, payload);
    if (!body.secondImageUrl) delete body.secondImageUrl;
    const data = await mkFetchJson('/api/mockups/generate-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    let url;
    if (data.image) url = data.image.fullUrl || data.image.thumbUrl;   // Gemini (síncrono)
    else if (data.jobId) url = await mkPollJob(data.jobId, setProgress); // WaveSpeed (asíncrono)
    if (!url) throw new Error('No se recibió la imagen generada.');
    return url;
}

// Polling del preview asíncrono (WaveSpeed). Devuelve la URL o lanza error.
async function mkPollJob(jobId, setProgress) {
    const started = Date.now();
    const MAX_MS = 6 * 60 * 1000;   // hasta 6 min (GPT Image 2 a veces se satura)
    const EST_MS = 150 * 1000;      // GPT Image 2 tarda ~2.5 min: base para el % estimado
    const INTERVAL = 3000;
    // Progreso estimado por tiempo (WaveSpeed no da % real); topado en 95% hasta terminar.
    const tick = () => setProgress(Math.min(95, Math.max(1, Math.round(((Date.now() - started) / EST_MS) * 100))));
    while (Date.now() - started < MAX_MS) {
        await new Promise(r => setTimeout(r, INTERVAL));
        let st;
        try {
            st = await mkFetchJson('/api/mockups/generate-status/' + encodeURIComponent(jobId));
        } catch (e) {
            tick();   // un fallo puntual no aborta
            continue;
        }
        if (st.status === 'completed') return st.image && (st.image.fullUrl || st.image.thumbUrl);
        if (st.status === 'failed') throw new Error(st.error || 'La generación falló.');
        tick();
    }
    throw new Error('La generación tardó demasiado (más de 6 min). Intenta de nuevo.');
}

async function mkSend(orderId, blockId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    // Anti DOBLE-ENVÍO: si ya hay un envío en curso para este bloque, no dispares otro (evita que
    // se dupliquen todos los mensajes cuando la acción se llama dos veces casi al mismo tiempo).
    mkState.sending = mkState.sending || {};
    if (mkState.sending[blockId]) return;
    mkState.sending[blockId] = true;

    const card = block.closest('.mk-card');
    const telefono = card && card.dataset.phone;
    const order = mkState.pending.find(o => o.id === orderId) || {};
    // Preview de ESTE bloque: generado en sesión o guardado (persistido).
    const imageUrl = mkState.results[blockId] || ((order.previews || []).find(p => p.blockId === blockId) || {}).imageUrl;
    if (!telefono) { mkToast('Este pedido no tiene teléfono.', 'error'); delete mkState.sending[blockId]; return; }
    if (!imageUrl) { mkToast('Genera el preview primero.', 'error'); delete mkState.sending[blockId]; return; }

    const btn = block.querySelector('.mk-send-btn');
    const setBtn = (html, disabled) => { if (btn) { btn.disabled = disabled; btn.innerHTML = html; } };
    setBtn('<i class="fas fa-spinner fa-spin mr-2"></i>Enviando…', true);

    try {
        // Salvaguarda ANTI-FUGA: no mandar a este cliente el preview de OTRO cliente.
        const chk = await mkFetchJson('/api/mockups/check-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefono, imageUrl }) });
        if (chk && chk.ok === false) {
            mkToast(chk.error || 'La imagen no corresponde a este cliente; no se envió.', 'error');
            setBtn('<i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp', false);
            return;
        }

        const ctx = await mkFetchJson('/api/mockups/send-context?telefono=' + encodeURIComponent(telefono));

        if (!ctx.windowOpen) {
            // Conversación cerrada (+24h): solo se puede plantilla. Avisar una vez por pedido.
            if (!mkState.noticeSent[orderId]) {
                setBtn('<i class="fas fa-spinner fa-spin mr-2"></i>Enviando aviso…', true);
                await mkSendChat(telefono, { template: MK_CLOSED_TEMPLATE });
                mkState.noticeSent[orderId] = true;
                await mkAfterSend(orderId, telefono, false);   // IA encendida; estatus sin cambiar
            }
            mkToast('Conversación cerrada: se avisó al cliente con la plantilla. Cuando responda, dale Enviar y va la foto.', 'success');
            setBtn('<i class="fab fa-whatsapp mr-2"></i>Enviar foto (cuando responda)', false);
            return;
        }

        // /cuatro (pago) + /bbb (tarjeta) SOLO una vez por pedido. El candado es ATÓMICO en el
        // servidor (claim-payment marca el pedido); solo el primer claim manda el pago, aunque
        // recargues la página o mandes varias fotos. Antes vivía en memoria y salía repetido.
        let paymentClaimed = false;
        try { const r = await mkFetchJson('/api/mockups/claim-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) }); paymentClaimed = !!(r && r.claimed); } catch (_) {}
        if (paymentClaimed) {
            if (ctx.cuatro && (ctx.cuatro.text || ctx.cuatro.fileUrl)) { setBtn('<i class="fas fa-spinner fa-spin mr-2"></i>Info de pago…', true); await mkSendChat(telefono, mkQrBody(ctx.cuatro)); }
            if (ctx.bbb && (ctx.bbb.text || ctx.bbb.fileUrl)) { setBtn('<i class="fas fa-spinner fa-spin mr-2"></i>Tarjeta…', true); await mkSendChat(telefono, mkQrBody(ctx.bbb)); }
            mkState.paymentSent[orderId] = true;
        }
        // La foto de este bloque (WhatsApp no soporta WebP -> convertir a JPEG).
        setBtn('<i class="fas fa-spinner fa-spin mr-2"></i>Enviando foto…', true);
        const wa = await mkFetchJson('/api/mockups/wa-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: imageUrl }) });
        await mkSendChat(telefono, { fileUrl: wa.jpgUrl, fileType: 'image/jpeg' });

        await mkAfterSend(orderId, telefono, true);   // estatus -> "Foto enviada" + IA encendida
        mkToast('Foto enviada al cliente ✅', 'success');
        setBtn('<i class="fas fa-check mr-2"></i>Enviado', true);
    } catch (e) {
        mkToast('Error al enviar: ' + e.message, 'error');
        setBtn('<i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp', false);
    } finally {
        delete mkState.sending[blockId];
    }
}

// Envía un mensaje por el mismo endpoint que usa el chat (registra en la conversación
// y procesa comandos como /cuatro). body: { text } | { text, fileUrl, fileType }.
function mkSendChat(telefono, body) {
    return mkFetchJson('/api/contacts/' + encodeURIComponent(telefono) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// Body para el endpoint del chat a partir de una respuesta rápida (texto y/o imagen).
function mkQrBody(qr) {
    const body = {};
    if (qr.text) body.text = qr.text;
    if (qr.fileUrl && qr.fileType) { body.fileUrl = qr.fileUrl; body.fileType = qr.fileType; }
    return body;
}

// Tras enviar: asegurar la IA encendida (post-venta) para que responda al cliente, y
// (si se envió la foto) cambiar el estatus del pedido a "Foto enviada". Best-effort:
// los mensajes ya salieron, así que un fallo aquí no debe romper el flujo.
async function mkAfterSend(orderId, telefono, photoSent) {
    try {
        await mkFetchJson('/api/contacts/' + encodeURIComponent(telefono) + '/activate-postventa', { method: 'POST' });
    } catch (e) { console.error('[mockups] activar IA:', e.message); }
    if (photoSent) {
        try {
            await db.collection('pedidos').doc(orderId).update({ estatus: 'Foto enviada' });
            const o = mkState.pending.find(x => x.id === orderId);
            if (o) o.estatus = 'Foto enviada';
        } catch (e) { console.error('[mockups] estatus Foto enviada:', e.message); }
    }
}

// ===================================================================
// 2ª REFERENCIA (DISEÑO): SVG editable -> PNG -> URL pública
// -------------------------------------------------------------------
// El diseño (nombres/fecha/símbolo) vive como SVG con placeholders en la
// plantilla; el navegador lo rellena con los datos del pedido, lo rasteriza
// con la fuente manuscrita EMBEBIDA y lo sube como 2ª imagen de referencia
// para que la IA lo grabe en la lámpara base.
// ===================================================================
function mkGetTemplate(id) { return mkState.templates.find(t => t.id === id) || null; }

// XML-escape para meter valores dentro del <text> del SVG sin romperlo.
function mkXmlEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Sustituye {clave} en el SVG por los valores (XML-escapados). Los placeholders
// sin valor se vacían para no dejar "{fecha}" a la vista.
function mkFillDesignSvg(svg, fields = {}) {
    let out = String(svg || '');
    for (const [k, v] of Object.entries(fields)) {
        const esc = mkXmlEsc(v);
        // Reemplazo por FUNCIÓN: si se pasa como string, los `$` del valor ($&, $1, $$…) se
        // interpretarían como patrones de reemplazo y corromperían el texto (ej. "$&").
        out = out.replace(new RegExp('\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'g'), () => esc);
    }
    return out.replace(/\{[a-zA-Z0-9_]+\}/g, '');
}

// Descarga la fuente una sola vez y la deja como data-URI base64 (para embeberla en el SVG,
// requisito para que la tipografía se vea al rasterizar el SVG dentro de un <canvas>).
function mkFontDataUrl() {
    if (!mkFontDataUrlPromise) {
        mkFontDataUrlPromise = fetch(MK_API + MK_DESIGN_FONT_URL)
            .then(r => { if (!r.ok) throw new Error('No se pudo cargar la fuente del diseño.'); return r.arrayBuffer(); })
            .then(buf => {
                let bin = '';
                const bytes = new Uint8Array(buf);
                for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                return 'data:font/ttf;base64,' + btoa(bin);
            })
            .catch(e => { mkFontDataUrlPromise = null; throw e; });   // permite reintentar
    }
    return mkFontDataUrlPromise;
}

// Garantiza que la fuente manuscrita esté CARGADA en document.fonts antes de medir con
// canvas.measureText. Sin esto, measureText usa una fuente de reemplazo (más ancha) y el
// ajuste dentro de los límites encoge el texto de más (sale más chico que en el lienzo vivo).
// Usa la FontFace API con el TTF ya descargado (mkFontDataUrl), así no depende del @font-face.
let mkDesignFontLoadPromise = null;
function mkEnsureDesignFontLoaded() {
    if (!mkDesignFontLoadPromise) {
        mkDesignFontLoadPromise = (async () => {
            try {
                if (!document.fonts || !window.FontFace) return;
                // Siempre cargamos el TTF real y lo añadimos a document.fonts (idempotente por la
                // promesa cacheada). No usamos document.fonts.check(): devuelve true cuando NO hay
                // @font-face declarado y saltaría la carga, dejando measureText con la de reemplazo.
                const url = await mkFontDataUrl();
                const ff = new FontFace(MK_DESIGN_FONT_FAMILY, 'url(' + url + ')');
                await ff.load();
                document.fonts.add(ff);
            } catch (_) { mkDesignFontLoadPromise = null; }   // best-effort; permite reintentar
        })();
    }
    return mkDesignFontLoadPromise;
}

// --- Layout de textos del diseño: renglones (enters) + tamaños de producción -----------------
// SVG ignora los '\n' (aplasta todo a un renglón) y un texto largo se desborda de su zona.
// Este pase replica las reglas de PRODUCCIÓN (las mismas del diseño de corte en Corel):
//   - Campo con enter (ej. fecha "21-Julio-2026 ⏎ Aniversario No. 27") -> renglones apilados
//     y centrados en la y original (la 1ª línea sube medio bloque; el resto cae abajo).
//   - 2+ renglones -> el tamaño baja a 69% (44.8pt/65.2pt, proporción de los diseños manuales),
//     para que el bloque no crezca al doble de alto.
//   - Auto-ajuste de ancho: la línea más ancha debe caber en su zona (nombres ~24% del ancho
//     del lienzo = el aro del infinito; otros textos ~32%). Se puede afinar por texto con el
//     atributo opcional data-max-w="<px del viewBox>" en el SVG del diseño.
const MK_2L_RATIO = 0.69;        // proporción 2 renglones (44.8/65.2 de producción)
const MK_MAXW_NOMBRE = 0.24;     // ancho máx de un nombre, como fracción del viewBox
const MK_MAXW_OTROS = 0.32;      // ancho máx de fecha/otros textos
function mkLayoutDesignSvg(svg, fields = {}) {
    try {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        if (doc.querySelector('parsererror')) return mkFillDesignSvg(svg, fields);
        const root = doc.documentElement;
        const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
        const vbW = (vb.length === 4 && vb[2] > 0) ? vb[2] : (parseFloat(root.getAttribute('width')) || 1024);
        const ctx = document.createElement('canvas').getContext('2d');

        doc.querySelectorAll('text').forEach(t => {
            if (t.children.length) return;                    // ya trae tspans/markup propio
            const raw0 = t.textContent || '';
            const keys = Array.from(raw0.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map(m => m[1].toLowerCase());
            const raw = raw0.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => {
                const v = fields[k.toLowerCase()];
                return v != null ? String(v) : '';
            });
            if (raw === raw0 && raw.indexOf('\n') < 0) return; // texto fijo de una línea: intacto
            const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
            if (!lines.length) { t.textContent = ''; return; }

            let size = parseFloat(t.getAttribute('font-size')) || 32;
            const original = size;
            if (lines.length > 1) size = size * MK_2L_RATIO;  // 2 renglones -> tamaño de producción

            // Auto-ajuste de ancho midiendo con la fuente real (ya cargada en document.fonts).
            const fam = t.getAttribute('font-family') || 'sans-serif';
            const esNombre = keys.some(k => /nombre/.test(k));
            const maxW = parseFloat(t.getAttribute('data-max-w')) || vbW * (esNombre ? MK_MAXW_NOMBRE : MK_MAXW_OTROS);
            ctx.font = size + 'px ' + fam;
            const wMax = Math.max.apply(null, lines.map(l => ctx.measureText(l).width));
            if (wMax > maxW && wMax > 0) size = Math.max(8, size * maxW / wMax);
            if (size !== original) t.setAttribute('font-size', String(Math.round(size * 100) / 100));

            if (lines.length === 1) { t.textContent = lines[0]; return; }
            const x = t.getAttribute('x') || '0';
            const LH = 1.15;                                  // interlineado en em
            t.textContent = '';
            lines.forEach((line, i) => {
                const ts = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                ts.setAttribute('x', x);
                ts.setAttribute('dy', i === 0 ? (-((lines.length - 1) * LH) / 2) + 'em' : LH + 'em');
                ts.textContent = line;
                t.appendChild(ts);
            });
        });
        return new XMLSerializer().serializeToString(root);
    } catch (_) { return mkFillDesignSvg(svg, fields); }      // ante cualquier duda, relleno simple
}

// SVG final: layout de textos (relleno + renglones + tamaños) + fuente embebida + xmlns.
async function mkBuildDesignSvg(svg, fields) {
    await mkEnsureDesignFontLoaded();                          // para medir texto con la fuente real
    let filled = mkLayoutDesignSvg(svg, fields).trim();
    if (!/xmlns=/.test(filled)) filled = filled.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    const fontUrl = await mkFontDataUrl();
    const style = `<defs><style>@font-face{font-family:'${MK_DESIGN_FONT_FAMILY}';src:url(${fontUrl}) format('truetype');}</style></defs>`;
    return filled.replace(/(<svg\b[^>]*>)/, '$1' + style);   // <defs> justo tras la etiqueta <svg ...>
}

// width/height del viewBox del SVG, escalados a targetW (para el tamaño del canvas).
function mkSvgDims(svg, targetW = 1024) {
    const m = String(svg).match(/viewBox\s*=\s*"\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/);
    let w = 1024, h = 1024;
    if (m) { const vw = parseFloat(m[1]), vh = parseFloat(m[2]); if (vw > 0 && vh > 0) { w = vw; h = vh; } }
    const scale = targetW / w;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// Rasteriza el SVG (con la fuente) a un canvas -> { blob, dataUrl } (PNG).
async function mkRasterizeDesign(svg, fields) {
    const full = await mkBuildDesignSvg(svg, fields);
    const dims = mkSvgDims(full, 1024);
    const img = new Image();
    img.decoding = 'async';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(full);
    await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo renderizar el diseño.')); }));
    const canvas = document.createElement('canvas');
    canvas.width = dims.w; canvas.height = dims.h;
    canvas.getContext('2d').drawImage(img, 0, 0, dims.w, dims.h);
    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('No se pudo exportar el diseño a imagen.');
    return { blob, dataUrl };
}

async function mkDesignDataUrl(svg, fields) { return (await mkRasterizeDesign(svg, fields)).dataUrl; }

// Sube una imagen (File/Blob) y devuelve su URL pública (para usarla como 2ª referencia).
async function mkUploadRefImage(fileOrBlob, filename) {
    const fd = new FormData();
    fd.append('file', fileOrBlob, filename || 'ref.png');
    const up = await mkFetchJson('/api/mockups/upload-image', { method: 'POST', body: fd });
    return up.url;
}

// Lee los campos (nombre1/nombre2/fecha…) de un contenedor (bloque o pane de pruebas).
function mkReadFields(scope) {
    const fields = {};
    scope.querySelectorAll('.mk-fld').forEach(i => {
        let v = i.value.trim();
        if (/nombre/i.test(i.dataset.key)) v = mkTitleCase(v);
        fields[i.dataset.key] = v;
    });
    return fields;
}

// Normaliza un nombre de capa a una clave comparable (minúsculas, sin acentos ni símbolos):
// "Nombre 1" -> "nombre1", "Fecha" -> "fecha".
function mkNorm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }

// Sustituye {clave} en texto PLANO (el markup del lienzo hace el XML-escape aparte).
function mkFillPlain(text, fields) {
    return String(text == null ? '' : text).replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => {
        const v = fields[k.toLowerCase()];
        return v != null ? String(v) : '';
    });
}

// Clona los items de un diseño y rellena sus TEXTOS con los datos del pedido: por placeholders
// {nombre1}… en el texto, o —si no hay— por el NOMBRE de la capa (una capa "Nombre 1" toma
// fields.nombre1, "Fecha" -> fields.fecha, etc.). No muta el diseño guardado.
function mkLzFillItemsWithFields(items, fields) {
    return (items || []).map(raw => {
        const it = Object.assign({}, raw);
        if (Array.isArray(raw.points)) it.points = raw.points.map(p => ({ x: p.x, y: p.y }));
        if (it.type !== 'text') return it;
        if (it.baseSize == null) it.baseSize = it.size;
        let txt = it.text || '';
        if (/\{[a-zA-Z0-9_]+\}/.test(txt)) {
            txt = mkFillPlain(txt, fields);
        } else {
            const key = mkNorm(it.name);
            if (key && key !== 'personalizacion' && Object.prototype.hasOwnProperty.call(fields, key)) {
                txt = fields[key] != null ? String(fields[key]) : '';
            }
        }
        it.text = txt;
        it.size = it.baseSize;   // parte del tamaño deseado; los límites lo re-ajustan
        return it;
    });
}

// Rasteriza un DISEÑO guardado del lienzo, relleno con los datos del pedido -> {blob, dataUrl}.
async function mkRasterizeLzDesignBlob(designId, fields) {
    const d = (mkLzState().designs || []).find(x => x.id === designId);
    if (!d) throw new Error('El diseño del lienzo no está disponible.');
    // Hidratar (imágenes remotas -> data URI) UNA vez por diseño y cachearlo: varios bloques
    // usan el mismo diseño y no queremos re-descargar sus imágenes cada vez.
    if (!mkState.lzHydrated[designId]) mkState.lzHydrated[designId] = await mkLzHydrateItems(d.items || []);
    let items = mkLzFillItemsWithFields(mkState.lzHydrated[designId], fields);   // textos -> datos del pedido
    await mkEnsureDesignFontLoaded();                     // measureText con métricas correctas
    mkLzComputeSizes(items);                              // aplica los límites al texto nuevo
    return await mkLzRasterizeItems(items);
}

// Resuelve la 2ª referencia de un bloque, por prioridad: (1) imagen subida a mano; (2) un
// DISEÑO del lienzo elegido en el bloque, rasterizado con los datos del pedido; (3) el diseño
// SVG de la plantilla. '' si no aplica.
async function mkResolveSecondRef(block, templateId, fields) {
    const blockId = block.dataset.block;
    const file = mkState.refFiles[blockId];
    if (file) return await mkUploadRefImage(file, 'ref-upload.png');
    const pick = block.querySelector('.mk-lz-pick');
    const designId = pick ? pick.value : '';
    if (designId) {
        const { blob } = await mkRasterizeLzDesignBlob(designId, fields);
        return await mkUploadRefImage(blob, 'design-lienzo.png');
    }
    const tpl = mkGetTemplate(templateId);
    const useDesign = block.querySelector('.mk-usedesign');
    if (tpl && tpl.designSvg && (!useDesign || useDesign.checked)) {
        const { blob } = await mkRasterizeDesign(tpl.designSvg, fields);
        return await mkUploadRefImage(blob, 'design.png');
    }
    return '';
}

// Panel de "2ª referencia" dentro de un bloque de preview. Los controles de "diseño" (casilla
// + Ver diseño) solo aparecen si la plantilla seleccionada tiene un designSvg; la subida manual
// está siempre disponible. Se re-renderiza al cambiar de plantilla (mkOnBlockTemplateChange).
function mkRef2Html(blockId, hasDesign, tplId) {
    const b = mkAttr(blockId);
    const designs = mkLzState().designs || [];
    const tpl = mkGetTemplate(tplId);
    // Diseño pre-seleccionado: lo elegido en esta sesión gana; si no, el guardado en la plantilla.
    const sess = mkState.lzPickByTemplate;
    const pickedId = (sess && Object.prototype.hasOwnProperty.call(sess, tplId)) ? (sess[tplId] || '') : ((tpl && tpl.designId) || '');
    const uploadLabel = (hasDesign || designs.length) ? 'Subir otra' : 'Subir imagen';
    const canGen = designs.length || hasDesign;   // ¿hay una fuente para generar la referencia?
    // Selector de DISEÑO DEL LIENZO (diseños guardados): se rellena con los datos del pedido.
    const lzPick = designs.length ? `
                    <div class="mk-lz-pickrow">
                        <span class="mk-muted" style="font-size:.8rem;">Diseño del lienzo:</span>
                        <select class="mk-lz-pick" onchange="mkOnPickLzDesign('${b}', this.value)">
                            <option value="">— usar el de la plantilla —</option>
                            ${designs.map(d => `<option value="${mkAttr(d.id)}"${d.id === pickedId ? ' selected' : ''}>${mkEsc(d.nombre)}</option>`).join('')}
                        </select>
                    </div>` : '';
    const genBtn = canGen ? `<button type="button" class="btn btn-secondary btn-sm" onclick="mkGenRef2('${b}', this)"><i class="fas fa-wand-magic-sparkles mr-1"></i>Generar imagen de referencia</button>` : '';
    const uploadBtns = `
                    <div class="mk-ref2-btns">
                        ${genBtn}
                        <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;"><i class="fas fa-upload mr-1"></i>${uploadLabel}<input type="file" class="mk-ref-file" accept="image/*" style="display:none;" onchange="mkOnRefFile(event,'${b}')"></label>
                        <button type="button" class="btn btn-outline btn-sm" id="mk-ref-clear-${b}" style="display:none;" onclick="mkClearRef('${b}')"><i class="fas fa-times mr-1"></i>Quitar</button>
                    </div>`;
    const check = hasDesign ? `<label class="mk-ref2-check"><input type="checkbox" class="mk-usedesign" checked> Usar el diseño de la plantilla</label>` : '';
    const hint = designs.length
        ? '<small class="mk-muted">Elige un <b>diseño del lienzo</b> (se rellena con los nombres/fecha del pedido) y dale <b>Generar imagen de referencia</b>, o sube/<b>arrastra</b>/<b>pega</b> una imagen. Prioridad: imagen subida › diseño del lienzo › diseño de la plantilla.</small>'
        : (hasDesign
            ? '<small class="mk-muted">Dale <b>Generar imagen de referencia</b> para verla, o sube/<b>arrastra</b>/<b>pega (Ctrl+V)</b> una imagen; si subes una, se usa esa. Se manda junto a la foto base para que la IA grabe ese diseño.</small>'
            : '<small class="mk-muted">Opcional: sube, <b>arrastra</b> o <b>pega (Ctrl+V)</b> una imagen para usarla como 2ª referencia (esta plantilla no tiene diseño).</small>');
    return `
        <div class="mk-ref2" ondragover="event.preventDefault()" ondrop="mkOnRefDrop(event,'${b}')" onmousedown="mkSetRefPasteTarget('${b}')">
            <label>2ª referencia · diseño a grabar (opcional)</label>
            <div class="mk-ref2-row">
                <img class="mk-ref-thumb" id="mk-ref-thumb-${b}" alt="" title="Clic para ver en grande" onclick="mkThumbZoom(this)" style="display:none;">
                <div class="mk-ref2-controls">${check}${lzPick}${uploadBtns}${hint}
                </div>
            </div>
        </div>`;
}

// Elegir un diseño del lienzo en un bloque: recuerda la elección por plantilla y auto-genera
// la vista previa de la 2ª referencia con los datos del pedido.
function mkOnPickLzDesign(blockId, designId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    const tplSel = block.querySelector('.mk-tpl');
    const tplId = tplSel ? tplSel.value : '';
    if (tplId) {
        mkState.lzPickByTemplate[tplId] = designId;
        // Persistir en la plantilla: queda fijo para TODOS los pedidos de esa plantilla (y al recargar).
        const tpl = mkGetTemplate(tplId);
        if (tpl && (tpl.designId || '') !== (designId || '')) {
            tpl.designId = designId || null;   // optimista
            mkFetchJson('/api/mockups/templates/' + tplId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designId: designId || null }) }).catch(() => {});
        }
    }
    if (designId) mkGenRef2(blockId);
    else if (!mkState.refFiles[blockId]) mkSetRefThumb(blockId, '');
}

// Genera la imagen de 2ª referencia con los datos del pedido y la muestra en la miniatura:
// usa el DISEÑO DEL LIENZO elegido; si no hay, el diseño SVG de la plantilla. Es la MISMA
// imagen que se enviará a la IA al generar el preview.
async function mkGenRef2(blockId, btn) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    if (mkState.refFiles[blockId]) { mkToast('Tienes una imagen subida como 2ª referencia; quítala para generarla desde el diseño.', 'error'); return; }
    const fields = mkReadFields(block);
    const pick = block.querySelector('.mk-lz-pick');
    const designId = pick ? pick.value : '';
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Generando…'; }
    try {
        let dataUrl;
        if (designId) {
            dataUrl = (await mkRasterizeLzDesignBlob(designId, fields)).dataUrl;
        } else {
            const tpl = mkGetTemplate(block.querySelector('.mk-tpl').value);
            if (!tpl || !tpl.designSvg) { mkToast('Elige un "Diseño del lienzo", o usa una plantilla con diseño, o sube una imagen.', 'error'); return; }
            dataUrl = await mkDesignDataUrl(tpl.designSvg, fields);
        }
        mkSetRefThumb(blockId, dataUrl);
        if (btn) mkToast('Imagen de referencia generada ✓ (haz clic en la miniatura para verla en grande)', 'success');
    } catch (e) {
        mkToast('No se pudo generar la referencia: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

// Abre una imagen (miniatura de referencia) en grande en una pestaña nueva.
function mkThumbZoom(img) {
    if (!img || !img.getAttribute('src')) return;
    const w = window.open('', '_blank');
    if (w) w.document.write('<title>2ª referencia</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh"><img src="' + img.getAttribute('src') + '" style="max-width:100%;max-height:100%"></body>');
}

// Restaura la miniatura + botón "Quitar" de una imagen subida a un bloque tras un re-render.
function mkRestoreRefThumb(blockId) {
    const f = mkState.refFiles[blockId];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = e => mkSetRefThumb(blockId, e.target.result);
    reader.readAsDataURL(f);
    const clr = document.getElementById('mk-ref-clear-' + blockId);
    if (clr) clr.style.display = '';
}

function mkSetRefThumb(blockId, src) {
    const img = document.getElementById('mk-ref-thumb-' + blockId);
    if (!img) return;
    if (src) { img.src = src; img.style.display = ''; } else { img.removeAttribute('src'); img.style.display = 'none'; }
}

// "Ver diseño": rasteriza el diseño de la plantilla con los valores actuales y lo muestra.
async function mkPreviewDesign(blockId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    const tpl = mkGetTemplate(block.querySelector('.mk-tpl').value);
    if (!tpl || !tpl.designSvg) { mkToast('Esta plantilla no tiene diseño de referencia. Agrégalo en Plantillas.', 'error'); return; }
    try { mkSetRefThumb(blockId, await mkDesignDataUrl(tpl.designSvg, mkReadFields(block))); }
    catch (e) { mkToast('No se pudo generar el diseño: ' + e.message, 'error'); }
}

// Marca la zona de 2ª referencia "activa" para que Ctrl+V pegue ahí (la última en la que
// hiciste clic, soltaste o arrastraste). '__pruebas__' = la del banco de pruebas.
function mkSetRefPasteTarget(id) { mkState.refPasteTarget = id; }

// Setter compartido: recibe un File/Blob (de subir, arrastrar o pegar) y lo usa como 2ª
// referencia del bloque. Devuelve true si se aceptó.
function mkSetBlockRefFile(blockId, file) {
    if (!file || !file.type || !file.type.startsWith('image/')) { mkToast('Solo se aceptan imágenes.', 'error'); return false; }
    mkState.refFiles[blockId] = file;
    const reader = new FileReader();
    reader.onload = e => mkSetRefThumb(blockId, e.target.result);
    reader.readAsDataURL(file);
    const clr = document.getElementById('mk-ref-clear-' + blockId);
    if (clr) clr.style.display = '';
    return true;
}

function mkOnRefFile(ev, blockId) {
    const file = ev.target.files && ev.target.files[0];
    if (file) mkSetBlockRefFile(blockId, file);
}

function mkOnRefDrop(ev, blockId) {
    ev.preventDefault();
    mkSetRefPasteTarget(blockId);
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) mkSetBlockRefFile(blockId, f);
}

function mkClearRef(blockId) {
    delete mkState.refFiles[blockId];
    mkSetRefThumb(blockId, '');
    const clr = document.getElementById('mk-ref-clear-' + blockId);
    if (clr) clr.style.display = 'none';
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    const inp = block && block.querySelector('.mk-ref-file');
    if (inp) inp.value = '';
}

// ---------- pestaña "Pruebas" (banco de mockup, sin pedido) ----------
function mkRenderPruebas() {
    const cont = document.getElementById('mk-pane-pruebas');
    if (!cont) return;
    if (!mkState.templates.length) {
        cont.innerHTML = '<div class="settings-card"><p class="mk-muted">Crea primero una plantilla (pestaña <b>Plantillas</b>) para poder probar.</p></div>';
        return;
    }
    const P = mkState.pruebas;
    const tplId = (P.templateId && mkGetTemplate(P.templateId)) ? P.templateId : mkState.templates[0].id;
    P.templateId = tplId;
    const tpl = mkGetTemplate(tplId);
    // Prompt a mostrar: la edición en curso (por plantilla) o el de la plantilla guardado.
    const promptVal = (tplId in P.promptEdits) ? P.promptEdits[tplId] : (tpl.promptTemplate || '');
    cont.innerHTML = `
    <div class="settings-card">
        <h2 class="text-xl font-bold mb-1">Banco de pruebas</h2>
        <p class="mk-muted" style="margin-bottom:14px;">Genera un mockup libre (sin pedido). Ajusta el diseño y el prompt hasta que quede; <b>nada se envía al cliente</b>.</p>
        <div class="mk-block-body">
            <div>
                <div class="mk-inputs">
                    <div><label>Plantilla</label><select id="mk-pr-tpl" onchange="mkPruebasTplChange()">${mkTemplateOptionsSel(tplId)}</select></div>
                    <div><label>Modelo</label><select id="mk-pr-provider">
                        <option value="wavespeed"${P.provider === 'wavespeed' ? ' selected' : ''}>GPT Image 2 (WaveSpeed)</option>
                        <option value="gemini"${P.provider === 'gemini' ? ' selected' : ''}>Nano Banana (Gemini)</option>
                    </select></div>
                </div>
                <div class="mk-fields mk-inputs" id="mk-pr-fields" style="margin-top:8px;">${mkFieldsHtml(mkTemplateFieldDefs(tplId), P.values)}</div>
                <div class="mk-ref2" style="margin-top:12px;" ondragover="event.preventDefault()" ondrop="mkPruebasOnDrop(event)" onmousedown="mkSetRefPasteTarget('__pruebas__')">
                    <label>Diseño (2ª referencia)</label>
                    <div class="mk-ref2-row">
                        <img class="mk-ref-thumb" id="mk-pr-design" alt="" style="display:none;">
                        <div class="mk-ref2-controls">
                            <div class="mk-ref2-btns">
                                <button type="button" class="btn btn-outline btn-sm" onclick="mkPruebasPreviewDesign()"><i class="fas fa-eye mr-1"></i>Ver diseño</button>
                                <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;"><i class="fas fa-upload mr-1"></i>Subir imagen<input type="file" id="mk-pr-file" accept="image/*" style="display:none;" onchange="mkPruebasOnFile(event)"></label>
                                <button type="button" class="btn btn-outline btn-sm" id="mk-pr-clear" style="display:none;" onclick="mkPruebasClear()"><i class="fas fa-times mr-1"></i>Quitar</button>
                            </div>
                            <small class="mk-muted">${tpl && tpl.designSvg ? 'Esta plantilla tiene diseño. Míralo, o sube/<b>arrastra</b>/<b>pega (Ctrl+V)</b> uno propio.' : 'Sube, <b>arrastra</b> o <b>pega (Ctrl+V)</b> una imagen para usarla como 2ª referencia (esta plantilla no tiene diseño).'}</small>
                        </div>
                    </div>
                </div>
                <div class="mk-extra-wrap" style="margin-top:12px;">
                    <label>Prompt (usa {nombre1} {nombre2} {fecha})</label>
                    <textarea id="mk-pr-prompt" class="mk-extra" rows="5" style="min-height:96px;font-size:.85rem;">${mkEsc(promptVal)}</textarea>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">
                        <button type="button" class="btn btn-outline btn-sm" id="mk-pr-saveprompt" onclick="mkPruebasSavePrompt()"><i class="fas fa-save mr-1"></i>Guardar prompt en la plantilla</button>
                        <button type="button" class="btn btn-outline btn-sm" onclick="mkPruebasResetPrompt()"><i class="fas fa-rotate-left mr-1"></i>Restablecer</button>
                        <small class="mk-muted">Se usa este prompt al generar; los datos ({nombre1}…) se sustituyen. "Guardar" lo aplica también a Pendientes y auto-generación.</small>
                    </div>
                </div>
                <div class="mk-extra-wrap" style="margin-top:10px;">
                    <label>Detalles adicionales (opcional)</label>
                    <textarea id="mk-pr-extra" class="mk-extra" rows="2" placeholder="Instrucciones extra para la IA…">${mkEsc(P.extra || '')}</textarea>
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary btn-sm" id="mk-pr-gen" onclick="mkPruebasGenerate()"><i class="fas fa-wand-magic-sparkles mr-2"></i>Generar mockup</button>
                </div>
            </div>
            <div class="mk-result" id="mk-pr-result">
                ${P.resultUrl ? mkPruebasResultHtml(P.resultUrl) : '<div class="mk-result-empty">El mockup aparecerá aquí</div>'}
            </div>
        </div>
        ${mkLzHtml()}
    </div>`;
    // Si había una imagen subida como 2ª referencia, restaura su miniatura + botón "Quitar" tras
    // el re-render (si no, el archivo quedaría activo sin verse y anularía el diseño en silencio).
    if (P.refFile) {
        const clr = document.getElementById('mk-pr-clear'); if (clr) clr.style.display = '';
        const reader = new FileReader();
        reader.onload = e => { const img = document.getElementById('mk-pr-design'); if (img) { img.src = e.target.result; img.style.display = ''; } };
        reader.readAsDataURL(P.refFile);
    }
    mkLzMount();   // lienzo de diseño (su estado vive en mkState.lienzo y sobrevive re-render)
}

// Guarda lo escrito (campos/modelo/extra) antes de un re-render de la pestaña.
function mkPruebasCapture() {
    const P = mkState.pruebas;
    const v = {};
    document.querySelectorAll('#mk-pr-fields .mk-fld').forEach(i => { v[i.dataset.key] = i.value; });
    P.values = v;
    const prov = document.getElementById('mk-pr-provider'); if (prov) P.provider = prov.value;
    const ex = document.getElementById('mk-pr-extra'); if (ex) P.extra = ex.value;
    // Conserva la edición del prompt (por plantilla) para que sobreviva a los re-render.
    const tid = document.getElementById('mk-pr-tpl'); const pt = document.getElementById('mk-pr-prompt');
    if (tid && pt) P.promptEdits[tid.value] = pt.value;
}

function mkPruebasTplChange() {
    mkPruebasCapture();
    mkState.pruebas.templateId = document.getElementById('mk-pr-tpl').value;
    mkRenderPruebas();
}

async function mkPruebasPreviewDesign() {
    const tpl = mkGetTemplate(document.getElementById('mk-pr-tpl').value);
    if (!tpl || !tpl.designSvg) { mkToast('Esta plantilla no tiene diseño de referencia.', 'error'); return; }
    const img = document.getElementById('mk-pr-design');
    try { const url = await mkDesignDataUrl(tpl.designSvg, mkReadFields(document.getElementById('mk-pr-fields'))); if (img) { img.src = url; img.style.display = ''; } }
    catch (e) { mkToast('No se pudo generar el diseño: ' + e.message, 'error'); }
}

// Setter compartido de la 2ª referencia de Pruebas (subir/arrastrar/pegar). Devuelve true si se aceptó.
function mkPruebasSetRefFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) { mkToast('Solo se aceptan imágenes.', 'error'); return false; }
    mkState.pruebas.refFile = file;
    const reader = new FileReader();
    reader.onload = e => { const img = document.getElementById('mk-pr-design'); if (img) { img.src = e.target.result; img.style.display = ''; } };
    reader.readAsDataURL(file);
    const clr = document.getElementById('mk-pr-clear'); if (clr) clr.style.display = '';
    return true;
}

function mkPruebasOnFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (file) mkPruebasSetRefFile(file);
}

function mkPruebasOnDrop(ev) {
    ev.preventDefault();
    mkSetRefPasteTarget('__pruebas__');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) mkPruebasSetRefFile(f);
}

function mkPruebasClear() {
    mkState.pruebas.refFile = null;
    const img = document.getElementById('mk-pr-design'); if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
    const clr = document.getElementById('mk-pr-clear'); if (clr) clr.style.display = 'none';
    const inp = document.getElementById('mk-pr-file'); if (inp) inp.value = '';
}

// Guarda el prompt editado EN LA PLANTILLA (lo aplica también a Pendientes y auto-generación).
async function mkPruebasSavePrompt() {
    const tplId = document.getElementById('mk-pr-tpl').value;
    const prompt = (document.getElementById('mk-pr-prompt')?.value || '').trim();
    if (!tplId) return;
    if (!prompt) { mkToast('El prompt no puede estar vacío.', 'error'); return; }
    const btn = document.getElementById('mk-pr-saveprompt');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Guardando…'; }
    try {
        await mkFetchJson('/api/mockups/templates/' + tplId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promptTemplate: prompt }) });
        const t = mkGetTemplate(tplId); if (t) t.promptTemplate = prompt;   // refleja en memoria (sin recargar)
        mkState.pruebas.promptEdits[tplId] = prompt;
        mkToast('Prompt guardado en la plantilla ✅', 'success');
    } catch (e) {
        mkToast('No se pudo guardar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

// Descarta la edición y vuelve al prompt guardado en la plantilla.
function mkPruebasResetPrompt() {
    const tplId = document.getElementById('mk-pr-tpl').value;
    const tpl = mkGetTemplate(tplId);
    delete mkState.pruebas.promptEdits[tplId];
    const pt = document.getElementById('mk-pr-prompt');
    if (pt && tpl) pt.value = tpl.promptTemplate || '';
    mkToast('Prompt restablecido al de la plantilla.', 'info');
}

function mkPruebasResultHtml(url) {
    // Clic en la imagen (o en "Ampliar") la abre en el modal del CRM (openImageModal), no en pestaña nueva.
    return `
        <img src="${mkAttr(url)}" alt="Mockup" title="Clic para ampliar" onclick="openImageModal(this.src)">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            <button class="btn btn-outline btn-sm" onclick="openImageModal(this.closest('.mk-result').querySelector('img').src)"><i class="fas fa-expand mr-2"></i>Ampliar</button>
            <button class="btn btn-secondary btn-sm" onclick="mkPruebasGenerate()"><i class="fas fa-redo mr-2"></i>Regenerar</button>
        </div>`;
}

async function mkPruebasGenerate() {
    const tplId = document.getElementById('mk-pr-tpl').value;
    const provider = document.getElementById('mk-pr-provider').value;
    const P = mkState.pruebas;
    P.templateId = tplId; P.provider = provider;
    if (!tplId) { mkToast('Selecciona una plantilla.', 'error'); return; }

    const scope = document.getElementById('mk-pr-fields');
    const fields = {};
    scope.querySelectorAll('.mk-fld').forEach(i => { let v = i.value.trim(); if (/nombre/i.test(i.dataset.key)) { v = mkTitleCase(v); i.value = v; } fields[i.dataset.key] = v; });
    P.values = Object.assign({}, fields);
    const extraPrompt = (document.getElementById('mk-pr-extra')?.value || '').trim();
    P.extra = extraPrompt;
    // Prompt editado en el banco de pruebas (override; no se guarda salvo con "Guardar prompt").
    const promptTemplate = (document.getElementById('mk-pr-prompt')?.value || '');
    P.promptEdits[tplId] = promptTemplate;

    const box = document.getElementById('mk-pr-result');
    const btn = document.getElementById('mk-pr-gen');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generando…'; }
    const setBox = (msg) => { if (box) box.innerHTML = `<div class="mk-spin"></div><div class="mk-result-empty">${mkEsc(msg)}</div>`; };
    const setProgress = (pct) => { if (box) box.innerHTML = `<div class="mk-progress"><div class="mk-progress-bar"><div class="mk-progress-fill" style="width:${pct}%"></div></div><div class="mk-result-empty">Generando… ${pct}%</div></div>`; };

    try {
        setBox('Preparando diseño…');
        let secondImageUrl = '';
        if (P.refFile) {
            secondImageUrl = await mkUploadRefImage(P.refFile, 'ref-upload.png');
        } else {
            const tpl = mkGetTemplate(tplId);
            if (tpl && tpl.designSvg) { const { blob } = await mkRasterizeDesign(tpl.designSvg, fields); secondImageUrl = await mkUploadRefImage(blob, 'design.png'); }
        }

        setBox('Enviando a la IA…');
        const url = await mkRunGeneration({ templateId: tplId, provider, fields, extraPrompt, promptTemplate, orderId: null, blockId: 'prueba', secondImageUrl }, setProgress);
        P.resultUrl = url;
        if (box) box.innerHTML = mkPruebasResultHtml(url);
    } catch (e) {
        if (box) box.innerHTML = `<div class="mk-result-empty" style="color:#dc2626;">${mkEsc(e.message)}</div>`;
        mkToast('Error al generar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generar mockup'; }
    }
}

// ===================================================================
// LIENZO DE DISEÑO (pestaña Pruebas)
// -------------------------------------------------------------------
// Mini editor SVG de 864×1152 con fondo negro sólido: se agregan textos
// (fuente Rows of Sunflowers o Arial) y elementos (infinito/corazón o una
// imagen importada), se mueven arrastrando, y se exporta a PNG — para
// descargarlo o usarlo directo como 2ª referencia del mockup.
// Estado en mkState.lienzo (items: text | image | path); prefijo mkLz*.
// ===================================================================
const MK_LZ_W = 864, MK_LZ_H = 1152;
const MK_LZ_PRESETS = {
    // Infinito centrado en (0,0), ~540px de ancho a escala 1 (el trazo del SVG semilla).
    infinito: { d: 'M 0 0 C -70 -90 -230 -90 -270 0 C -230 90 -70 90 0 0 C 70 -90 230 -90 270 0 C 230 90 70 90 0 0 Z', scale: 1.3, strokeWidth: 8, x: 432, y: 500 },
    // Corazón (icono 24×24 con origen arriba-izquierda).
    corazon: { d: 'M12 21 C12 21 3 14.5 3 8.5 C3 5.4 5.4 3 8.5 3 C10.4 3 12 4.7 12 4.7 C12 4.7 13.6 3 15.5 3 C18.6 3 21 5.4 21 8.5 C21 14.5 12 21 12 21 Z', scale: 5, strokeWidth: 3, x: 372, y: 516 },
};

function mkLzState() {
    if (!mkState.lienzo) mkState.lienzo = { items: [], sel: null, selIds: [], seq: 1, designs: [], designId: null };
    if (!Array.isArray(mkState.lienzo.designs)) mkState.lienzo.designs = [];
    if (!Array.isArray(mkState.lienzo.selIds)) mkState.lienzo.selIds = mkState.lienzo.sel != null ? [mkState.lienzo.sel] : [];
    return mkState.lienzo;
}

// Selección MÚLTIPLE: selIds = todos los seleccionados; sel = el "primario" (el último,
// cuyos controles muestra la barra). Toda mutación de selección pasa por mkLzSetSel.
function mkLzSelIds() { return mkLzState().selIds; }

function mkLzSetSel(ids) {
    const st = mkLzState();
    st.selIds = ids || [];
    st.sel = st.selIds.length ? st.selIds[st.selIds.length - 1] : null;
}

// ---- historial del lienzo (Ctrl+Z / Ctrl+Y con el mouse sobre el lienzo) ----
// Cada operación (agregar, mover, escalar, editar, borrar, reordenar, cargar diseño)
// guarda un snapshot ANTES de mutar. Los cambios rápidos del mismo control (escribir en
// el input de texto, p. ej.) se fusionan en un solo paso vía "tag" + ventana de 1s.
const MK_LZ_HIST_MAX = 60;
let mkLzUndoStack = [], mkLzRedoStack = [], mkLzHistLastTag = null, mkLzHistLastAt = 0;

// Clon barato de items: los strings (href de imágenes, que pueden pesar MB) se comparten
// por referencia —son inmutables—; solo se clona la estructura (y points, el único anidado).
function mkLzCloneItems(items) {
    return items.map(it => {
        const c = Object.assign({}, it);
        if (Array.isArray(it.points)) c.points = it.points.map(p => ({ x: p.x, y: p.y }));
        return c;
    });
}

function mkLzSnapshot() {
    const st = mkLzState();
    return { items: mkLzCloneItems(st.items), seq: st.seq, selIds: mkLzSelIds().slice() };
}

function mkLzHistPushSnap(snap, tag, now) {
    mkLzHistLastTag = tag || null;
    mkLzHistLastAt = now || Date.now();
    mkLzUndoStack.push(snap);
    if (mkLzUndoStack.length > MK_LZ_HIST_MAX) mkLzUndoStack.shift();
    mkLzRedoStack.length = 0;   // una acción nueva invalida lo rehacible
}

// Captura el estado ACTUAL antes de una mutación. tag: operaciones consecutivas con el
// mismo tag en <1s no crean pasos nuevos (se conserva el estado previo al primer cambio).
function mkLzHistPush(tag) {
    const now = Date.now();
    if (tag && tag === mkLzHistLastTag && now - mkLzHistLastAt < 1000) { mkLzHistLastAt = now; return; }
    mkLzHistPushSnap(mkLzSnapshot(), tag, now);
}

function mkLzRestore(snap) {
    const st = mkLzState();
    st.items = mkLzCloneItems(snap.items);
    st.seq = snap.seq;
    mkLzSetSel((snap.selIds || []).filter(id => st.items.some(i => i.id === id)));
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers(); mkLzEnforceLimits();
}

function mkLzUndo() {
    if (!mkLzUndoStack.length) return;
    mkLzHistLastTag = null;   // rompe el coalescing: lo que siga crea paso nuevo
    mkLzRedoStack.push(mkLzSnapshot());
    mkLzRestore(mkLzUndoStack.pop());
}

function mkLzRedo() {
    if (!mkLzRedoStack.length) return;
    mkLzHistLastTag = null;
    mkLzUndoStack.push(mkLzSnapshot());
    mkLzRestore(mkLzRedoStack.pop());
}

// ¿El mouse está sobre la zona del lienzo? (gate de Ctrl+Z/Ctrl+Y: fuera de ella, los
// atajos se dejan pasar —p. ej. deshacer texto en el prompt—).
function mkLzHovering() {
    const el = document.querySelector('.mk-lz');
    try { return !!(el && el.matches(':hover')); } catch (_) { return false; }
}

function mkLzHtml() {
    return `
        <div class="mk-lz">
            <label class="mk-lz-label">Lienzo de diseño (864×1152, fondo negro) — arma el diseño y conviértelo a PNG</label>
            <div id="mk-lz-tools"></div>
            <div class="mk-lz-row">
                <div id="mk-lz-canvas-wrap"></div>
                <div class="mk-lz-layers">
                    <label class="mk-lz-label">Capas</label>
                    <div id="mk-lz-layers-list"></div>
                </div>
                <div class="mk-lz-side">
                    <button type="button" class="btn btn-primary btn-sm" onclick="mkLzUseAsRef(this)"><i class="fas fa-file-image mr-1"></i>Convertir a PNG → 2ª referencia</button>
                    <button type="button" class="btn btn-outline btn-sm" onclick="mkLzDownload(this)"><i class="fas fa-download mr-1"></i>Descargar PNG</button>
                    <small class="mk-muted">Clic = seleccionar (con <b>Shift</b> se agregan más), arrastra para mover, <b>cuadritos de las esquinas</b> para escalar y <b>rueda del mouse</b> para hacer zoom. <b>Doble clic</b> en un texto para editarlo, <b>Ctrl+D</b> duplica, <b>Supr</b> elimina y con el mouse sobre el lienzo <b>Ctrl+Z / Ctrl+Y</b> deshace y rehace. Las áreas de <b>Límite</b> (rojo, rectangulares o trazadas <b>a mano</b>) son contenedores: un texto colocado adentro se encoge solo lo necesario para caber; no salen en el PNG.</small>
                    <div class="mk-lz-save">
                        <label class="mk-lz-label">Diseños guardados</label>
                        <select id="mk-lz-designs" onchange="mkLzOnDesignPick(this.value)"><option value="">— nuevo diseño —</option></select>
                        <input type="text" id="mk-lz-name" placeholder="Nombre del diseño">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button type="button" class="btn btn-outline btn-sm" onclick="mkLzSaveDesign(this)"><i class="fas fa-save mr-1"></i>Guardar diseño</button>
                            <button type="button" class="btn btn-outline btn-sm" id="mk-lz-del-design" style="display:none;color:#dc2626;" title="Eliminar el diseño guardado" onclick="mkLzDeleteDesign()"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

// Crea el <svg> una sola vez (los re-render solo cambian su contenido interno, para no
// perder el pointer capture durante un arrastre) y pinta lienzo + herramientas + capas.
function mkLzMount() {
    const wrap = document.getElementById('mk-lz-canvas-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<svg id="mk-lz-svg" viewBox="0 0 ${MK_LZ_W} ${MK_LZ_H}" xmlns="http://www.w3.org/2000/svg" onpointerdown="mkLzDown(event)" onpointermove="mkLzMove(event)" onpointerup="mkLzUp(event)" onpointercancel="mkLzUp(event)" onwheel="mkLzWheel(event)" ondblclick="mkLzDblClick(event)"></svg>`;
    mkLzApplyView();   // restaura el zoom de la sesión (viewBox)
    mkLzRenderCanvas();
    mkLzRenderTools();
    mkLzRenderLayers();
    mkLzRenderDesignsSelect();
    mkLzLoadDesignsList();   // async: rellena el selector de diseños guardados
    mkLzBindKeys();          // Supr = eliminar, Ctrl+D = duplicar (una sola vez por sesión)
    // Cuando termina de cargar la fuente manuscrita, las medidas de tinta cambian:
    // re-ajustar los textos dentro de límites con las métricas reales.
    mkEnsureDesignFontLoaded().then(() => mkLzEnforceLimits());
}

// Markup de los items (compartido entre el lienzo en vivo y el SVG exportado).
// forExport=true omite las áreas de LÍMITE: son guías de edición, no salen en el PNG.
function mkLzItemsMarkup(forExport) { return mkLzItemsMarkupFrom(mkLzState().items, forExport); }
function mkLzItemsMarkupFrom(items, forExport) {
    return items.map(it => {
        if (it.type === 'limit') {
            if (forExport) return '';
            return `<rect data-lz="${it.id}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="rgba(220,38,38,0.12)" stroke="#dc2626" stroke-width="2" stroke-dasharray="10 6"></rect>`;
        }
        if (it.type === 'limitPath') {
            if (forExport) return '';
            const d = 'M ' + (it.points || []).map(p => p.x + ' ' + p.y).join(' L ') + ' Z';
            return `<g data-lz="${it.id}" transform="translate(${it.x},${it.y}) scale(${it.scale || 1})"><path d="${d}" fill="rgba(220,38,38,0.12)" stroke="#dc2626" stroke-width="2" stroke-dasharray="10 6"></path></g>`;
        }
        if (it.type === 'text') {
            const fam = it.font === 'arial' ? 'Arial, Helvetica, sans-serif' : "'Rows of Sunflowers'";
            const anchor = it.align === 'left' ? 'start' : (it.align === 'right' ? 'end' : 'middle');
            return `<text data-lz="${it.id}" x="${it.x}" y="${it.y}" fill="#ffffff" font-family="${fam}" font-size="${it.size}" text-anchor="${anchor}" dominant-baseline="central">${mkXmlEsc(it.text)}</text>`;
        }
        if (it.type === 'image') {
            return `<image data-lz="${it.id}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${it.href}" preserveAspectRatio="xMidYMid meet"></image>`;
        }
        // Elemento vectorial (infinito, corazón…)
        return `<g data-lz="${it.id}" transform="translate(${it.x},${it.y}) scale(${it.scale})"><path d="${it.d}" fill="none" stroke="#ffffff" stroke-width="${it.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path></g>`;
    }).join('');
}

function mkLzRenderCanvas() {
    const svg = document.getElementById('mk-lz-svg');
    if (!svg) return;
    const st = mkLzState();
    let inner = `<rect x="0" y="0" width="${MK_LZ_W}" height="${MK_LZ_H}" fill="#000000"></rect>`;
    if (!st.items.length) inner += `<text x="${MK_LZ_W / 2}" y="${MK_LZ_H / 2}" fill="#555" font-size="34" text-anchor="middle" style="pointer-events:none;">Lienzo vacío: agrega texto o elementos</text>`;
    inner += mkLzItemsMarkup();
    svg.innerHTML = inner;
    // Selección: contorno por elemento + UNA caja combinada con los cuadritos de escala
    // (con un solo seleccionado, la caja combinada ES su bbox: se ve igual que antes).
    const boxes = mkLzSelBoxes();
    if (boxes.length) {
        // k re-escala contorno/handles al zoom actual para que se vean SIEMPRE del mismo
        // tamaño en pantalla (con zoom, el viewBox encoge y 24 unidades serían enormes).
        const k = ((st.view && st.view.w) || MK_LZ_W) / MK_LZ_W;
        const pad = 6 * k, HS = 24 * k;
        let g = '';
        if (boxes.length > 1) {
            g += boxes.map(({ bb }) => `<rect x="${bb.x - 3 * k}" y="${bb.y - 3 * k}" width="${bb.w + 6 * k}" height="${bb.h + 6 * k}" fill="none" stroke="#4f8ff7" stroke-width="${2 * k}" stroke-dasharray="${5 * k} ${4 * k}" opacity="0.55" style="pointer-events:none;"></rect>`).join('');
        }
        const u = mkLzUnionBBox(boxes);
        const x0 = u.x - pad, y0 = u.y - pad, x1 = u.x + u.w + pad, y1 = u.y + u.h + pad;
        g += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#4f8ff7" stroke-width="${3 * k}" stroke-dasharray="${8 * k} ${5 * k}" style="pointer-events:none;"></rect>`;
        g += [['tl', x0, y0, 'nwse'], ['tr', x1, y0, 'nesw'], ['bl', x0, y1, 'nesw'], ['br', x1, y1, 'nwse']]
            .map(([hk, cx, cy, cur]) => `<rect data-lzh="${hk}" x="${cx - HS / 2}" y="${cy - HS / 2}" width="${HS}" height="${HS}" fill="#ffffff" stroke="#4f8ff7" stroke-width="${3 * k}" style="cursor:${cur}-resize;"></rect>`).join('');
        svg.insertAdjacentHTML('beforeend', `<g id="mk-lz-selgfx">${g}</g>`);
    }
}

// ---- zoom con la rueda (sobre el lienzo): arriba = acercar, abajo = alejar ----
// Zoom por viewBox anclado al cursor (el punto bajo el mouse no se mueve). Entre 1x
// (lienzo completo, default) y 8x; el viewBox se mantiene dentro del lienzo.
function mkLzApplyView() {
    const svg = document.getElementById('mk-lz-svg');
    if (!svg) return;
    const v = mkLzState().view || { x: 0, y: 0, w: MK_LZ_W, h: MK_LZ_H };
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

function mkLzWheel(ev) {
    ev.preventDefault();   // que la página no haga scroll mientras haces zoom
    const st = mkLzState();
    const v = st.view || { x: 0, y: 0, w: MK_LZ_W, h: MK_LZ_H };
    const p = mkLzPoint(ev);   // punto bajo el cursor, en coords del lienzo (ancla del zoom)
    const factor = ev.deltaY < 0 ? 1 / 1.15 : 1.15;
    const newW = Math.min(MK_LZ_W, Math.max(MK_LZ_W / 8, v.w * factor));
    const s = newW / v.w;
    if (s === 1) return;   // ya en el tope
    // Alto derivado del ancho (proporción fija del lienzo): evita la deriva de punto
    // flotante que dejaría el viewBox en 1151.999… tras muchos pasos de zoom.
    const newH = (newW * MK_LZ_H) / MK_LZ_W;
    let nx = p.x - (p.x - v.x) * s;
    let ny = p.y - (p.y - v.y) * s;
    nx = Math.min(Math.max(0, nx), MK_LZ_W - newW);
    ny = Math.min(Math.max(0, ny), MK_LZ_H - newH);
    st.view = { x: nx, y: ny, w: newW, h: newH };
    mkLzApplyView();
    mkLzRenderCanvas();   // re-escala contorno/handles al nuevo zoom
}

// Doble clic sobre un TEXTO: lo selecciona y manda el foco al campo de texto de la barra
// con el contenido seleccionado, listo para reescribirse.
function mkLzDblClick(ev) {
    const node = ev.target && ev.target.closest ? ev.target.closest('[data-lz]') : null;
    if (!node) return;
    const id = parseInt(node.getAttribute('data-lz'), 10);
    const it = mkLzState().items.find(i => i.id === id);
    if (!it || it.type !== 'text') return;
    ev.preventDefault();
    mkLzSetSel([id]);
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
    const inp = document.getElementById('mk-lz-text-inp');
    if (inp) { inp.focus(); inp.select(); }
}

// bboxes (en coords del lienzo) de los elementos seleccionados que ya están montados.
function mkLzSelBoxes() {
    const st = mkLzState();
    return mkLzSelIds()
        .map(id => { const it = st.items.find(i => i.id === id); return it ? { it, bb: mkLzCanvasBBox(it) } : null; })
        .filter(x => x && x.bb);
}

function mkLzUnionBBox(boxes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { bb } of boxes) {
        x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y);
        x1 = Math.max(x1, bb.x + bb.w); y1 = Math.max(y1, bb.y + bb.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Bounding box del item en coordenadas del LIENZO (los <g> de vectores llevan transform,
// así que su getBBox local se mapea con translate+scale).
function mkLzCanvasBBox(it) {
    // TEXTO: caja de TINTA real (lo que se ve). El getBBox del <text> incluye el espacio del
    // em (ascendentes/descendentes) y haría el recuadro de selección más grande que las letras.
    if (it.type === 'text') {
        const ink = mkLzInkBBox(it, it.size);
        if (!ink || ink.w < 4 || ink.h < 4) return { x: it.x - 20, y: it.y - 20, w: 40, h: 40 };   // texto vacío: caja mínima seleccionable
        return ink;
    }
    const svg = document.getElementById('mk-lz-svg');
    const node = svg && svg.querySelector(`[data-lz="${it.id}"]`);
    if (!node) return null;
    let b;
    try { b = node.getBBox(); } catch (_) { return null; }
    if (it.type === 'path' || it.type === 'limitPath') {
        const s = it.scale || 1;
        return { x: it.x + s * b.x, y: it.y + s * b.y, w: s * b.width, h: s * b.height };
    }
    return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function mkLzRenderTools() {
    const box = document.getElementById('mk-lz-tools');
    if (!box) return;
    const st = mkLzState();
    const ids = mkLzSelIds();
    const it = ids.length === 1 ? st.items.find(i => i.id === ids[0]) : null;
    let html = `
        <button type="button" class="btn btn-outline btn-sm" onclick="mkLzAddText()"><i class="fas fa-font mr-1"></i>Texto</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="mkLzAddPreset('infinito')"><i class="fas fa-infinity mr-1"></i>Infinito</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="mkLzAddPreset('corazon')"><i class="fas fa-heart mr-1"></i>Corazón</button>
        <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;"><i class="fas fa-image mr-1"></i>Importar imagen/SVG<input type="file" accept="image/*,.svg" style="display:none;" onchange="mkLzOnImport(event)"></label>
        <button type="button" class="btn btn-outline btn-sm" title="Área de límite (contenedor): un texto colocado adentro se encoge solo lo necesario para caber dentro de sus bordes. No sale en el PNG." onclick="mkLzAddLimit()"><i class="fas fa-vector-square mr-1"></i>Límite</button>
        <button type="button" class="btn btn-sm ${st.drawing ? 'btn-primary' : 'btn-outline'}" title="Límite a mano alzada: actívalo y traza el área directamente sobre el lienzo (Esc cancela)." onclick="mkLzToggleDrawLimit()"><i class="fas fa-pencil-alt mr-1"></i>A mano</button>`;
    if (ids.length > 1) {
        html += `<span class="mk-lz-sep"></span><span class="mk-muted" style="font-size:.8rem;">${ids.length} seleccionados</span>
            <button type="button" class="btn btn-outline btn-sm" title="Duplicar (Ctrl+D)" onclick="mkLzDuplicate()"><i class="fas fa-clone mr-1"></i>Duplicar</button>
            <button type="button" class="btn btn-outline btn-sm" style="color:#dc2626;" title="Eliminar (Supr)" onclick="mkLzDelete()"><i class="fas fa-trash mr-1"></i>Eliminar</button>`;
    } else if (it) {
        html += `<span class="mk-lz-sep"></span>`;
        if (it.type === 'text') {
            const alignBtn = (a, icon, title) => `<button type="button" class="btn btn-sm ${(it.align || 'center') === a ? 'btn-primary' : 'btn-outline'}" title="${title}" onclick="mkLzPatchT({align:'${a}'})"><i class="fas ${icon}"></i></button>`;
            html += `<input type="text" id="mk-lz-text-inp" value="${mkAttr(it.text)}" placeholder="Texto…" oninput="mkLzPatch({text:this.value})">
                <select onchange="mkLzPatch({font:this.value})"><option value="sun"${it.font !== 'arial' ? ' selected' : ''}>Rows of Sunflowers</option><option value="arial"${it.font === 'arial' ? ' selected' : ''}>Arial</option></select>
                <input type="number" id="mk-lz-size-inp" value="${it.size}" min="10" max="400" title="Tamaño de letra" oninput="mkLzPatch({size:Math.max(10,+this.value||10),baseSize:Math.max(10,+this.value||10)})">
                ${alignBtn('left', 'fa-align-left', 'Alinear a la izquierda (el punto de anclaje es el borde izquierdo)')}${alignBtn('center', 'fa-align-center', 'Centrado')}${alignBtn('right', 'fa-align-right', 'Alinear a la derecha')}`;
        } else if (it.type === 'image') {
            html += `<input type="number" value="${Math.round(it.w)}" min="20" max="${MK_LZ_W}" title="Ancho (px)" oninput="mkLzResizeImage(+this.value)">`;
        } else if (it.type === 'limit') {
            html += `<input type="number" value="${Math.round(it.w)}" min="20" max="${MK_LZ_W}" title="Ancho del área" oninput="mkLzPatch({w:Math.max(20,+this.value||20)})">
                <input type="number" value="${Math.round(it.h)}" min="20" max="${MK_LZ_H}" title="Alto del área" oninput="mkLzPatch({h:Math.max(20,+this.value||20)})">`;
        } else if (it.type === 'limitPath') {
            html += `<input type="number" value="${it.scale || 1}" min="0.2" max="20" step="0.2" title="Escala del área" oninput="mkLzPatch({scale:Math.max(0.2,+this.value||1)})">`;
        } else {
            html += `<input type="number" value="${it.scale}" min="0.2" max="20" step="0.2" title="Escala" oninput="mkLzPatch({scale:Math.max(0.2,+this.value||1)})">
                <input type="number" value="${it.strokeWidth}" min="1" max="30" title="Grosor del trazo" oninput="mkLzPatch({strokeWidth:Math.max(1,+this.value||1)})">`;
        }
        html += `<button type="button" class="btn btn-outline btn-sm" title="Duplicar (Ctrl+D)" onclick="mkLzDuplicate()"><i class="fas fa-clone mr-1"></i>Duplicar</button>
            <button type="button" class="btn btn-outline btn-sm" style="color:#dc2626;" title="Eliminar (Supr)" onclick="mkLzDelete()"><i class="fas fa-trash mr-1"></i>Eliminar</button>`;
    }
    box.innerHTML = html;
}

// Aplica un cambio al item seleccionado y repinta SOLO el lienzo (la barra no se
// re-renderiza para no perder el foco del input mientras escribes).
function mkLzPatch(patch) {
    const st = mkLzState();
    const it = st.items.find(i => i.id === st.sel);
    if (!it) return;
    mkLzHistPush('patch:' + st.sel);   // teclear seguido en el mismo control = un solo paso
    Object.assign(it, patch);
    mkLzRenderCanvas();
    mkLzEnforceLimits();   // un texto más largo o un área editada pueden requerir encoger
}

// Variante para controles con estado visual en la barra (ej. alineación): además de
// repintar el lienzo, re-renderiza la barra para reflejar el botón activo.
function mkLzPatchT(patch) {
    mkLzPatch(patch);
    mkLzRenderTools();
}

function mkLzResizeImage(w) {
    const st = mkLzState();
    const it = st.items.find(i => i.id === st.sel);
    if (!it || it.type !== 'image') return;
    mkLzHistPush('imgw:' + st.sel);
    w = Math.max(20, Math.min(MK_LZ_W, w || 20));
    it.w = w;
    it.h = Math.round(w * (it.ar || 1));
    mkLzRenderCanvas();
}

function mkLzAddText() {
    mkLzHistPush();
    const st = mkLzState();
    const id = st.seq++;
    // baseSize = tamaño DESEADO por el usuario; si el texto toca un área de límite, size
    // baja automáticamente pero baseSize se conserva para crecer de vuelta si cabe.
    st.items.push({ id, type: 'text', name: 'Texto', x: MK_LZ_W / 2, y: MK_LZ_H / 2, text: 'Texto', font: 'sun', size: 120, baseSize: 120, align: 'center' });
    mkLzSetSel([id]);
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers(); mkLzEnforceLimits();
}

// Área de LÍMITE (contenedor, rojo punteado): un texto cuyo anclaje cae adentro se encoge
// solo lo necesario para caber dentro de sus bordes. NO se exporta al PNG.
function mkLzAddLimit() {
    mkLzHistPush();
    const st = mkLzState();
    const id = st.seq++;
    st.items.push({ id, type: 'limit', name: 'Límite', x: 100, y: 100, w: 300, h: 200 });
    mkLzSetSel([id]);
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers(); mkLzEnforceLimits();
}

// ---- límite a MANO ALZADA: se activa el modo y se traza directo sobre el lienzo ----
let mkLzDrawPts = null;   // puntos del trazo en curso (null = no está trazando)

// Modo trazo en el SVG: cursor de cruz + clase que vuelve los objetos "transparentes" al
// mouse (pointer-events:none) para poder trazar el límite ENCIMA de un objeto sin que este
// lo capture ni muestre el cursor de mover.
function mkLzSetDrawMode(on) {
    const svg = document.getElementById('mk-lz-svg');
    if (!svg) return;
    svg.style.cursor = on ? 'crosshair' : '';
    svg.classList.toggle('mk-lz-drawing', !!on);
}

function mkLzToggleDrawLimit() {
    const st = mkLzState();
    st.drawing = !st.drawing;
    mkLzDrawPts = null;
    if (st.drawing) mkLzSetSel([]);
    mkLzSetDrawMode(st.drawing);
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
    if (st.drawing) mkToast('Traza el área de límite arrastrando sobre el lienzo, incluso encima de objetos (Esc cancela).', 'info');
}

function mkLzCancelDraw() {
    const st = mkLzState();
    st.drawing = false;
    mkLzDrawPts = null;
    mkLzSetDrawMode(false);
    mkLzRenderCanvas(); mkLzRenderTools();
}

// Vista previa del trazo en curso (path temporal actualizado directo, sin re-render).
function mkLzDrawPreview() {
    const svg = document.getElementById('mk-lz-svg');
    if (!svg || !mkLzDrawPts) return;
    const d = 'M ' + mkLzDrawPts.map(p => p.x + ' ' + p.y).join(' L ');
    const node = svg.querySelector('#mk-lz-drawpath');
    if (node) node.setAttribute('d', d);
    else svg.insertAdjacentHTML('beforeend', `<path id="mk-lz-drawpath" d="${d}" fill="none" stroke="#dc2626" stroke-width="2" stroke-dasharray="8 5" style="pointer-events:none;"></path>`);
}

// Cierra el trazo y lo convierte en un área de límite (polígono con origen en su esquina).
function mkLzFinishDraw() {
    const st = mkLzState();
    const pts = mkLzDrawPts || [];
    mkLzDrawPts = null;
    st.drawing = false;
    mkLzSetDrawMode(false);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    if (pts.length >= 3 && w > 30 && h > 30) {
        mkLzHistPush();
        const id = st.seq++;
        st.items.push({ id, type: 'limitPath', name: 'Límite a mano', x: Math.round(x0), y: Math.round(y0), scale: 1, points: pts.map(p => ({ x: Math.round(p.x - x0), y: Math.round(p.y - y0) })) });
        mkLzSetSel([id]);
    } else {
        mkToast('Trazo muy pequeño: arrastra para dibujar el área del límite.', 'error');
    }
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers(); mkLzEnforceLimits();
}

// Caja de TINTA real de un texto a un tamaño dado: lo realmente dibujado, medido con
// canvas.measureText (actualBoundingBox*). NO incluye el espacio tipográfico reservado
// para ascendentes/descendentes que el texto no usa (ej. el hueco de la "g" si no hay).
// Coordenadas alineadas con el <text> del lienzo (anclaje en it.x/it.y, baseline central).
let mkLzMeasureCtx = null;
function mkLzInkBBox(it, size) {
    if (!mkLzMeasureCtx) mkLzMeasureCtx = document.createElement('canvas').getContext('2d');
    const ctx = mkLzMeasureCtx;
    ctx.font = `${size}px ${it.font === 'arial' ? 'Arial, Helvetica, sans-serif' : "'Rows of Sunflowers'"}`;
    ctx.textAlign = it.align === 'left' ? 'left' : (it.align === 'right' ? 'right' : 'center');
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(it.text || '');
    const left = m.actualBoundingBoxLeft != null ? m.actualBoundingBoxLeft : m.width / 2;
    const right = m.actualBoundingBoxRight != null ? m.actualBoundingBoxRight : m.width / 2;
    const asc = m.actualBoundingBoxAscent != null ? m.actualBoundingBoxAscent : size * 0.7;
    const desc = m.actualBoundingBoxDescent != null ? m.actualBoundingBoxDescent : size * 0.2;
    // El SVG usa dominant-baseline:central -> la baseline CENTRAL queda en it.y. La baseline
    // ALFABÉTICA (donde se apoyan las letras, referencia de las medidas de tinta) está en
    // it.y + (ascent-descent)/2 según las métricas de la fuente. Sin este ajuste la caja
    // sale corrida hacia arriba (le sobra arriba y le falta abajo).
    const fA = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : size * 0.8;
    const fD = m.fontBoundingBoxDescent != null ? m.fontBoundingBoxDescent : size * 0.2;
    const alpha = it.y + (fA - fD) / 2;
    return { x: it.x - left, y: alpha - asc, w: left + right, h: asc + desc };
}

// Todas las áreas de límite como POLÍGONOS en coords del lienzo (el rect se convierte;
// el trazo a mano alzada ya lo es, mapeado con su translate+scale).
function mkLzLimitShapes() { return mkLzLimitShapesFrom(mkLzState().items); }
function mkLzLimitShapesFrom(items) {
    const shapes = [];
    for (const it of items) {
        if (it.type === 'limit') {
            shapes.push([{ x: it.x, y: it.y }, { x: it.x + it.w, y: it.y }, { x: it.x + it.w, y: it.y + it.h }, { x: it.x, y: it.y + it.h }]);
        } else if (it.type === 'limitPath' && Array.isArray(it.points) && it.points.length >= 3) {
            const s = it.scale || 1;
            shapes.push(it.points.map(p => ({ x: it.x + s * p.x, y: it.y + s * p.y })));
        }
    }
    return shapes;
}

// ¿El punto está dentro del polígono? (ray casting par/impar)
function mkLzPointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// Puntos del PERÍMETRO de la caja de tinta del texto (a escala f, crecida un margen M):
// esquinas + varios puntos por lado. Que TODOS caigan dentro del polígono ≈ la caja entera
// cabe. Funciona con cualquier forma (rectángulo o trazo a mano), no solo con rayos al centro.
function mkLzTextBoxPts(t, f, M) {
    const ink = mkLzInkBBox(t, t.baseSize);
    const extL = t.x - ink.x, extR = ink.x + ink.w - t.x, extT = t.y - ink.y, extB = ink.y + ink.h - t.y;
    const x0 = t.x - (extL * f + M), x1 = t.x + (extR * f + M);
    const y0 = t.y - (extT * f + M), y1 = t.y + (extB * f + M);
    const pts = [];
    const N = 6;   // muestreo por lado (los lados largos —arriba/abajo— son los que más se salen)
    for (let i = 0; i <= N; i++) { const x = x0 + (x1 - x0) * i / N; pts.push({ x, y: y0 }, { x, y: y1 }); }
    for (let i = 1; i < N; i++) { const y = y0 + (y1 - y0) * i / N; pts.push({ x: x0, y }, { x: x1, y }); }
    return pts;
}

// Los límites son CONTENEDORES: un texto cuyo anclaje cae dentro de un área de límite se
// encoge SOLO lo necesario para que su caja quepa dentro del contorno (con un margencito),
// midiendo la TINTA real del texto. Si cabe al tamaño deseado (baseSize), se queda tal cual;
// si el límite se agranda/quita o el texto sale, vuelve a crecer hasta baseSize.
const MK_LZ_LIMIT_MARGIN = 6;

// PURO: ajusta in-place el .size de los textos de `items` según los límites presentes en
// `items` (sin tocar el DOM ni el estado global). Sirve para rasterizar un diseño off-screen
// —p. ej. rellenar un diseño guardado con los datos de un pedido— igual que en el lienzo vivo.
function mkLzComputeSizes(items) {
    const shapes = mkLzLimitShapesFrom(items);
    for (const t of items) {
        if (t.type !== 'text') continue;
        if (t.baseSize == null) t.baseSize = t.size;
        let size = t.baseSize;
        if (shapes.length && (t.text || '').trim()) {
            const inShapes = shapes.filter(poly => mkLzPointInPoly({ x: t.x, y: t.y }, poly));
            if (inShapes.length) {
                const fits = (f) => mkLzTextBoxPts(t, f, MK_LZ_LIMIT_MARGIN).every(p => inShapes.every(poly => mkLzPointInPoly(p, poly)));
                let f = 1;
                if (!fits(1)) {   // no cabe a tamaño deseado -> mayor f in (0,1] que quepa (bisección)
                    let lo = 0, hi = 1;
                    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
                    f = lo;
                }
                size = Math.max(10, Math.floor(t.baseSize * f));
            }
        }
        t.size = size;
    }
    return items;
}

function mkLzEnforceLimits() {
    const st = mkLzState();
    const texts = st.items.filter(i => i.type === 'text');
    if (!texts.length) return;
    const before = texts.map(t => t.size);
    mkLzComputeSizes(st.items);
    const changed = texts.some((t, i) => t.size !== before[i]);
    if (changed) {
        mkLzRenderCanvas();   // re-dibuja con los tamaños finales (y el contorno correcto)
        const ids = mkLzSelIds();
        const it = ids.length === 1 ? st.items.find(i => i.id === ids[0]) : null;
        const inp = document.getElementById('mk-lz-size-inp');
        if (inp && it && it.type === 'text' && document.activeElement !== inp) inp.value = it.size;
    }
}

function mkLzAddPreset(kind) {
    const p = MK_LZ_PRESETS[kind];
    if (!p) return;
    mkLzHistPush();
    const st = mkLzState();
    const id = st.seq++;
    st.items.push({ id, type: 'path', name: kind === 'infinito' ? 'Infinito' : 'Corazón', x: p.x, y: p.y, scale: p.scale, strokeWidth: p.strokeWidth, d: p.d });
    st.sel = id;
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
}

function mkLzOnImport(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const isSvg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '');
    if (!isSvg && (!f.type || !f.type.startsWith('image/'))) { mkToast('Solo se aceptan imágenes (PNG/JPG/SVG…).', 'error'); return; }
    const reader = new FileReader();
    if (isSvg) {
        // SVG: se lee como TEXTO y se normaliza (viewBox + width/height explícitos); un SVG
        // sin tamaño intrínseco no se pinta dentro de <image> ni al rasterizar.
        reader.onload = e => {
            try { mkLzAddSvgItem(String(e.target.result)); }
            catch (err) { mkToast('SVG no válido: ' + err.message, 'error'); }
        };
        reader.readAsText(f);
        return;
    }
    reader.onload = e => {
        const href = e.target.result;   // data URI (queda embebida, exporta sin problemas)
        const im = new Image();
        im.onload = () => {
            const natW = im.naturalWidth || 400, natH = im.naturalHeight || 400;
            mkLzPushImage(href, natW, natH);
        };
        im.onerror = () => mkToast('No se pudo leer la imagen.', 'error');
        im.src = href;
    };
    reader.readAsDataURL(f);
}

// Agrega un SVG importado como item de imagen (data URI) con su aspecto real.
function mkLzAddSvgItem(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('no se pudo leer el archivo.');
    // Tamaño: primero el viewBox; si no hay, width/height (ignorando porcentajes).
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    let w = 0, h = 0;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
    if (!w || !h) {
        const aw = root.getAttribute('width') || '', ah = root.getAttribute('height') || '';
        if (!aw.includes('%') && !ah.includes('%')) { w = parseFloat(aw) || 0; h = parseFloat(ah) || 0; }
    }
    if (!w || !h) { w = 400; h = 400; }
    if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    root.setAttribute('width', w);    // tamaño intrínseco explícito: requisito para <image>
    root.setAttribute('height', h);
    const href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
    mkLzPushImage(href, w, h, 'SVG');
}

// Alta común de un item de imagen (raster o SVG), centrado y a lo sumo 500px de ancho.
function mkLzPushImage(href, natW, natH, name) {
    mkLzHistPush();
    const st = mkLzState();
    const w = Math.min(500, Math.round(natW));
    const ar = natH / natW;
    const h = Math.round(w * ar);
    const id = st.seq++;
    st.items.push({ id, type: 'image', name: name || 'Imagen', x: Math.round((MK_LZ_W - w) / 2), y: Math.round((MK_LZ_H - h) / 2), w, h, ar, href });
    st.sel = id;
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
}

function mkLzDelete() {
    const st = mkLzState();
    const ids = mkLzSelIds();
    if (!ids.length) return;
    mkLzHistPush();
    st.items = st.items.filter(i => !ids.includes(i.id));
    mkLzSetSel([]);
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
    mkLzEnforceLimits();   // si se borró un límite, los textos pueden volver a su tamaño
}

// Duplica TODO lo seleccionado (Ctrl+D o botón): clones desplazados +24,+24 que quedan
// como la nueva selección. Se conserva el caché remoteHref (mismo href => no re-subir).
function mkLzDuplicate() {
    const st = mkLzState();
    const ids = mkLzSelIds();
    if (!ids.length) return;
    mkLzHistPush();
    const clones = [];
    for (const id of ids) {
        const it = st.items.find(i => i.id === id);
        if (!it) continue;
        const c = JSON.parse(JSON.stringify(it));
        c.id = st.seq++;
        c.x = (c.x || 0) + 24;
        c.y = (c.y || 0) + 24;
        if (c.name) c.name = c.name + ' copia';
        st.items.push(c);
        clones.push(c.id);
    }
    mkLzSetSel(clones);
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
    mkLzEnforceLimits();
}

// Atajos de teclado del lienzo (solo en la pestaña Pruebas, con el lienzo montado y el
// foco FUERA de inputs: borrar mientras renombras una capa no debe borrar el elemento).
let mkLzKeysBound = false;
function mkLzBindKeys() {
    if (mkLzKeysBound) return;
    mkLzKeysBound = true;
    document.addEventListener('keydown', (e) => {
        if (mkState.tab !== 'pruebas' || !document.getElementById('mk-lz-svg')) return;
        const t = e.target;
        const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
        if (e.key === 'Escape' && mkLzState().drawing) { e.preventDefault(); mkLzCancelDraw(); return; }
        // Deshacer/rehacer SOLO con el mouse sobre el lienzo (no secuestra el Ctrl+Z de otras partes).
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            if (mkLzHovering()) { e.preventDefault(); mkLzUndo(); }
            return;
        }
        if ((e.ctrlKey || e.metaKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
            if (mkLzHovering()) { e.preventDefault(); mkLzRedo(); }
            return;
        }
        if (!mkLzSelIds().length) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); mkLzDelete(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); mkLzDuplicate(); }
    });
}

// ---- panel de capas (como Photoshop: la de más al frente arriba) ----
function mkLzRenderLayers() {
    const box = document.getElementById('mk-lz-layers-list');
    if (!box) return;
    const st = mkLzState();
    if (!st.items.length) { box.innerHTML = '<small class="mk-muted">Sin elementos todavía.</small>'; return; }
    // En SVG el último item del arreglo se pinta AL FRENTE -> se lista invertido (frente arriba).
    const selIds = mkLzSelIds();
    box.innerHTML = [...st.items].reverse().map(it => {
        const icon = it.type === 'text' ? 'fa-font' : (it.type === 'image' ? 'fa-image' : (it.type === 'limit' ? 'fa-vector-square' : (it.type === 'limitPath' ? 'fa-draw-polygon' : 'fa-bezier-curve')));
        return `
        <div class="mk-lz-layer${selIds.includes(it.id) ? ' active' : ''}" onclick="mkLzSelect(${it.id}, event)">
            <i class="fas ${icon}"></i>
            <input type="text" value="${mkAttr(it.name || '')}" placeholder="Sin nombre" title="Nombre de la capa" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" oninput="mkLzRename(${it.id}, this.value)">
            <button type="button" title="Traer al frente" onclick="event.stopPropagation();mkLzReorder(${it.id},1)"><i class="fas fa-chevron-up"></i></button>
            <button type="button" title="Enviar atrás" onclick="event.stopPropagation();mkLzReorder(${it.id},-1)"><i class="fas fa-chevron-down"></i></button>
        </div>`;
    }).join('');
}

// Clic en una capa: selecciona solo esa; con Shift, la agrega/quita del grupo.
function mkLzSelect(id, ev) {
    if (ev && ev.shiftKey) {
        const ids = mkLzSelIds().slice();
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1); else ids.push(id);
        mkLzSetSel(ids);
    } else {
        mkLzSetSel([id]);
    }
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
}

// Renombrar no repinta nada (el nombre solo vive en el panel; conserva el foco del input).
function mkLzRename(id, name) {
    const it = mkLzState().items.find(i => i.id === id);
    if (!it) return;
    mkLzHistPush('rename:' + id);
    it.name = name;
}

// dir 1 = hacia el frente (al final del arreglo), -1 = hacia atrás.
function mkLzReorder(id, dir) {
    const st = mkLzState();
    const i = st.items.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= st.items.length) return;
    mkLzHistPush();
    const [it] = st.items.splice(i, 1);
    st.items.splice(j, 0, it);
    mkLzRenderCanvas(); mkLzRenderLayers();
}

// ---- arrastre (pointer events; coordenadas convertidas al viewBox del SVG) ----
let mkLzDrag = null;

function mkLzPoint(ev) {
    const svg = document.getElementById('mk-lz-svg');
    const m = svg && svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
}

function mkLzMetric(it) { return it.type === 'text' ? it.size : (it.type === 'image' || it.type === 'limit' ? it.w : it.scale); }

function mkLzDown(ev) {
    const st = mkLzState();
    // 0) Modo "límite a mano alzada": el arrastre TRAZA el área (no selecciona ni mueve).
    if (st.drawing) {
        ev.preventDefault();
        const p = mkLzPoint(ev);
        mkLzDrawPts = [{ x: Math.round(p.x), y: Math.round(p.y) }];
        try { document.getElementById('mk-lz-svg').setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        return;
    }
    // 1) ¿Agarró un cuadrito de escala? (van primero: los handles no llevan data-lz y
    //    caerían en el "clic al vacío" que deselecciona). Escala TODO lo seleccionado.
    const handle = ev.target && ev.target.closest ? ev.target.closest('[data-lzh]') : null;
    if (handle && mkLzSelIds().length) {
        const boxes = mkLzSelBoxes();
        if (!boxes.length) return;
        ev.preventDefault();
        const u = mkLzUnionBBox(boxes);
        // Ancla = la esquina OPUESTA al handle (de la caja combinada): queda fija al escalar.
        const anchor = {
            tl: { x: u.x + u.w, y: u.y + u.h }, tr: { x: u.x, y: u.y + u.h },
            bl: { x: u.x + u.w, y: u.y }, br: { x: u.x, y: u.y },
        }[handle.getAttribute('data-lzh')];
        const p = mkLzPoint(ev);
        const d0 = Math.hypot(p.x - anchor.x, p.y - anchor.y) || 1;
        mkLzDrag = { resize: true, anchor, d0, items: boxes.map(({ it }) => ({ id: it.id, ox: it.x, oy: it.y, m0: mkLzMetric(it), ar: it.type === 'limit' ? (it.h / it.w) : undefined })), pre: mkLzSnapshot(), pushed: false };
        try { document.getElementById('mk-lz-svg').setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        return;
    }
    // 2) Clic sobre un elemento: Shift+clic agrega/quita de la selección; clic normal
    //    selecciona solo ese y arrastra TODO lo seleccionado. Al vacío -> deseleccionar.
    const node = ev.target && ev.target.closest ? ev.target.closest('[data-lz]') : null;
    if (!node) {
        if (mkLzSelIds().length) { mkLzSetSel([]); mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers(); }
        return;
    }
    ev.preventDefault();
    const id = parseInt(node.getAttribute('data-lz'), 10);
    if (ev.shiftKey) {
        const ids = mkLzSelIds().slice();
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1); else ids.push(id);
        mkLzSetSel(ids);
        mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
        return;   // shift+clic solo (de)selecciona; no inicia arrastre
    }
    let ids = mkLzSelIds();
    if (!ids.includes(id)) { mkLzSetSel([id]); ids = mkLzSelIds(); }
    else st.sel = id;   // ya estaba en el grupo: pasa a primario sin romper la selección
    const p = mkLzPoint(ev);
    mkLzDrag = { sx: p.x, sy: p.y, items: ids.map(x => { const it = st.items.find(i => i.id === x); return { id: x, ox: it.x, oy: it.y }; }), pre: mkLzSnapshot(), pushed: false };
    try { document.getElementById('mk-lz-svg').setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers();
}

function mkLzMove(ev) {
    // Trazo a mano alzada en curso: acumular puntos (mínimo 5 unidades entre ellos).
    if (mkLzDrawPts) {
        const p = mkLzPoint(ev);
        const last = mkLzDrawPts[mkLzDrawPts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 5) {
            mkLzDrawPts.push({ x: Math.round(p.x), y: Math.round(p.y) });
            mkLzDrawPreview();
        }
        return;
    }
    if (!mkLzDrag) return;
    // Primer movimiento REAL del gesto: empuja el estado previo al historial (un solo
    // paso por arrastre; un clic sin mover no ensucia el historial).
    if (!mkLzDrag.pushed) { mkLzHistPushSnap(mkLzDrag.pre); mkLzDrag.pushed = true; }
    const st = mkLzState();
    const p = mkLzPoint(ev);
    if (mkLzDrag.resize) {
        // Factor = distancia al ancla vs. la inicial (escala uniforme desde la esquina opuesta).
        let f = Math.hypot(p.x - mkLzDrag.anchor.x, p.y - mkLzDrag.anchor.y) / mkLzDrag.d0;
        f = Math.max(0.05, Math.min(20, f));
        const single = mkLzDrag.items.length === 1;
        for (const d of mkLzDrag.items) {
            const it = st.items.find(i => i.id === d.id);
            if (!it) continue;
            let fEff = f;   // con UN elemento, el tope de su métrica también fija el ancla exacta
            if (it.type === 'text') { it.size = Math.max(10, Math.round(d.m0 * f)); it.baseSize = it.size; if (single) fEff = it.size / d.m0; }
            else if (it.type === 'image') { it.w = Math.max(20, Math.round(d.m0 * f)); it.h = Math.round(it.w * (it.ar || 1)); if (single) fEff = it.w / d.m0; }
            else if (it.type === 'limit') { it.w = Math.max(20, Math.round(d.m0 * f)); it.h = Math.max(20, Math.round(d.m0 * f * (d.ar || 1))); if (single) fEff = it.w / d.m0; }
            else { it.scale = Math.max(0.1, +(d.m0 * f).toFixed(2)); if (single) fEff = it.scale / d.m0; }
            it.x = Math.round(mkLzDrag.anchor.x + (d.ox - mkLzDrag.anchor.x) * fEff);
            it.y = Math.round(mkLzDrag.anchor.y + (d.oy - mkLzDrag.anchor.y) * fEff);
        }
    } else {
        const dx = p.x - mkLzDrag.sx, dy = p.y - mkLzDrag.sy;
        for (const d of mkLzDrag.items) {
            const it = st.items.find(i => i.id === d.id);
            if (!it) continue;
            it.x = Math.round(d.ox + dx);
            it.y = Math.round(d.oy + dy);
        }
    }
    mkLzRenderCanvas();   // el SVG persiste (solo cambia su contenido), el pointer capture no se pierde
    mkLzEnforceLimits();  // en vivo: al arrastrar un texto dentro de un límite (o mover/escalar el límite)
}

function mkLzUp() {
    if (mkLzDrawPts) { mkLzFinishDraw(); return; }   // fin del trazo a mano alzada
    if (!mkLzDrag) return;
    const wasResize = mkLzDrag.resize;
    mkLzDrag = null;
    mkLzRenderCanvas();
    mkLzEnforceLimits();   // al soltar: ajusta los textos dentro de áreas de límite
    if (wasResize) mkLzRenderTools();   // sincroniza los inputs numéricos (tamaño/escala/ancho)
}

// ---- exportar: SVG independiente (fuente embebida) -> canvas 864×1152 -> PNG ----
async function mkLzRasterize() { return mkLzRasterizeItems(mkLzState().items); }
async function mkLzRasterizeItems(items) {
    const fontUrl = await mkFontDataUrl();
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MK_LZ_W} ${MK_LZ_H}" width="${MK_LZ_W}" height="${MK_LZ_H}"><defs><style>@font-face{font-family:'${MK_DESIGN_FONT_FAMILY}';src:url(${fontUrl}) format('truetype');}</style></defs><rect x="0" y="0" width="${MK_LZ_W}" height="${MK_LZ_H}" fill="#000000"></rect>${mkLzItemsMarkupFrom(items, true)}</svg>`;
    const img = new Image();
    img.decoding = 'async';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo renderizar el lienzo.')); }));
    const canvas = document.createElement('canvas');
    canvas.width = MK_LZ_W; canvas.height = MK_LZ_H;
    canvas.getContext('2d').drawImage(img, 0, 0, MK_LZ_W, MK_LZ_H);
    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('No se pudo exportar el lienzo a imagen.');
    return { blob, dataUrl };
}

// PNG del lienzo como 2ª referencia del banco de pruebas (misma ranura que "Subir imagen").
async function mkLzUseAsRef(btn) {
    if (!mkLzState().items.some(i => i.type !== 'limit' && i.type !== 'limitPath')) { mkToast('El lienzo está vacío: agrega texto o elementos primero (las áreas de límite no se exportan).', 'error'); return; }
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Convirtiendo…'; }
    try {
        const { blob } = await mkLzRasterize();
        const file = new File([blob], 'lienzo.png', { type: 'image/png' });
        if (mkPruebasSetRefFile(file)) mkToast('Lienzo convertido a PNG y listo como 2ª referencia ✅', 'success');
    } catch (e) {
        mkToast('No se pudo convertir: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

async function mkLzDownload(btn) {
    if (!mkLzState().items.some(i => i.type !== 'limit' && i.type !== 'limitPath')) { mkToast('El lienzo está vacío: agrega texto o elementos primero (las áreas de límite no se exportan).', 'error'); return; }
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Exportando…'; }
    try {
        const { dataUrl } = await mkLzRasterize();
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'diseno-864x1152.png';
        a.click();
    } catch (e) {
        mkToast('No se pudo exportar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

// ---- diseños guardados (Firestore vía /api/mockups/designs) ----
// Al GUARDAR, las imágenes pesadas (data URI) se suben a Storage y el doc guarda su URL
// (límite de 1MB por documento). Al CARGAR se rehidratan a data URI vía /fetch-image,
// porque un href http externo no se pinta al rasterizar el SVG.
const MK_LZ_INLINE_MAX = 80000;   // ~60KB binario: umbral para subir la imagen a Storage

async function mkLzSerializeItems() {
    const st = mkLzState();
    const items = [];
    for (const orig of st.items) {
        const it = { ...orig };
        delete it.remoteHref; delete it.remoteSrc;
        if (it.type === 'image' && typeof it.href === 'string' && it.href.startsWith('data:') && it.href.length > MK_LZ_INLINE_MAX) {
            if (orig.remoteHref && orig.remoteSrc === orig.href) {
                it.href = orig.remoteHref;   // ya subida antes y sin cambios: reusar
            } else {
                const blob = await (await fetch(orig.href)).blob();
                const url = await mkUploadRefImage(blob, 'design-asset.png');
                orig.remoteHref = url; orig.remoteSrc = orig.href;
                it.href = url;
            }
        }
        items.push(it);
    }
    return items;
}

async function mkLzHydrateItems(items) {
    const out = [];
    for (const raw of (items || [])) {
        const it = { ...raw };
        if (it.type === 'image' && typeof it.href === 'string' && !it.href.startsWith('data:')) {
            try {
                const r = await mkFetchJson('/api/mockups/fetch-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: it.href }) });
                it.remoteHref = it.href;
                it.href = 'data:' + (r.mimeType || 'image/webp') + ';base64,' + r.base64;
                it.remoteSrc = it.href;
            } catch (e) {
                // Se queda la URL: se VE en el lienzo pero no rasterizaría; avisar.
                mkToast('Una imagen del diseño no se pudo rehidratar; expórtala de nuevo antes de convertir a PNG.', 'error');
            }
        }
        out.push(it);
    }
    return out;
}

// Solo trae la lista (sin tocar el DOM); la usan Pruebas Y los bloques de Pendientes.
async function mkLzFetchDesigns() {
    try {
        const d = await mkFetchJson('/api/mockups/designs');
        mkLzState().designs = d.designs || [];
        mkState.lzHydrated = {};   // los diseños cambiaron: invalida el cache de hidratación
    } catch (_) { /* sin red o backend viejo: el lienzo sigue funcionando */ }
    return mkLzState().designs;
}

async function mkLzLoadDesignsList() {
    await mkLzFetchDesigns();
    mkLzRenderDesignsSelect();
}

function mkLzRenderDesignsSelect() {
    const sel = document.getElementById('mk-lz-designs');
    if (!sel) return;
    const st = mkLzState();
    sel.innerHTML = '<option value="">— nuevo diseño —</option>' + st.designs.map(d =>
        `<option value="${mkAttr(d.id)}"${d.id === st.designId ? ' selected' : ''}>${mkEsc(d.nombre)}</option>`
    ).join('');
    const del = document.getElementById('mk-lz-del-design');
    if (del) del.style.display = st.designId ? '' : 'none';
}

async function mkLzOnDesignPick(id) {
    const st = mkLzState();
    if (!id) {   // "— nuevo diseño —": desasocia sin tocar el lienzo actual
        st.designId = null;
        const name = document.getElementById('mk-lz-name'); if (name) name.value = '';
        mkLzRenderDesignsSelect();
        return;
    }
    const d = st.designs.find(x => x.id === id);
    if (!d) return;
    if (st.items.length && typeof showConfirmModal === 'function') {
        const ok = await showConfirmModal(`¿Cargar "${mkEsc(d.nombre)}" y reemplazar el lienzo actual?`, { icon: 'fa-folder-open', confirmText: 'Cargar' });
        if (!ok) { mkLzRenderDesignsSelect(); return; }
    }
    mkLzHistPush();   // cargar un diseño reemplaza el lienzo: se puede deshacer
    st.designId = id;
    mkLzSetSel([]);
    st.items = await mkLzHydrateItems(d.items);
    st.seq = st.items.reduce((m, i) => Math.max(m, +i.id || 0), 0) + 1;
    const name = document.getElementById('mk-lz-name'); if (name) name.value = d.nombre || '';
    mkLzRenderCanvas(); mkLzRenderTools(); mkLzRenderLayers(); mkLzRenderDesignsSelect();
    mkLzEnforceLimits();
    mkToast('Diseño cargado ✓', 'success');
}

async function mkLzSaveDesign(btn) {
    const st = mkLzState();
    const nombre = (document.getElementById('mk-lz-name')?.value || '').trim();
    if (!nombre) { mkToast('Ponle nombre al diseño.', 'error'); return; }
    if (!st.items.length) { mkToast('El lienzo está vacío.', 'error'); return; }
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Guardando…'; }
    try {
        const items = await mkLzSerializeItems();
        if (st.designId) {
            await mkFetchJson('/api/mockups/designs/' + st.designId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, items }) });
        } else {
            const r = await mkFetchJson('/api/mockups/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, items }) });
            st.designId = r.design && r.design.id;
        }
        await mkLzLoadDesignsList();
        mkToast('Diseño guardado ✅', 'success');
    } catch (e) {
        mkToast('No se pudo guardar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

async function mkLzDeleteDesign() {
    const st = mkLzState();
    if (!st.designId) return;
    const d = st.designs.find(x => x.id === st.designId);
    if (typeof showConfirmModal === 'function') {
        const ok = await showConfirmModal(`¿Eliminar el diseño guardado "${mkEsc(d ? d.nombre : '')}"?<br><span style="font-size:12px;color:var(--color-text-light,#64748b)">El lienzo actual no se toca.</span>`, { icon: 'delete', confirmText: 'Eliminar' });
        if (!ok) return;
    }
    try {
        await mkFetchJson('/api/mockups/designs/' + st.designId, { method: 'DELETE' });
        st.designId = null;
        const name = document.getElementById('mk-lz-name'); if (name) name.value = '';
        await mkLzLoadDesignsList();
        mkToast('Diseño eliminado.', 'success');
    } catch (e) {
        mkToast('No se pudo eliminar: ' + e.message, 'error');
    }
}

// ---------- plantillas (CRUD / UI) ----------
function mkRenderTemplates() {
    const cont = document.getElementById('mk-plantillas');
    if (!cont) return;
    if (mkState.editing !== null) { mkRenderTemplateForm(); return; }

    if (!mkState.templates.length) {
        cont.innerHTML = '<div class="settings-card"><p class="mk-muted">Sin plantillas todavía. Crea la primera con <b>Nueva plantilla</b>.</p></div>';
        return;
    }
    cont.innerHTML = mkState.templates.map(t => `
        <div class="settings-card mk-tpl-card">
            <img class="mk-tpl-thumb" src="${mkAttr(t.baseImageUrl || '')}" alt="" onerror="this.style.opacity=.3">
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <h3 class="font-bold">${mkEsc(t.nombre)} <span class="mk-muted" style="font-weight:400;">· ${mkEsc(t.aspectRatio || '1:1')}</span></h3>
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-outline btn-sm" onclick="mkEditTemplate('${mkAttr(t.id)}')"><i class="fas fa-pen"></i></button>
                        <button class="btn btn-outline btn-sm" onclick="mkDeleteTemplate('${mkAttr(t.id)}')" style="color:#dc2626;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <p class="mk-muted" style="margin:6px 0;white-space:pre-wrap;">${mkEsc((t.promptTemplate || '').slice(0, 220))}${(t.promptTemplate || '').length > 220 ? '…' : ''}</p>
                <div>${(t.productMatch || []).map(m => `<span class="mk-chip">${mkEsc(m)}</span>`).join('') || '<span class="mk-muted">Sin coincidencias de producto</span>'}</div>
            </div>
        </div>
    `).join('');
}

function mkNewTemplate() {
    // designSvg vacío por defecto: solo las lámparas de infinito/corazón llevan diseño de
    // referencia. El operador lo agrega con el botón "Usar ejemplo" (o pegando su propio SVG),
    // así una plantilla de nube u otra NO arrastra el diseño de infinito por accidente.
    mkState.editing = { id: null, nombre: '', baseImageUrl: '', baseImagePath: '', promptTemplate: MK_SEED_PROMPT, productMatch: [], aspectRatio: '1:1', designSvg: '' };
    mkState.newFile = null;
    mkSwitchTab('plantillas');
    mkRenderTemplateForm();
}

function mkEditTemplate(id) {
    const t = mkState.templates.find(x => x.id === id);
    if (!t) return;
    mkState.editing = JSON.parse(JSON.stringify(t));
    mkState.newFile = null;
    mkRenderTemplateForm();
}

function mkRenderTemplateForm() {
    const cont = document.getElementById('mk-plantillas');
    if (!cont) return;
    const t = mkState.editing;
    const ratios = ['1:1', '2:3', '3:4', '4:5', '9:16', '3:2', '4:3', '16:9'];
    cont.innerHTML = `
        <div class="settings-card">
            <h2 class="text-xl font-bold mb-3">${t.id ? 'Editar' : 'Nueva'} plantilla</h2>
            <div style="display:grid;grid-template-columns:160px 1fr;gap:18px;align-items:start;">
                <div>
                    <label class="text-xs font-semibold text-gray-500">Foto base</label>
                    <img id="mk-tpl-preview" class="mk-tpl-thumb" style="width:180px;height:180px;object-fit:cover;display:block;margin:6px 0;cursor:pointer;" ${t.baseImageUrl ? `src="${mkAttr(t.baseImageUrl)}"` : ''} onerror="this.removeAttribute('src')" onclick="document.getElementById('mk-tpl-file').click()" ondragover="event.preventDefault()" ondrop="mkOnTemplateDrop(event)" title="Clic para subir, o pega con Ctrl+V" alt="">
                    <label class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;">
                        <i class="fas fa-upload mr-2"></i>Subir foto
                        <input type="file" id="mk-tpl-file" accept="image/*" onchange="mkOnTemplateFile(event)" style="display:none;">
                    </label>
                    <p class="mk-muted" style="margin-top:4px;">Sube, arrastra o pega con <b>Ctrl+V</b>. Debe ser pública.</p>
                </div>
                <div>
                    <div style="display:grid;grid-template-columns:1fr 120px;gap:10px;">
                        <div><label class="text-xs font-semibold text-gray-500">Nombre de la plantilla</label><input type="text" id="mk-tpl-nombre" value="${mkAttr(t.nombre)}" placeholder="Infinito Corazones" class="!mb-0"></div>
                        <div><label class="text-xs font-semibold text-gray-500">Aspecto</label>
                            <select id="mk-tpl-aspect" class="!mb-0" onchange="mkUpdateAspectPreview()">${ratios.map(r => `<option value="${r}"${r === (t.aspectRatio || '1:1') ? ' selected' : ''}>${r}</option>`).join('')}</select>
                        </div>
                    </div>
                    <div style="margin-top:10px;"><label class="text-xs font-semibold text-gray-500">Prompt (usa {nombre1} {nombre2} {fecha} {personalizacion})</label>
                        <textarea id="mk-tpl-prompt" rows="6" class="!mb-0">${mkEsc(t.promptTemplate)}</textarea>
                    </div>
                    <div style="margin-top:10px;"><label class="text-xs font-semibold text-gray-500">Coincide con productos (separados por coma)</label>
                        <input type="text" id="mk-tpl-match" value="${mkAttr((t.productMatch || []).join(', '))}" placeholder="infinito, corazones, lampara 3d" class="!mb-0">
                    </div>
                    <div style="margin-top:12px;">
                        <label class="text-xs font-semibold text-gray-500">Diseño de referencia · SVG (opcional) — usa {nombre1} {nombre2} {fecha}</label>
                        <div style="display:grid;grid-template-columns:1fr 200px;gap:12px;align-items:start;">
                            <textarea id="mk-tpl-design" rows="6" class="!mb-0" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;" placeholder="Pega aquí el SVG del diseño (infinito, nombres, fecha, corazones)…" oninput="mkDesignFormPreview()">${mkEsc(t.designSvg || '')}</textarea>
                            <div style="text-align:center;">
                                <img id="mk-tpl-design-preview" style="width:100%;max-width:200px;border:1px solid var(--color-border);border-radius:8px;background:#000;display:block;min-height:70px;" alt="">
                                <button type="button" class="btn btn-outline btn-sm" style="margin-top:6px;" onclick="mkUseDesignSeed()"><i class="fas fa-infinity mr-1"></i>Usar ejemplo</button>
                            </div>
                        </div>
                        <p class="mk-muted" style="margin-top:4px;">Vista previa con nombres de muestra. Al generar, se rellena con los datos del pedido, se rasteriza a PNG y se manda como 2ª referencia.</p>
                    </div>
                    <div id="mk-tpl-error" class="text-sm mt-2" style="color:#dc2626;"></div>
                    <div style="display:flex;gap:8px;margin-top:14px;">
                        <button id="mk-tpl-save" class="btn btn-primary btn-sm" onclick="mkSaveTemplate()"><i class="fas fa-save mr-2"></i>Guardar</button>
                        <button class="btn btn-outline btn-sm" onclick="mkCancelTemplate()">Cancelar</button>
                    </div>
                </div>
            </div>
        </div>`;
    mkUpdateAspectPreview();
    mkDesignFormPreview();
}

// Vista previa (debounced) del diseño SVG del editor de plantillas, con nombres de muestra.
function mkDesignFormPreview() {
    const ta = document.getElementById('mk-tpl-design');
    const img = document.getElementById('mk-tpl-design-preview');
    if (!ta || !img) return;
    const svg = ta.value.trim();
    if (!svg) { img.removeAttribute('src'); return; }
    clearTimeout(mkDesignFormPreview._t);
    mkDesignFormPreview._t = setTimeout(async () => {
        try { img.src = await mkDesignDataUrl(svg, { nombre1: 'Brenda', nombre: 'Brenda', nombre2: 'Oscar', fecha: '18-10-2025' }); }
        catch (e) { /* SVG a medio escribir: no molestar */ }
    }, 400);
}

function mkUseDesignSeed() {
    const ta = document.getElementById('mk-tpl-design');
    if (ta) { ta.value = MK_DESIGN_SEED; mkDesignFormPreview(); }
}

// Ajusta la forma de la miniatura de la foto base al aspecto elegido (para previsualizar el encuadre).
function mkAspectDims(ratio, max) {
    max = max || 180;
    const m = String(ratio || '1:1').split(':').map(Number);
    const w = m[0] || 1, h = m[1] || 1;
    return (w >= h) ? { w: max, h: Math.round(max * h / w) } : { w: Math.round(max * w / h), h: max };
}

function mkUpdateAspectPreview() {
    const sel = document.getElementById('mk-tpl-aspect');
    const img = document.getElementById('mk-tpl-preview');
    if (!sel || !img) return;
    const d = mkAspectDims(sel.value, 180);
    img.style.width = d.w + 'px';
    img.style.height = d.h + 'px';
}

function mkOnTemplateFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (file) mkUseTemplateFile(file);
}

// Función compartida: recibe un File/Blob (de subir, arrastrar o pegar) y lo usa como foto base.
function mkUseTemplateFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) { mkToast('Solo se aceptan imágenes.', 'error'); return; }
    mkState.newFile = file;
    const reader = new FileReader();
    reader.onload = e => { const img = document.getElementById('mk-tpl-preview'); if (img) { img.src = e.target.result; img.style.opacity = 1; } };
    reader.readAsDataURL(file);
}

function mkOnTemplateDrop(ev) {
    ev.preventDefault();
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) mkUseTemplateFile(f);
}

// Pegar imagen con Ctrl+V (solo cuando el formulario de plantilla está abierto).
let mkPasteBound = false;
function mkBindPaste() {
    if (mkPasteBound) return;
    mkPasteBound = true;
    document.addEventListener('paste', (e) => {
        const items = (e.clipboardData && e.clipboardData.items) || [];
        let blob = null;
        for (const it of items) { if (it.type && it.type.startsWith('image/')) { blob = it.getAsFile(); if (blob) break; } }
        if (!blob) return;
        const ok = () => { e.preventDefault(); mkToast('Imagen pegada ✓', 'success'); };
        // 1) Editor de plantilla abierto -> foto base (comportamiento previo).
        if (document.getElementById('mk-tpl-file')) { mkUseTemplateFile(blob); ok(); return; }
        // 2) Pestaña Pruebas -> su 2ª referencia (panel único, sin ambigüedad).
        if (mkState.tab === 'pruebas' && document.getElementById('mk-pr-design')) { if (mkPruebasSetRefFile(blob)) ok(); return; }
        // 3) Bloque de preview marcado como destino (última zona de 2ª ref donde clicaste/soltaste).
        const tgt = mkState.refPasteTarget;
        if (tgt && tgt !== '__pruebas__') {
            const sel = '.mk-block[data-block="' + (window.CSS && CSS.escape ? CSS.escape(tgt) : tgt) + '"]';
            if (document.querySelector(sel)) { if (mkSetBlockRefFile(tgt, blob)) ok(); }
        }
    });
}

function mkCancelTemplate() {
    mkState.editing = null;
    mkState.newFile = null;
    mkRenderTemplates();
}

async function mkSaveTemplate() {
    const t = mkState.editing;
    const errEl = document.getElementById('mk-tpl-error');
    const setErr = m => { if (errEl) errEl.textContent = m; };
    setErr('');

    const nombre = document.getElementById('mk-tpl-nombre').value.trim();
    const promptTemplate = document.getElementById('mk-tpl-prompt').value.trim();
    const aspectRatio = document.getElementById('mk-tpl-aspect').value;
    const productMatch = document.getElementById('mk-tpl-match').value.split(',').map(s => s.trim()).filter(Boolean);
    const designSvg = (document.getElementById('mk-tpl-design')?.value || '').trim();
    if (!nombre) return setErr('Ponle un nombre a la plantilla.');
    if (!promptTemplate) return setErr('El prompt no puede estar vacío.');
    if (!t.id && !mkState.newFile) return setErr('Sube la foto base de la lámpara.');

    const btn = document.getElementById('mk-tpl-save');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando…'; }
    try {
        let baseImagePath = t.baseImagePath || null;
        let baseImageUrl = t.baseImageUrl || null;
        if (mkState.newFile) {
            const fd = new FormData();
            fd.append('foto', mkState.newFile);
            const up = await mkFetchJson('/api/mockups/templates/upload', { method: 'POST', body: fd });
            baseImagePath = up.baseImagePath;
            baseImageUrl = up.baseImageUrl;
        }
        const payload = { nombre, promptTemplate, aspectRatio, productMatch, baseImagePath, baseImageUrl, designSvg };
        if (t.id) await mkFetchJson('/api/mockups/templates/' + t.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        else await mkFetchJson('/api/mockups/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

        mkState.editing = null;
        mkState.newFile = null;
        await mkLoadTemplates();
        mkRenderTemplates();
        mkToast('Plantilla guardada ✅', 'success');
    } catch (e) {
        setErr(e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar'; }
    }
}

async function mkDeleteTemplate(id) {
    const ok = await showConfirmModal('¿Eliminar esta plantilla?', { icon: 'delete', confirmText: 'Eliminar' });
    if (!ok) return;
    try {
        await mkFetchJson('/api/mockups/templates/' + id, { method: 'DELETE' });
        await mkLoadTemplates();
        mkRenderTemplates();
    } catch (e) { mkToast('Error al eliminar: ' + e.message, 'error'); }
}
