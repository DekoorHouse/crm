import { History, blankDocument, createObject, clone, validateDocument, validImageSource, objectMarkup, setPaint, POWERCLIP_TYPES, documentKey, forgetImages, exportSvg, makePowerClip, placeInPowerClip, extractPowerClip, objectsWithContents, fitPowerClip } from './model.mjs';
import { icon, decorateControls } from './icons.mjs';
import { RESIZE_HANDLES, resizeBounds, objectReference, fullyContained, snapTranslation, powerClipDropTarget, unionBounds, resizeSelection, resizeRotated, rotatedBounds } from './geometry.mjs';
import { rotateObject, rotatePoint, angleOf, normalizeAngle, pivot, turns } from './transform.mjs';
import { HAIRLINE_WIDTH } from './model.mjs';
import { createColorPicker } from './colorPicker.mjs';
import { pathData } from './path.mjs';
import { presetObject } from './presets.mjs';
import { BITMAP_METHODS, bitmapSize, dpiToStep, toBitmap, pngWithDpi } from './bitmap.mjs';
import { RASTER_PROMPT, rasterModel, linkRasterModel, rasterize } from './rasterize.mjs';
import { pathNodes, movePathNodes, movePathHandle, closestOnPath, insertPathNode, removePathNodes } from './pathEdit.mjs';
import { importSvg, parseColor, dropImages } from './svgImport.mjs';
import { loadDraft, saveDraft } from './draftStore.mjs';
import { powerClipEditDocument, mergePowerClipEdits } from './model.mjs';
import { connect, cloudError } from './cloud.mjs';
import { normalizeSpline, pointsPath, splinePath, splinePoints, closestOnSpline, moveSplineNodes, insertSplineNode, removeSplineNodes, controlPath, closestOnControlLine, legPoint } from './spline.mjs';
import { renderAdjusted, canvasBlob, bakeAdjustedSource, sourceKey } from './imageAdjust.mjs';

