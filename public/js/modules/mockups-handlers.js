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

const mkState = { tab: 'pendientes', pending: [], templates: [], results: {}, editing: null, newFile: null };

// ---------- utilidades ----------
function mkEsc(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
function mkAttr(s) { return mkEsc(s).replace(/"/g, '&quot;'); }

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
        throw new Error(data.error || ('Error ' + res.status));
    }
    return data;
}

function mkFmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (_) { return ''; }
}

// Heurística: intenta separar nombre1/nombre2/fecha del texto libre del pedido.
// Los campos quedan EDITABLES, así que basta con acercar; el operador confirma.
function mkParseDatos(text) {
    const raw = (text || '').trim();
    let fecha = '';
    const dm = raw.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);
    if (dm) fecha = dm[1];
    let rest = raw.replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/, ' ');
    rest = rest.replace(/nombres?\s*:/ig, ' ').replace(/fecha\s*:/ig, ' ').replace(/para\s*:/ig, ' ');
    // Quita separadores sueltos de los bordes (barra "|", comas, &, +) para que
    // NO terminen grabados en la lámpara (ej: "Sheyla |" -> "Sheyla").
    const clean = s => s.replace(/^[\s|,&+]+|[\s|,&+]+$/g, '').trim();
    const parts = rest
        .split(/\s+y\s+|\s*&\s*|\s*\+\s*|\s*\|\s*|,|\n|\s+and\s+/i)
        .map(clean)
        .filter(Boolean);
    return { nombre1: parts[0] || '', nombre2: parts[1] || '', fecha: clean(fecha), personalizacion: raw };
}

// ---------- init / tabs ----------
async function initializeMockupsHandlers() {
    mkState.tab = 'pendientes';
    mkState.editing = null;
    mkBindPaste();
    // Cargar plantillas ANTES que pendientes: la lista de pendientes las necesita
    // (selector de plantilla + mensaje de "crea la primera").
    try { await mkLoadTemplates(); } catch (e) { mkToast(e.message, 'error'); }
    try { await mkLoadPending(); } catch (e) { mkToast(e.message, 'error'); }
}

function mkSwitchTab(tab) {
    mkState.tab = tab;
    document.querySelectorAll('[data-mktab]').forEach(b => b.classList.toggle('active', b.dataset.mktab === tab));
    const p1 = document.getElementById('mk-pane-pendientes');
    const p2 = document.getElementById('mk-pane-plantillas');
    if (p1) p1.style.display = tab === 'pendientes' ? '' : 'none';
    if (p2) p2.style.display = tab === 'plantillas' ? '' : 'none';
    if (tab === 'plantillas') mkRenderTemplates();
}

async function mkReload() {
    try { await mkLoadTemplates(); } catch (e) { mkToast(e.message, 'error'); }
    try { await mkLoadPending(); } catch (e) { mkToast(e.message, 'error'); }
}

// ---------- plantillas (carga) ----------
async function mkLoadTemplates() {
    const data = await mkFetchJson('/api/mockups/templates');
    mkState.templates = data.templates || [];
    if (mkState.tab === 'plantillas') mkRenderTemplates();
}

