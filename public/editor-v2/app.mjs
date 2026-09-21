import { History, blankDocument, createObject, clone, validateDocument, objectMarkup, exportSvg } from './model.mjs';

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), scene = $('#scene'), objects = $('#objects'), selection = $('#selection');
const storageKey = 'dekoor.editor-v2.document.v1';
let history = new History(), selectedId = null, tool = 'select', gesture = null;
let view = { x: 0, y: 0, scale: 2 }, draft = null;
let storageBlocked = false;
const current = () => draft || history.document;
const selected = () => current().objects.find(o => o.id === selectedId);
const status = message => { $('#status').textContent = message; };

try {
    const saved = localStorage.getItem(storageKey);
    if (saved) history = new History(JSON.parse(saved));
} catch {
    storageBlocked = true;
    $('#save-status').textContent = 'No se pudo recuperar el borrador. Descarga tu proyecto.';
}

function persist() {
    // Preserve unreadable previous data until the user explicitly opens/creates a project.
    if (storageBlocked) return;
    try {
        localStorage.setItem(storageKey, JSON.stringify(history.document));
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
    if (gesture) cancelGesture();
    tool = next;
    canvas.dataset.tool = next;
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === next);
        button.setAttribute('aria-pressed', String(button.dataset.tool === next));
    });
    status({ select: 'Selecciona un objeto para moverlo o editarlo', hand: 'Arrastra para desplazar la vista', rect: 'Arrastra para dibujar · Shift: cuadrado', ellipse: 'Arrastra para dibujar · Shift: círculo', text: 'Haz clic para añadir texto' }[next]);
}
function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale };
}
function renderScene() {
    const d = current();
    scene.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    $('#paper').setAttribute('width', d.width); $('#paper').setAttribute('height', d.height);
    objects.replaceChildren();
    for (const object of d.objects) {
        if (object.hidden) continue;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Markup comes only from validated primitives, never from imported SVG.
        group.innerHTML = objectMarkup(object);
        group.dataset.id = object.id;
        group.setAttribute('pointer-events', object.locked ? 'none' : 'all');
        objects.append(group);
    }
    selection.replaceChildren();
    const o = selected();
    if (o && !o.hidden) {
        const bounds = getBounds(o), unit = 1 / view.scale;
        const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: 'none', stroke: '#8b5bd1', 'stroke-width': unit, 'pointer-events': 'none' })) box.setAttribute(key, value);
        selection.append(box);
        if (!o.locked && o.type !== 'text') {
            const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            for (const [key, value] of Object.entries({ x: o.x + o.width - 4 * unit, y: o.y + o.height - 4 * unit, width: 8 * unit, height: 8 * unit, fill: 'white', stroke: '#8b5bd1', 'stroke-width': unit, cursor: 'nwse-resize' })) handle.setAttribute(key, value);
            handle.dataset.handle = 'resize'; selection.append(handle);
        }
    }
    $('#zoom-label').textContent = `${Math.round(view.scale / (96 / 25.4) * 100)}%`;
}
function getBounds(o) {
    if (o.type === 'text') {
        const group = [...objects.children].find(g => g.dataset.id === o.id);
        if (group) return group.getBBox();
    }
    return o;
}
function render() {
    if (selectedId && !selected()) selectedId = null;
    renderScene();
    const d = history.document, o = selected();
    $('#document-name').value = d.name;
    $('#page-width').value = d.width; $('#page-height').value = d.height;
    $('#empty-selection').hidden = Boolean(o); $('#properties').hidden = !o;
    $('#selection-kind').textContent = o ? ({ rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto' }[o.type] + (o.locked ? ' · bloqueado' : '')) : 'Documento';
    if (o) {
        const bounds = getBounds(o);
        document.querySelectorAll('[data-property]').forEach(input => {
            const key = input.dataset.property;
            input.value = o.type === 'text' && ['width', 'height'].includes(key) ? Number(bounds[key].toFixed(2)) :
                input.type === 'color' && o[key] === 'none' ? '#000000' : typeof o[key] === 'number' ? Number(o[key].toFixed(2)) : o[key];
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
        $('[data-action="forward"]').disabled ||= d.objects.at(-1)?.id === o.id;
        $('[data-action="backward"]').disabled ||= d.objects[0]?.id === o.id;
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
            button.onclick = () => { if (!gesture) { selectedId = item.id; render(); } };
            row.append(button);
            for (const field of ['hidden', 'locked']) {
                const toggle = document.createElement('button'); toggle.dataset.field = field;
                toggle.onclick = () => edit(next => { const target = next.objects.find(o => o.id === item.id); target[field] = !target[field]; });
                row.append(toggle);
            }
        }
        row.className = 'layer' + (item.id === selectedId ? ' selected' : '');
        const select = row.children[0];
        select.textContent = `${{ rect: '□', ellipse: '○', text: 'T' }[item.type]}  ${item.name}`;
        select.title = item.name; select.setAttribute('aria-pressed', String(item.id === selectedId));
        for (const [field, on, off] of [['hidden', '○', '●'], ['locked', '▣', '◇']]) {
            const button = row.querySelector(`[data-field="${field}"]`); button.textContent = item[field] ? on : off;
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
    view.scale = Math.max(.05, Math.min(40, (rect.width - 100) / d.width, (rect.height - 110) / d.height));
    view.x = (rect.width - d.width * view.scale) / 2; view.y = (rect.height - d.height * view.scale) / 2;
    renderScene();
}
function zoom(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const scale = Math.max(.05, Math.min(40, view.scale * factor));
    view.x = x - (x - view.x) * scale / view.scale; view.y = y - (y - view.y) * scale / view.scale;
    view.scale = scale; renderScene();
}

canvas.addEventListener('pointerdown', event => {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault(); canvas.focus();
    const start = point(event);
    canvas.setPointerCapture(event.pointerId);
    if (tool === 'hand' || event.button === 1) {
        gesture = { type: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: { ...view } }; return;
    }
    if (tool === 'text') {
        const text = createObject('text', start.x, start.y); text.fill = '#352a49'; text.stroke = 'none';
        selectedId = text.id; edit(d => d.objects.push(text)); setTool('select');
        $('[data-property="text"]').focus(); $('[data-property="text"]').select(); return;
    }
    if (tool === 'rect' || tool === 'ellipse') {
        draft = clone(history.document);
        const object = createObject(tool, start.x, start.y, .1, .1); selectedId = object.id; draft.objects.push(object);
        gesture = { type: 'draw', start, pointerId: event.pointerId }; renderScene(); return;
    }
    const target = event.target.closest('[data-id]');
    const handle = event.target.closest('[data-handle]');
    if (!handle) selectedId = target?.dataset.id || null;
    const o = selected();
    if (o && !o.locked && !o.hidden) {
        draft = clone(history.document);
        gesture = { type: handle ? 'resize' : 'move', start, original: clone(o), pointerId: event.pointerId };
    }
    render();
});
canvas.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'pan') {
        view.x = gesture.view.x + event.clientX - gesture.clientX; view.y = gesture.view.y + event.clientY - gesture.clientY; renderScene(); return;
    }
    const p = point(event), dx = p.x - gesture.start.x, dy = p.y - gesture.start.y, o = selected();
    if (gesture.type === 'move') { o.x = gesture.original.x + dx; o.y = gesture.original.y + dy; }
    if (gesture.type === 'draw') {
        let w = Math.abs(dx), h = Math.abs(dy);
        if (event.shiftKey) w = h = Math.max(w, h);
        o.x = gesture.start.x - (dx < 0 ? w : 0); o.y = gesture.start.y - (dy < 0 ? h : 0);
        o.width = Math.max(.1, w); o.height = Math.max(.1, h);
    }
    if (gesture.type === 'resize') {
        o.width = Math.max(.1, gesture.original.width + dx); o.height = Math.max(.1, gesture.original.height + dy);
        if (event.shiftKey) o.height = o.width * gesture.original.height / gesture.original.width;
    }
    renderScene();
});
canvas.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const previous = gesture; gesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (previous.type === 'pan') return;
    if (previous.type === 'draw' && selected().width * view.scale < 3 && selected().height * view.scale < 3) { draft = null; render(); return; }
    commit(draft); if (previous.type === 'draw') setTool('select');
});
function cancelGesture() {
    if (!gesture) return;
    const previous = gesture; gesture = null; draft = null;
    if (previous.type === 'pan') view = previous.view;
    if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    render();
}
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', cancelGesture);
window.addEventListener('blur', cancelGesture);
canvas.addEventListener('wheel', event => {
    event.preventDefault(); if (gesture) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    if (event.ctrlKey || event.metaKey) { const rect = canvas.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * unit * .002), event.clientX - rect.left, event.clientY - rect.top); }
    else { view.x -= (event.shiftKey ? event.deltaY : event.deltaX) * unit; view.y -= (event.shiftKey ? 0 : event.deltaY) * unit; renderScene(); }
}, { passive: false });

