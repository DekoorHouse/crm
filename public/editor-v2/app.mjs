import { History, blankDocument, createObject, clone, validateDocument, objectMarkup, exportSvg, makePowerClip, placeInPowerClip, extractPowerClip, objectsWithContents, fitPowerClip } from './model.mjs';
import { icon, decorateControls } from './icons.mjs';
import { RESIZE_HANDLES, resizeBounds, objectReference, fullyContained, snapTranslation, powerClipDropTarget } from './geometry.mjs';
import { HAIRLINE_WIDTH } from './model.mjs';
import { powerClipEditDocument, mergePowerClipEdits } from './model.mjs';
import { connect, cloudError } from './cloud.mjs';
import { normalizeSpline, pointsPath, splinePath } from './spline.mjs';

decorateControls();

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), scene = $('#scene'), objects = $('#objects'), selection = $('#selection');
const storageKey = 'dekoor.editor-v2.document.v1';
let history = new History(), selectedId = null, tool = 'select', gesture = null;
let selectedIds = new Set();
let powerClipSources = null;
let powerClipEditing = null;
const savedDocument = () => powerClipEditing ? mergePowerClipEdits(powerClipEditing.history.document, powerClipEditing.id, history.document) : history.document;
function setSelection(ids) { selectedIds = new Set(ids); selectedId = [...selectedIds].at(-1) || null; }
const selectOnly = id => setSelection(id ? [id] : []);
const selectedObjects = () => current().objects.filter(object => selectedIds.has(object.id));
let view = { x: 0, y: 0, scale: 2 }, draft = null;
let storageBlocked = false;
let cloudBinding = null, cloudSavedJson = null, cloudBusy = false, pendingSave = false;
let cloudApi = null;
let nextFill = '#b9a3ed';
let nextStroke = '#352a49';
let paletteTarget = 'fill';
let splineDraft = null, splinePointer = null;
let displayUnit = 'mm';
try { displayUnit = localStorage.getItem('dekoor.editor-v2.unit') === 'in' ? 'in' : 'mm'; } catch {}
const unitFactor = () => displayUnit === 'in' ? 25.4 : 1;
const displayMeasure = value => Number((value / unitFactor()).toFixed(displayUnit === 'in' ? 6 : 2));
const pagePresets = {
    tabloid: { width: 279.4, height: 431.8, unit: 'in' },
    letter: { width: 215.9, height: 279.4, unit: 'in' },
    '12x18': { width: 304.8, height: 457.2, unit: 'in' },
    a4: { width: 210, height: 297, unit: 'mm' },
};
const current = () => draft || history.document;
const selected = () => current().objects.find(o => o.id === selectedId);
const status = message => { $('#status').textContent = message; };

try {
    const saved = localStorage.getItem(storageKey);
    if (saved) history = new History(JSON.parse(saved));
    const meta = JSON.parse(localStorage.getItem(storageKey + '.cloud') || 'null');
    if (meta && meta.documentJson === JSON.stringify(history.document) && typeof meta.binding?.id === 'string' && Number.isSafeInteger(meta.binding.revision)) {
        cloudBinding = meta.binding; cloudSavedJson = meta.savedJson;
    }
} catch {
    storageBlocked = true;
    $('#save-status').textContent = 'No se pudo recuperar el borrador. Descarga tu proyecto.';
}