function mkTemplateOptions(producto) {
    const prod = (producto || '').toLowerCase();
    // Auto-selecciona la plantilla cuya productMatch coincida con el producto del pedido.
    let selected = null;
    for (const t of mkState.templates) {
        if ((t.productMatch || []).some(m => m && prod.includes(String(m).toLowerCase()))) { selected = t.id; break; }
    }
    if (!selected && mkState.templates.length) selected = mkState.templates[0].id;
    return mkState.templates.map(t =>
        `<option value="${mkAttr(t.id)}"${t.id === selected ? ' selected' : ''}>${mkEsc(t.nombre)}</option>`
    ).join('');
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

    if (!mkState.templates.length) {
        cont.innerHTML = '<div class="settings-card"><p class="mk-muted">Aún no tienes plantillas de lámpara. Ve a la pestaña <b>Plantillas</b> y crea la primera (sube la foto base y define el prompt).</p></div>';
        return;
    }
    if (!mkState.pending.length) {
        cont.innerHTML = '<div class="settings-card"><p class="mk-muted">No hay pedidos <b>Sin estatus</b> pendientes de preview. 🎉</p></div>';
        return;
    }

    cont.innerHTML = mkState.pending.map(o => {
        const datos = (o.items || []).map(it => it.datosProducto).filter(Boolean).join('\n') || (o.items?.[0]?.producto || '');
        const p = mkParseDatos(datos);
        const producto = o.producto || (o.items?.[0]?.producto || '');
        const num = o.consecutiveOrderNumber ? ('DH' + o.consecutiveOrderNumber) : '—';
        const saved = mkState.results[o.id] || o.previewUrl;
        return `
        <div class="settings-card mk-card" data-order="${mkAttr(o.id)}" data-phone="${mkAttr(o.telefono)}" data-client="${mkAttr(o.clientName)}">
            <div class="mk-card-head">
                <div>
                    <span class="mk-order-num">${mkEsc(num)}</span>
                    <span class="mk-client">${mkEsc(o.clientName || 'Sin nombre')}</span>
                    <span class="mk-phone"><i class="fab fa-whatsapp"></i> ${mkEsc(o.telefono || '')}</span>
                </div>
                <span class="mk-date">${mkEsc(mkFmtDate(o.createdAt))}${producto ? ' · ' + mkEsc(producto) : ''}</span>
            </div>
            <div class="mk-card-body">
                <div>
                    <div class="mk-raw">
                        <label>Detalles del pedido</label>
                        <textarea class="mk-datos" readonly>${mkEsc(datos)}</textarea>
                    </div>
                    <div class="mk-inputs">
                        <div><label>Nombre 1</label><input class="mk-n1" value="${mkAttr(p.nombre1)}"></div>
                        <div><label>Nombre 2</label><input class="mk-n2" value="${mkAttr(p.nombre2)}"></div>
                        <div><label>Fecha</label><input class="mk-fecha" value="${mkAttr(p.fecha)}"></div>
                        <div><label>Plantilla</label><select class="mk-tpl">${mkTemplateOptions(producto)}</select></div>
                        <div class="mk-full"><label>Modelo</label>
                            <select class="mk-provider">
                                <option value="wavespeed" selected>GPT Image 2 (WaveSpeed)</option>
                                <option value="gemini">Nano Banana (Gemini)</option>
                            </select>
                        </div>
                    </div>
                    <div style="margin-top:12px;">
                        <button class="btn btn-primary btn-sm mk-gen-btn" onclick="mkGenerate('${mkAttr(o.id)}')">
                            <i class="fas fa-wand-magic-sparkles mr-2"></i>Generar preview
                        </button>
                    </div>
                </div>
                <div class="mk-result" id="mk-result-${mkAttr(o.id)}">
                    ${saved ? mkResultHtml(o, saved) : '<div class="mk-result-empty">El preview aparecerá aquí</div>'}
                </div>
            </div>
        </div>`;
    }).join('');
}

function mkResultHtml(order, imgUrl) {
    const first = (order.clientName || '').trim().split(/\s+/)[0] || '';
    const caption = `¡Hola${first ? ' ' + first : ''}! 😍 Te comparto un preview de cómo quedaría tu lámpara. ¿La aprobamos así?`;
    return `
        <img src="${mkAttr(imgUrl)}" alt="Preview">
        <input class="mk-caption" style="width:100%" value="${mkAttr(caption)}">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            <button class="btn btn-primary btn-sm mk-send-btn" onclick="mkSend('${mkAttr(order.id)}')"><i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp</button>
            <a class="btn btn-outline btn-sm" href="${mkAttr(imgUrl)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt mr-2"></i>Abrir</a>
            <button class="btn btn-secondary btn-sm" onclick="mkGenerate('${mkAttr(order.id)}')"><i class="fas fa-redo mr-2"></i>Regenerar</button>
        </div>`;
}