$('#properties').addEventListener('submit', event => event.preventDefault());
$('#properties').addEventListener('change', event => {
    const input = event.target, o = selected();
    if (!o || o.locked) return;
    const property = input.dataset.property;
    if (property) {
        if (!input.checkValidity()) { status('Introduce un valor dentro del rango permitido.'); render(); return; }
        edit(d => { d.objects.find(item => item.id === o.id)[property] = input.type === 'number' ? Number(input.value) : input.value; });
    } else if (input.id === 'no-fill' || input.id === 'no-stroke') {
        edit(d => { d.objects.find(item => item.id === o.id)[input.id === 'no-fill' ? 'fill' : 'stroke'] = input.checked ? 'none' : '#352a49'; });
    }
});
$('#document-name').addEventListener('change', event => edit(d => { d.name = event.target.value.trim() || 'Sin título'; }));
for (const dimension of ['width', 'height']) $('#page-' + dimension).addEventListener('change', event => {
    if (!event.target.checkValidity()) { render(); status('La página debe medir entre 1 y 5000 mm.'); return; }
    edit(d => { d[dimension] = Number(event.target.value); }); fit();
});
function download(content, type, extension) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
    link.href = url; link.download = (history.document.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'Proyecto') + extension;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const actions = {
    undo() { if (history.undo()) { persist(); render(); status('Cambio deshecho'); } },
    redo() { if (history.redo()) { persist(); render(); status('Cambio rehecho'); } },
    new() {
        if (!window.confirm('¿Crear un proyecto nuevo? Descarga el actual con «Guardar proyecto» si quieres conservar una copia. Puedes deshacer esta acción.')) return;
        storageBlocked = false; selectedId = null; commit(blankDocument()); persist(); fit(); status('Nuevo documento A4');
    },
    open() { $('#open-file').click(); },
    save() { download(JSON.stringify(history.document, null, 2), 'application/json', '.dekoor'); status('Proyecto descargado'); },
    export() { download(exportSvg(history.document), 'image/svg+xml', '.svg'); status('SVG exportado con medidas en milímetros'); },
    delete() { const o = selected(); if (o && !o.locked) edit(d => { d.objects = d.objects.filter(item => item.id !== o.id); }); },
    duplicate() {
        const o = selected(); if (!o || o.locked) return;
        edit(d => { const copy = clone(o); copy.id = crypto.randomUUID(); copy.name = (copy.name + ' copia').slice(0, 120); copy.x += 5; copy.y += 5; d.objects.push(copy); selectedId = copy.id; });
    },
    forward() { reorder(1); }, backward() { reorder(-1); },
    'zoom-in'() { zoom(1.2); }, 'zoom-out'() { zoom(1 / 1.2); }, fit,
    help() { $('#help').showModal(); },
};
function reorder(delta) {
    const o = selected(); if (!o || o.locked) return;
    edit(d => { const index = d.objects.findIndex(item => item.id === o.id), target = index + delta;
        if (target >= 0 && target < d.objects.length) [d.objects[index], d.objects[target]] = [d.objects[target], d.objects[index]];
    });
}
document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.tool) setTool(button.dataset.tool);
    if (button.dataset.action && !gesture) actions[button.dataset.action]?.();
});
$('#open-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
        if (file.size > 5 * 1024 * 1024) throw new Error('El proyecto supera el límite de 5 MB.');
        const next = validateDocument(JSON.parse(await file.text()));
        if (!window.confirm('¿Abrir este proyecto y reemplazar el borrador actual? Puedes deshacer esta acción.')) return;
        cancelGesture(); storageBlocked = false; selectedId = null; commit(next); persist(); fit(); status('Proyecto abierto');
    } catch (error) { status(`No se abrió el archivo: ${error.message}`); }
});
document.addEventListener('keydown', event => {
    if ($('#help').open) return;
    const editing = event.target.closest('input, textarea, [contenteditable="true"]');
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (key === 'escape') { cancelGesture(); selectedId = null; setTool('select'); render(); return; }
    if (editing) return;
    if (mod && ['z', 'y', 'd', 's', 'o'].includes(key)) {
        event.preventDefault(); if (gesture) return;
        const action = { z: event.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', s: 'save', o: 'open' }[key]; actions[action](); return;
    }
    if (mod || event.altKey || gesture) return;
    if ({ v: 'select', h: 'hand', r: 'rect', e: 'ellipse', t: 'text' }[key]) { event.preventDefault(); setTool({ v: 'select', h: 'hand', r: 'rect', e: 'ellipse', t: 'text' }[key]); }
    if (key === 'delete' || key === 'backspace') { event.preventDefault(); actions.delete(); }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        const o = selected(); if (!o || o.locked) return; event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        edit(d => { const item = d.objects.find(item => item.id === o.id); if (key === 'arrowleft') item.x -= amount; if (key === 'arrowright') item.x += amount; if (key === 'arrowup') item.y -= amount; if (key === 'arrowdown') item.y += amount; });
    }
});
new ResizeObserver(() => { if (!gesture) renderScene(); }).observe(canvas);
setTool('select'); render(); fit();
