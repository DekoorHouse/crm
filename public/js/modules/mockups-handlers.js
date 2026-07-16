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
const mkState = { tab: 'pendientes', pending: [], templates: [], results: {}, editing: null, newFile: null, paymentSent: {}, noticeSent: {}, refFiles: {}, refPasteTarget: null, pruebas: { provider: 'wavespeed', values: {}, resultUrl: '', refFile: null, promptEdits: {} } };

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
function mkExtractFecha(raw) {
    const labeled = raw.match(/fecha\s*:\s*([^|\n]+)/i);
    if (labeled) return labeled[1].trim().replace(/[\s|,]+$/, '').trim();
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
                    <span class="mk-order-num" style="cursor:pointer;" title="Ver conversación del cliente" onclick="mkOpenChat('${mkAttr(o.id)}')">${mkEsc(num)} <i class="fas fa-comments" style="font-size:.75em;opacity:.6;"></i></span>
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
                ${mkRef2Html(block.id, !!(mkGetTemplate(tplId) && mkGetTemplate(tplId).designSvg))}
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
        ref2.outerHTML = mkRef2Html(blockId, !!(mkGetTemplate(tplId) && mkGetTemplate(tplId).designSvg));
        mkRestoreRefThumb(blockId);   // conserva la miniatura de una imagen ya subida
    }
}

function mkResultHtml(orderId, blockId, imgUrl) {
    return `
        <img src="${mkAttr(imgUrl)}" alt="Preview">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            <button class="btn btn-primary btn-sm mk-send-btn" onclick="mkSend('${mkAttr(orderId)}','${mkAttr(blockId)}')"><i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp</button>
            <a class="btn btn-outline btn-sm" href="${mkAttr(imgUrl)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt mr-2"></i>Abrir</a>
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

// SVG final: rellena textos + embebe la fuente como @font-face + garantiza xmlns.
async function mkBuildDesignSvg(svg, fields) {
    let filled = mkFillDesignSvg(svg, fields).trim();
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

// Resuelve la 2ª referencia de un bloque: prioriza una imagen subida a mano; si no, el diseño
// de la plantilla (rasterizado con los campos actuales) cuando está activado. '' si no aplica.
async function mkResolveSecondRef(block, templateId, fields) {
    const blockId = block.dataset.block;
    const file = mkState.refFiles[blockId];
    if (file) return await mkUploadRefImage(file, 'ref-upload.png');
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
function mkRef2Html(blockId, hasDesign) {
    const b = mkAttr(blockId);
    const uploadLabel = hasDesign ? 'Subir otra' : 'Subir imagen';
    const uploadBtns = `
                    <div class="mk-ref2-btns">
                        ${hasDesign ? `<button type="button" class="btn btn-outline btn-sm" onclick="mkPreviewDesign('${b}')"><i class="fas fa-eye mr-1"></i>Ver diseño</button>` : ''}
                        <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;"><i class="fas fa-upload mr-1"></i>${uploadLabel}<input type="file" class="mk-ref-file" accept="image/*" style="display:none;" onchange="mkOnRefFile(event,'${b}')"></label>
                        <button type="button" class="btn btn-outline btn-sm" id="mk-ref-clear-${b}" style="display:none;" onclick="mkClearRef('${b}')"><i class="fas fa-times mr-1"></i>Quitar</button>
                    </div>`;
    const controls = hasDesign
        ? `<label class="mk-ref2-check"><input type="checkbox" class="mk-usedesign" checked> Usar el diseño de la plantilla</label>${uploadBtns}<small class="mk-muted">Se manda junto a la foto base para que la IA grabe ese diseño. Puedes subir, <b>arrastrar</b> o <b>pegar (Ctrl+V)</b> una imagen; si lo haces, se usa esa.</small>`
        : `${uploadBtns}<small class="mk-muted">Opcional: sube, <b>arrastra</b> o <b>pega (Ctrl+V)</b> una imagen para usarla como 2ª referencia (esta plantilla no tiene diseño).</small>`;
    return `
        <div class="mk-ref2" ondragover="event.preventDefault()" ondrop="mkOnRefDrop(event,'${b}')" onmousedown="mkSetRefPasteTarget('${b}')">
            <label>2ª referencia · diseño a grabar (opcional)</label>
            <div class="mk-ref2-row">
                <img class="mk-ref-thumb" id="mk-ref-thumb-${b}" alt="" style="display:none;">
                <div class="mk-ref2-controls">${controls}
                </div>
            </div>
        </div>`;
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
    </div>`;
    // Si había una imagen subida como 2ª referencia, restaura su miniatura + botón "Quitar" tras
    // el re-render (si no, el archivo quedaría activo sin verse y anularía el diseño en silencio).
    if (P.refFile) {
        const clr = document.getElementById('mk-pr-clear'); if (clr) clr.style.display = '';
        const reader = new FileReader();
        reader.onload = e => { const img = document.getElementById('mk-pr-design'); if (img) { img.src = e.target.result; img.style.display = ''; } };
        reader.readAsDataURL(P.refFile);
    }
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
    return `
        <img src="${mkAttr(url)}" alt="Mockup">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            <a class="btn btn-outline btn-sm" href="${mkAttr(url)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt mr-2"></i>Abrir</a>
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