function persist() {
    // Preserve unreadable previous data until the user explicitly opens/creates a project.
    if (storageBlocked) return;
    try {
        const documentJson = JSON.stringify(savedDocument());
        localStorage.setItem(storageKey, documentJson);
        localStorage.setItem(storageKey + '.cloud', JSON.stringify({ binding: cloudBinding, savedJson: cloudSavedJson, documentJson }));
        $('#save-status').textContent = 'Borrador guardado en este navegador';
    } catch { $('#save-status').textContent = 'No se pudo guardar el borrador. Descarga tu proyecto.'; }
}
function commit(next) {
    try { if (history.commit(next)) persist(); }
    catch (error) { status(error.message); }
    draft = null;
    render();
}
function edit(operation) {
    if (gesture) return;
    const next = clone(history.document); operation(next); commit(next);
}
function setTool(next) {
    powerClipSources = null; hideObjectMenu();
    canvas.classList.remove('placing-powerclip');
    if (gesture) cancelGesture();
    splineDraft = null; splinePointer = null;
    tool = next;
    canvas.dataset.tool = next;
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === next);
        button.setAttribute('aria-pressed', String(button.dataset.tool === next));
    });
    renderScene();
    status({ select: 'Selecciona un objeto para moverlo o editarlo', hand: 'Arrastra para desplazar la vista', rect: 'Arrastra para dibujar · Shift: cuadrado', ellipse: 'Arrastra para dibujar · Shift: círculo', text: 'Haz clic para añadir texto', spline: 'Spline: coloca puntos con clics · Enter o doble clic para terminar · Esc para cancelar' }[next]);
}
function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale };
}
function renderScene() {
    $('#hover-reference').replaceChildren();
    const d = current();
    scene.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    $('#paper').setAttribute('width', d.width); $('#paper').setAttribute('height', d.height);
    objects.replaceChildren();
    if (powerClipEditing) {
        const frame = powerClipEditing.history.document.objects.find(item => item.id === powerClipEditing.id);
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        outline.setAttribute('pointer-events', 'none');
        outline.innerHTML = objectMarkup({ ...frame, powerClip: undefined, fill: 'none', stroke: '#22d3ee', strokeWidth: 1.5 / view.scale });
        objects.append(outline);
    }
    for (const object of d.objects) {
        if (object.hidden) continue;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Markup comes only from validated primitives, never from imported SVG.
        group.innerHTML = objectMarkup(object);
        if (object.powerClip) drawPowerClipMarker(group, object);
        if (object.type === 'spline' && !object.locked) {
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitArea.setAttribute('d', splinePath(object)); hitArea.setAttribute('fill', 'none');
            hitArea.setAttribute('stroke', 'transparent'); hitArea.setAttribute('stroke-width', Math.max(object.strokeWidth, 10 / view.scale));
            hitArea.setAttribute('pointer-events', 'stroke'); group.append(hitArea);
        }
        group.dataset.id = object.id;
        group.setAttribute('pointer-events', object.locked ? 'none' : 'all');
        objects.append(group);
    }
    selection.replaceChildren();
    for (const o of selectedObjects()) {
      if (!o.hidden) {
        const bounds = getBounds(o), unit = 1 / view.scale;
        const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'pointer-events': 'none' })) box.setAttribute(key, value);
        selection.append(box);
        if (!o.locked && o.type !== 'text' && selectedIds.size === 1) {
            // Reduce the outer gap when zooming out; keep the node itself free to drag.
            const handleOffset = 4 + Math.max(1, Math.min(4, 4 * view.scale / (96 / 25.4)));
            for (const control of RESIZE_HANDLES) {
                const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                for (const [key, value] of Object.entries({ x: o.x + o.width * control.x + ((control.x * 2 - 1) * handleOffset - 4) * unit, y: o.y + o.height * control.y + ((control.y * 2 - 1) * handleOffset - 4) * unit, width: 8 * unit, height: 8 * unit, fill: 'white', stroke: '#8b5bd1', 'stroke-width': unit, cursor: control.cursor })) handle.setAttribute(key, value);
                handle.dataset.handle = control.name; selection.append(handle);
            }
        }
      }
    }
    if (gesture?.type === 'marquee' && gesture.area) {
        const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ ...gesture.area, fill: '#a78bfa', 'fill-opacity': .12, stroke: '#c4b5fd', 'stroke-width': 1 / view.scale, 'stroke-dasharray': `${4 / view.scale} ${3 / view.scale}`, 'pointer-events': 'none' })) box.setAttribute(key, value);
        selection.append(box);
    }
    $('#zoom-label').textContent = `${Math.round(view.scale / (96 / 25.4) * 100)}%`;
    renderSplinePreview();
    renderPowerClipToolbar();
    if (gesture?.dropTarget) drawPowerClipDrop(gesture.dropTarget);
}
function svgElement(tag, attributes, parent) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.append(element); return element;
}
function drawPowerClipMarker(group, object) {
    if (object.powerClip.objects.length) return;
    const { x, y, width, height } = object;
    const overlay = svgElement('g', { 'pointer-events': 'none', 'data-editor-marker': 'powerclip' }, group);
    if (!object.powerClip.objects.length) svgElement('path', { d: `M${x + width * .2} ${y + height * .2}L${x + width * .8} ${y + height * .8}M${x + width * .8} ${y + height * .2}L${x + width * .2} ${y + height * .8}`, stroke: '#64748b', 'stroke-width': 1 / view.scale, opacity: .65 }, overlay);
    const size = Math.min(12 / view.scale, width / 5, height / 5), cx = x + width / 2, cy = y + height / 2;
    svgElement('rect', { x: cx - size * 1.2, y: cy - size * .8, width: size * 2.4, height: size * 1.6, rx: size * .3, fill: '#18343d', opacity: .85 }, overlay);
    svgElement('text', { x: cx, y: cy + size * .35, 'text-anchor': 'middle', 'font-size': size, fill: '#a5f3fc', 'font-family': 'Arial, sans-serif' }, overlay).textContent = 'PC';
}
function drawPowerClipDrop(target) {
    const overlay = $('#hover-reference'); overlay.replaceChildren();
    const g = svgElement('g', { transform: `translate(${view.x} ${view.y}) scale(${view.scale})` }, overlay);
    const shape = { fill: '#22d3ee', 'fill-opacity': .2, stroke: '#22d3ee', 'stroke-width': 2 / view.scale };
    if (target.type === 'ellipse') svgElement('ellipse', { cx: target.x + target.width / 2, cy: target.y + target.height / 2, rx: target.width / 2, ry: target.height / 2, ...shape }, g);
    else svgElement('rect', { x: target.x, y: target.y, width: target.width, height: target.height, ...shape }, g);
    const x = Math.max(4, Math.min(canvas.clientWidth - 246, view.x + target.x * view.scale));
    const y = Math.max(4, Math.min(canvas.clientHeight - 32, view.y + target.y * view.scale - 36));
    svgElement('rect', { x, y, width: 242, height: 28, rx: 5, fill: '#10343d', stroke: '#22d3ee' }, overlay);
    svgElement('text', { x: x + 10, y: y + 18, fill: '#a5f3fc', 'font-size': 12 }, overlay).textContent = 'Soltar para colocar dentro del PowerClip';
}
function renderPowerClipToolbar() {
    const toolbar = $('#powerclip-toolbar'), o = selected();
    toolbar.hidden = !o?.powerClip?.objects.length || selectedIds.size !== 1 || o.locked || o.hidden || Boolean(gesture);
    if (toolbar.hidden) return;
    const rect = canvas.getBoundingClientRect();
    const center = rect.left + view.x + (o.x + o.width / 2) * view.scale;
    const top = rect.top + view.y + o.y * view.scale;
    toolbar.style.left = Math.max(rect.left + 8, Math.min(center - toolbar.offsetWidth / 2, rect.right - toolbar.offsetWidth - 8)) + 'px';
    toolbar.style.top = Math.max(rect.top + 8, Math.min(top - toolbar.offsetHeight - 12, rect.bottom - toolbar.offsetHeight - 8)) + 'px';
}
function renderSplinePreview() {
    let preview = $('#spline-preview');
    if (!preview) { preview = document.createElementNS('http://www.w3.org/2000/svg', 'g'); preview.id = 'spline-preview'; preview.setAttribute('pointer-events', 'none'); scene.append(preview); }
    preview.replaceChildren();
    if (!splineDraft?.length) return;
    const points = splinePointer ? [...splineDraft, splinePointer] : splineDraft;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pointsPath(points)); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#22d3ee');
    path.setAttribute('stroke-width', 1.5 / view.scale); preview.append(path);
    for (const p of splineDraft) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        node.setAttribute('cx', p.x); node.setAttribute('cy', p.y); node.setAttribute('r', 3 / view.scale);
        node.setAttribute('fill', '#22d3ee'); preview.append(node);
    }
}
function finishSpline() {
    if (!splineDraft || splineDraft.length < 2) { status('Coloca al menos dos puntos para terminar la spline.'); return; }
    const shape = { ...createObject('spline', 0, 0), ...normalizeSpline(splineDraft), fill: 'none', stroke: nextStroke };
    splineDraft = null; splinePointer = null; selectOnly(shape.id);
    edit(document => document.objects.push(shape)); setTool('select');
    status('Spline creada');
}
function getBounds(o) {
    if (o.type === 'text') {
        const group = [...objects.children].find(g => g.dataset.id === o.id);
        if (group) return group.getBBox();
    }
    return o;
}
function render() {
    $('#powerclip-edit-bar').hidden = !powerClipEditing;
    for (const selector of ['#document-name', '#page-width', '#page-height', '#page-preset']) $(selector).disabled = Boolean(powerClipEditing);
    setSelection([...selectedIds].filter(id => current().objects.some(object => object.id === id)));
    const d = history.document, o = selected();
    $('.inspector').hidden = !o;
    $('#cloud-badge').hidden = !o;
    renderScene();
    const paletteColor = o ? o[paletteTarget] : paletteTarget === 'fill' ? nextFill : nextStroke;
    $('#palette-color').value = paletteColor === 'none' ? '#000000' : paletteColor;
    document.querySelectorAll('[data-color]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.color === paletteColor));
        button.disabled = Boolean(o?.locked);
    });
    $('#palette-color').disabled = Boolean(o?.locked);
    $('#stroke-menu-label').hidden = !o;
    const strokeMenu = $('#stroke-menu'), widths = selectedObjects().map(item => item.strokeWidth);
    const sameWidth = widths.every(value => Math.abs(value - widths[0]) < 1e-8);
    strokeMenu.value = sameWidth ? ([...strokeMenu.options].find(option => option.value !== 'custom' && Math.abs(Number(option.value) - widths[0]) < 1e-8)?.value || 'custom') : 'custom';
    strokeMenu.disabled = !selectedObjects().some(item => !item.locked);
    $('#cloud-badge').textContent = cloudBinding ? (JSON.stringify(d) === cloudSavedJson ? 'Guardado en Firebase' : 'Cambios sin guardar en Firebase') : 'Proyectos en Firebase';
    $('#document-name').value = d.name;
    $('#display-unit').value = displayUnit;
    $('#page-preset').value = Object.keys(pagePresets).find(key => Math.abs(d.width - pagePresets[key].width) < .001 && Math.abs(d.height - pagePresets[key].height) < .001) || 'custom';
    document.querySelectorAll('[data-unit]').forEach(element => { element.textContent = displayUnit === 'in' ? 'pulg' : 'mm'; });
    for (const key of ['width', 'height']) {
        const input = $('#page-' + key); input.min = 1 / unitFactor(); input.max = 5000 / unitFactor(); input.value = displayMeasure(d[key]);
    }
    $('#empty-selection').hidden = Boolean(o); $('#properties').hidden = !o || selectedIds.size > 1;
    $('#multi-selection').hidden = selectedIds.size < 2;
    $('#multi-selection').textContent = `${selectedIds.size} objetos seleccionados. Puedes moverlos juntos, cambiar el contorno o eliminarlos.`;
    $('#selection-kind').textContent = selectedIds.size > 1 ? `${selectedIds.size} objetos` : o ? ({ rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto', spline: 'Spline', image: 'Imagen' }[o.type] + (o.powerClip ? ' · PowerClip' : '') + (o.locked ? ' · bloqueado' : '')) : 'Documento';
    if (o) {
        const bounds = getBounds(o);
        document.querySelectorAll('[data-property]').forEach(input => {
            const key = input.dataset.property;
            if (input.type === 'number') {
                const limits = { width: [.1, 10000], height: [.1, 10000], fontSize: [.1, 1000], strokeWidth: [0, 100] }[key];
                input.min = limits[0] / unitFactor(); input.max = limits[1] / unitFactor();
            }
            input.value = o.type === 'text' && ['width', 'height'].includes(key) ? displayMeasure(bounds[key]) :
                input.type === 'color' && o[key] === 'none' ? '#000000' : typeof o[key] === 'number' ? displayMeasure(o[key]) : o[key];
            if (key === 'strokeWidth') input.value = Number((o[key] / unitFactor()).toFixed(6));
            input.disabled = o.locked || (o.type === 'text' && ['width', 'height'].includes(key));
        });
        $('#no-fill').checked = o.fill === 'none'; $('#no-stroke').checked = o.stroke === 'none';
        $('#no-fill').disabled = o.locked; $('#no-stroke').disabled = o.locked;
        $('#text-properties').hidden = o.type !== 'text';
    }
    $('[data-action="undo"]').disabled = !history.past.length;
    $('[data-action="redo"]').disabled = !history.future.length;
    for (const action of ['delete', 'duplicate', 'forward', 'backward']) $('[data-action="' + action + '"]').disabled = !o || o.locked;
    if (o) {
        $('[data-action="forward"]').disabled ||= !d.objects.some((item, index) => selectedIds.has(item.id) && index < d.objects.length - 1 && !selectedIds.has(d.objects[index + 1].id));
        $('[data-action="backward"]').disabled ||= !d.objects.some((item, index) => selectedIds.has(item.id) && index > 0 && !selectedIds.has(d.objects[index - 1].id));
    }
    $('#object-count').textContent = d.objects.length;
    const layers = $('#layers');
    for (const child of [...layers.children]) if (!d.objects.some(item => item.id === child.dataset.id)) child.remove();
    if (!d.objects.length) {
        const empty = document.createElement('p'); empty.className = 'layer-caption'; empty.textContent = 'Los objetos aparecerán aquí.'; layers.append(empty);
    }
    let position = 0;
    for (const item of [...d.objects].reverse()) {
        let row = [...layers.children].find(child => child.dataset.id === item.id);
        if (!row) {
            row = document.createElement('div'); row.dataset.id = item.id;
            const button = document.createElement('button'); button.className = 'layer-select';
            button.onclick = () => { if (!gesture) { selectOnly(item.id); render(); } };
            row.append(button);
            for (const field of ['hidden', 'locked']) {
                const toggle = document.createElement('button'); toggle.dataset.field = field;
                toggle.onclick = () => edit(next => { const target = next.objects.find(o => o.id === item.id); target[field] = !target[field]; });
                row.append(toggle);
            }
        }
        row.className = 'layer' + (selectedIds.has(item.id) ? ' selected' : '');
        const select = row.children[0];
        const label = document.createElement('span'); label.textContent = item.name + (item.powerClip ? ' · PowerClip' : '');
        select.replaceChildren(icon(item.type), label);
        select.title = item.name; select.setAttribute('aria-pressed', String(selectedIds.has(item.id)));
        for (const [field, on, off] of [['hidden', 'hidden', 'visible'], ['locked', 'locked', 'unlocked']]) {
            const button = row.querySelector(`[data-field="${field}"]`); button.replaceChildren(icon(item[field] ? on : off));
            button.title = `${field === 'hidden' ? (item.hidden ? 'Mostrar' : 'Ocultar') : (item.locked ? 'Desbloquear' : 'Bloquear')} ${item.name}`;
            button.setAttribute('aria-label', button.title);
        }
        // Keep nodes stable: committing a field on blur must not swallow the next click.
        if (layers.children[position] !== row) layers.insertBefore(row, layers.children[position] || null);
        position++;
    }
}
function fit() {
    const rect = canvas.getBoundingClientRect(), d = current();
    view.scale = Math.max(.05, Math.min((96 / 25.4) * 100, (rect.width - 100) / d.width, (rect.height - 110) / d.height));
    view.x = (rect.width - d.width * view.scale) / 2; view.y = (rect.height - d.height * view.scale) / 2;
    renderScene();
}
function zoom(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const scale = Math.max(.05, Math.min((96 / 25.4) * 100, view.scale * factor));
    view.x = x - (x - view.x) * scale / view.scale; view.y = y - (y - view.y) * scale / view.scale;
    view.scale = scale; renderScene();
}

let lastPowerClipClick = null;
canvas.addEventListener('pointerdown', event => {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    const clickedId = event.target.closest('[data-id]')?.dataset.id;
    if (event.button === 0 && tool === 'select' && !powerClipEditing && !powerClipSources) {
        const previous = lastPowerClipClick;
        lastPowerClipClick = { id: clickedId, time: event.timeStamp, x: event.clientX, y: event.clientY };
        if (clickedId && previous?.id === clickedId && event.timeStamp - previous.time < 500 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 5 && beginPowerClipEditing(event)) {
            lastPowerClipClick = null; return;
        }
    }
    hideObjectMenu();
    if (powerClipSources && event.button === 0) {
        event.preventDefault();
        const id = event.target.closest('[data-id]')?.dataset.id;
        try {
            const next = clone(history.document); placeInPowerClip(next, powerClipSources, id, { createContainer: true });
            const valid = validateDocument(next);
            powerClipSources = null; canvas.classList.remove('placing-powerclip'); selectOnly(id); commit(valid); status('Contenido colocado en PowerClip');
        } catch (error) { status(error.message + ' Esc para cancelar.'); }
        return;
    }
    event.preventDefault(); canvas.focus();
    const start = point(event);
    canvas.setPointerCapture(event.pointerId);
    if (tool === 'hand' || event.button === 1) {
        gesture = { type: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: { ...view } }; return;
    }
    if (tool === 'spline') {
        selectOnly(null);
        if (!splineDraft) splineDraft = [];
        const last = splineDraft.at(-1);
        if (!last || Math.hypot(start.x - last.x, start.y - last.y) * view.scale > 3) {
            if (splineDraft.length >= 500) { status('Máximo 500 puntos por spline. Pulsa Enter para terminar.'); return; }
            splineDraft.push(start);
        }
        splinePointer = null; render(); return;
    }
    if (tool === 'text') {
        const text = createObject('text', start.x, start.y); text.fill = nextFill; text.stroke = 'none';
        selectOnly(text.id); edit(d => d.objects.push(text)); setTool('select');
        $('[data-property="text"]').focus(); $('[data-property="text"]').select(); return;
    }
    if (tool === 'rect' || tool === 'ellipse') {
        draft = clone(history.document);
        const object = createObject(tool, start.x, start.y, .1, .1); object.fill = nextFill; object.stroke = nextStroke; selectOnly(object.id); draft.objects.push(object);
        gesture = { type: 'draw', start, pointerId: event.pointerId }; renderScene(); return;
    }
    const target = event.target.closest('[data-id]');
    const handle = event.target.closest('[data-handle]');
    const hit = !handle ? referenceAt(start) : null;
    const targetId = hit?.target.id || target?.dataset.id;
    if (!handle && !targetId) {
        gesture = { type: 'marquee', start, originalIds: [...selectedIds], pointerId: event.pointerId };
        selectOnly(null); render(); return;
    }
    if (!handle && !selectedIds.has(targetId)) selectOnly(targetId);
    const o = selected();
    if (o && !o.locked && !o.hidden) {
        draft = clone(history.document);
        gesture = { type: handle ? 'resize' : 'move', handle: handle?.dataset.handle, start, original: clone(o), originals: clone(selectedObjects().filter(item => !item.locked)), pointerId: event.pointerId };
        gesture.anchor = hit?.reference || start;
        gesture.snapTargets = current().objects.map(item => {
            const bounds = getBounds(item);
            return { ...item, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        });
    }
    render();
});
function referenceAt(position) {
    for (const item of [...current().objects].reverse()) {
        if (item.hidden || item.locked) continue;
        const bounds = item.type === 'text' ? getBounds(item) : item;
        const reference = objectReference({ ...item, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, position, 7 / view.scale);
        if (reference) return { target: item, reference };
    }
    return null;
}
function showReference(event) {
    const overlay = $('#hover-reference'); overlay.replaceChildren();
    canvas.style.cursor = '';
    if (gesture || tool === 'hand' || event.pointerType === 'touch' || event.target.closest('[data-handle]')) return;
    const hit = referenceAt(point(event));
    if (!hit) return;
    if (tool === 'select') canvas.style.cursor = 'move';
    drawReference(hit);
}
function drawReference({ target, reference }) {
    const overlay = $('#hover-reference'); overlay.replaceChildren();
    const add = (tag, attributes, parent = overlay) => {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        parent.append(element); return element;
    };
    if (reference.label === 'Borde') {
        const outline = add('g', { transform: `translate(${view.x} ${view.y}) scale(${view.scale})` });
        const attrs = { fill: 'none', stroke: '#22d3ee', 'stroke-width': 1.5 / view.scale };
        if (target.type === 'spline') add('path', { d: splinePath(target), ...attrs }, outline);
        else if (target.type === 'ellipse') add('ellipse', { cx: target.x + target.width / 2, cy: target.y + target.height / 2, rx: target.width / 2, ry: target.height / 2, ...attrs }, outline);
        else add('rect', { x: target.x, y: target.y, width: target.width, height: target.height, ...attrs }, outline);
    }
    const x = view.x + reference.x * view.scale, y = view.y + reference.y * view.scale;
    const marker = { fill: '#102b35', stroke: '#22d3ee', 'stroke-width': 1.5 };
    if (reference.label === 'Centro') {
        add('circle', { cx: x, cy: y, r: 5, ...marker });
        add('path', { d: `M${x - 8} ${y}h16M${x} ${y - 8}v16`, stroke: '#22d3ee', 'stroke-width': 1 });
    } else if (reference.label === 'Nodo') add('path', { d: `M${x} ${y - 5}l5 5-5 5-5-5Z`, ...marker });
    else if (reference.label === 'Punto medio') add('rect', { x: x - 4, y: y - 4, width: 8, height: 8, ...marker });
    else add('circle', { cx: x, cy: y, r: 3.5, ...marker });
    const labelWidth = reference.label.length * 7 + 18;
    const labelX = Math.max(4, Math.min(canvas.clientWidth - labelWidth - 4, x + 14));
    const labelY = Math.max(4, Math.min(canvas.clientHeight - 28, y + 14));
    add('rect', { x: labelX, y: labelY, width: labelWidth, height: 24, rx: 5, fill: '#102b35', stroke: '#22d3ee', 'stroke-width': 1 });
    add('text', { x: labelX + 9, y: labelY + 16, fill: '#a5f3fc', 'font-size': 12, 'font-weight': 600 }).textContent = reference.label;
}
canvas.addEventListener('pointerleave', () => { $('#hover-reference').replaceChildren(); canvas.style.cursor = ''; });
canvas.addEventListener('pointermove', event => {
    if (tool === 'spline' && splineDraft && !gesture) { splinePointer = point(event); renderSplinePreview(); showReference(event); return; }
    if (!gesture) { showReference(event); return; }
    if (gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'pan') {
        view.x = gesture.view.x + event.clientX - gesture.clientX; view.y = gesture.view.y + event.clientY - gesture.clientY; renderScene(); return;
    }
    const p = point(event), dx = p.x - gesture.start.x, dy = p.y - gesture.start.y, o = selected();
    if (gesture.type === 'marquee') {
        gesture.area = { x: Math.min(p.x, gesture.start.x), y: Math.min(p.y, gesture.start.y), width: Math.abs(dx), height: Math.abs(dy) };
        setSelection(current().objects.filter(item => !item.hidden && !item.locked && fullyContained(gesture.area, getBounds(item))).map(item => item.id));
    }
    if (gesture.type === 'move') {
        const movement = snapTranslation(gesture.anchor, { x: dx, y: dy }, gesture.snapTargets, selectedIds, 7 / view.scale);
        gesture.snap = movement.hit;
        for (const original of gesture.originals) { const item = draft.objects.find(item => item.id === original.id); item.x = original.x + movement.x; item.y = original.y + movement.y; }
        gesture.moved ||= Math.hypot(dx, dy) * view.scale > 4;
        gesture.dropTarget = gesture.moved ? powerClipDropTarget(draft.objects, selectedIds, p) : null;
    }
    if (gesture.type === 'draw') {
        let w = Math.abs(dx), h = Math.abs(dy);
        if (event.shiftKey) w = h = Math.max(w, h);
        o.x = gesture.start.x - (dx < 0 ? w : 0); o.y = gesture.start.y - (dy < 0 ? h : 0);
        o.width = Math.max(.1, w); o.height = Math.max(.1, h);
    }
    if (gesture.type === 'resize') {
        Object.assign(o, resizeBounds(gesture.original, gesture.handle, dx, dy));
    }
    renderScene();
    if (gesture.type === 'move' && gesture.snap && !gesture.dropTarget) drawReference(gesture.snap);
});
canvas.addEventListener('dblclick', event => {
    if (tool === 'spline') { event.preventDefault(); finishSpline(); return; }
    beginPowerClipEditing(event);
});
function beginPowerClipEditing(event) {
    if (tool !== 'select' || powerClipEditing || powerClipSources) return false;
    const id = event.target.closest('[data-id]')?.dataset.id || selectedId;
    const target = history.document.objects.find(item => item.id === id);
    if (!target?.powerClip || target.locked) return false;
    event.preventDefault(); finishPropertyColor(); cancelGesture();
    try {
        const content = powerClipEditDocument(history.document, id);
        powerClipEditing = { id, history };
        history = new History(content); selectOnly(null); setTool('select'); render();
        status('Editando contenido de PowerClip. Terminar edición o Esc para volver.');
    } catch (error) { status(error.message); }
    return true;
}
function finishPowerClipEditing() {
    if (!powerClipEditing) return;
    finishPropertyColor(); cancelGesture();
    const session = powerClipEditing;
    try {
        const next = savedDocument();
        history = session.history; powerClipEditing = null;
        selectOnly(session.id); setTool('select'); commit(next);
        status('Edición de PowerClip terminada');
    } catch (error) { status(error.message); }
}
$('#powerclip-edit-done').onclick = finishPowerClipEditing;
canvas.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const previous = gesture; gesture = null;
    if (previous.moved || previous.type !== 'move') lastPowerClipClick = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (previous.type === 'pan') return;
    if (previous.type === 'marquee') { render(); status(`${selectedIds.size} objetos seleccionados`); return; }
    if (previous.type === 'draw' && selected().width * view.scale < 3 && selected().height * view.scale < 3) { draft = null; render(); return; }
    if (previous.type === 'move' && previous.moved) {
        const drop = powerClipDropTarget(draft.objects, selectedIds, point(event));
        if (drop) {
            try {
                const next = clone(draft); placeInPowerClip(next, selectedIds, drop.id);
                const valid = validateDocument(next); selectOnly(drop.id); commit(valid); status('Contenido colocado en PowerClip'); return;
            } catch (error) { draft = null; render(); status(error.message); return; }
        }
    }
    commit(draft); if (previous.type === 'draw') setTool('select');
    if (previous.snap) { drawReference(previous.snap); status(`Encajado en ${previous.snap.reference.label.toLowerCase()}`); }
    else showReference(event);
});
function cancelGesture() {
    if (!gesture) return;
    const previous = gesture; gesture = null; draft = null;
    if (previous.type === 'pan') view = previous.view;
    if (previous.type === 'marquee') setSelection(previous.originalIds);
    if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    render();
}
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', cancelGesture);
window.addEventListener('blur', cancelGesture);
canvas.addEventListener('wheel', event => {
    event.preventDefault(); if (gesture) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const rect = canvas.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * unit * .002), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

$('#properties').addEventListener('submit', event => event.preventDefault());
$('#stroke-menu').addEventListener('change', event => {
    if (event.target.value === 'custom') { $('[data-property="strokeWidth"]').focus(); return; }
    const width = Number(event.target.value);
    edit(d => { for (const item of d.objects.filter(item => selectedIds.has(item.id) && !item.locked)) {
        item.strokeWidth = width;
        if (item.stroke === 'none') item.stroke = nextStroke === 'none' ? '#000000' : nextStroke;
    } });
    status(width === HAIRLINE_WIDTH ? 'Grosor: Muy fina (0.0762 mm)' : `Grosor: ${width} mm`);
});
let pendingColor = null, colorFrame = null;
function finishPropertyColor() {
    if (colorFrame !== null) cancelAnimationFrame(colorFrame);
    colorFrame = null;
    const pending = pendingColor;
    pendingColor = null;
    if (!pending || pending.document !== history.document) return;
    edit(d => {
        const item = d.objects.find(item => item.id === pending.id);
        if (!item || item.locked) return;
        item[pending.property] = pending.value;
        if (pending.property === 'stroke' && item.strokeWidth === 0) item.strokeWidth = HAIRLINE_WIDTH;
    });
}
function previewPropertyColor(input, o) {
    pendingColor = { input, id: o.id, document: history.document, property: input.dataset.property, value: input.value };
    if (colorFrame !== null) return;
    colorFrame = requestAnimationFrame(() => {
        colorFrame = null;
        const pending = pendingColor;
        if (!pending || pending.document !== history.document) return;
        const item = history.document.objects.find(item => item.id === pending.id);
        const group = [...objects.children].find(group => group.dataset.id === pending.id);
        if (!item || !group) return;
        const preview = { ...item, [pending.property]: pending.value };
        if (pending.property === 'stroke' && preview.strokeWidth === 0) preview.strokeWidth = HAIRLINE_WIDTH;
        // Only repaint this object. Do not reset the native picker or serialize the project while dragging.
        group.innerHTML = objectMarkup(preview);
        if (preview.powerClip) drawPowerClipMarker(group, preview);
    });
}
function updateProperty(event) {
    const input = event.target, o = selected();
    if (event.type === 'input' && input.type !== 'color') return;
    if (!o || o.locked) return;
    const property = input.dataset.property;
    if (input.type === 'color' && (property === 'fill' || property === 'stroke')) {
        previewPropertyColor(input, o);
        if (event.type === 'change') finishPropertyColor();
        return;
    }
    if (property) {
        if (!input.checkValidity()) { status('Introduce un valor dentro del rango permitido.'); render(); return; }
        const value = input.type === 'number' ? Number(input.value) * unitFactor() : input.value;
        if (o[property] === value) return;
        edit(d => {
            const item = d.objects.find(item => item.id === o.id);
            item[property] = value;
            if (property === 'stroke' && value !== 'none' && item.strokeWidth === 0) item.strokeWidth = HAIRLINE_WIDTH;
        });
    } else if (input.id === 'no-fill' || input.id === 'no-stroke') {
        edit(d => { d.objects.find(item => item.id === o.id)[input.id === 'no-fill' ? 'fill' : 'stroke'] = input.checked ? 'none' : '#352a49'; });
    }
}
// Native color pickers emit input while choosing, before their final change event.
$('#properties').addEventListener('input', updateProperty);
$('#properties').addEventListener('change', updateProperty);
$('#properties').addEventListener('focusout', event => {
    if (pendingColor?.input === event.target) finishPropertyColor();
});
document.addEventListener('pointerdown', event => {
    if (pendingColor && event.target !== pendingColor.input) finishPropertyColor();
}, true);
document.addEventListener('keydown', event => {
    if (pendingColor && event.target !== pendingColor.input) finishPropertyColor();
}, true);
$('#document-name').addEventListener('change', event => edit(d => { d.name = event.target.value.trim() || 'Sin título'; }));
for (const dimension of ['width', 'height']) $('#page-' + dimension).addEventListener('change', event => {
    if (!event.target.checkValidity()) { render(); status('La página debe medir entre 1 y 5000 mm.'); return; }
    edit(d => { d[dimension] = Number(event.target.value) * unitFactor(); });
});
$('#page-preset').addEventListener('change', event => {
    const preset = pagePresets[event.target.value];
    if (!preset || gesture) return;
    displayUnit = preset.unit;
    try { localStorage.setItem('dekoor.editor-v2.unit', displayUnit); } catch {}
    edit(d => { d.width = preset.width; d.height = preset.height; });
});
$('#display-unit').addEventListener('change', event => {
    displayUnit = event.target.value;
    try { localStorage.setItem('dekoor.editor-v2.unit', displayUnit); } catch {}
    render(); status(displayUnit === 'in' ? 'Medidas en pulgadas' : 'Medidas en milímetros');
});
let pastingImage = false;
document.addEventListener('paste', async event => {
    if (event.target.closest('input, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]') || gesture || splineDraft) return;
    const item = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && ['image/png', 'image/jpeg', 'image/webp'].includes(item.type));
    if (!item) return;
    event.preventDefault(); if (pastingImage) return;
    const file = item.getAsFile(); if (!file) return;
    const pasteDocument = history.document;
    pastingImage = true; status('Pegando imagen…');
    try {
        if (file.size > 10 * 1024 * 1024) throw new Error('La imagen supera el límite de 10 MB.');
        const src = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file);
        });
        const image = new Image(); image.src = src; await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('La imagen no tiene dimensiones válidas.');
        const ratio = Math.min(25.4 / 96, history.document.width * .8 / image.naturalWidth, history.document.height * .8 / image.naturalHeight);
        const width = Math.max(.1, image.naturalWidth * ratio), height = Math.max(.1, image.naturalHeight * ratio);
        const center = { x: (canvas.clientWidth / 2 - view.x) / view.scale, y: (canvas.clientHeight / 2 - view.y) / view.scale };
        const object = { ...createObject('image', center.x - width / 2, center.y - height / 2, width, height), src, stroke: 'none', fill: 'none' };
        if (gesture || splineDraft || history.document !== pasteDocument) throw new Error('El documento cambió mientras se leía la imagen. Vuelve a pegarla.');
        setTool('select'); selectOnly(object.id); edit(d => d.objects.push(object)); status('Imagen pegada');
    } catch (error) { status(error.message || 'No se pudo pegar la imagen.'); }
    finally { pastingImage = false; }
});
function download(content, type, extension, name = history.document.name) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
    link.href = url; link.download = (name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'Proyecto') + extension;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