async function mkGenerate(orderId) {
    const card = document.querySelector(`.mk-card[data-order="${window.CSS && CSS.escape ? CSS.escape(orderId) : orderId}"]`);
    if (!card) return;
    const box = document.getElementById('mk-result-' + orderId);
    const btn = card.querySelector('.mk-gen-btn');
    const fields = {
        nombre1: card.querySelector('.mk-n1').value.trim(),
        nombre2: card.querySelector('.mk-n2').value.trim(),
        fecha: card.querySelector('.mk-fecha').value.trim(),
        personalizacion: card.querySelector('.mk-datos').value.trim(),
    };
    const templateId = card.querySelector('.mk-tpl').value;
    const provider = card.querySelector('.mk-provider').value;
    if (!templateId) { mkToast('Selecciona una plantilla.', 'error'); return; }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generando…'; }
    const setBox = (msg) => { if (box) box.innerHTML = `<div class="mk-spin"></div><div class="mk-result-empty">${mkEsc(msg)}</div>`; };
    setBox('Enviando a la IA…');

    try {
        const data = await mkFetchJson('/api/mockups/generate-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId, provider, fields, orderId }),
        });

        let url;
        if (data.image) {
            url = data.image.fullUrl || data.image.thumbUrl;           // Gemini (síncrono)
        } else if (data.jobId) {
            url = await mkPollJob(data.jobId, setBox);                 // WaveSpeed (asíncrono)
        }
        if (!url) throw new Error('No se recibió la imagen generada.');

        mkState.results[orderId] = url;
        const order = mkState.pending.find(o => o.id === orderId) || { id: orderId };
        order.previewUrl = url;
        if (box) box.innerHTML = mkResultHtml(order, url);
    } catch (e) {
        if (box) box.innerHTML = `<div class="mk-result-empty" style="color:#dc2626;">${mkEsc(e.message)}</div>`;
        mkToast('Error al generar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generar preview'; }
    }
}

// Polling del preview asíncrono (WaveSpeed). Devuelve la URL o lanza error.
async function mkPollJob(jobId, setBox) {
    const started = Date.now();
    const MAX_MS = 4 * 60 * 1000;   // hasta 4 min (GPT Image 2 puede tardar)
    const INTERVAL = 3000;
    while (Date.now() - started < MAX_MS) {
        await new Promise(r => setTimeout(r, INTERVAL));
        const secs = Math.round((Date.now() - started) / 1000);
        let st;
        try {
            st = await mkFetchJson('/api/mockups/generate-status/' + encodeURIComponent(jobId));
        } catch (e) {
            setBox('Generando… (' + secs + 's)');   // un fallo puntual no aborta
            continue;
        }
        if (st.status === 'completed') return st.image && (st.image.fullUrl || st.image.thumbUrl);
        if (st.status === 'failed') throw new Error(st.error || 'La generación falló.');
        setBox('Generando… (' + secs + 's)');
    }
    throw new Error('La generación tardó demasiado (más de 4 min). Intenta de nuevo.');
}