decorateControls();

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), scene = $('#scene'), objects = $('#objects'), selection = $('#selection');
let history = new History(), selectedId = null, tool = 'select', gesture = null;
let selectedIds = new Set();
let powerClipSources = null;
let powerClipEditing = null;
// Double-clicking a spline edits its nodes: { id, nodes: Set of point indices }.
let nodeEditing = null;
// PowerClip editing can go several levels deep: each session keeps the history of the level around it
// (parent is the session one level up). The saved document merges every level back into the page.
function savedDocument() {
    let merged = history.document;
    for (let session = powerClipEditing; session; session = session.parent) merged = mergePowerClipEdits(session.history.document, session.id, merged);
    return merged;
}
const powerClipLevels = () => { let levels = 0; for (let session = powerClipEditing; session; session = session.parent) levels++; return levels; };
// Clicking a selected object again swaps its size handles for rotation handles, as in CorelDRAW.
let rotateMode = false;
function setSelection(ids) {
    const next = new Set(ids);
    if (next.size !== selectedIds.size || [...next].some(id => !selectedIds.has(id))) rotateMode = false;
    selectedIds = next; selectedId = [...selectedIds].at(-1) || null;
}
const selectOnly = id => setSelection(id ? [id] : []);
const selectedObjects = () => current().objects.filter(object => selectedIds.has(object.id));
let view = { x: 0, y: 0, scale: 2 }, draft = null;
let storageBlocked = false;
let cloudBinding = null, cloudSavedKey = null, cloudBusy = false, pendingSave = false;
let cloudApi = null;
let nextFill = '#b9a3ed';
let nextStroke = '#352a49';
// The colours for new objects survive a reload in this browser.
try {
    const saved = JSON.parse(localStorage.getItem('dekoor.editor-v2.paint') || 'null'), valid = value => /^(none|#[0-9a-f]{6})$/i.test(value);
    if (valid(saved?.fill)) nextFill = saved.fill;
    if (valid(saved?.stroke)) nextStroke = saved.stroke;
} catch {}
let paletteTarget = 'fill';
let splineDraft = null, splinePointer = null, splineFinishedAt = -Infinity;
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
const editedSpline = () => nodeEditing && current().objects.find(o => o.id === nodeEditing.id);
// Node editing works the same way for splines (control points) and curves (nodes with handles).
const nodeTools = {
    spline: { points: splinePoints, move: moveSplineNodes, remove: removeSplineNodes },
    path: { points: pathNodes, move: movePathNodes, remove: removePathNodes },
};
const status = message => { $('#status').textContent = message; };

try {
    const restored = await loadDraft();
    if (restored) history = new History(restored.document);
    const meta = restored?.meta;
    // Drafts saved before image fingerprints kept the whole document JSON in the metadata.
    const matches = meta && (meta.documentKey ? meta.documentKey === documentKey(history.document) : meta.documentJson === JSON.stringify(history.document));
    if (matches && typeof meta.binding?.id === 'string' && Number.isSafeInteger(meta.binding.revision)) {
        cloudBinding = meta.binding;
        cloudSavedKey = meta.documentKey ? meta.savedKey : meta.savedJson && documentKey(JSON.parse(meta.savedJson));
    }
} catch {
    storageBlocked = true;
    $('#save-status').textContent = 'No se pudo recuperar el borrador. Descarga tu proyecto.';
}

// The draft is written shortly after the last change, so quick repeated edits do not each serialize it.
let persistTimer = null;
function persist() {
    // Preserve unreadable previous data until the user explicitly opens/creates a project.
    if (storageBlocked) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 300);
}
function persistNow() {
    clearTimeout(persistTimer); persistTimer = null;
    forgetUnusedImages();
    if (storageBlocked) return;
    const saved = savedDocument();
    saveDraft(saved, { binding: cloudBinding, savedKey: cloudSavedKey, documentKey: documentKey(saved) })
        .then(() => { $('#save-status').textContent = 'Borrador guardado en este navegador'; })
        .catch(() => { $('#save-status').textContent = 'No se pudo guardar el borrador. Descarga tu proyecto.'; });
}
addEventListener('pagehide', () => { if (persistTimer !== null) persistNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && persistTimer !== null) persistNow(); });
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
    splineDraft = null; splinePointer = null; nodeEditing = null; rotateMode = false;
    tool = next;
    canvas.dataset.tool = next;
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === next);
        button.setAttribute('aria-pressed', String(button.dataset.tool === next));
    });
    renderScene();
    status({ select: 'Selecciona un objeto para moverlo o editarlo', hand: 'Arrastra para desplazar la vista', rect: 'Arrastra para dibujar · Shift: cuadrado', ellipse: 'Arrastra para dibujar · Shift: círculo', text: 'Haz clic para añadir texto', spline: 'Spline: coloca puntos con clics · clic en el primero para cerrarla · Enter o doble clic para terminar · Esc para cancelar' }[next]);
}
function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale };
}
// Photos are shown at the resolution the view needs, never at full size: previews of 256 to 4096 px are
// made in the background, one image at a time, and kept per image while the document uses it. A grey
// placeholder shows until the first preview is ready. Exports still embed the original data.
const PREVIEW_SIZES = [256, 512, 1024, 2048, 4096];
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mO88h8AAq0B1Rl1jWUAAAAASUVORK5CYII=';
const previews = new Map();
let previewQueue = Promise.resolve(), previewRedraw = null;
const previewEntry = src => {
    let entry = previews.get(src);
    if (!entry) previews.set(src, entry = { urls: new Map(), pending: new Map(), natural: Infinity });
    return entry;
};
// The smallest preview size that covers size, or the image itself once it is known to be smaller.
const previewSize = (entry, size) => {
    const level = PREVIEW_SIZES.find(value => value >= size) ?? PREVIEW_SIZES.at(-1);
    return entry.natural <= level ? 'full' : level;
};
function makePreview(src, size) {
    const entry = previewEntry(src);
    if (entry.urls.has(size)) return Promise.resolve(entry.urls.get(size));
    if (!entry.pending.has(size)) {
        const job = previewQueue.then(async () => {
            if (previews.get(src) !== entry) return null;
            const blob = await (await fetch(src)).blob(), bitmap = await createImageBitmap(blob);
            entry.natural = Math.max(bitmap.width, bitmap.height);
            let out = blob;
            if (size !== 'full' && entry.natural > size) {
                const scale = size / entry.natural, canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                out = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .92)) || blob;
            }
            bitmap.close();
            const key = size !== 'full' && entry.natural > size ? size : 'full';
            if (previews.get(src) !== entry) return null;
            if (!entry.urls.has(key)) entry.urls.set(key, URL.createObjectURL(out));
            return entry.urls.get(key);
        }).finally(() => {
            entry.pending.delete(size);
            clearTimeout(previewRedraw);
            previewRedraw = setTimeout(() => { if (!gesture) renderScene(); }, 60);
        });
        entry.pending.set(size, job);
        previewQueue = job.catch(() => {});
    }
    return entry.pending.get(size);
}
function displaySrc(src, o) {
    if (!src.startsWith('data:')) return src;
    const entry = previewEntry(src);
    const size = o.pixelated ? 'full' : previewSize(entry, Math.max(o.width, o.height) * view.scale * (window.devicePixelRatio || 1));
    if (entry.urls.has(size)) return entry.urls.get(size);
    makePreview(src, size).catch(() => status('No se pudo mostrar una imagen.'));
    // Meanwhile show the closest preview already made: a larger one first, then a smaller one.
    const ready = [...entry.urls.keys()].map(key => key === 'full' ? entry.natural : key).sort((a, b) => a - b);
    const wanted = size === 'full' ? entry.natural : size, best = ready.find(value => value >= wanted) ?? ready.at(-1);
    if (best === undefined) return PLACEHOLDER;
    return entry.urls.get(best === entry.natural && entry.urls.has('full') ? 'full' : best);
}
// Previews, fingerprints and checks are kept only for images the document or its undo history still uses.
function forgetUnusedImages() {
    const live = new Set();
    const stores = [history];
    for (let session = powerClipEditing; session; session = session.parent) stores.push(session.history);
    for (const store of stores) {
        for (const document of [store.document, ...store.past, ...store.future]) {
            for (const object of objectsWithContents(document.objects)) if (object.type === 'image') live.add(object.src);
        }
    }
    forgetImages(live);
    for (const [src, entry] of previews) if (!live.has(src)) { entry.urls.forEach(url => URL.revokeObjectURL(url)); previews.delete(src); }
}
// A 1-bit image shown smaller than its pixels would sample stray dots and look noisy, so on screen
// it is smoothed until each of its pixels covers a screen pixel. Exports always keep square pixels.
// Its size on screen is measured, so images inside PowerClips (scaled with their container) count too.
function smoothSmallBitmaps(root, object) {
    for (const element of root.querySelectorAll('image[data-bitmap]')) {
        const item = [...objectsWithContents([object])].find(entry => entry.id === element.dataset.bitmap);
        const natural = item && previews.get(item.src)?.natural, box = element.getBoundingClientRect();
        if (natural && natural !== Infinity && Math.max(box.width, box.height) * (window.devicePixelRatio || 1) >= natural) continue;
        element.removeAttribute('image-rendering'); element.style.removeProperty('image-rendering');
    }
}
function renderScene() {
    $('#hover-reference').replaceChildren();
    const d = current();
    scene.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    $('#paper').setAttribute('width', d.width); $('#paper').setAttribute('height', d.height);
    objects.replaceChildren();
    for (const object of d.objects) {
        if (object.hidden) continue;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Markup comes only from validated primitives, never from imported SVG.
        group.innerHTML = objectMarkup(object, displaySrc);
        showAdjustedImages(group);
        if (object.powerClip) drawPowerClipMarker(group, object);
        // Thin lines get a wider invisible stroke so they are easy to click.
        if ((object.type === 'spline' || (object.type === 'path' && object.fill === 'none')) && !object.locked) {
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitArea.setAttribute('d', object.type === 'spline' ? splinePath(object) : pathData(object)); hitArea.setAttribute('fill', 'none');
            if (turns(object)) hitArea.setAttribute('transform', rotateAttr(object));
            hitArea.setAttribute('stroke', 'transparent'); hitArea.setAttribute('stroke-width', Math.max(object.strokeWidth, 10 / view.scale));
            hitArea.setAttribute('pointer-events', 'stroke'); group.append(hitArea);
        }
        group.dataset.id = object.id;
        group.setAttribute('pointer-events', object.locked ? 'none' : 'all');
        objects.append(group);
        smoothSmallBitmaps(group, object);
    }
    if (powerClipEditing) {
        // The container outline goes above the content, with a dark halo so it shows over any image;
        // clicks pass through to the content underneath.
        const frame = { ...powerClipEditing.history.document.objects.find(item => item.id === powerClipEditing.id), powerClip: undefined, fill: 'none' };
        svgElement('g', { 'pointer-events': 'none', 'data-powerclip-frame': 'true' }, objects).innerHTML =
            objectMarkup({ ...frame, stroke: '#0b1f26', strokeWidth: 4 / view.scale, strokeGradient: undefined }) + objectMarkup({ ...frame, stroke: '#22d3ee', strokeWidth: 1.5 / view.scale, strokeGradient: undefined });
    }
    selection.replaceChildren();
    for (const o of selectedObjects()) {
      if (nodeEditing?.id === o.id && nodeTools[o.type] && !o.hidden) { drawNodes(o); continue; }
      if (!o.hidden) {
        // A rotated object gets its own frame turned with it, so the handles follow its sides.
        const unit = 1 / view.scale, bounds = turns(o) ? localBox(o) : getBounds(o);
        const frame = turns(o) ? svgElement('g', { transform: rotateAttr(o) }, selection) : selection;
        svgElement('rect', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'pointer-events': 'none' }, frame);
        if (!o.locked && selectedIds.size === 1) {
            if (rotateMode) drawRotateHandles(bounds, frame);
            else if (o.type !== 'text') drawResizeHandles(bounds, false, frame);
        }
      }
    }
    // Several objects: one dashed box around the ones that can be scaled, with its own handles.
    const scalable = selectedObjects().filter(item => !item.hidden && !item.locked);
    if (selectedIds.size > 1 && scalable.length) {
        const box = unionBounds(scalable.map(getBounds)), unit = 1 / view.scale;
        if (box.width >= .1 && box.height >= .1) {
            svgElement('rect', { ...box, fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'stroke-dasharray': `${4 * unit} ${3 * unit}`, 'pointer-events': 'none' }, selection);
            if (rotateMode) drawRotateHandles(box, selection); else drawResizeHandles(box, true);
        }
    }
    if (rotateMode && scalable.length && !nodeEditing) drawRotationCentre(gesture?.type === 'rotate' ? gesture.centre : selectionCentre(scalable));
    if (['marquee', 'node-marquee'].includes(gesture?.type) && gesture.area) {
        const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ ...gesture.area, fill: '#a78bfa', 'fill-opacity': .12, stroke: '#c4b5fd', 'stroke-width': 1 / view.scale, 'stroke-dasharray': `${4 / view.scale} ${3 / view.scale}`, 'pointer-events': 'none' })) box.setAttribute(key, value);
        selection.append(box);
    }
    $('#zoom-label').textContent = `${Math.round(view.scale / (96 / 25.4) * 100)}%`;
    renderSplinePreview();
    renderPowerClipToolbar();
    if (gesture?.dropTarget) drawPowerClipDrop(gesture.dropTarget);
    else if (gesture?.dropHint) drawPowerClipDrop(gesture.dropHint, true);
}
function svgElement(tag, attributes, parent) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.append(element); return element;
}
// Reduce the outer gap of handles when zooming out; keep the node itself free to drag.
const handleOffset = () => 4 + Math.max(1, Math.min(4, 4 * view.scale / (96 / 25.4)));
function drawResizeHandles(bounds, group = false, parent = selection) {
    const unit = 1 / view.scale, offset = handleOffset();
    for (const control of RESIZE_HANDLES) {
        const handle = svgElement('rect', { x: bounds.x + bounds.width * control.x + ((control.x * 2 - 1) * offset - 4) * unit, y: bounds.y + bounds.height * control.y + ((control.y * 2 - 1) * offset - 4) * unit, width: 8 * unit, height: 8 * unit, fill: 'white', stroke: '#8b5bd1', 'stroke-width': unit, cursor: control.cursor, 'data-handle': control.name }, parent);
        if (group) handle.dataset.group = 'true';
    }
}
// Round rotation handles on the corners, like CorelDRAW's curved arrows.
function drawRotateHandles(bounds, parent) {
    const unit = 1 / view.scale, offset = handleOffset();
    for (const control of RESIZE_HANDLES.filter(item => item.name.length === 2)) {
        svgElement('circle', { cx: bounds.x + bounds.width * control.x + (control.x * 2 - 1) * offset * unit, cy: bounds.y + bounds.height * control.y + (control.y * 2 - 1) * offset * unit, r: 5 * unit, fill: '#8b5bd1', stroke: 'white', 'stroke-width': 1.5 * unit, 'data-rotate': control.name }, parent);
    }
}
function drawRotationCentre(c) {
    const unit = 1 / view.scale, marker = svgElement('g', { 'pointer-events': 'none' }, selection);
    svgElement('circle', { cx: c.x, cy: c.y, r: 6 * unit, fill: 'none', stroke: '#8b5bd1', 'stroke-width': 1.5 * unit }, marker);
    svgElement('circle', { cx: c.x, cy: c.y, r: 1.5 * unit, fill: '#8b5bd1' }, marker);
}
// Rotation turns around the centre of the page-aligned box of the objects being rotated.
function selectionCentre(items) {
    const box = unionBounds(items.map(getBounds));
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
function drawNodes(o) {
    if (o.type === 'path') { drawPathNodes(o); return; }
    const unit = 1 / view.scale, nodes = splinePoints(o);
    // Dashed control line between the control points, as in CorelDRAW; the curve is highlighted over it.
    svgElement('path', { d: controlPath(nodes, o.closed), fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'stroke-dasharray': `${4 * unit} ${3 * unit}`, 'pointer-events': 'none' }, selection);
    svgElement('path', { d: splinePath(o), fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'pointer-events': 'none' }, selection);
    nodes.forEach((p, index) => {
        const active = nodeEditing.nodes.has(index);
        svgElement('rect', { x: p.x - 4 * unit, y: p.y - 4 * unit, width: 8 * unit, height: 8 * unit, fill: active ? '#8b5bd1' : 'white', stroke: active ? 'white' : '#8b5bd1', 'stroke-width': unit, cursor: 'move', 'data-node': index }, selection);
    });
}
function drawPathNodes(o) {
    const unit = 1 / view.scale, nodes = pathNodes(o);
    svgElement('path', { d: pathData(o), fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'pointer-events': 'none', ...(turns(o) ? { transform: rotateAttr(o) } : {}) }, selection);
    // Handles of the selected nodes: a line from the node and a round grip, as in CorelDRAW.
    for (const index of nodeEditing.nodes) {
        const node = nodes[index]; if (!node) continue;
        for (const side of ['in', 'out']) {
            const handle = node[side]; if (!handle || Math.hypot(handle.x - node.x, handle.y - node.y) * view.scale < .5) continue;
            svgElement('line', { x1: node.x, y1: node.y, x2: handle.x, y2: handle.y, stroke: '#8b5bd1', 'stroke-width': unit, 'stroke-dasharray': `${3 * unit} ${2 * unit}`, 'pointer-events': 'none' }, selection);
            svgElement('circle', { cx: handle.x, cy: handle.y, r: 3.5 * unit, fill: '#8b5bd1', stroke: 'white', 'stroke-width': unit, cursor: 'move', 'data-node-handle': `${index}:${side}` }, selection);
        }
    }
    nodes.forEach((p, index) => {
        const active = nodeEditing.nodes.has(index);
        svgElement('rect', { x: p.x - 4 * unit, y: p.y - 4 * unit, width: 8 * unit, height: 8 * unit, fill: active ? '#8b5bd1' : 'white', stroke: active ? 'white' : '#8b5bd1', 'stroke-width': unit, cursor: 'move', 'data-node': index }, selection);
    });
}
// SVG transform that turns editor overlays with a rotated object (see transform.mjs).
const rotateAttr = o => `rotate(${-o.rotation} ${pivot(o).x} ${pivot(o).y})`;
function drawPowerClipMarker(group, object) {
    if (object.powerClip.objects.length) return;
    const { x, y, width, height } = object;
    const overlay = svgElement('g', { 'pointer-events': 'none', 'data-editor-marker': 'powerclip', ...(turns(object) ? { transform: rotateAttr(object) } : {}) }, group);
    if (!object.powerClip.objects.length) svgElement('path', { d: `M${x + width * .2} ${y + height * .2}L${x + width * .8} ${y + height * .8}M${x + width * .8} ${y + height * .2}L${x + width * .2} ${y + height * .8}`, stroke: '#64748b', 'stroke-width': 1 / view.scale, opacity: .65 }, overlay);
    const size = Math.min(12 / view.scale, width / 5, height / 5), cx = x + width / 2, cy = y + height / 2;
    svgElement('rect', { x: cx - size * 1.2, y: cy - size * .8, width: size * 2.4, height: size * 1.6, rx: size * .3, fill: '#18343d', opacity: .85 }, overlay);
    svgElement('text', { x: cx, y: cy + size * .35, 'text-anchor': 'middle', 'font-size': size, fill: '#a5f3fc', 'font-family': 'Arial, sans-serif' }, overlay).textContent = 'PC';
}
// waiting: a PowerClip with content is only outlined until W is held.
function drawPowerClipDrop(target, waiting = false) {
    const overlay = $('#hover-reference'); overlay.replaceChildren();
    const g = svgElement('g', { transform: `translate(${view.x} ${view.y}) scale(${view.scale})${turns(target) ? ' ' + rotateAttr(target) : ''}` }, overlay);
    const shape = waiting ? { fill: 'none', stroke: '#22d3ee', 'stroke-width': 1.5 / view.scale, 'stroke-dasharray': `${6 / view.scale} ${4 / view.scale}` }
        : { fill: '#22d3ee', 'fill-opacity': .2, stroke: '#22d3ee', 'stroke-width': 2 / view.scale };
    if (target.type === 'path') svgElement('path', { d: pathData(target), ...shape }, g);
    else if (target.type === 'ellipse') svgElement('ellipse', { cx: target.x + target.width / 2, cy: target.y + target.height / 2, rx: target.width / 2, ry: target.height / 2, ...shape }, g);
    else svgElement('rect', { x: target.x, y: target.y, width: target.width, height: target.height, ...shape }, g);
    const text = waiting ? 'Mantén W para colocar dentro del PowerClip' : 'Soltar para colocar dentro del PowerClip', width = Math.round(text.length * 5.6 + 18);
    const x = Math.max(4, Math.min(canvas.clientWidth - width - 4, view.x + target.x * view.scale));
    const y = Math.max(4, Math.min(canvas.clientHeight - 32, view.y + target.y * view.scale - 36));
    svgElement('rect', { x, y, width, height: 28, rx: 5, fill: '#10343d', stroke: '#22d3ee' }, overlay);
    svgElement('text', { x: x + 10, y: y + 18, fill: '#a5f3fc', 'font-size': 12 }, overlay).textContent = text;
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
    // Over the first point, preview the closed curve that a click would create.
    const closing = Boolean(splinePointer) && closesSpline(splinePointer);
    const points = splinePointer && !closing ? [...splineDraft, splinePointer] : splineDraft;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pointsPath(points, closing)); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#22d3ee');
    path.setAttribute('stroke-width', 1.5 / view.scale); preview.append(path);
    svgElement('path', { d: controlPath(points, closing), fill: 'none', stroke: '#22d3ee', 'stroke-width': 1 / view.scale, 'stroke-dasharray': `${4 / view.scale} ${3 / view.scale}`, opacity: .7 }, preview);
    for (const p of splineDraft) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        node.setAttribute('cx', p.x); node.setAttribute('cy', p.y); node.setAttribute('r', (closing && p === splineDraft[0] ? 5 : 3) / view.scale);
        node.setAttribute('fill', '#22d3ee'); preview.append(node);
    }
}
// With three or more points, clicking the first one closes the spline.
const closesSpline = p => splineDraft?.length >= 3 && Math.hypot(p.x - splineDraft[0].x, p.y - splineDraft[0].y) * view.scale <= 7;
function finishSpline(closed = false) {
    if (!splineDraft || splineDraft.length < 2) { status('Coloca al menos dos puntos para terminar la spline.'); return; }
    const shape = { ...createObject('spline', 0, 0), ...normalizeSpline(splineDraft, closed), fill: closed ? nextFill : 'none', stroke: nextStroke, ...(closed ? { closed: true } : {}) };
    splineDraft = null; splinePointer = null; splineFinishedAt = performance.now(); selectOnly(shape.id);
    edit(document => document.objects.push(shape)); setTool('select');
    status(closed ? 'Spline cerrada creada' : 'Spline creada');
}
// The page-aligned box around an object as drawn, rotation included.
function getBounds(o) {
    if (o.type === 'text') {
        const group = [...objects.children].find(g => g.dataset.id === o.id);
        if (group) return group.getBBox();
    }
    return rotatedBounds(o);
}
// An object's box in its own, unrotated frame (the rendered text box for text).
function localBox(o) {
    const text = o.type === 'text' && [...objects.children].find(g => g.dataset.id === o.id)?.querySelector('text');
    return text ? text.getBBox() : { x: o.x, y: o.y, width: o.width, height: o.height };
}
function render() {
    $('#powerclip-edit-bar').hidden = !powerClipEditing;
    $('#powerclip-edit-label').textContent = powerClipLevels() > 1 ? `Editando PowerClip · nivel ${powerClipLevels()}` : 'Editando contenido de PowerClip';
    for (const selector of ['#document-name', '#page-width', '#page-height', '#page-preset']) $(selector).disabled = Boolean(powerClipEditing);
    setSelection([...selectedIds].filter(id => current().objects.some(object => object.id === id)));
    // Leave node editing when its spline is deselected, hidden, locked or removed.
    const edited = editedSpline();
    if (nodeEditing && (!nodeTools[edited?.type] || edited.locked || edited.hidden || selectedIds.size !== 1 || !selectedIds.has(edited.id))) nodeEditing = null;
    if (nodeEditing) { const count = nodeTools[edited.type].points(edited).length; nodeEditing.nodes = new Set([...nodeEditing.nodes].filter(index => index < count)); }
    const d = history.document, o = selected();
    $('.inspector').hidden = !o;
    $('#cloud-badge').hidden = !o;
    renderScene();
    // Fill and outline chips: the selected object's colours, or the ones new objects will get.
    const paint = o || { fill: nextFill, stroke: nextStroke };
    $('#paint-caption').textContent = o ? (selectedIds.size > 1 ? 'Selección' : 'Objeto') : 'Nuevos objetos';
    for (const [key, chip] of [['fill', $('#fill-chip')], ['stroke', $('#stroke-chip')]]) {
        const value = paint[key], name = key === 'fill' ? 'Relleno' : 'Contorno';
        chip.classList.toggle('none', value === 'none');
        chip.style[key === 'fill' ? 'backgroundColor' : 'borderColor'] = value === 'none' ? '' : value;
        // A gradient shows as a strip of its colours.
        const gradient = o?.[key + 'Gradient'] && value !== 'none' ? `linear-gradient(90deg, ${o[key + 'Gradient'].stops.map(stop => `${stop.color} ${stop.offset * 100}%`).join(', ')})` : '';
        if (key === 'fill') chip.style.backgroundImage = gradient; else chip.style.borderImage = gradient ? `${gradient} 1` : '';
        chip.title = `${name}: ${value === 'none' ? 'sin color' : value} · Clic: color personalizado`; chip.setAttribute('aria-label', chip.title);
        chip.disabled = Boolean(o?.locked);
    }
    const paletteColor = o ? o[paletteTarget] : paletteTarget === 'fill' ? nextFill : nextStroke;
    document.querySelectorAll('[data-color]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.color === paletteColor));
        button.disabled = Boolean(o?.locked);
    });
    $('#stroke-menu-label').hidden = !o;
    const strokeMenu = $('#stroke-menu'), widths = selectedObjects().map(item => item.strokeWidth);
    const sameWidth = widths.every(value => Math.abs(value - widths[0]) < 1e-8);
    strokeMenu.value = sameWidth ? ([...strokeMenu.options].find(option => option.value !== 'custom' && Math.abs(Number(option.value) - widths[0]) < 1e-8)?.value || 'custom') : 'custom';
    strokeMenu.disabled = !selectedObjects().some(item => !item.locked);
    $('#cloud-badge').textContent = cloudBinding ? (documentKey(d) === cloudSavedKey ? 'Guardado en Firebase' : 'Cambios sin guardar en Firebase') : 'Proyectos en Firebase';
    $('#document-name').value = d.name;
    $('#display-unit').value = displayUnit;
    $('#page-preset').value = Object.keys(pagePresets).find(key => Math.abs(d.width - pagePresets[key].width) < .001 && Math.abs(d.height - pagePresets[key].height) < .001) || 'custom';
    document.querySelectorAll('[data-unit]').forEach(element => { element.textContent = displayUnit === 'in' ? 'pulg' : 'mm'; });
    for (const key of ['width', 'height']) {
        const input = $('#page-' + key); input.min = 1 / unitFactor(); input.max = 5000 / unitFactor(); input.value = displayMeasure(d[key]);
    }
    $('#empty-selection').hidden = Boolean(o); $('#properties').hidden = !o || selectedIds.size > 1;
    $('#multi-selection').hidden = selectedIds.size < 2;
    $('#multi-selection').textContent = `${selectedIds.size} objetos seleccionados. Puedes moverlos juntos, escalarlos con los controles del recuadro (clic otra vez para girarlos), cambiar el contorno o eliminarlos.`;
    $('#selection-kind').textContent = selectedIds.size > 1 ? `${selectedIds.size} objetos` : o ? ({ rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto', spline: 'Spline', image: 'Imagen', path: 'Curva' }[o.type] + (o.closed ? ' cerrada' : '') + (o.powerClip ? ' · PowerClip' : '') + (nodeEditing ? ' · nodos' : '') + (o.locked ? ' · bloqueado' : '')) : 'Documento';
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
        $('#rotation-input').value = Number((o.rotation || 0).toFixed(2)); $('#rotation-input').disabled = o.locked;
        $('#image-properties').hidden = o.type !== 'image';
        if (o.type === 'image') {
            for (const input of adjustInputs) { input.value = o.adjust?.[input.dataset.imageAdjust] ?? 0; input.disabled = o.locked; }
            $('#image-invert').checked = Boolean(o.adjust?.invert); $('#image-invert').disabled = o.locked;
            $('#image-adjust-reset').disabled = o.locked || !o.adjust;
            showAdjustValues();
        }
    }
    $('[data-action="undo"]').disabled = !history.past.length;
    $('[data-action="redo"]').disabled = !history.future.length;
    for (const action of ['delete', 'duplicate', 'forward', 'backward', 'rotate-left', 'rotate-right']) $('[data-action="' + action + '"]').disabled = !o || o.locked;
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

let lastClick = null;
canvas.addEventListener('pointerdown', event => {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    const nodeTarget = event.target.closest('[data-node]'), node = nodeTarget ? Number(nodeTarget.dataset.node) : null;
    const edited = editedSpline();
    // While editing nodes, the curve and its control line take the clicks within the reference tolerance.
    // A double click adds a control point where the control line was clicked, or on the leg that
    // drives the clicked part of the curve.
    const near = hit => Boolean(hit) && hit.distance * view.scale <= 7;
    const handleTarget = event.target.closest('[data-node-handle]'), nodeHandle = handleTarget && handleTarget.dataset.nodeHandle.split(':');
    const isPath = edited?.type === 'path', free = edited && node === null && !nodeHandle;
    const lineHit = free && !isPath ? closestOnControlLine(edited, point(event)) : null;
    const curveHit = free ? (isPath ? closestOnPath(edited, point(event)) : closestOnSpline(edited, point(event))) : null;
    const insertAt = near(lineHit) ? lineHit : near(curveHit) ? (isPath ? curveHit : legPoint(edited, curveHit)) : null;
    const clickedId = insertAt ? edited.id : event.target.closest('[data-id]')?.dataset.id;
    if (event.button === 0 && tool === 'select' && !powerClipSources) {
        const previous = lastClick;
        lastClick = { id: clickedId, node, time: event.timeStamp, x: event.clientX, y: event.clientY };
        if (previous && (clickedId || node !== null) && previous.id === clickedId && previous.node === node && event.timeStamp - previous.time < 500 &&
            Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 5 && doubleClick(event, clickedId, node, insertAt)) {
            // Keep the browser from selecting page text on the second click.
            event.preventDefault(); lastClick = null; return;
        }
    }
    hideObjectMenu();
    if (powerClipSources && event.button === 0) {
        event.preventDefault();
        const id = event.target.closest('[data-id]')?.dataset.id;
        try {
            const next = clone(history.document); centreOn(next, powerClipSources, point(event)); placeInPowerClip(next, powerClipSources, id, { createContainer: true });
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
        if (closesSpline(start)) { finishSpline(true); return; }
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
    if (edited) {
        if (nodeHandle) {
            draft = clone(history.document);
            gesture = { type: 'node-handle', start, pointerId: event.pointerId, original: clone(edited), index: Number(nodeHandle[0]), side: nodeHandle[1] };
            render(); return;
        }
        if (node !== null) {
            if (!event.shiftKey) { if (!nodeEditing.nodes.has(node)) nodeEditing.nodes = new Set([node]); }
            else if (!nodeEditing.nodes.delete(node)) nodeEditing.nodes.add(node);
            if (nodeEditing.nodes.has(node)) {
                draft = clone(history.document);
                gesture = { type: 'nodes', start, pointerId: event.pointerId, original: clone(edited), indices: [...nodeEditing.nodes], anchor: nodeTools[edited.type].points(edited)[node], snapTargets: snapTargets() };
            }
            render(); return;
        }
        if (!clickedId || clickedId === edited.id) {
            gesture = { type: 'node-marquee', start, pointerId: event.pointerId, originalNodes: new Set(nodeEditing.nodes), additive: event.shiftKey, onObject: Boolean(clickedId) };
            if (!event.shiftKey) nodeEditing.nodes = new Set();
            render(); return;
        }
        // Clicking another object leaves node editing and selects it as usual.
        nodeEditing = null;
    }
    // Rotation handles turn the selection around its centre; Ctrl keeps the angle to steps of 15°.
    if (event.target.closest('[data-rotate]')) {
        const items = selectedObjects().filter(item => !item.hidden && !item.locked);
        if (items.length) {
            const centre = selectionCentre(items);
            draft = clone(history.document);
            gesture = { type: 'rotate', start, centre, startAngle: angleOf(start, centre), originals: clone(items), pointerId: event.pointerId };
        }
        render(); return;
    }
    const target = event.target.closest('[data-id]');
    const handle = event.target.closest('[data-handle]');
    const hit = !handle ? referenceAt(start) : null;
    const targetId = hit?.target.id || target?.dataset.id;
    if (!handle && !targetId) {
        gesture = { type: 'marquee', start, originalIds: [...selectedIds], pointerId: event.pointerId };
        selectOnly(null); render(); return;
    }
    if (handle?.dataset.group) {
        const items = selectedObjects().filter(item => !item.hidden && !item.locked);
        draft = clone(history.document);
        gesture = { type: 'resize-group', handle: handle.dataset.handle, start, originals: clone(items), box: unionBounds(items.map(getBounds)), pointerId: event.pointerId };
        render(); return;
    }
    // A plain click on an object that was already selected switches between size and rotation handles.
    const reselect = !handle && selectedIds.has(targetId);
    if (!handle && !selectedIds.has(targetId)) selectOnly(targetId);
    const o = selected();
    if (o && !o.locked && !o.hidden) {
        draft = clone(history.document);
        gesture = { type: handle ? 'resize' : 'move', handle: handle?.dataset.handle, start, original: clone(o), originals: clone(selectedObjects().filter(item => !item.locked)), pointerId: event.pointerId, reselect };
        gesture.anchor = hit?.reference || start;
        gesture.snapTargets = snapTargets();
    }
    render();
});
// Text snaps to its rendered box; every other object keeps its geometry and rotation.
// The page itself is also a target: its corners, edge midpoints, centre and edges.
function snapTargets() {
    const d = current(), page = { id: '__page', type: 'rect', page: true, x: 0, y: 0, width: d.width, height: d.height, hidden: false };
    return [page, ...d.objects.map(item => {
        if (item.type !== 'text') return item;
        const bounds = getBounds(item);
        return { ...item, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    })];
}
const referenceLabel = ({ target, reference }) => target?.page ? `${reference.label === 'Nodo' ? 'Esquina' : reference.label} de página` : reference.label;
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
    if (gesture || nodeEditing || tool === 'hand' || event.pointerType === 'touch' || event.target.closest('[data-handle]')) return;
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
        const outline = add('g', { transform: `translate(${view.x} ${view.y}) scale(${view.scale})${turns(target) ? ' ' + rotateAttr(target) : ''}` });
        const attrs = { fill: 'none', stroke: '#22d3ee', 'stroke-width': 1.5 / view.scale };
        if (target.type === 'spline') add('path', { d: splinePath(target), ...attrs }, outline);
        else if (target.type === 'path') add('path', { d: pathData(target), ...attrs }, outline);
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
    const text = referenceLabel({ target, reference }), labelWidth = text.length * 7 + 18;
    const labelX = Math.max(4, Math.min(canvas.clientWidth - labelWidth - 4, x + 14));
    const labelY = Math.max(4, Math.min(canvas.clientHeight - 28, y + 14));
    add('rect', { x: labelX, y: labelY, width: labelWidth, height: 24, rx: 5, fill: '#102b35', stroke: '#22d3ee', 'stroke-width': 1 });
    add('text', { x: labelX + 9, y: labelY + 16, fill: '#a5f3fc', 'font-size': 12, 'font-weight': 600 }).textContent = text;
}
canvas.addEventListener('pointerleave', () => { $('#hover-reference').replaceChildren(); canvas.style.cursor = ''; });
canvas.addEventListener('pointermove', event => {
    if (tool === 'spline' && splineDraft && !gesture) {
        splinePointer = point(event); renderSplinePreview(); showReference(event);
        if (closesSpline(splinePointer)) drawReference({ reference: { ...splineDraft[0], label: 'Cerrar curva' } });
        return;
    }
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
    if (gesture.type === 'node-marquee') {
        gesture.area = { x: Math.min(p.x, gesture.start.x), y: Math.min(p.y, gesture.start.y), width: Math.abs(dx), height: Math.abs(dy) };
        gesture.moved ||= Math.hypot(dx, dy) * view.scale > 3;
        const inside = nodeTools[o.type].points(o).flatMap((node, index) => fullyContained(gesture.area, { ...node, width: 0, height: 0 }) ? [index] : []);
        nodeEditing.nodes = new Set([...(gesture.additive ? gesture.originalNodes : []), ...inside]);
    }
    if (gesture.type === 'nodes') {
        const movement = snapTranslation(gesture.anchor, { x: dx, y: dy }, gesture.snapTargets, new Set([o.id]), 7 / view.scale);
        gesture.moved ||= Math.hypot(dx, dy) * view.scale > 3;
        gesture.snap = gesture.moved ? movement.hit : null;
        // Below the drag threshold, keep the exact original geometry so a click does not add an undo step.
        Object.assign(o, gesture.moved && (movement.x || movement.y) ? nodeTools[o.type].move(gesture.original, gesture.indices, movement.x, movement.y) : clone(gesture.original));
    }
    if (gesture.type === 'node-handle') {
        gesture.moved ||= Math.hypot(dx, dy) * view.scale > 3;
        Object.assign(o, gesture.moved ? movePathHandle(gesture.original, gesture.index, gesture.side, p) : clone(gesture.original));
    }
    if (gesture.type === 'move') {
        const movement = snapTranslation(gesture.anchor, { x: dx, y: dy }, gesture.snapTargets, selectedIds, 7 / view.scale);
        gesture.snap = movement.hit;
        for (const original of gesture.originals) { const item = draft.objects.find(item => item.id === original.id); item.x = original.x + movement.x; item.y = original.y + movement.y; }
        gesture.moved ||= Math.hypot(dx, dy) * view.scale > 4;
        gesture.pointer = p; updatePowerClipDrop(gesture);
    }
    if (gesture.type === 'draw') { gesture.delta = { x: dx, y: dy }; sizeDrawing(o, event.ctrlKey || event.metaKey); }
    if (gesture.type === 'resize-group') {
        for (const item of resizeSelection(gesture.originals, gesture.box, gesture.handle, dx, dy)) Object.assign(draft.objects.find(object => object.id === item.id), item);
    }
    if (gesture.type === 'rotate') {
        let delta = normalizeAngle(angleOf(p, gesture.centre) - gesture.startAngle);
        // Ctrl: one object lands on multiples of 15°; a group turns in steps of 15°.
        const [single] = gesture.originals.length === 1 ? gesture.originals : [];
        if (event.ctrlKey) delta = single ? Math.round(((single.rotation || 0) + delta) / 15) * 15 - (single.rotation || 0) : Math.round(delta / 15) * 15;
        // Without Ctrl, right angles hold the rotation within 4° so they are easy to hit.
        else {
            const base = single ? single.rotation || 0 : 0, right = Math.round((base + delta) / 90) * 90;
            if (Math.abs(base + delta - right) <= 4) delta = right - base;
        }
        for (const item of gesture.originals) Object.assign(draft.objects.find(object => object.id === item.id), rotateObject(item, gesture.centre, delta));
        status(gesture.originals.length === 1 ? `Rotación: ${formatAngle((gesture.originals[0].rotation || 0) + delta)}` : `Giro: ${formatAngle(delta)}`);
    }
    if (gesture.type === 'resize') {
        Object.assign(o, turns(gesture.original) ? resizeRotated(gesture.original, gesture.handle, dx, dy) : resizeBounds(gesture.original, gesture.handle, dx, dy));
    }
    renderScene();
    if (['move', 'nodes'].includes(gesture.type) && gesture.snap && !gesture.dropTarget && !gesture.dropHint) drawReference(gesture.snap);
});
canvas.addEventListener('dblclick', event => {
    if (tool === 'spline') { event.preventDefault(); finishSpline(); return; }
    // pointerdown already handles double clicks while editing nodes, and a click that just closed
    // a spline must not turn the rest of that double click into node editing.
    if (nodeEditing || event.timeStamp - splineFinishedAt < 500) return;
    if (!beginNodeEditing(event.target.closest('[data-id]')?.dataset.id || selectedId, point(event))) beginPowerClipEditing(event);
});
function doubleClick(event, id, node, insertAt) {
    if (!nodeEditing) return beginNodeEditing(id, point(event)) || beginPowerClipEditing(event);
    if (node !== null) { deleteNodes([node]); return true; }
    if (!insertAt) return false;
    addNode(insertAt); return true;
}
// A curve that is a PowerClip edits its nodes only when double-clicked on its outline; inside, the double
// click opens its content, as in CorelDRAW.
function beginNodeEditing(id, at) {
    const target = current().objects.find(item => item.id === id);
    if (tool !== 'select' || powerClipSources || !nodeTools[target?.type] || target.locked || target.hidden) return false;
    if (target.powerClip && !(at && closestOnPath(target, at).distance * view.scale <= 7)) return false;
    nodeEditing = { id, nodes: new Set() }; selectOnly(id); rotateMode = false; render();
    status(target.type === 'path' ? 'Nodos: arrastra nodos o manijas (elige un nodo para ver sus manijas) · doble clic en la curva añade · doble clic en un nodo o Supr elimina · Esc termina'
        : 'Nodos: arrastra para mover · doble clic en la curva añade · doble clic en un nodo o Supr elimina · Esc termina');
    return true;
}
function finishNodeEditing() {
    nodeEditing = null; render(); status('Edición de nodos terminada');
}
function addNode(hit) {
    try {
        const id = nodeEditing.id, edited = editedSpline();
        const { geometry, node } = edited.type === 'path' ? insertPathNode(edited, hit) : { geometry: insertSplineNode(edited, hit), node: hit.index + 1 };
        nodeEditing.nodes = new Set([node]);
        edit(d => Object.assign(d.objects.find(item => item.id === id), geometry));
        status('Nodo añadido');
    } catch (error) { status(error.message); }
}
function deleteNodes(indices) {
    if (!indices.length) { status('Selecciona los nodos que quieres eliminar.'); return; }
    try {
        const id = nodeEditing.id, edited = editedSpline(), geometry = nodeTools[edited.type].remove(edited, indices);
        nodeEditing.nodes = new Set();
        edit(d => Object.assign(d.objects.find(item => item.id === id), geometry));
        status(indices.length === 1 ? 'Nodo eliminado' : `${indices.length} nodos eliminados`);
    } catch (error) { status(error.message); }
}
function beginPowerClipEditing(event) {
    if (tool !== 'select' || powerClipSources) return false;
    const id = event.target.closest('[data-id]')?.dataset.id || selectedId;
    const target = history.document.objects.find(item => item.id === id);
    if (!target?.powerClip || target.locked) return false;
    event.preventDefault(); finishPropertyColor(); cancelGesture();
    try {
        const content = powerClipEditDocument(history.document, id);
        powerClipEditing = { id, history, parent: powerClipEditing };
        history = new History(content); selectOnly(null); setTool('select'); render();
        status(powerClipLevels() > 1 ? `Editando un PowerClip dentro de otro (nivel ${powerClipLevels()}). Terminar edición o Esc para subir un nivel.`
            : 'Editando contenido de PowerClip. Terminar edición o Esc para volver.');
    } catch (error) { status(error.message); }
    return true;
}
function finishPowerClipEditing() {
    if (!powerClipEditing) return;
    finishPropertyColor(); cancelGesture();
    const session = powerClipEditing;
    try {
        // Only this level is merged: the level around it becomes the one being edited.
        const next = mergePowerClipEdits(session.history.document, session.id, history.document);
        history = session.history; powerClipEditing = session.parent;
        selectOnly(session.id); setTool('select'); commit(next);
        status(powerClipEditing ? `De vuelta en el nivel ${powerClipLevels()} de PowerClip` : 'Edición de PowerClip terminada');
    } catch (error) { status(error.message); }
}
function finishAllPowerClipEditing() {
    while (powerClipEditing) { const session = powerClipEditing; finishPowerClipEditing(); if (powerClipEditing === session) return; }
}
$('#powerclip-edit-done').onclick = finishPowerClipEditing;
canvas.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const previous = gesture; gesture = null;
    if (previous.moved || !['move', 'nodes', 'node-marquee', 'node-handle'].includes(previous.type)) lastClick = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (previous.type === 'pan') return;
    if (previous.type === 'marquee') { render(); status(`${selectedIds.size} objetos seleccionados`); return; }
    if (previous.type === 'node-marquee') {
        // A plain click on empty space ends node editing, like deselecting with Select.
        if (!previous.moved && !previous.onObject) { selectOnly(null); finishNodeEditing(); return; }
        render(); if (previous.moved) status(`${nodeEditing?.nodes.size ?? 0} nodos seleccionados`); return;
    }
    if (previous.type === 'draw' && selected().width * view.scale < 3 && selected().height * view.scale < 3) { draft = null; render(); return; }
    if (previous.type === 'move' && !previous.moved && previous.reselect) {
        draft = null; rotateMode = !rotateMode; render();
        status(rotateMode ? 'Arrastra una esquina para girar · Ctrl: de 15° en 15° · clic otra vez para volver al tamaño' : 'Selecciona un objeto para moverlo o editarlo');
        return;
    }
    if (previous.type === 'move' && previous.moved) {
        previous.pointer = point(event); updatePowerClipDrop(previous);
        const drop = previous.dropTarget;
        if (drop) {
            try {
                const next = clone(draft); centreOn(next, selectedIds, previous.pointer); placeInPowerClip(next, selectedIds, drop.id);
                const valid = validateDocument(next); selectOnly(drop.id); commit(valid); status('Contenido colocado en PowerClip'); return;
            } catch (error) { draft = null; render(); status(error.message); return; }
        }
    }
    commit(draft); if (previous.type === 'draw') setTool('select');
    if (previous.snap) { drawReference(previous.snap); status(`Encajado en ${referenceLabel(previous.snap).toLowerCase()}`); }
    else showReference(event);
});
// Workshop shapes appear at their real size in the middle of the view, as cutting lines.
function insertPreset(key) {
    if (gesture) return;
    const centre = { x: (canvas.clientWidth / 2 - view.x) / view.scale, y: (canvas.clientHeight / 2 - view.y) / view.scale };
    const object = presetObject(key, centre, nextStroke);
    selectOnly(object.id); edit(d => d.objects.push(object)); setTool('select');
    status(`${object.name} insertado · ${+object.width.toFixed(1)} × ${+object.height.toFixed(1)} mm`);
}
// Ctrl draws with equal sides (a square or a circle), as in CorelDRAW.
function sizeDrawing(o, equal) {
    const { x: dx, y: dy } = gesture.delta;
    let w = Math.abs(dx), h = Math.abs(dy);
    if (equal) w = h = Math.max(w, h);
    o.x = gesture.start.x - (dx < 0 ? w : 0); o.y = gesture.start.y - (dy < 0 ? h : 0);
    o.width = Math.max(.1, w); o.height = Math.max(.1, h);
}
// Pressing or releasing Ctrl while drawing updates the shape without moving the mouse.
for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    if (gesture?.type !== 'draw' || !gesture.delta || !['Control', 'Meta'].includes(event.key)) return;
    sizeDrawing(selected(), event.ctrlKey || event.metaKey); renderScene();
});
// Content placed in a PowerClip goes where the container was clicked (or where it was dropped): the
// centre of the placed objects moves to that point, so it shows inside the container instead of
// staying outside it, clipped away.
function centreOn(doc, ids, point) {
    const items = doc.objects.filter(item => ids.has(item.id));
    if (!items.length) return;
    const box = unionBounds(items.map(getBounds)), dx = point.x - (box.x + box.width / 2), dy = point.y - (box.y + box.height / 2);
    for (const item of items) { item.x += dx; item.y += dy; }
}
function cancelGesture() {
    if (!gesture) return;
    const previous = gesture; gesture = null; draft = null;
    if (previous.type === 'pan') view = previous.view;
    if (previous.type === 'marquee') setSelection(previous.originalIds);
    if (previous.type === 'node-marquee' && nodeEditing) nodeEditing.nodes = previous.originalNodes;
    if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    render();
}
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', cancelGesture);
window.addEventListener('blur', cancelGesture);