let exporting = false;
$('#export-cancel').onclick = () => $('#export-dialog').close();
$('#export-dialog').addEventListener('cancel', event => { if (exporting) event.preventDefault(); });
$('#export-form').addEventListener('submit', async event => {
    event.preventDefault(); if (exporting) return;
    const snapshot = clone(history.document), format = $('#export-format').value;
    exporting = true;
    $('#export-form').querySelectorAll('button, select').forEach(element => { element.disabled = true; });
    $('#export-message').textContent = 'Preparando archivo…';
    try {
        if (format === 'pdf') {
            const { exportPdf } = await import('./pdf.mjs');
            download(await exportPdf(snapshot), 'application/pdf', '.pdf', snapshot.name);
        } else download(exportSvg(snapshot), 'image/svg+xml', '.svg', snapshot.name);
        $('#export-dialog').close(); status(`${format.toUpperCase()} exportado con el tamaño de página del proyecto`);
    } catch (error) { $('#export-message').textContent = error.message || 'No se pudo exportar el diseño.'; }
    finally {
        exporting = false;
        $('#export-form').querySelectorAll('button, select').forEach(element => { element.disabled = false; });
    }
});
const actions = {
    undo() { if (history.undo()) { persist(); render(); status('Cambio deshecho'); } },
    redo() { if (history.redo()) { persist(); render(); status('Cambio rehecho'); } },
    new() {
        if (!window.confirm('¿Crear un proyecto nuevo? Guarda el actual en Firebase o descarga una copia si quieres conservarlo. Puedes deshacer esta acción.')) return;
        cloudBinding = null; cloudSavedJson = null;
        storageBlocked = false; selectOnly(null); commit(blankDocument()); persist(); fit(); status('Nuevo documento A4');
    },
    open() { showCloud(false); },
    cloud() { showCloud(false); },
    async save() { if (await ensureProjectName()) showCloud(true); },
    import() { $('#open-file').click(); },
    async download() { if (await ensureProjectName()) { download(JSON.stringify(history.document, null, 2), 'application/json', '.dekoor'); status('Proyecto descargado'); } },
    export() { $('#export-message').textContent = ''; $('#export-dialog').showModal(); },
    delete() { edit(d => { d.objects = d.objects.filter(item => !selectedIds.has(item.id) || item.locked); }); },
    duplicate() {
        const originals = selectedObjects().filter(item => !item.locked); if (!originals.length) return;
        edit(d => { const ids = []; for (const o of originals) { const copy = clone(o); for (const item of objectsWithContents([copy])) item.id = crypto.randomUUID(); copy.name = (copy.name + ' copia').slice(0, 120); copy.x += 5; copy.y += 5; d.objects.push(copy); ids.push(copy.id); } setSelection(ids); });
    },
    forward() { reorder(1); }, backward() { reorder(-1); },
    front() { reorderToEnd(true); }, back() { reorderToEnd(false); },
    'zoom-in'() { zoom(1.2); }, 'zoom-out'() { zoom(1 / 1.2); }, fit,
    help() { $('#help').showModal(); },
};
for (const name of ['new', 'open', 'cloud', 'save', 'import', 'download', 'export']) {
    const action = actions[name];
    if (action) actions[name] = (...args) => { finishPowerClipEditing(); if (!powerClipEditing) return action(...args); };
}
function hideObjectMenu() { $('#object-menu').hidden = true; }
canvas.addEventListener('contextmenu', event => {
    event.preventDefault(); if (gesture || splineDraft) return;
    const id = event.target.closest('[data-id]')?.dataset.id || referenceAt(point(event))?.target.id;
    const object = current().objects.find(item => item.id === id);
    if (!object) { hideObjectMenu(); return; }
    if (!selectedIds.has(id)) selectOnly(id);
    render();
    const menu = $('#object-menu'), single = selectedIds.size === 1;
    $('#make-powerclip').disabled = Boolean(powerClipEditing) || !single || object.locked || Boolean(object.powerClip) || !['rect', 'ellipse'].includes(object.type);
    $('#place-powerclip').disabled = selectedObjects().some(item => item.locked || item.powerClip) || !current().objects.some(item => ['rect', 'ellipse'].includes(item.type) && !item.locked && !item.hidden && !selectedIds.has(item.id));
    $('#place-powerclip').disabled ||= Boolean(powerClipEditing);
    $('#extract-powerclip').hidden = !object.powerClip;
    $('#extract-powerclip').disabled = !single || object.locked || !object.powerClip?.objects.length;
    $('#remove-powerclip').hidden = !object.powerClip;
    $('#remove-powerclip').disabled = !single || object.locked || Boolean(object.powerClip?.objects.length);
    menu.hidden = false;
    menu.style.left = Math.max(4, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 4)) + 'px';
    menu.querySelector('button:not(:disabled):not([hidden])')?.focus();
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#object-menu')) hideObjectMenu(); });
window.addEventListener('blur', hideObjectMenu);
$('#make-powerclip').onclick = () => {
    const id = selectedId; hideObjectMenu();
    edit(d => makePowerClip(d.objects.find(item => item.id === id)));
    status('PowerClip vacío creado. Clic derecho en otro objeto → Colocar dentro de PowerClip.');
};
$('#place-powerclip').onclick = () => {
    hideObjectMenu(); setTool('select'); powerClipSources = new Set(selectedIds);
    canvas.classList.add('placing-powerclip');
    status('Haz clic en un rectángulo o elipse para colocar el contenido dentro. Esc para cancelar.'); canvas.focus();
};
$('#extract-powerclip').onclick = () => { hideObjectMenu(); edit(d => extractPowerClip(d, selectedId)); status('Contenido extraído'); };
$('#powerclip-extract').onclick = () => { edit(d => extractPowerClip(d, selectedId)); status('Contenido extraído'); };
for (const mode of ['contain', 'cover']) $('#powerclip-' + mode).onclick = () => {
    const group = [...objects.children].find(item => item.dataset.id === selectedId)?.querySelector('[data-powerclip-content]');
    if (!group) return;
    const bounds = group.getBBox();
    try { edit(d => fitPowerClip(d.objects.find(item => item.id === selectedId), mode, bounds)); status(mode === 'contain' ? 'Contenido ajustado proporcionalmente dentro del PowerClip' : 'Contenido ampliado proporcionalmente para rellenar el PowerClip'); }
    catch (error) { status(error.message); }
};
$('#remove-powerclip').onclick = () => { hideObjectMenu(); edit(d => { delete d.objects.find(item => item.id === selectedId).powerClip; }); };

function reorder(delta) {
    edit(d => {
        const indices = Array.from({ length: d.objects.length }, (_, i) => i); if (delta > 0) indices.reverse();
        for (const index of indices) {
            const target = index + delta;
            if (selectedIds.has(d.objects[index].id) && !d.objects[index].locked && target >= 0 && target < d.objects.length && !selectedIds.has(d.objects[target].id))
                [d.objects[index], d.objects[target]] = [d.objects[target], d.objects[index]];
        }
    });
}
function reorderToEnd(front) {
    if (!selectedObjects().some(item => !item.locked)) return;
    edit(d => {
        const moved = d.objects.filter(item => selectedIds.has(item.id) && !item.locked), rest = d.objects.filter(item => !selectedIds.has(item.id) || item.locked);
        d.objects = front ? [...rest, ...moved] : [...moved, ...rest];
    });
    status(front ? 'Objeto traído al frente' : 'Objeto enviado al fondo');
}
document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.tool) setTool(button.dataset.tool);
    if (button.dataset.action && !gesture) {
        if (splineDraft) { status('Termina la spline con Enter o cancélala con Esc antes de continuar.'); return; }
        actions[button.dataset.action]?.();
    }
});
$('#open-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
        if (file.size > 32 * 1024 * 1024) throw new Error('El proyecto supera el límite de 32 MB.');
        const next = validateDocument(JSON.parse(await file.text()));
        if (!window.confirm('¿Abrir este proyecto y reemplazar el borrador actual? Puedes deshacer esta acción.')) return;
        cancelGesture(); cloudBinding = null; cloudSavedJson = null;
        storageBlocked = false; selectOnly(null); commit(next); persist(); fit(); $('#cloud-dialog').close(); status('Proyecto abierto');
    } catch (error) { status(`No se abrió el archivo: ${error.message}`); }
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hideObjectMenu(); powerClipSources = null; }
    if (document.querySelector('dialog[open]')) return;
    const editing = event.target.closest('input, select, textarea, [contenteditable="true"]');
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (key === 'escape') { if (powerClipEditing && !editing && !splineDraft) { finishPowerClipEditing(); return; } cancelGesture(); selectOnly(null); setTool('select'); render(); return; }
    if (editing) return;
    if (splineDraft) {
        if (key === 'enter') { event.preventDefault(); finishSpline(); }
        else if (key === 'backspace') { event.preventDefault(); splineDraft.pop(); renderSplinePreview(); }
        else if (mod) event.preventDefault();
        return;
    }
    if (mod && ['home', 'end'].includes(key)) {
        event.preventDefault(); if (!gesture) actions[key === 'home' ? 'front' : 'back'](); return;
    }
    if (mod && ['z', 'y', 'd', 's', 'o', 'i', 'e'].includes(key)) {
        event.preventDefault(); if (gesture) return;
        const action = { z: event.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', s: 'save', o: 'open', i: 'import', e: 'export' }[key]; actions[action](); return;
    }
    if (mod || event.altKey || gesture) return;
    if ({ v: 'select', h: 'hand', r: 'rect', e: 'ellipse', t: 'text', b: 'spline' }[key]) { event.preventDefault(); setTool({ v: 'select', h: 'hand', r: 'rect', e: 'ellipse', t: 'text', b: 'spline' }[key]); }
    if (key === 'delete' || key === 'backspace') { event.preventDefault(); actions.delete(); }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        const o = selected(); if (!o || o.locked) return; event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        edit(d => { for (const item of d.objects.filter(item => selectedIds.has(item.id) && !item.locked)) { if (key === 'arrowleft') item.x -= amount; if (key === 'arrowright') item.x += amount; if (key === 'arrowup') item.y -= amount; if (key === 'arrowdown') item.y += amount; } });
    }
});
new ResizeObserver(() => { if (!gesture) renderScene(); }).observe(canvas);
const palette = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff', '#800000', '#ff0000', '#ff6600', '#ff9900', '#ffcc00', '#ffff00', '#99cc00', '#00ff00', '#008000', '#008080', '#00ffff', '#00aaff', '#0066ff', '#0000ff', '#000080', '#6600cc', '#9900ff', '#b9a3ed', '#ff00ff', '#ff66aa', '#ffb3cc', '#663300', '#996633'];
for (const color of ['none', ...palette]) {
    const button = document.createElement('button'); button.dataset.color = color;
    if (color !== 'none') button.style.backgroundColor = color;
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    button.title = (color === 'none' ? 'Sin color' : `RGB ${channels.join(', ')} · ${color}`) + ' · Clic izquierdo: relleno · Clic derecho: contorno'; button.setAttribute('aria-label', button.title);
    button.onclick = () => applyPalette(color, 'fill');
    button.oncontextmenu = event => { event.preventDefault(); if (!button.disabled) applyPalette(color, 'stroke'); };
    $('#palette-swatches').append(button);
}
function applyPalette(color, target = 'fill') {
    if (gesture || selected()?.locked) return;
    paletteTarget = target;
    if (target === 'fill') nextFill = color; else nextStroke = color;
    const o = selected();
    const label = target === 'fill' ? 'relleno' : 'contorno';
    if (o) {
        edit(d => { for (const item of d.objects.filter(item => selectedIds.has(item.id) && !item.locked)) { item[target] = color; if (target === 'stroke' && color !== 'none' && item.strokeWidth === 0) item.strokeWidth = HAIRLINE_WIDTH; } });
        status(color === 'none' ? `Sin ${label}` : `Color de ${label} actualizado`);
    } else { render(); status(color === 'none' ? `Sin ${label} para la siguiente figura` : `Color de ${label} elegido para la siguiente figura`); }
}
$('#palette-color').addEventListener('click', () => { paletteTarget = 'fill'; });
$('#palette-color').addEventListener('contextmenu', event => { event.preventDefault(); paletteTarget = 'stroke'; $('#palette-color').showPicker(); });
$('#palette-color').addEventListener('change', event => applyPalette(event.target.value, paletteTarget));