async function mkSend(orderId) {
    const card = document.querySelector(`.mk-card[data-order="${window.CSS && CSS.escape ? CSS.escape(orderId) : orderId}"]`);
    if (!card) return;
    const telefono = card.dataset.phone;
    const imageUrl = mkState.results[orderId];
    const caption = (card.querySelector('.mk-caption')?.value || '').trim();
    if (!telefono) { mkToast('Este pedido no tiene teléfono.', 'error'); return; }
    if (!imageUrl) { mkToast('Genera el preview primero.', 'error'); return; }

    const btn = card.querySelector('.mk-send-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Enviando…'; }
    try {
        await mkFetchJson('/api/mockups/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telefono, imageUrl, caption }),
        });
        mkToast('Preview enviado por WhatsApp ✅', 'success');
        if (btn) { btn.innerHTML = '<i class="fas fa-check mr-2"></i>Enviado'; }
    } catch (e) {
        mkToast('Error al enviar: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp'; }
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
    mkState.editing = { id: null, nombre: '', baseImageUrl: '', baseImagePath: '', promptTemplate: MK_SEED_PROMPT, productMatch: [], aspectRatio: '1:1' };
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
                    <img id="mk-tpl-preview" class="mk-tpl-thumb" style="width:150px;height:150px;object-fit:cover;display:block;margin:6px 0;cursor:pointer;" ${t.baseImageUrl ? `src="${mkAttr(t.baseImageUrl)}"` : ''} onerror="this.removeAttribute('src')" onclick="document.getElementById('mk-tpl-file').click()" ondragover="event.preventDefault()" ondrop="mkOnTemplateDrop(event)" title="Clic para subir, o pega con Ctrl+V" alt="">
                    <label class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;">
                        <i class="fas fa-upload mr-2"></i>Subir foto
                        <input type="file" id="mk-tpl-file" accept="image/*" onchange="mkOnTemplateFile(event)" style="display:none;">
                    </label>
                    <p class="mk-muted" style="margin-top:4px;">Sube, arrastra o pega con <b>Ctrl+V</b>. Debe ser pública.</p>
                </div>
                <div>
                    <div style="display:grid;grid-template-columns:1fr 120px;gap:10px;">
                        <div><label class="text-xs font-semibold text-gray-500">Nombre de la plantilla</label><input id="mk-tpl-nombre" value="${mkAttr(t.nombre)}" placeholder="Infinito Corazones" class="!mb-0"></div>
                        <div><label class="text-xs font-semibold text-gray-500">Aspecto</label>
                            <select id="mk-tpl-aspect" class="!mb-0">${ratios.map(r => `<option value="${r}"${r === (t.aspectRatio || '1:1') ? ' selected' : ''}>${r}</option>`).join('')}</select>
                        </div>
                    </div>
                    <div style="margin-top:10px;"><label class="text-xs font-semibold text-gray-500">Prompt (usa {nombre1} {nombre2} {fecha} {personalizacion})</label>
                        <textarea id="mk-tpl-prompt" rows="6" class="!mb-0">${mkEsc(t.promptTemplate)}</textarea>
                    </div>
                    <div style="margin-top:10px;"><label class="text-xs font-semibold text-gray-500">Coincide con productos (separados por coma)</label>
                        <input id="mk-tpl-match" value="${mkAttr((t.productMatch || []).join(', '))}" placeholder="infinito, corazones, lampara 3d" class="!mb-0">
                    </div>
                    <div id="mk-tpl-error" class="text-sm mt-2" style="color:#dc2626;"></div>
                    <div style="display:flex;gap:8px;margin-top:14px;">
                        <button id="mk-tpl-save" class="btn btn-primary btn-sm" onclick="mkSaveTemplate()"><i class="fas fa-save mr-2"></i>Guardar</button>
                        <button class="btn btn-outline btn-sm" onclick="mkCancelTemplate()">Cancelar</button>
                    </div>
                </div>
            </div>
        </div>`;
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
        if (!document.getElementById('mk-tpl-file')) return; // form de plantilla no abierto
        const items = (e.clipboardData && e.clipboardData.items) || [];
        for (const it of items) {
            if (it.type && it.type.startsWith('image/')) {
                const blob = it.getAsFile();
                if (blob) { mkUseTemplateFile(blob); e.preventDefault(); mkToast('Imagen pegada ✓', 'success'); break; }
            }
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
        const payload = { nombre, promptTemplate, aspectRatio, productMatch, baseImagePath, baseImageUrl };
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
    if (!confirm('¿Eliminar esta plantilla?')) return;
    try {
        await mkFetchJson('/api/mockups/templates/' + id, { method: 'DELETE' });
        await mkLoadTemplates();
        mkRenderTemplates();
    } catch (e) { mkToast('Error al eliminar: ' + e.message, 'error'); }
}