// An empty PowerClip takes whatever is dropped on it; one that already has content only takes more
// while W is held, so objects can be moved over it without falling in.
let insertKeyHeld = false;
function updatePowerClipDrop(move) {
    const container = move.moved ? powerClipDropTarget(draft.objects, selectedIds, move.pointer) : null;
    const accepts = Boolean(container) && (!container.powerClip.objects.length || insertKeyHeld);
    move.dropTarget = accepts ? container : null;
    move.dropHint = container && !accepts ? container : null;
}
function setInsertKey(event, held) {
    if (event.key?.toLowerCase() !== 'w' || insertKeyHeld === held) return;
    insertKeyHeld = held;
    if (gesture?.type !== 'move' || !gesture.pointer) return;
    updatePowerClipDrop(gesture); renderScene();
    if (gesture.snap && !gesture.dropTarget && !gesture.dropHint) drawReference(gesture.snap);
}
document.addEventListener('keydown', event => setInsertKey(event, true));
document.addEventListener('keyup', event => setInsertKey(event, false));
window.addEventListener('blur', () => { insertKeyHeld = false; });
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
        setPaint(item, pending.property, pending.value);
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
        group.innerHTML = objectMarkup(preview, displaySrc);
        showAdjustedImages(group);
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
            // A rotated shape grows along its own side, so the opposite side stays on the page.
            if (turns(o) && (property === 'width' || property === 'height')) {
                const along = rotatePoint(property === 'width' ? { x: value - o.width, y: 0 } : { x: 0, y: value - o.height }, { x: 0, y: 0 }, o.rotation);
                Object.assign(item, resizeRotated(o, property === 'width' ? 'e' : 's', along.x, along.y));
                return;
            }
            if (property === 'fill' || property === 'stroke') setPaint(item, property, value); else item[property] = value;
            if (property === 'stroke' && value !== 'none' && item.strokeWidth === 0) item.strokeWidth = HAIRLINE_WIDTH;
        });
    } else if (input.id === 'no-fill' || input.id === 'no-stroke') {
        edit(d => { setPaint(d.objects.find(item => item.id === o.id), input.id === 'no-fill' ? 'fill' : 'stroke', input.checked ? 'none' : '#352a49'); });
    }
}
// Native color pickers emit input while choosing, before their final change event.
$('#properties').addEventListener('input', updateProperty);
$('#properties').addEventListener('change', updateProperty);
$('#properties').addEventListener('focusout', event => {
    if (pendingColor?.input === event.target) finishPropertyColor();
});