function cloudMessage(message) { $('#cloud-message').textContent = message; }
function cloudState() {
    const user = cloudApi?.user;
    $('#cloud-login').hidden = Boolean(user); $('#cloud-account').hidden = !user;
    $('#cloud-user').textContent = user ? `Sesión: ${user.email || user.uid}` : '';
    $('#cloud-dialog').querySelectorAll('button, input').forEach(element => {
        element.disabled = cloudBusy;
    });
}
async function cloudOperation(operation) {
    if (cloudBusy) return;
    cloudBusy = true; cloudState();
    try { await operation(); } catch (error) { cloudMessage(cloudError(error)); }
    finally { cloudBusy = false; cloudState(); }
}
async function refreshProjects() {
    const list = $('#cloud-projects'); list.replaceChildren();
    cloudMessage('Cargando proyectos…');
    const projects = await cloudApi.list();
    if (!cloudApi.user) { list.replaceChildren(); return; }
    for (const project of projects) {
        const row = document.createElement('button'); row.className = 'cloud-project';
        const title = document.createElement('strong'); title.textContent = project.name || 'Sin título';
        const detail = document.createElement('span');
        detail.textContent = `${project.count ?? 0} objetos · ${project.updatedAt?.toLocaleString('es-MX') || 'Sin fecha'}`;
        row.append(title, detail);
        row.onclick = () => cloudOperation(async () => {
            cloudMessage('Abriendo proyecto…');
            const loaded = await cloudApi.load(project.id);
            // Guard against accidentally discarding edits; loading is also undoable.
            if (!window.confirm('¿Abrir este proyecto y reemplazar el borrador actual? Puedes deshacerlo.')) { cloudMessage('Apertura cancelada.'); return; }
            cancelGesture(); cloudBinding = loaded.binding; cloudSavedJson = JSON.stringify(loaded.document);
            storageBlocked = false; selectOnly(null); commit(loaded.document); persist(); fit();
            $('#cloud-dialog').close(); status('Proyecto cargado desde Firebase');
        });
        list.append(row);
    }
    cloudMessage(projects.length ? 'Selecciona un proyecto para abrirlo.' : 'Todavía no hay proyectos. Guarda el primero en Firebase.');
}
let nameRequest = null;
const needsProjectName = name => !name.trim() || name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'sin titulo';
function ensureProjectName() {
    if (!needsProjectName(history.document.name)) return Promise.resolve(true);
    if (nameRequest) return nameRequest;
    const dialog = $('#name-dialog'), input = $('#project-save-name');
    input.value = ''; input.setCustomValidity(''); dialog.returnValue = '';
    nameRequest = new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const accepted = dialog.returnValue === 'save';
            if (accepted) edit(document => { document.name = input.value.trim(); });
            nameRequest = null; resolve(accepted);
        }, { once: true });
    });
    dialog.showModal(); input.focus();
    return nameRequest;
}
$('#project-save-name').addEventListener('input', event => event.target.setCustomValidity(''));
$('#name-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#project-save-name');
    if (needsProjectName(input.value)) {
        input.setCustomValidity('Escribe un nombre para tu proyecto.'); input.reportValidity(); return;
    }
    $('#name-dialog').close('save');
});
$('#name-cancel').onclick = () => $('#name-dialog').close('cancel');
async function saveCloud(copy = false) {
    if (!await ensureProjectName()) { cloudMessage('Guardado cancelado.'); return; }
    // Capture a snapshot: edits made while the request is in flight stay marked as pending.
    const snapshot = clone(history.document), previousBinding = cloudBinding;
    cloudMessage('Guardando en Firebase…');
    const binding = await cloudApi.save(snapshot, copy ? null : cloudBinding);
    if (cloudBinding === previousBinding) {
        cloudBinding = binding; cloudSavedJson = JSON.stringify(snapshot); persist(); render();
    }
    try {
        await refreshProjects();
        cloudMessage(copy ? 'Copia guardada en Firebase.' : 'Proyecto guardado en Firebase.');
    } catch { cloudMessage('El proyecto se guardó en Firebase, pero no se pudo actualizar la lista.'); }
    status('Proyecto guardado en Firebase');
}
async function showCloud(saveRequested) {
    if (cloudBusy) return;
    pendingSave = saveRequested;
    if (!$('#cloud-dialog').open) $('#cloud-dialog').showModal();
    await cloudOperation(async () => {
        cloudMessage('Conectando con Firebase…');
        if (!cloudApi) {
            cloudApi = await connect();
            cloudApi.watch(() => { cloudState(); if (!cloudApi.user) $('#cloud-projects').replaceChildren(); });
        }
        cloudState();
        if (!cloudApi.user) { cloudMessage('Inicia sesión con tu cuenta del CRM.'); return; }
        if (pendingSave) { pendingSave = false; await saveCloud(); }
        else await refreshProjects();
    });
}
$('#cloud-close').onclick = () => $('#cloud-dialog').close();
$('#cloud-dialog').addEventListener('cancel', event => { if (cloudBusy) event.preventDefault(); });
$('#cloud-save').onclick = () => cloudOperation(() => saveCloud());
$('#cloud-copy').onclick = () => cloudOperation(() => saveCloud(true));
$('#cloud-refresh').onclick = () => cloudOperation(refreshProjects);
$('#cloud-login').addEventListener('submit', event => {
    event.preventDefault();
    cloudOperation(async () => {
        if (!cloudApi) cloudApi = await connect();
        cloudMessage('Iniciando sesión…');
        const password = $('#cloud-password').value;
        $('#cloud-password').value = '';
        await cloudApi.login($('#cloud-email').value.trim(), password);
        cloudState();
        if (pendingSave) { pendingSave = false; await saveCloud(); }
        else await refreshProjects();
    });
});
setTool('select'); render(); fit();
