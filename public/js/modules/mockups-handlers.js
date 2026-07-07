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

// results: URL de preview por blockId (en sesión). paymentSent/noticeSent: dedupe de
// envío por pedido (mandar /cuatro+/bbb o el aviso una sola vez aunque haya varias fotos).
const mkState = { tab: 'pendientes', pending: [], templates: [], results: {}, editing: null, newFile: null, paymentSent: {}, noticeSent: {} };

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

// Abre el modal de conversación del CRM (chat-handlers.js) para el cliente del pedido.
function mkOpenChat(orderId) {
    const o = mkState.pending.find(x => x.id === orderId);
    if (!o || !o.telefono) return;
    if (typeof openConversationPreview !== 'function') { mkToast('El chat no está disponible.', 'error'); return; }
    openConversationPreview({ stopPropagation() {} }, String(o.telefono), { id: String(o.telefono), name: o.clientName || '' });
}

// Quita un pedido de la lista de mockups (marca no destructiva; NO borra el pedido).
async function mkHideOrder(orderId) {
    if (!confirm('¿Quitar este pedido de la lista de Mockups? No se borra el pedido; solo deja de aparecer aquí.')) return;
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
        return `<div><label>${mkEsc(f.label)}</label><input class="mk-fld" data-key="${mkAttr(f.key)}" value="${mkAttr(v)}"></div>`;
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

    cont.innerHTML = mkState.pending.map(o => {
        const datos = (o.items || []).map(it => it.datosProducto).filter(Boolean).join('\n') || (o.items?.[0]?.producto || '');
        const producto = o.producto || (o.items?.[0]?.producto || '');
        const num = o.consecutiveOrderNumber ? ('DH' + o.consecutiveOrderNumber) : '—';
        o._prefill = mkPrefill(mkParseDatos(datos));   // valores sugeridos para el primer bloque
        // Bloques iniciales: uno por preview guardado, o uno vacío.
        const saved = Array.isArray(o.previews) ? o.previews : [];
        const blocks = saved.length
            ? saved.map(pv => ({ id: pv.blockId || mkNewBlockId(), templateId: pv.templateId, provider: 'wavespeed', values: mkMergeValues(o._prefill, pv.fields), previewUrl: pv.imageUrl }))
            : [{ id: mkNewBlockId(), templateId: mkAutoTemplate(producto), provider: 'wavespeed', values: o._prefill, previewUrl: '' }];
        return `
        <div class="settings-card mk-card" data-order="${mkAttr(o.id)}" data-phone="${mkAttr(o.telefono)}" data-client="${mkAttr(o.clientName)}">
            <div class="mk-card-head">
                <div>
                    <span class="mk-order-num" style="cursor:pointer;" title="Ver conversación del cliente" onclick="mkOpenChat('${mkAttr(o.id)}')">${mkEsc(num)} <i class="fas fa-comments" style="font-size:.75em;opacity:.6;"></i></span>
                    <span class="mk-client">${mkEsc(o.clientName || 'Sin nombre')}</span>
                    <span class="mk-phone"><i class="fab fa-whatsapp"></i> ${mkEsc(o.telefono || '')}</span>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <span class="mk-date">${mkEsc(mkFmtDate(o.createdAt))}${producto ? ' · ' + mkEsc(producto) : ''}</span>
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

// Al cambiar la plantilla de un bloque, re-render de sus campos (conservando lo escrito por clave).
function mkOnBlockTemplateChange(blockId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    const cur = {};
    block.querySelectorAll('.mk-fld').forEach(i => { cur[i.dataset.key] = i.value; });
    block.querySelector('.mk-fields').innerHTML = mkFieldsHtml(mkTemplateFieldDefs(block.querySelector('.mk-tpl').value), cur);
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

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generando…'; }
    const setBox = (msg) => { if (box) box.innerHTML = `<div class="mk-spin"></div><div class="mk-result-empty">${mkEsc(msg)}</div>`; };
    const setProgress = (pct) => { if (box) box.innerHTML = `<div class="mk-progress"><div class="mk-progress-bar"><div class="mk-progress-fill" style="width:${pct}%"></div></div><div class="mk-result-empty">Generando… ${pct}%</div></div>`; };
    setBox('Enviando a la IA…');

    try {
        const data = await mkFetchJson('/api/mockups/generate-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId, provider, fields, orderId, blockId }),
        });

        let url;
        if (data.image) url = data.image.fullUrl || data.image.thumbUrl;   // Gemini (síncrono)
        else if (data.jobId) url = await mkPollJob(data.jobId, setProgress); // WaveSpeed (asíncrono)
        if (!url) throw new Error('No se recibió la imagen generada.');

        mkState.results[blockId] = url;
        if (box) box.innerHTML = mkResultHtml(orderId, blockId, url);
    } catch (e) {
        if (box) box.innerHTML = `<div class="mk-result-empty" style="color:#dc2626;">${mkEsc(e.message)}</div>`;
        mkToast('Error al generar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generar preview'; }
    }
}

// Polling del preview asíncrono (WaveSpeed). Devuelve la URL o lanza error.
async function mkPollJob(jobId, setProgress) {
    const started = Date.now();
    const MAX_MS = 4 * 60 * 1000;   // hasta 4 min
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
    throw new Error('La generación tardó demasiado (más de 4 min). Intenta de nuevo.');
}

async function mkSend(orderId, blockId) {
    const block = document.querySelector(`.mk-block[data-block="${window.CSS && CSS.escape ? CSS.escape(blockId) : blockId}"]`);
    if (!block) return;
    const card = block.closest('.mk-card');
    const telefono = card && card.dataset.phone;
    const order = mkState.pending.find(o => o.id === orderId) || {};
    // Preview de ESTE bloque: generado en sesión o guardado (persistido).
    const imageUrl = mkState.results[blockId] || ((order.previews || []).find(p => p.blockId === blockId) || {}).imageUrl;
    if (!telefono) { mkToast('Este pedido no tiene teléfono.', 'error'); return; }
    if (!imageUrl) { mkToast('Genera el preview primero.', 'error'); return; }

    const btn = block.querySelector('.mk-send-btn');
    const setBtn = (html, disabled) => { if (btn) { btn.disabled = disabled; btn.innerHTML = html; } };
    setBtn('<i class="fas fa-spinner fa-spin mr-2"></i>Enviando…', true);

    try {
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

        // /cuatro (pago) + /bbb (tarjeta) SOLO una vez por pedido, aunque mandes varias fotos.
        if (!mkState.paymentSent[orderId]) {
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
                    <img id="mk-tpl-preview" class="mk-tpl-thumb" style="width:180px;height:180px;object-fit:cover;display:block;margin:6px 0;cursor:pointer;" ${t.baseImageUrl ? `src="${mkAttr(t.baseImageUrl)}"` : ''} onerror="this.removeAttribute('src')" onclick="document.getElementById('mk-tpl-file').click()" ondragover="event.preventDefault()" ondrop="mkOnTemplateDrop(event)" title="Clic para subir, o pega con Ctrl+V" alt="">
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
                            <select id="mk-tpl-aspect" class="!mb-0" onchange="mkUpdateAspectPreview()">${ratios.map(r => `<option value="${r}"${r === (t.aspectRatio || '1:1') ? ' selected' : ''}>${r}</option>`).join('')}</select>
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
    mkUpdateAspectPreview();
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