// Adjusted images show processed copies; the document keeps the original pixels and the settings.
const adjustedViews = new Map(), pendingViews = new Set();
const viewKey = item => `${item.id}|${sourceKey(item.src)}|${JSON.stringify(item.adjust)}`;
function findObject(id) {
    for (const item of objectsWithContents(current().objects)) if (item.id === id) return item;
}
function storeView(key, blob, final) {
    const url = URL.createObjectURL(blob), previous = adjustedViews.get(key);
    if (previous) URL.revokeObjectURL(previous.url);
    adjustedViews.delete(key); adjustedViews.set(key, { url, final, bytes: blob.size });
    // Keep recent versions so undo and redo show them without reprocessing, within a memory budget.
    let total = 0;
    for (const view of adjustedViews.values()) total += view.bytes;
    while (adjustedViews.size > 1 && (adjustedViews.size > 24 || total > 256 * 1024 * 1024)) {
        const [oldKey, old] = adjustedViews.entries().next().value;
        URL.revokeObjectURL(old.url); adjustedViews.delete(oldKey); total -= old.bytes;
    }
    return url;
}
const imageElement = id => [...objects.children].find(group => group.dataset.id === id)?.querySelector('image');
function showAdjustedImages(root) {
    for (const element of root.querySelectorAll('image[data-adjusted]')) {
        const item = findObject(element.dataset.adjusted);
        if (!item?.adjust) continue;
        const key = viewKey(item), view = adjustedViews.get(key);
        if (view) element.setAttribute('href', view.url);
        if (view?.final || pendingViews.has(key)) continue;
        pendingViews.add(key);
        // The settled view keeps the full resolution, so zooming in shows the same pixels as the export.
        renderAdjusted(item.src, item.adjust).then(canvas => canvasBlob(canvas))
            .then(blob => { storeView(key, blob, true); showAdjustedImages(objects); })
            .catch(() => status('No se pudo mostrar el ajuste de la imagen.'))
            .finally(() => pendingViews.delete(key));
    }
}
const adjustInputs = [...document.querySelectorAll('[data-image-adjust]')];
const readAdjust = () => ({ ...Object.fromEntries(adjustInputs.map(input => [input.dataset.imageAdjust, Number(input.value)])), invert: $('#image-invert').checked });
function showAdjustValues() {
    for (const input of adjustInputs) {
        const value = Number(input.value);
        $(`[data-adjust-value="${input.dataset.imageAdjust}"]`).textContent = Number(input.min) < 0 && value > 0 ? `+${value}` : String(value);
    }
}
// While a slider moves, process a copy at the size the image covers on screen (1024 to 2048 px),
// so it stays sharp; one preview at a time, always ending on the last position.
let adjustPreviewBusy = false, adjustPreviewAgain = false;
async function previewAdjust() {
    if (adjustPreviewBusy) { adjustPreviewAgain = true; return; }
    adjustPreviewBusy = true;
    try {
        const o = selected();
        if (o?.type === 'image' && !o.locked) {
            const adjust = readAdjust(), key = viewKey({ ...o, adjust });
            let url = adjustedViews.get(key)?.url;
            if (!url) {
                const shown = imageElement(o.id)?.getBoundingClientRect() || { width: 0, height: 0 };
                const maxSize = Math.min(2048, Math.max(1024, Math.ceil(Math.max(shown.width, shown.height) * devicePixelRatio)));
                url = storeView(key, await canvasBlob(await renderAdjusted(o.src, adjust, { maxSize, fast: true }), 'image/webp'), false);
            }
            imageElement(o.id)?.setAttribute('href', url);
        }
    } catch { status('No se pudo mostrar el ajuste de la imagen.'); }
    finally {
        adjustPreviewBusy = false;
        if (adjustPreviewAgain) { adjustPreviewAgain = false; previewAdjust(); }
    }
}
$('#image-properties').addEventListener('input', event => {
    if (!event.target.matches('[data-image-adjust]')) return;
    showAdjustValues(); previewAdjust();
});
$('#image-properties').addEventListener('change', event => {
    if (!event.target.matches('[data-image-adjust]')) return;
    const o = selected(), adjust = readAdjust();
    if (o?.type !== 'image' || o.locked) return;
    edit(d => { d.objects.find(item => item.id === o.id).adjust = adjust; });
});
// Inverting colours is one more adjustment: the original pixels stay, and doing it again undoes it.
function invertImages() {
    const images = selectedObjects().filter(item => item.type === 'image' && !item.locked);
    if (!images.length) return false;
    const ids = new Set(images.map(item => item.id)), inverted = !images.every(item => item.adjust?.invert);
    edit(d => { for (const item of d.objects) if (ids.has(item.id)) item.adjust = { ...(item.adjust || {}), invert: inverted }; });
    status(inverted ? (images.length === 1 ? 'Colores invertidos' : `Colores invertidos en ${images.length} imágenes`) : 'Colores originales');
    return true;
}
$('#image-invert').addEventListener('change', () => { if (!invertImages()) render(); });
$('#invert-image').onclick = () => { hideObjectMenu(); invertImages(); };
$('#image-adjust-reset').onclick = () => {
    const o = selected();
    if (o?.type !== 'image' || o.locked || !o.adjust) return;
    edit(d => { delete d.objects.find(item => item.id === o.id).adjust; });
    status('Ajustes de imagen restablecidos');
};
const formatAngle = degrees => `${Number(normalizeAngle(degrees).toFixed(1))}°`;
// Turn the unlocked selection around its centre; used by the angle field and the 90° buttons.
function rotateSelection(delta) {
    const items = selectedObjects().filter(item => !item.hidden && !item.locked);
    if (!items.length || !normalizeAngle(delta)) return;
    const centre = selectionCentre(items);
    edit(d => { for (const item of items) Object.assign(d.objects.find(object => object.id === item.id), rotateObject(item, centre, delta)); });
    status(items.length === 1 ? `Rotación: ${formatAngle((items[0].rotation || 0) + delta)}` : `Giro: ${formatAngle(delta)}`);
}
$('#rotation-input').addEventListener('change', event => {
    const o = selected();
    if (!o || o.locked || !event.target.checkValidity()) { render(); return; }
    rotateSelection(Number(event.target.value) - (o.rotation || 0));
});
// Exports carry the adjusted pixels: laser and print software never see the editor settings.
async function bakeAdjustedImages(snapshot) {
    for (const item of objectsWithContents(snapshot.objects)) {
        if (item.type !== 'image' || !item.adjust) continue;
        if (!item.hidden) item.src = await bakeAdjustedSource(item.src, item.adjust);
        delete item.adjust;
    }
}
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
        await bakeAdjustedImages(snapshot);
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
function newDocument() {
    cloudBinding = null; cloudSavedKey = null;
    storageBlocked = false; selectOnly(null); commit(blankDocument()); persist(); fit(); status('Nuevo documento A4');
}
const actions = {
    undo() { if (history.undo()) { nodeEditing?.nodes.clear(); persist(); render(); status('Cambio deshecho'); } },
    redo() { if (history.redo()) { nodeEditing?.nodes.clear(); persist(); render(); status('Cambio rehecho'); } },
    new() {
        if (!window.confirm('¿Crear un proyecto nuevo? Guarda el actual en Firebase o descarga una copia si quieres conservarlo. Puedes deshacer esta acción.')) return;
        newDocument();
    },
    open() { showCloud(false); },
    cloud() { showCloud(false); },
    async save() { if (await ensureProjectName()) showCloud(true); },
    import() { $('#open-file').click(); },
    async download() { if (await ensureProjectName()) { download(JSON.stringify(history.document, null, 2), 'application/json', '.dekoor'); status('Proyecto descargado'); } },
    export() { $('#export-message').textContent = ''; $('#export-dialog').showModal(); },
    delete() {
        if (nodeEditing) { deleteNodes([...nodeEditing.nodes]); return; }
        edit(d => { d.objects = d.objects.filter(item => !selectedIds.has(item.id) || item.locked); });
    },
    duplicate() {
        const originals = selectedObjects().filter(item => !item.locked); if (!originals.length) return;
        edit(d => { const ids = []; for (const o of originals) { const copy = clone(o); for (const item of objectsWithContents([copy])) item.id = crypto.randomUUID(); copy.name = (copy.name + ' copia').slice(0, 120); copy.x += 5; copy.y += 5; d.objects.push(copy); ids.push(copy.id); } setSelection(ids); });
    },
    forward() { reorder(1); }, backward() { reorder(-1); },
    'rotate-left'() { rotateSelection(90); }, 'rotate-right'() { rotateSelection(-90); },
    front() { reorderToEnd(true); }, back() { reorderToEnd(false); },
    'zoom-in'() { zoom(1.2); }, 'zoom-out'() { zoom(1 / 1.2); }, fit,
    help() { $('#help').showModal(); },
    'lamp-frame'() { insertPreset('lamp-frame'); },
};
for (const name of ['new', 'open', 'cloud', 'save', 'import', 'download', 'export']) {
    const action = actions[name];
    if (action) actions[name] = (...args) => { finishAllPowerClipEditing(); if (!powerClipEditing) return action(...args); };
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
    $('#make-powerclip').disabled = !single || object.locked || Boolean(object.powerClip) || !POWERCLIP_TYPES.includes(object.type);
    $('#place-powerclip').disabled = selectedObjects().some(item => item.locked) || !current().objects.some(item => POWERCLIP_TYPES.includes(item.type) && !item.locked && !item.hidden && !selectedIds.has(item.id));
    $('#extract-powerclip').hidden = !object.powerClip;
    $('#extract-powerclip').disabled = !single || object.locked || !object.powerClip?.objects.length;
    $('#invert-image').hidden = object.type !== 'image';
    $('#invert-image').disabled = object.locked;
    $('#bitmap-image').hidden = object.type !== 'image';
    $('#bitmap-image').disabled = !single || object.locked;
    $('#raster-image').hidden = object.type !== 'image';
    $('#raster-image').disabled = !single || object.locked;
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
    status('Haz clic dentro del PowerClip (rectángulo, elipse o curva) justo donde quieres que quede el contenido. Esc para cancelar.'); canvas.focus();
};
// Convertir a raster: an AI version of the image for raster engraving, shown next to the original
// before it is applied. With "Mantener original" the result goes beside it; without, it replaces it.
let raster = null;
const rasterToken = async () => { cloudApi ||= await connect(); return cloudApi.token(); };
const rasterMessage = text => { $('#raster-message').textContent = text; };
function rasterButtons({ busy = false, login = false, link = false } = {}) {
    $('#raster-generate').disabled = busy || !raster?.ready;
    $('#raster-generate').textContent = raster?.result ? 'Generar de nuevo' : 'Generar';
    $('#raster-apply').hidden = !raster?.result; $('#raster-apply').disabled = busy;
    $('#raster-login').hidden = !login; $('#raster-link').hidden = !link;
    $('#raster-ratio').disabled = busy; $('#raster-prompt').disabled = busy;
}
async function rasterSetup() {
    const session = raster;
    rasterMessage('Consultando el modelo…'); rasterButtons({ busy: true });
    try {
        const { linked, ratios } = await rasterModel(await rasterToken());
        if (raster !== session) return;
        const select = $('#raster-ratio');
        // "Automático" comes first and is the default: the model's own "auto", or no ratio at all.
        const options = [{ value: ratios.includes('auto') ? 'auto' : '', label: 'Automático' }, ...ratios.filter(value => value !== 'auto').map(value => ({ value, label: value }))];
        select.replaceChildren(...options.map(({ value, label }) => Object.assign(document.createElement('option'), { value, textContent: label })));
        select.selectedIndex = 0;
        session.ready = linked;
        rasterMessage(linked ? '' : 'El modelo no está vinculado en Imágenes. Vincúlalo para poder usarlo.');
        rasterButtons({ link: !linked });
    } catch (error) {
        if (raster !== session) return;
        rasterMessage(error.message); rasterButtons({ login: Boolean(error.login) });
    }
}
async function openRaster() {
    hideObjectMenu();
    const object = selected();
    if (!object || object.type !== 'image' || object.locked) return;
    raster = { id: object.id, result: null, ready: false };
    $('#raster-before').src = object.src;
    $('#raster-after').hidden = true; $('#raster-after').removeAttribute('src');
    $('#raster-placeholder').hidden = false; $('#raster-placeholder').textContent = 'Aquí aparecerá el resultado';
    $('#raster-prompt').value = RASTER_PROMPT;
    $('#raster-dialog').showModal();
    await rasterSetup();
}
// The model gets the image as a reference of at most 2048 px (PNG, or JPEG if that is too heavy).
async function rasterReference(src) {
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return png.size <= 5.5 * 1024 * 1024 ? png : new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
}
// The stopwatch runs in hundredths of a second from the moment the image is sent until the result is in.
let rasterClock = null;
function startRasterClock() {
    stopRasterClock();
    const started = performance.now(), timer = $('#raster-timer');
    $('#raster-working').hidden = false;
    const tick = () => { timer.textContent = `${((performance.now() - started) / 1000).toFixed(2)} s`; };
    tick(); rasterClock = setInterval(tick, 30);
}
function stopRasterClock() {
    clearInterval(rasterClock); rasterClock = null;
    $('#raster-working').hidden = true;
}
async function generateRaster() {
    const session = raster, object = current().objects.find(item => item.id === session?.id);
    if (!object) { $('#raster-dialog').close(); return; }
    const prompt = $('#raster-prompt').value.trim();
    if (!prompt) { rasterMessage('Escribe las instrucciones para la IA.'); return; }
    rasterButtons({ busy: true });
    $('#raster-placeholder').hidden = true; $('#raster-after').hidden = true;
    startRasterClock();
    try {
        rasterMessage('Preparando la imagen…');
        const image = await rasterReference(object.src);
        rasterMessage('Enviando a la IA…');
        const result = await rasterize({ image, prompt, aspectRatio: $('#raster-ratio').value, token: rasterToken,
            onProgress: () => { if (raster === session) rasterMessage('La IA está trabajando; suele tardar entre 30 s y 2 min.'); } });
        const blob = await (await fetch(result.url)).blob(), dataUrl = await blobDataUrl(blob);
        if (!validImageSource(dataUrl)) throw new Error('La IA devolvió una imagen que el editor no puede usar.');
        if (raster !== session) return;
        stopRasterClock();
        session.result = { ...result, dataUrl };
        $('#raster-after').src = dataUrl; $('#raster-after').hidden = false; $('#raster-placeholder').hidden = true;
        rasterMessage(`Listo${result.cost != null ? ` · costo $${result.cost.toFixed(3)} USD` : ''}. También quedó en la galería de Imágenes.`);
        rasterButtons();
    } catch (error) {
        if (raster !== session) return;
        stopRasterClock();
        $('#raster-placeholder').hidden = false;
        $('#raster-placeholder').textContent = session.result ? '' : 'Aquí aparecerá el resultado';
        if (session.result) { $('#raster-after').hidden = false; $('#raster-placeholder').hidden = true; }
        rasterMessage(error.message); rasterButtons({ login: Boolean(error.login) });
    }
}
function applyRaster() {
    const session = raster, result = session?.result, object = current().objects.find(item => item.id === session?.id);
    if (!result || !object) return;
    const keep = $('#raster-keep').checked, ratio = result.width && result.height ? result.width / result.height : object.width / object.height;
    // The result keeps the original's height; its width follows the new aspect ratio.
    const height = object.height, width = height * ratio;
    if (keep) {
        const copy = { ...createObject('image', object.x + object.width + 5, object.y, width, height), name: (object.name + ' raster').slice(0, 120), src: result.dataUrl, fill: 'none', stroke: 'none', strokeWidth: 0 };
        edit(d => d.objects.splice(d.objects.findIndex(item => item.id === object.id) + 1, 0, copy));
        selectOnly(copy.id);
    } else {
        edit(d => {
            const item = d.objects.find(entry => entry.id === object.id);
            item.src = result.dataUrl; delete item.adjust;
            item.x = object.x + object.width / 2 - width / 2; item.width = width;
        });
    }
    raster = null; $('#raster-dialog').close(); render();
    status(keep ? 'Versión raster agregada junto a la original' : 'Imagen reemplazada por la versión raster');
}
$('#raster-image').onclick = openRaster;
$('#raster-generate').onclick = generateRaster;
$('#raster-apply').onclick = applyRaster;
$('#raster-cancel').onclick = () => { raster = null; $('#raster-dialog').close(); };
$('#raster-dialog').addEventListener('close', () => { raster = null; stopRasterClock(); });
$('#raster-login').onclick = () => { $('#raster-dialog').close(); showCloud(false); status('Inicia sesión y vuelve a elegir «Convertir a raster».'); };
$('#raster-link').onclick = async () => {
    rasterButtons({ busy: true });
    try { await linkRasterModel(await rasterToken()); await rasterSetup(); }
    catch (error) { rasterMessage(error.message); rasterButtons({ login: Boolean(error.login), link: true }); }
};
// Convertir a mapa de bits (bitmap.mjs): pure black and white at the size the image has on the page and
// the resolution of the laser's line step, with its adjustments applied first. Black is what gets burned.
let bitmap = null, bitmapTimer = null;
const bitmapInfo = text => { $('#bitmap-info').textContent = text; };
const millimetres = value => +value.toFixed(1);
function openBitmap() {
    hideObjectMenu();
    const object = selected();
    if (!object || object.type !== 'image' || object.locked) return;
    bitmap = { id: object.id, source: null, result: null, run: 0 };
    const method = $('#bitmap-method');
    if (!method.options.length) method.replaceChildren(...Object.entries(BITMAP_METHODS).map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
    $('#bitmap-before').src = object.src;
    $('#bitmap-after').hidden = true; $('#bitmap-placeholder').hidden = false;
    $('#bitmap-dialog').showModal();
    updateBitmap();
}
function scheduleBitmap() { clearTimeout(bitmapTimer); bitmapTimer = setTimeout(updateBitmap, 150); }
async function updateBitmap() {
    const session = bitmap;
    if (!session) return;
    const object = current().objects.find(item => item.id === session.id);
    if (!object) { $('#bitmap-dialog').close(); return; }
    const dpi = Number($('#bitmap-dpi').value), method = $('#bitmap-method').value, threshold = Number($('#bitmap-threshold').value);
    const run = ++session.run;
    $('#bitmap-threshold-value').textContent = threshold;
    $('#bitmap-step').textContent = dpi >= 50 && dpi <= 1200 ? `paso ${dpiToStep(dpi).toFixed(3)} mm` : '';
    $('#bitmap-apply').disabled = $('#bitmap-download').disabled = true;
    try {
        if (!(dpi >= 50 && dpi <= 1200)) throw new Error('Usa una resolución entre 50 y 1200 DPI.');
        const { width, height } = bitmapSize(object.width, object.height, dpi);
        bitmapInfo(`${millimetres(object.width)} × ${millimetres(object.height)} mm → ${width} × ${height} px · calculando…`);
        session.source ||= await renderAdjusted(object.src, object.adjust);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.imageSmoothingQuality = 'high';
        context.drawImage(session.source, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        pixels.data.set(toBitmap(pixels.data, width, height, { method, threshold }));
        context.putImageData(pixels, 0, 0);
        const blob = new Blob([pngWithDpi(await (await canvasBlob(canvas, 'image/png')).arrayBuffer(), dpi)], { type: 'image/png' });
        const dataUrl = await blobDataUrl(blob);
        if (bitmap !== session || run !== session.run) return;
        if (!validImageSource(dataUrl)) throw new Error('El mapa de bits es demasiado grande. Baja los DPI.');
        session.result = { dataUrl, blob, dpi };
        $('#bitmap-after').src = dataUrl; $('#bitmap-after').hidden = false; $('#bitmap-placeholder').hidden = true;
        bitmapInfo(`${millimetres(object.width)} × ${millimetres(object.height)} mm → ${width} × ${height} px a ${dpi} DPI (paso ${dpiToStep(dpi).toFixed(3)} mm) · ${Math.max(1, Math.round(blob.size / 1024))} KB`);
        $('#bitmap-apply').disabled = $('#bitmap-download').disabled = false;
    } catch (error) {
        if (bitmap !== session || run !== session.run) return;
        session.result = null; bitmapInfo(error.message || 'No se pudo convertir la imagen.');
    }
}
function applyBitmap() {
    const session = bitmap, result = session?.result, object = current().objects.find(item => item.id === session?.id);
    if (!result || !object) return;
    const keep = $('#bitmap-keep').checked;
    if (keep) {
        const copy = { ...createObject('image', object.x + object.width + 5, object.y, object.width, object.height), name: (object.name + ' 1 bit').slice(0, 120),
            src: result.dataUrl, fill: 'none', stroke: 'none', strokeWidth: 0, pixelated: true, ...(object.rotation ? { rotation: object.rotation } : {}) };
        edit(d => d.objects.splice(d.objects.findIndex(item => item.id === object.id) + 1, 0, copy));
        selectOnly(copy.id);
    } else {
        // The adjustments are already in the bitmap.
        edit(d => { const item = d.objects.find(entry => entry.id === object.id); item.src = result.dataUrl; item.pixelated = true; delete item.adjust; });
    }
    bitmap = null; $('#bitmap-dialog').close(); render();
    status(keep ? 'Mapa de bits agregado junto a la original' : 'Imagen convertida a mapa de bits');
}
$('#bitmap-image').onclick = openBitmap;
$('#bitmap-apply').onclick = applyBitmap;
$('#bitmap-download').onclick = () => {
    const result = bitmap?.result, object = current().objects.find(item => item.id === bitmap?.id);
    if (result) download(result.blob, 'image/png', ` ${result.dpi} dpi.png`, object?.name || 'Mapa de bits');
};
$('#bitmap-cancel').onclick = () => $('#bitmap-dialog').close();
$('#bitmap-dialog').addEventListener('close', () => { bitmap = null; clearTimeout(bitmapTimer); });
for (const id of ['#bitmap-dpi', '#bitmap-threshold']) $(id).addEventListener('input', scheduleBitmap);
$('#bitmap-method').addEventListener('change', updateBitmap);
$('#bitmap-actual').addEventListener('change', event => $('#bitmap-frame').classList.toggle('actual', event.target.checked));
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
// Other CSS colour names are resolved by the browser; anything it does not know is left out.
const colorContext = document.createElement('canvas').getContext('2d');
function resolveColor(name) {
    colorContext.fillStyle = '#010203'; colorContext.fillStyle = name;
    const value = colorContext.fillStyle;
    return value === '#010203' && name !== '#010203' ? null : parseColor(value);
}
// An SVG is added to the current document as editable objects, at its own position on the page. When
// the document is still empty, the page also takes the SVG's size.
async function importSvgFile(file) {
    if (file.size > 32 * 1024 * 1024) throw new Error('El SVG supera el límite de 32 MB.');
    const base = history.document, used = [...objectsWithContents(base.objects)].length;
    if (used >= 2000) throw new Error('El proyecto ya tiene el máximo de 2000 objetos.');
    const result = importSvg(await file.text(), { resolveColor, maxObjects: 2000 - used });
    await embedImages(result);
    if (!result.objects.length) throw new Error('El SVG no tiene formas, textos ni imágenes compatibles.');
    if (history.document !== base || gesture || splineDraft) throw new Error('El documento cambió mientras se leía el SVG. Vuelve a importarlo.');
    const resize = !base.objects.length && result.width >= 1 && result.height >= 1 && result.width <= 5000 && result.height <= 5000;
    cancelGesture();
    commit({ ...clone(base), ...(resize ? { width: result.width, height: result.height } : {}), objects: [...base.objects, ...result.objects] });
    if (history.document === base) return;
    setSelection(result.objects.map(object => object.id)); render(); if (resize) fit();
    $('#cloud-dialog').close();
    const count = (n, one, many) => n === 1 ? one : `${n} ${many}`;
    const notes = [result.skipped && count(result.skipped, 'se omitió 1 elemento no compatible o imagen que no se pudo cargar', 'elementos no compatibles o imágenes que no se pudieron cargar se omitieron'),
        result.clipped && count(result.clipped, 'se ignoró 1 recorte que no se pudo convertir en PowerClip', 'recortes que no se pudieron convertir en PowerClip se ignoraron'),
        result.masked && count(result.masked, 'se ignoró 1 máscara', 'máscaras se ignoraron'), result.truncated && 'se llegó al límite de 2000 objetos'].filter(Boolean);
    status(`SVG importado: ${result.objects.length} ${result.objects.length === 1 ? 'objeto' : 'objetos'}${notes.length ? ' · ' + notes.join(' · ') : ''}`);
}
const isSvg = file => /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
// Images the SVG links to or embeds in other formats: linked files are downloaded (after asking, since
// that contacts the sites in the file) and GIF, BMP, SVG… become PNG. Ones that fail are left out.
async function embedImages(result) {
    if (!result.pending.length) return;
    const online = result.pending.filter(object => /^https?:/i.test(object.src)).length;
    const allowed = !online || window.confirm(online === 1 ? 'El SVG tiene 1 imagen enlazada en internet. ¿Descargarla para incluirla? Si no, se omitirá.'
        : `El SVG tiene ${online} imágenes enlazadas en internet. ¿Descargarlas para incluirlas? Si no, se omitirán.`);
    const failed = new Set();
    for (const object of result.pending) {
        try {
            if (!allowed && /^https?:/i.test(object.src)) throw new Error('omitida');
            object.src = await embedImage(object.src);
        } catch { failed.add(object); }
    }
    dropImages(result, failed);
}
async function embedImage(href) {
    const url = new URL(href); // Paths relative to the SVG file cannot be reached from the browser.
    if (!['data:', 'https:', 'http:'].includes(url.protocol)) throw new Error('Origen no compatible.');
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('No se pudo descargar la imagen.');
    const blob = await response.blob();
    if (blob.size > 10 * 1024 * 1024) throw new Error('La imagen supera el límite de 10 MB.');
    if (/^image\/(png|jpeg|webp)$/.test(blob.type)) { const data = await blobDataUrl(blob); if (validImageSource(data)) return data; }
    // Bitmap formats decode directly; SVG only through an <img>.
    const objectUrl = URL.createObjectURL(blob);
    try {
        let image;
        try { image = await createImageBitmap(blob); }
        catch { image = new Image(); image.src = objectUrl; await image.decode(); }
        const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
        const scale = Math.min(1, 4096 / Math.max(width || 1024, height || 1024));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((width || 1024) * scale)); canvas.height = Math.max(1, Math.round((height || 1024) * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close?.();
        const data = canvas.toDataURL('image/png');
        if (!validImageSource(data)) throw new Error('La imagen no se pudo convertir.');
        return data;
    } finally { URL.revokeObjectURL(objectUrl); }
}
async function openFile(file) {
    if (isSvg(file)) { await importSvgFile(file); return; }
    if (file.size > 32 * 1024 * 1024) throw new Error('El proyecto supera el límite de 32 MB.');
    const next = validateDocument(JSON.parse(await file.text()));
    if (!window.confirm('¿Abrir este proyecto y reemplazar el borrador actual? Puedes deshacer esta acción.')) return;
    cancelGesture(); cloudBinding = null; cloudSavedKey = null;
    storageBlocked = false; selectOnly(null); commit(next); persist(); fit(); $('#cloud-dialog').close(); status('Proyecto abierto');
}
$('#open-file').addEventListener('change', event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    openFile(file).catch(error => status(`No se abrió el archivo: ${error.message}`));
});
// Dropping an SVG or a project file on the work area opens it too.
$('#viewport').addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
$('#viewport').addEventListener('drop', event => {
    const file = event.dataTransfer.files[0]; if (!file) return;
    event.preventDefault();
    if (gesture || splineDraft) { status('Termina lo que estás haciendo antes de soltar un archivo.'); return; }
    openFile(file).catch(error => status(`No se abrió el archivo: ${error.message}`));
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hideObjectMenu(); powerClipSources = null; }
    if (document.querySelector('dialog[open]')) return;
    const editing = event.target.closest('input, select, textarea, [contenteditable="true"]');
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (key === 'escape') {
        // The first Escape cancels a node drag; the next one leaves node editing.
        if (nodeEditing && !editing) { if (gesture) cancelGesture(); else finishNodeEditing(); return; }
        if (powerClipEditing && !editing && !splineDraft) { finishPowerClipEditing(); return; }
        cancelGesture(); selectOnly(null); setTool('select'); render(); return;
    }
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
        // With an image selected, Ctrl+I inverts its colours; otherwise it imports.
        if (key === 'i' && invertImages()) return;
        const action = { z: event.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', s: 'save', o: 'open', i: 'import', e: 'export' }[key]; actions[action](); return;
    }
    if (mod || event.altKey || gesture) return;
    // With a PowerClip selected, X fits its content inside and C fills it, like the floating bar.
    if ((key === 'x' || key === 'c') && selectedIds.size === 1 && selected()?.powerClip?.objects.length && !selected().locked) {
        event.preventDefault(); $(key === 'x' ? '#powerclip-contain' : '#powerclip-cover').onclick(); return;
    }
    if ({ v: 'select', h: 'hand', r: 'rect', e: 'ellipse', t: 'text', b: 'spline' }[key]) { event.preventDefault(); setTool({ v: 'select', h: 'hand', r: 'rect', e: 'ellipse', t: 'text', b: 'spline' }[key]); }
    if (key === 'delete' || key === 'backspace') { event.preventDefault(); actions.delete(); }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        const o = selected(); if (!o || o.locked) return; event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const dx = { arrowleft: -amount, arrowright: amount }[key] || 0, dy = { arrowup: -amount, arrowdown: amount }[key] || 0;
        if (nodeEditing?.nodes.size) {
            const geometry = nodeTools[o.type].move(o, [...nodeEditing.nodes], dx, dy);
            edit(d => Object.assign(d.objects.find(item => item.id === o.id), geometry)); return;
        }
        edit(d => { for (const item of d.objects.filter(item => selectedIds.has(item.id) && !item.locked)) { item.x += dx; item.y += dy; } });
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
        edit(d => { for (const item of d.objects.filter(item => selectedIds.has(item.id) && !item.locked)) { setPaint(item, target, color); if (target === 'stroke' && color !== 'none' && item.strokeWidth === 0) item.strokeWidth = HAIRLINE_WIDTH; } });
        status(color === 'none' ? `Sin ${label}` : `Color de ${label} actualizado`);
    } else {
        try { localStorage.setItem('dekoor.editor-v2.paint', JSON.stringify({ fill: nextFill, stroke: nextStroke })); } catch {}
        render(); status(color === 'none' ? `Sin ${label} para los nuevos objetos` : `Color de ${label} para los nuevos objetos`);
    }
}
// Clicking the fill or outline chip opens the colour picker for a custom colour of that kind. While it
// is open the selection (or the chip for new objects) is repainted without committing; the colour
// becomes one undo step when it is applied.
let pickerFrame = null, pickerChip = null;
function previewPaletteColor(color) {
    if (pickerFrame !== null) cancelAnimationFrame(pickerFrame);
    pickerFrame = requestAnimationFrame(() => {
        pickerFrame = null;
        const chip = paletteTarget === 'fill' ? $('#fill-chip') : $('#stroke-chip');
        chip.classList.remove('none'); chip.style[paletteTarget === 'fill' ? 'backgroundColor' : 'borderColor'] = color;
        for (const item of selectedObjects().filter(item => !item.locked)) {
            const group = [...objects.children].find(group => group.dataset.id === item.id);
            if (!group) continue;
            const preview = { ...item, [paletteTarget]: color };
            if (paletteTarget === 'stroke' && preview.strokeWidth === 0) preview.strokeWidth = HAIRLINE_WIDTH;
            group.innerHTML = objectMarkup(preview, displaySrc);
            showAdjustedImages(group);
            if (preview.powerClip) drawPowerClipMarker(group, preview);
        }
    });
}
const stopPreview = () => { if (pickerFrame !== null) { cancelAnimationFrame(pickerFrame); pickerFrame = null; } pickerChip = null; };
const colorPicker = createColorPicker($('#color-picker'), {
    onInput: previewPaletteColor,
    onCommit: color => { stopPreview(); applyPalette(color, paletteTarget); },
    onCancel: () => { stopPreview(); render(); },
});
for (const [target, chip] of [['fill', $('#fill-chip')], ['stroke', $('#stroke-chip')]]) {
    chip.addEventListener('click', () => {
        if (colorPicker.open) { const same = pickerChip === chip; colorPicker.commit(); if (same) return; }
        if (gesture || selected()?.locked) return;
        const o = selected(), current = o ? o[target] : target === 'fill' ? nextFill : nextStroke;
        paletteTarget = target; pickerChip = chip;
        colorPicker.show(chip, current === 'none' ? '#000000' : current);
    });
}

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
            cancelGesture(); cloudBinding = loaded.binding; cloudSavedKey = documentKey(loaded.document);
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
        cloudBinding = binding; cloudSavedKey = documentKey(snapshot); persist(); render();
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
const blobDataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});
// The thumbnail uses small previews of the photos, so a draft with many photos still opens quickly.
async function draftThumbnail(draftDocument) {
    const small = new Map();
    for (const object of objectsWithContents(draftDocument.objects)) {
        if (object.type !== 'image' || !object.src.startsWith('data:') || small.has(object.src)) continue;
        const url = await makePreview(object.src, previewSize(previewEntry(object.src), 256));
        small.set(object.src, url ? await blobDataUrl(await (await fetch(url)).blob()) : PLACEHOLDER);
    }
    const { width, height } = draftDocument;
    const body = draftDocument.objects.filter(object => !object.hidden).map(object => objectMarkup(object, src => small.get(src) ?? src)).join('');
    return URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/>${body}</svg>`], { type: 'image/svg+xml' }));
}
// Every load asks whether to continue the autosaved draft or start from something else.
function showWelcome() {
    const draftDocument = history.document, hasDraft = draftDocument.objects.length > 0 || draftDocument.name !== 'Sin título';
    const dialog = $('#welcome-dialog'), thumb = $('#welcome-thumb');
    let thumbUrl = null;
    $('#welcome-continue').hidden = !hasDraft;
    if (hasDraft) {
        const count = draftDocument.objects.length;
        $('#welcome-draft-name').textContent = `${draftDocument.name} · ${count} ${count === 1 ? 'objeto' : 'objetos'}`;
        thumb.removeAttribute('src');
        draftThumbnail(draftDocument).then(url => {
            if (dialog.open) { thumbUrl = url; thumb.src = url; } else URL.revokeObjectURL(url);
        }).catch(() => {});
    }
    const release = () => { if (thumbUrl) URL.revokeObjectURL(thumbUrl); thumbUrl = null; thumb.removeAttribute('src'); };
    const choose = action => () => { dialog.close(); release(); action(); };
    $('#welcome-continue').onclick = choose(() => status('Borrador recuperado'));
    $('#welcome-new').onclick = choose(() => { newDocument(); if (hasDraft) status('Nuevo documento A4 · Ctrl+Z recupera el borrador anterior'); });
    $('#welcome-open').onclick = choose(() => showCloud(false));
    $('#welcome-import').onclick = choose(() => $('#open-file').click());
    // Escape closes the window too and keeps the draft.
    dialog.addEventListener('close', release, { once: true });
    dialog.showModal();
    (hasDraft ? $('#welcome-continue') : $('#welcome-new')).focus();
}
setTool('select'); render(); fit(); showWelcome();
