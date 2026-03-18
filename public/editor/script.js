// =============================================
// CONSTANTS
// =============================================
const PALETTE_COLORS = [
    '#000000','#1a1a1a','#333333','#4d4d4d','#666666','#808080',
    '#999999','#b3b3b3','#cccccc','#e6e6e6','#ffffff',
    '#800000','#cc0000','#ff0000','#ff4d4d','#ff9999',
    '#804000','#cc6600','#ff8000','#ffad4d','#ffd699',
    '#808000','#cccc00','#ffff00','#ffff4d','#ffff99',
    '#408000','#66cc00','#80ff00','#adff4d','#d6ff99',
    '#008000','#00cc00','#00ff00','#4dff4d','#99ff99',
    '#008040','#00cc66','#00ff80','#4dffad','#99ffd6',
    '#008080','#00cccc','#00ffff','#4dffff','#99ffff',
    '#004080','#0066cc','#0080ff','#4dadff','#99d6ff',
    '#000080','#0000cc','#0000ff','#4d4dff','#9999ff',
    '#400080','#6600cc','#8000ff','#ad4dff','#d699ff',
    '#800080','#cc00cc','#ff00ff','#ff4dff','#ff99ff',
    '#800040','#cc0066','#ff0080','#ff4dad','#ff99d6',
];

const PAGE_PRESETS = {
    'a4-portrait':       { w: 794, h: 1123 },
    'a4-landscape':      { w: 1123, h: 794 },
    'a3-portrait':       { w: 1123, h: 1587 },
    'a3-landscape':      { w: 1587, h: 1123 },
    'letter-portrait':   { w: 816, h: 1056 },
    'letter-landscape':  { w: 1056, h: 816 },
    '1920x1080':         { w: 1920, h: 1080 },
    '1080x1080':         { w: 1080, h: 1080 },
    '800x600':           { w: 800, h: 600 },
};

const UNITS = {
    px: { factor: 1, dec: 1 },
    mm: { factor: 25.4 / 96, dec: 2 },
    cm: { factor: 2.54 / 96, dec: 2 },
    in: { factor: 1 / 96, dec: 3 },
};

const TOOL_NAMES = {
    select:  'Seleccionar',
    rect:    'Rectángulo',
    ellipse: 'Elipse',
    line:    'Línea',
    bspline: 'B-Spline',
    text:    'Texto',
};

const FONT_BASE = 'https://raw.githubusercontent.com/google/fonts/main/';
const FONTS = [
    { name: 'Inter', css: 'Inter, system-ui, sans-serif', url: FONT_BASE + 'ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf' },
    { name: 'Arial', css: 'Arial, Helvetica, sans-serif', url: FONT_BASE + 'apache/arimo/Arimo%5Bwght%5D.ttf' },
    { name: 'Georgia', css: 'Georgia, serif', url: FONT_BASE + 'apache/tinos/Tinos-Regular.ttf' },
    { name: 'Times New Roman', css: '"Times New Roman", Times, serif', url: FONT_BASE + 'apache/tinos/Tinos-Regular.ttf' },
    { name: 'Courier New', css: '"Courier New", Courier, monospace', url: FONT_BASE + 'ofl/courierprime/CourierPrime-Regular.ttf' },
    { name: 'Verdana', css: 'Verdana, Geneva, sans-serif', url: FONT_BASE + 'ofl/cabin/Cabin%5Bwdth%2Cwght%5D.ttf' },
    { name: 'Rows of Sunflowers', css: '"Rows of Sunflowers", cursive', url: '/editor/fonts/RowsOfSunflowers.ttf' },
];

// Loaded opentype font objects for text-to-curves export
const loadedOTFonts = {};

const SNAP_DIST = 12; // screen pixels

// =============================================
// STATE
// =============================================
const state = {
    tool: 'select',
    fillColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2,

    pageWidth: 800,
    pageHeight: 600,

    objects: [],
    nextId: 1,
    selectedIds: [],

    isDrawing: false,
    drawStart: null,

    bsplinePoints: [],

    viewBox: { x: 0, y: 0, w: 1000, h: 800 },
    isPanning: false,
    panStart: null,
    panViewBoxStart: null,

    isDragging: false,
    dragStart: null,
    dragObjProps: null,

    previewElement: null,
    spaceHeld: false,

    unit: 'mm',
    lockAspect: true,

    fontFamily: 'Inter',
    fontSize: 32,
    isTyping: false,
    typingObj: null,

    isResizing: false,
    resizeHandle: null, // 'nw','ne','sw','se'
    resizeStart: null,
    resizeObjBounds: null,
    resizeObjId: null,
};

// Undo/Redo
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function serializeObj(obj) {
    const copy = {};
    for (const k of Object.keys(obj)) {
        if (k === 'element') continue;
        if (k === 'children' && Array.isArray(obj.children)) {
            copy.children = obj.children.map(serializeObj);
        } else if (k === 'contents' && Array.isArray(obj.contents)) {
            copy.contents = obj.contents.map(serializeObj);
        } else if (k === 'container' && obj.container) {
            copy.container = serializeObj(obj.container);
        } else if (k === 'points' && Array.isArray(obj.points)) {
            copy.points = obj.points.map(p => ({...p}));
        } else {
            copy[k] = obj[k];
        }
    }
    return copy;
}

function saveUndoState() {
    const snapshot = {
        objects: state.objects.map(serializeObj),
        nextId: state.nextId,
        selectedIds: [...state.selectedIds],
    };
    undoStack.push(JSON.stringify(snapshot));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0; // clear redo on new action
}

function restoreSnapshot(json) {
    const snapshot = JSON.parse(json);
    // Clear current
    objectsLayer.innerHTML = '';
    selectionLayer.innerHTML = '';
    state.objects = [];
    state.selectedIds = [];
    // Rebuild
    for (const data of snapshot.objects) {
        const obj = data;
        const elem = buildSVGElement(obj);
        obj.element = elem;
        elem.dataset.objectId = obj.id;
        objectsLayer.appendChild(elem);
        state.objects.push(obj);
    }
    state.nextId = snapshot.nextId;
    state.selectedIds = snapshot.selectedIds;
    drawSelection();
    updatePropsPanel();
}

function undo() {
    if (undoStack.length === 0) return;
    // Save current state to redo
    const current = {
        objects: state.objects.map(serializeObj),
        nextId: state.nextId,
        selectedIds: [...state.selectedIds],
    };
    redoStack.push(JSON.stringify(current));
    restoreSnapshot(undoStack.pop());
}

function redo() {
    if (redoStack.length === 0) return;
    // Save current state to undo
    const current = {
        objects: state.objects.map(serializeObj),
        nextId: state.nextId,
        selectedIds: [...state.selectedIds],
    };
    undoStack.push(JSON.stringify(current));
    restoreSnapshot(redoStack.pop());
}

// Helpers for selected IDs
function primaryId() { return state.selectedIds[0] || null; }
function isSelected(id) { return state.selectedIds.includes(id); }

// =============================================
// DOM REFERENCES
// =============================================
let svg, objectsLayer, selectionLayer, previewLayer, snapLayer;
let pageRect;

// =============================================
// INITIALIZATION
// =============================================
function init() {
    svg            = document.getElementById('canvas');
    objectsLayer   = document.getElementById('objects-layer');
    selectionLayer = document.getElementById('selection-layer');
    previewLayer   = document.getElementById('preview-layer');
    snapLayer      = document.getElementById('snap-layer');
    pageRect       = document.getElementById('page');

    updatePage();
    requestAnimationFrame(() => resetView());
    buildColorPalette();
    setupEventListeners();
    updateStatusBar();
}

// =============================================
// PAGE MANAGEMENT
// =============================================
function updatePage() {
    pageRect.setAttribute('x', 0);
    pageRect.setAttribute('y', 0);
    pageRect.setAttribute('width', state.pageWidth);
    pageRect.setAttribute('height', state.pageHeight);
    document.getElementById('status-page').textContent =
        `${toUnit(state.pageWidth)} × ${toUnit(state.pageHeight)} ${state.unit}`;
}

function resetView() {
    const margin = 60;
    const ws = document.getElementById('workspace');
    const rect = ws.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const wsAspect = rect.width / rect.height;
    const pageAspect = (state.pageWidth + 2 * margin) / (state.pageHeight + 2 * margin);
    let vw, vh;
    if (wsAspect > pageAspect) { vh = state.pageHeight + 2 * margin; vw = vh * wsAspect; }
    else { vw = state.pageWidth + 2 * margin; vh = vw / wsAspect; }
    state.viewBox = { x: -(vw - state.pageWidth) / 2, y: -(vh - state.pageHeight) / 2, w: vw, h: vh };
    updateViewBox();
}

function updateViewBox() {
    svg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
    const wsW = document.getElementById('workspace').getBoundingClientRect().width;
    if (wsW > 0) {
        const zoom = Math.round((wsW / state.viewBox.w) * 100);
        document.getElementById('status-zoom').textContent = `${zoom}%`;
    }
}

// =============================================
// COORDINATE CONVERSION
// =============================================
function screenToSVG(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// =============================================
// OBJECT MANAGEMENT
// =============================================
function createObject(type, props) {
    saveUndoState();
    const obj = {
        id: state.nextId++,
        type,
        fill: (type === 'line' || type === 'bspline') ? 'none' : state.fillColor,
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
        rotation: 0,
        ...props,
    };
    if (type === 'group' || type === 'image' || type === 'powerclip' || type === 'curvepath') { obj.fill = 'none'; obj.stroke = 'none'; obj.strokeWidth = 0; }
    const elem = buildSVGElement(obj);
    obj.element = elem;
    elem.dataset.objectId = obj.id;
    objectsLayer.appendChild(elem);
    state.objects.push(obj);
    return obj;
}

function buildSVGElement(obj) {
    const ns = 'http://www.w3.org/2000/svg';
    let elem;
    switch (obj.type) {
        case 'rect':
            elem = document.createElementNS(ns, 'rect');
            elem.setAttribute('x', obj.x); elem.setAttribute('y', obj.y);
            elem.setAttribute('width', obj.width); elem.setAttribute('height', obj.height);
            break;
        case 'ellipse':
            elem = document.createElementNS(ns, 'ellipse');
            elem.setAttribute('cx', obj.cx); elem.setAttribute('cy', obj.cy);
            elem.setAttribute('rx', obj.rx); elem.setAttribute('ry', obj.ry);
            break;
        case 'line':
            elem = document.createElementNS(ns, 'line');
            elem.setAttribute('x1', obj.x1); elem.setAttribute('y1', obj.y1);
            elem.setAttribute('x2', obj.x2); elem.setAttribute('y2', obj.y2);
            break;
        case 'bspline':
            elem = document.createElementNS(ns, 'path');
            elem.setAttribute('d', bsplineToPath(obj.points));
            break;
        case 'text': {
            elem = document.createElementNS(ns, 'text');
            elem.setAttribute('x', obj.x); elem.setAttribute('y', obj.y);
            const fontDef = FONTS.find(f => f.name === obj.fontFamily) || FONTS[0];
            elem.setAttribute('font-family', fontDef.css);
            elem.setAttribute('font-size', obj.fontSize);
            elem.setAttribute('fill', obj.fill);
            elem.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
            elem.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth);
            elem.textContent = obj.text || '';
            break;
        }
        case 'curvepath': {
            elem = document.createElementNS(ns, 'path');
            elem.setAttribute('d', obj.d);
            elem.setAttribute('fill', obj.fill);
            elem.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
            elem.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth);
            // Apply transform for position/scale
            if (obj._origBounds) {
                const orig = obj._origBounds;
                const sx = obj.width / orig.w, sy = obj.height / orig.h;
                const tx = obj.x - orig.x * sx, ty = obj.y - orig.y * sy;
                let t = `translate(${tx}, ${ty}) scale(${sx}, ${sy})`;
                if (obj.rotation) {
                    const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
                    t = `rotate(${obj.rotation} ${cx} ${cy}) ` + t;
                }
                elem.setAttribute('transform', t);
            }
            break;
        }
        case 'image':
            elem = document.createElementNS(ns, 'image');
            elem.setAttribute('x', obj.x); elem.setAttribute('y', obj.y);
            elem.setAttribute('width', obj.width); elem.setAttribute('height', obj.height);
            elem.setAttributeNS('http://www.w3.org/1999/xlink', 'href', obj.href);
            elem.setAttribute('preserveAspectRatio', 'none');
            break;
        case 'group':
            elem = document.createElementNS(ns, 'g');
            for (const child of obj.children) {
                const ce = buildSVGElement(child);
                child.element = ce;
                ce.dataset.objectId = obj.id; // clicks on children → group
                elem.appendChild(ce);
            }
            break;
        case 'powerclip': {
            elem = document.createElementNS(ns, 'g');
            const clipId = 'clip-' + obj.id;
            const patId = 'pc-pat-' + obj.id;
            const defs = document.createElementNS(ns, 'defs');
            const clipPath = document.createElementNS(ns, 'clipPath');
            clipPath.setAttribute('id', clipId);
            clipPath.appendChild(buildClipShape(obj.container, ns));
            defs.appendChild(clipPath);
            // Crosshatch pattern for empty powerclips
            const pat = document.createElementNS(ns, 'pattern');
            pat.setAttribute('id', patId);
            pat.setAttribute('width', '12'); pat.setAttribute('height', '12');
            pat.setAttribute('patternUnits', 'userSpaceOnUse');
            const pl1 = document.createElementNS(ns, 'line');
            pl1.setAttribute('x1','0'); pl1.setAttribute('y1','0');
            pl1.setAttribute('x2','12'); pl1.setAttribute('y2','12');
            pl1.setAttribute('stroke', '#c8c0d8'); pl1.setAttribute('stroke-width', '0.7');
            pat.appendChild(pl1);
            const pl2 = document.createElementNS(ns, 'line');
            pl2.setAttribute('x1','12'); pl2.setAttribute('y1','0');
            pl2.setAttribute('x2','0'); pl2.setAttribute('y2','12');
            pl2.setAttribute('stroke', '#c8c0d8'); pl2.setAttribute('stroke-width', '0.7');
            pat.appendChild(pl2);
            defs.appendChild(pat);
            elem.appendChild(defs);
            // Draw the container shape (visible border)
            const containerElem = buildSVGElement(obj.container);
            obj.container.element = containerElem;
            containerElem.dataset.objectId = obj.id;
            elem.appendChild(containerElem);
            // If empty, show crosshatch fill clipped to container
            if (obj.contents.length === 0) {
                const hatch = buildClipShape(obj.container, ns);
                hatch.setAttribute('fill', `url(#${patId})`);
                hatch.setAttribute('stroke', 'none');
                hatch.setAttribute('pointer-events', 'none');
                elem.appendChild(hatch);
            }
            // Clipped content group
            const contentGroup = document.createElementNS(ns, 'g');
            contentGroup.setAttribute('clip-path', `url(#${clipId})`);
            for (const content of obj.contents) {
                const ce = buildSVGElement(content);
                content.element = ce;
                ce.dataset.objectId = obj.id;
                contentGroup.appendChild(ce);
            }
            elem.appendChild(contentGroup);
            break;
        }
    }
    if (!elem) {
        // Unknown type fallback — create a transparent rect placeholder
        elem = document.createElementNS(ns, 'rect');
        elem.setAttribute('width', 0); elem.setAttribute('height', 0);
    }
    if (obj.type !== 'group' && obj.type !== 'image' && obj.type !== 'powerclip' && obj.type !== 'text' && obj.type !== 'curvepath') {
        elem.setAttribute('fill', obj.fill);
        elem.setAttribute('stroke', obj.stroke);
        elem.setAttribute('stroke-width', obj.strokeWidth);
    }
    if (obj.type !== 'curvepath') applyRotation(obj, elem);
    elem.style.cursor = 'pointer';
    return elem;
}

function buildClipShape(container, ns) {
    let shape;
    switch (container.type) {
        case 'rect':
            shape = document.createElementNS(ns, 'rect');
            shape.setAttribute('x', container.x); shape.setAttribute('y', container.y);
            shape.setAttribute('width', container.width); shape.setAttribute('height', container.height);
            break;
        case 'ellipse':
            shape = document.createElementNS(ns, 'ellipse');
            shape.setAttribute('cx', container.cx); shape.setAttribute('cy', container.cy);
            shape.setAttribute('rx', container.rx); shape.setAttribute('ry', container.ry);
            break;
        default:
            shape = document.createElementNS(ns, 'rect');
            const b = getObjBounds(container);
            shape.setAttribute('x', b.x); shape.setAttribute('y', b.y);
            shape.setAttribute('width', b.w); shape.setAttribute('height', b.h);
            break;
    }
    if (container.rotation) {
        const b = getObjBounds(container);
        const cx = b.x + b.w/2, cy = b.y + b.h/2;
        shape.setAttribute('transform', `rotate(${container.rotation} ${cx} ${cy})`);
    }
    return shape;
}

function applyRotation(obj, elem) {
    if (!elem) elem = obj.element;
    if (obj.rotation && obj.rotation !== 0) {
        const b = getObjBounds(obj);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        elem.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
    } else {
        elem.removeAttribute('transform');
    }
}

function refreshElement(obj) {
    const elem = obj.element;
    switch (obj.type) {
        case 'rect':
            elem.setAttribute('x', obj.x); elem.setAttribute('y', obj.y);
            elem.setAttribute('width', obj.width); elem.setAttribute('height', obj.height);
            break;
        case 'ellipse':
            elem.setAttribute('cx', obj.cx); elem.setAttribute('cy', obj.cy);
            elem.setAttribute('rx', obj.rx); elem.setAttribute('ry', obj.ry);
            break;
        case 'line':
            elem.setAttribute('x1', obj.x1); elem.setAttribute('y1', obj.y1);
            elem.setAttribute('x2', obj.x2); elem.setAttribute('y2', obj.y2);
            break;
        case 'bspline':
            elem.setAttribute('d', bsplineToPath(obj.points));
            break;
        case 'image':
            elem.setAttribute('x', obj.x); elem.setAttribute('y', obj.y);
            elem.setAttribute('width', obj.width); elem.setAttribute('height', obj.height);
            break;
        case 'text': {
            elem.setAttribute('x', obj.x); elem.setAttribute('y', obj.y);
            const fontDef = FONTS.find(f => f.name === obj.fontFamily) || FONTS[0];
            elem.setAttribute('font-family', fontDef.css);
            elem.setAttribute('font-size', obj.fontSize);
            elem.setAttribute('fill', obj.fill);
            elem.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
            elem.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth);
            elem.textContent = obj.text || '';
            break;
        }
        case 'curvepath': {
            const orig = obj._origBounds;
            if (!orig) break; // safety
            const sx = obj.width / orig.w;
            const sy = obj.height / orig.h;
            // translate so the scaled path lands at obj.x, obj.y
            const tx = obj.x - orig.x * sx;
            const ty = obj.y - orig.y * sy;
            let t = `translate(${tx}, ${ty}) scale(${sx}, ${sy})`;
            if (obj.rotation) {
                const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
                t = `rotate(${obj.rotation} ${cx} ${cy}) ` + t;
            }
            elem.setAttribute('transform', t);
            elem.setAttribute('fill', obj.fill);
            elem.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
            elem.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth);
            return;
        }
        case 'group':
            for (const child of obj.children) refreshElement(child);
            break;
        case 'powerclip':
            // Rebuild entirely since clip path needs updating
            rebuildPowerClipElement(obj);
            return; // rebuildPowerClipElement handles everything
    }
    if (obj.type !== 'group' && obj.type !== 'image' && obj.type !== 'powerclip' && obj.type !== 'text' && obj.type !== 'curvepath') {
        elem.setAttribute('fill', obj.fill);
        elem.setAttribute('stroke', obj.stroke);
        elem.setAttribute('stroke-width', obj.strokeWidth);
    }
    if (obj.type !== 'curvepath') applyRotation(obj, elem);
}

function deleteObject(id) {
    saveUndoState();
    const idx = state.objects.findIndex(o => o.id === id);
    if (idx === -1) return;
    state.objects[idx].element.remove();
    state.objects.splice(idx, 1);
    if (isSelected(id)) {
        state.selectedIds = state.selectedIds.filter(i => i !== id);
        drawSelection();
    }
}

function findObject(id) { return state.objects.find(o => o.id === id); }

function objectAtPoint(pt) {
    for (let i = state.objects.length - 1; i >= 0; i--) {
        if (hitTest(state.objects[i], pt)) return state.objects[i];
    }
    return null;
}

function hitTest(obj, pt) {
    const m = Math.max(state.viewBox.w, state.viewBox.h) * 0.006;
    if (obj.type === 'group') {
        for (let i = obj.children.length - 1; i >= 0; i--) {
            if (hitTest(obj.children[i], pt)) return true;
        }
        return false;
    }
    if (obj.type === 'powerclip') {
        return hitTest(obj.container, pt);
    }
    switch (obj.type) {
        case 'text': {
            const tb = getObjBounds(obj);
            return pt.x >= tb.x - m && pt.x <= tb.x + tb.w + m &&
                   pt.y >= tb.y - m && pt.y <= tb.y + tb.h + m;
        }
        case 'rect': case 'image': case 'curvepath':
            return pt.x >= obj.x - m && pt.x <= obj.x + obj.width + m &&
                   pt.y >= obj.y - m && pt.y <= obj.y + obj.height + m;
        case 'ellipse': {
            const dx = (pt.x - obj.cx) / (obj.rx + m), dy = (pt.y - obj.cy) / (obj.ry + m);
            return dx * dx + dy * dy <= 1;
        }
        case 'line':
            return distToSeg(pt, {x:obj.x1,y:obj.y1}, {x:obj.x2,y:obj.y2}) <= m + obj.strokeWidth;
        case 'bspline': {
            if (obj.points.length < 2) return false;
            const samples = sampleBSpline(obj.points, 80);
            for (let i = 0; i < samples.length - 1; i++) {
                if (distToSeg(pt, samples[i], samples[i+1]) <= m + obj.strokeWidth) return true;
            }
            return false;
        }
    }
    return false;
}

function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x)*dx + (p.y - a.y)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t*dx), p.y - (a.y + t*dy));
}

// =============================================
// SELECTION
// =============================================
function selectObject(id, addToSelection) {
    if (id === null && !addToSelection) {
        state.selectedIds = [];
        pcEditingId = null;
    } else if (id !== null) {
        if (addToSelection) {
            if (isSelected(id)) state.selectedIds = state.selectedIds.filter(i => i !== id);
            else state.selectedIds.push(id);
        } else {
            state.selectedIds = [id];
        }
        const obj = findObject(id);
        if (!obj || obj.type !== 'powerclip' || obj.id !== pcEditingId) {
            pcEditingId = null;
        }
    }
    drawSelection();
    updatePropsPanel();
    updatePowerClipMenu();
}

function drawSelection() {
    selectionLayer.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;
        const bounds = getObjBounds(obj);
        const sw = state.viewBox.w * 0.0015;
        const hs = state.viewBox.w * 0.007;
        // Wrap everything in a group with rotation
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('pointer-events', 'none');
        if (obj.rotation) {
            const rcx = bounds.x + bounds.w/2, rcy = bounds.y + bounds.h/2;
            g.setAttribute('transform', `rotate(${obj.rotation} ${rcx} ${rcy})`);
        }
        // Dashed box
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', bounds.x); r.setAttribute('y', bounds.y);
        r.setAttribute('width', bounds.w); r.setAttribute('height', bounds.h);
        r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#7c5cf0');
        r.setAttribute('stroke-width', sw);
        r.setAttribute('stroke-dasharray', `${sw*4} ${sw*2}`);
        r.setAttribute('pointer-events', 'none');
        g.appendChild(r);
        // Corner handles (squares)
        const corners = [
            [bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y],
            [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h],
        ];
        for (const [cx, cy] of corners) {
            const h = document.createElementNS(ns, 'rect');
            h.setAttribute('x', cx - hs/2); h.setAttribute('y', cy - hs/2);
            h.setAttribute('width', hs); h.setAttribute('height', hs);
            h.setAttribute('fill', '#fff'); h.setAttribute('stroke', '#7c5cf0');
            h.setAttribute('stroke-width', sw); h.setAttribute('pointer-events', 'none');
            g.appendChild(h);
        }
        // Midpoint handles (diamonds)
        const mids = [
            [bounds.x + bounds.w/2, bounds.y],           // n
            [bounds.x + bounds.w/2, bounds.y + bounds.h], // s
            [bounds.x, bounds.y + bounds.h/2],             // w
            [bounds.x + bounds.w, bounds.y + bounds.h/2],  // e
        ];
        const ms = hs * 0.8;
        for (const [mx, my] of mids) {
            const d = document.createElementNS(ns, 'rect');
            d.setAttribute('x', mx - ms/2); d.setAttribute('y', my - ms/2);
            d.setAttribute('width', ms); d.setAttribute('height', ms);
            d.setAttribute('fill', '#fff'); d.setAttribute('stroke', '#7c5cf0');
            d.setAttribute('stroke-width', sw); d.setAttribute('pointer-events', 'none');
            d.setAttribute('transform', `rotate(45 ${mx} ${my})`);
            g.appendChild(d);
        }
        selectionLayer.appendChild(g);
        // B-spline control points (outside rotation group — they use actual point coords)
        if (obj.type === 'bspline' && obj.points.length > 0) {
            const cs = hs * 0.7;
            if (obj.points.length > 1) {
                const pl = document.createElementNS(ns, 'polyline');
                pl.setAttribute('points', obj.points.map(p => `${p.x},${p.y}`).join(' '));
                pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#7c5cf0');
                pl.setAttribute('stroke-width', sw * 0.6);
                pl.setAttribute('stroke-dasharray', `${sw*3} ${sw*1.5}`);
                pl.setAttribute('pointer-events', 'none');
                selectionLayer.appendChild(pl);
            }
            for (const p of obj.points) {
                const c = document.createElementNS(ns, 'circle');
                c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', cs/2);
                c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#7c5cf0');
                c.setAttribute('stroke-width', sw); c.setAttribute('pointer-events', 'none');
                selectionLayer.appendChild(c);
            }
        }
    }
}

function getObjBounds(obj) {
    switch (obj.type) {
        case 'rect': case 'image': case 'curvepath': return { x: obj.x, y: obj.y, w: obj.width, h: obj.height };
        case 'ellipse': return { x: obj.cx - obj.rx, y: obj.cy - obj.ry, w: obj.rx*2, h: obj.ry*2 };
        case 'line': {
            const x = Math.min(obj.x1, obj.x2), y = Math.min(obj.y1, obj.y2);
            return { x, y, w: Math.abs(obj.x2-obj.x1)||1, h: Math.abs(obj.y2-obj.y1)||1 };
        }
        case 'bspline': {
            if (!obj.points.length) return {x:0,y:0,w:0,h:0};
            const pts = sampleBSpline(obj.points, 80);
            let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
            for (const p of pts) { if(p.x<x1)x1=p.x; if(p.x>x2)x2=p.x; if(p.y<y1)y1=p.y; if(p.y>y2)y2=p.y; }
            return {x:x1,y:y1,w:(x2-x1)||1,h:(y2-y1)||1};
        }
        case 'group': {
            let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
            for (const c of obj.children) {
                const b = getObjBounds(c);
                if(b.x<x1)x1=b.x; if(b.y<y1)y1=b.y;
                if(b.x+b.w>x2)x2=b.x+b.w; if(b.y+b.h>y2)y2=b.y+b.h;
            }
            if(!isFinite(x1)) return {x:0,y:0,w:0,h:0};
            return {x:x1,y:y1,w:x2-x1,h:y2-y1};
        }
        case 'text': {
            // Use cached bounds or measure from SVG element
            if (obj.element && obj.element.getBBox) {
                try {
                    const bb = obj.element.getBBox();
                    return { x: bb.x, y: bb.y, w: bb.width || 1, h: bb.height || 1 };
                } catch(e) {}
            }
            // Fallback: estimate
            const estW = (obj.text || '').length * obj.fontSize * 0.6;
            const estH = obj.fontSize * 1.2;
            return { x: obj.x, y: obj.y - estH, w: estW || 1, h: estH };
        }
        case 'powerclip':
            return getObjBounds(obj.container);
    }
}

// =============================================
// SNAP POINTS (hover indicators)
// =============================================
// Rotate a point around a center by angle in degrees
function rotatePoint(px, py, cx, cy, angleDeg) {
    if (!angleDeg) return {x: px, y: py};
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = px - cx, dy = py - cy;
    return { x: cx + dx*cos - dy*sin, y: cy + dx*sin + dy*cos };
}

function getSnapPoints(obj) {
    const pts = [];
    const b = getObjBounds(obj);
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const rot = obj.rotation || 0;
    // Center (rotation doesn't move the center)
    pts.push({ x: cx, y: cy, type: 'center' });
    if (obj.type === 'rect' || obj.type === 'group' || obj.type === 'image' || obj.type === 'text' || obj.type === 'curvepath') {
        // Corners
        const rawCorners = [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}];
        for (const c of rawCorners) { const rp = rotatePoint(c.x,c.y,cx,cy,rot); pts.push({...rp,type:'corner'}); }
        // Edge midpoints
        const rawEdges = [{x:b.x+b.w/2,y:b.y},{x:b.x+b.w/2,y:b.y+b.h},{x:b.x,y:b.y+b.h/2},{x:b.x+b.w,y:b.y+b.h/2}];
        for (const e of rawEdges) { const rp = rotatePoint(e.x,e.y,cx,cy,rot); pts.push({...rp,type:'edge'}); }
    } else if (obj.type === 'ellipse') {
        // Quadrant points (cardinal) rotated
        const rawQ = [{x:obj.cx,y:obj.cy-obj.ry},{x:obj.cx,y:obj.cy+obj.ry},{x:obj.cx-obj.rx,y:obj.cy},{x:obj.cx+obj.rx,y:obj.cy}];
        for (const q of rawQ) { const rp = rotatePoint(q.x,q.y,cx,cy,rot); pts.push({...rp,type:'quadrant'}); }
    } else if (obj.type === 'line') {
        const rp1 = rotatePoint(obj.x1,obj.y1,cx,cy,rot);
        const rp2 = rotatePoint(obj.x2,obj.y2,cx,cy,rot);
        pts.push({...rp1,type:'endpoint'},{...rp2,type:'endpoint'});
        const mid = rotatePoint((obj.x1+obj.x2)/2,(obj.y1+obj.y2)/2,cx,cy,rot);
        pts.push({...mid,type:'edge'});
    } else if (obj.type === 'powerclip') {
        return getSnapPoints(obj.container);
    }
    return pts;
}

// Find the nearest point on an object's perimeter to a given point (rotation-aware)
function nearestEdgePoint(obj, pt) {
    const b = getObjBounds(obj);
    const ccx = b.x + b.w/2, ccy = b.y + b.h/2;
    const rot = obj.rotation || 0;
    // Un-rotate the mouse point to work in local space, then rotate result back
    const localPt = rotatePoint(pt.x, pt.y, ccx, ccy, -rot);

    if (obj.type === 'rect' || obj.type === 'group' || obj.type === 'image' || obj.type === 'text' || obj.type === 'curvepath') {
        const edges = [
            [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y}],
            [{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h}],
            [{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}],
            [{x:b.x,y:b.y+b.h},{x:b.x,y:b.y}],
        ];
        let best = null, bestD = Infinity;
        for (const [a, b2] of edges) {
            const p = closestPointOnSeg(localPt, a, b2);
            const d = Math.hypot(localPt.x - p.x, localPt.y - p.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        const rp = rotatePoint(best.x, best.y, ccx, ccy, rot);
        return { point: rp, dist: bestD };
    } else if (obj.type === 'ellipse') {
        let best = null, bestD = Infinity;
        const steps = 64;
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const px = obj.cx + obj.rx * Math.cos(angle);
            const py = obj.cy + obj.ry * Math.sin(angle);
            const d = Math.hypot(localPt.x - px, localPt.y - py);
            if (d < bestD) { bestD = d; best = {x: px, y: py}; }
        }
        const rp = rotatePoint(best.x, best.y, ccx, ccy, rot);
        return { point: rp, dist: bestD };
    } else if (obj.type === 'line') {
        const p = closestPointOnSeg(localPt, {x:obj.x1,y:obj.y1}, {x:obj.x2,y:obj.y2});
        const rp = rotatePoint(p.x, p.y, ccx, ccy, rot);
        return { point: rp, dist: Math.hypot(localPt.x - p.x, localPt.y - p.y) };
    } else if (obj.type === 'bspline') {
        if (obj.points.length < 2) return null;
        const samples = sampleBSpline(obj.points, 80);
        let best = null, bestD = Infinity;
        for (let i = 0; i < samples.length - 1; i++) {
            const p = closestPointOnSeg(localPt, samples[i], samples[i+1]);
            const d = Math.hypot(localPt.x - p.x, localPt.y - p.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        if (!best) return null;
        const rp = rotatePoint(best.x, best.y, ccx, ccy, rot);
        return { point: rp, dist: bestD };
    } else if (obj.type === 'powerclip') {
        return nearestEdgePoint(obj.container, pt);
    }
    return null;
}

function closestPointOnSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx*dx + dy*dy;
    if (len2 === 0) return {x: a.x, y: a.y};
    let t = ((p.x - a.x)*dx + (p.y - a.y)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return {x: a.x + t*dx, y: a.y + t*dy};
}

function drawSnapIndicators(mousePt) {
    snapLayer.innerHTML = '';
    if (state.selectedIds.length === 0) return;
    const ns = 'http://www.w3.org/2000/svg';
    const screenScale = state.viewBox.w / svg.getBoundingClientRect().width;
    const threshold = SNAP_DIST * screenScale;
    const edgeThreshold = threshold * 1.5; // wider detection for edge proximity
    const r = 4.5 * screenScale;

    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;

        // 1) Fixed snap points (center, corners, quadrants, edges, endpoints)
        const snaps = getSnapPoints(obj);
        let fixedShown = false;
        for (const sp of snaps) {
            const d = Math.hypot(mousePt.x - sp.x, mousePt.y - sp.y);
            if (d > threshold) continue;
            fixedShown = true;
            drawSnapMarker(ns, sp, r, screenScale);
        }

        // 2) Dynamic nearest-edge point (shows when near the perimeter but not near a fixed snap)
        if (!fixedShown) {
            const ne = nearestEdgePoint(obj, mousePt);
            if (ne && ne.dist <= edgeThreshold) {
                drawSnapMarker(ns, { x: ne.point.x, y: ne.point.y, type: 'edge-dynamic' }, r, screenScale);
            }
        }
    }
}

function drawSnapMarker(ns, sp, r, sw) {
    const color = '#7c5cf0';
    const fontSize = sw * 15;
    const labelOffset = r * 2.2;
    function addLabel(x, y, text) {
        const txt = document.createElementNS(ns, 'text');
        txt.setAttribute('x', x); txt.setAttribute('y', y);
        txt.setAttribute('fill', color); txt.setAttribute('font-size', fontSize);
        txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        txt.setAttribute('pointer-events', 'none');
        txt.textContent = text;
        snapLayer.appendChild(txt);
    }
    if (sp.type === 'center') {
        const sz = r * 2;
        const l1 = document.createElementNS(ns, 'line');
        l1.setAttribute('x1', sp.x - sz); l1.setAttribute('y1', sp.y);
        l1.setAttribute('x2', sp.x + sz); l1.setAttribute('y2', sp.y);
        l1.setAttribute('stroke', color); l1.setAttribute('stroke-width', sw);
        l1.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(l1);
        const l2 = document.createElementNS(ns, 'line');
        l2.setAttribute('x1', sp.x); l2.setAttribute('y1', sp.y - sz);
        l2.setAttribute('x2', sp.x); l2.setAttribute('y2', sp.y + sz);
        l2.setAttribute('stroke', color); l2.setAttribute('stroke-width', sw);
        l2.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(l2);
        addLabel(sp.x + labelOffset, sp.y + fontSize*0.35, 'centro');
    } else if (sp.type === 'corner' || sp.type === 'endpoint') {
        const sq = document.createElementNS(ns, 'rect');
        sq.setAttribute('x', sp.x - r); sq.setAttribute('y', sp.y - r);
        sq.setAttribute('width', r*2); sq.setAttribute('height', r*2);
        sq.setAttribute('fill', 'none'); sq.setAttribute('stroke', color);
        sq.setAttribute('stroke-width', sw);
        sq.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(sq);
        addLabel(sp.x + labelOffset, sp.y + fontSize*0.35, sp.type === 'corner' ? 'esquina' : 'punto');
    } else if (sp.type === 'edge') {
        const tr = document.createElementNS(ns, 'polygon');
        tr.setAttribute('points', `${sp.x},${sp.y-r*1.3} ${sp.x-r},${sp.y+r*0.7} ${sp.x+r},${sp.y+r*0.7}`);
        tr.setAttribute('fill', 'none'); tr.setAttribute('stroke', color);
        tr.setAttribute('stroke-width', sw);
        tr.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(tr);
        addLabel(sp.x + labelOffset, sp.y + fontSize*0.35, 'medio');
    } else if (sp.type === 'quadrant') {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', sp.x); c.setAttribute('cy', sp.y); c.setAttribute('r', r);
        c.setAttribute('fill', 'none'); c.setAttribute('stroke', color);
        c.setAttribute('stroke-width', sw);
        c.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(c);
        addLabel(sp.x + labelOffset, sp.y + fontSize*0.35, 'cuadrante');
    } else if (sp.type === 'edge-dynamic') {
        // Square with cross + "borde" label (CorelDRAW style)
        const s = r * 1.3;
        // Square outline
        const sq = document.createElementNS(ns, 'rect');
        sq.setAttribute('x', sp.x - s); sq.setAttribute('y', sp.y - s);
        sq.setAttribute('width', s*2); sq.setAttribute('height', s*2);
        sq.setAttribute('fill', '#fff'); sq.setAttribute('fill-opacity', '0.85');
        sq.setAttribute('stroke', color); sq.setAttribute('stroke-width', sw);
        sq.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(sq);
        // Horizontal line of cross
        const lh = document.createElementNS(ns, 'line');
        lh.setAttribute('x1', sp.x - s*0.6); lh.setAttribute('y1', sp.y);
        lh.setAttribute('x2', sp.x + s*0.6); lh.setAttribute('y2', sp.y);
        lh.setAttribute('stroke', color); lh.setAttribute('stroke-width', sw);
        lh.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(lh);
        // Vertical line of cross
        const lv = document.createElementNS(ns, 'line');
        lv.setAttribute('x1', sp.x); lv.setAttribute('y1', sp.y - s*0.6);
        lv.setAttribute('x2', sp.x); lv.setAttribute('y2', sp.y + s*0.6);
        lv.setAttribute('stroke', color); lv.setAttribute('stroke-width', sw);
        lv.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(lv);
        // "borde" label
        const txt = document.createElementNS(ns, 'text');
        txt.setAttribute('x', sp.x + s*2); txt.setAttribute('y', sp.y + s*0.5);
        txt.setAttribute('fill', color); txt.setAttribute('font-size', sw * 10);
        txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        txt.setAttribute('pointer-events', 'none');
        txt.textContent = 'borde';
        snapLayer.appendChild(txt);
    }
}

// =============================================
// B-SPLINE (De Boor evaluation)
// =============================================
function bsplineToPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    const samples = sampleBSpline(points, Math.max(60, points.length * 20));
    let d = `M ${samples[0].x.toFixed(2)} ${samples[0].y.toFixed(2)}`;
    for (let i = 1; i < samples.length; i++) d += ` L ${samples[i].x.toFixed(2)} ${samples[i].y.toFixed(2)}`;
    return d;
}

function sampleBSpline(ctrlPts, numSamples) {
    const n = ctrlPts.length - 1;
    if (n < 0) return [];
    if (n === 0) return [{x:ctrlPts[0].x,y:ctrlPts[0].y}];
    if (n === 1) {
        const out = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = i/numSamples;
            out.push({x:ctrlPts[0].x*(1-t)+ctrlPts[1].x*t, y:ctrlPts[0].y*(1-t)+ctrlPts[1].y*t});
        }
        return out;
    }
    const degree = Math.min(3, n), m = n + degree + 1;
    const knots = [];
    for (let i = 0; i <= m; i++) {
        if (i <= degree) knots.push(0);
        else if (i >= m - degree) knots.push(n - degree + 1);
        else knots.push(i - degree);
    }
    const tMax = knots[m - degree], out = [];
    for (let s = 0; s <= numSamples; s++) {
        let t = (s/numSamples)*tMax; if (t >= tMax) t = tMax - 1e-10;
        let k = degree;
        for (let j = degree; j < m - degree; j++) { if (t >= knots[j] && t < knots[j+1]) { k = j; break; } }
        const d = [];
        for (let j = 0; j <= degree; j++) { const idx = k - degree + j; d.push({x:ctrlPts[idx].x,y:ctrlPts[idx].y}); }
        for (let r = 1; r <= degree; r++) {
            for (let j = degree; j >= r; j--) {
                const idx = k - degree + j;
                const denom = knots[idx + degree - r + 1] - knots[idx];
                const alpha = denom === 0 ? 0 : (t - knots[idx]) / denom;
                d[j].x = (1-alpha)*d[j-1].x + alpha*d[j].x;
                d[j].y = (1-alpha)*d[j-1].y + alpha*d[j].y;
            }
        }
        out.push({x:d[degree].x, y:d[degree].y});
    }
    return out;
}

// =============================================
// TOOL HANDLERS
// =============================================
function handleMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && state.spaceHeld)) {
        e.preventDefault();
        state.isPanning = true;
        state.panStart = {x:e.clientX,y:e.clientY};
        state.panViewBoxStart = {...state.viewBox};
        svg.style.cursor = 'grabbing';
        return;
    }
    if (e.button !== 0) return;
    if (state.isTyping) return; // don't interfere with text input
    const pt = screenToSVG(e.clientX, e.clientY);
    switch (state.tool) {
        case 'select':  handleSelectDown(pt, e); break;
        case 'rect': case 'ellipse': case 'line': handleShapeDown(pt); break;
        case 'bspline': handleBSplineClick(pt); break;
        case 'text': handleTextClick(pt, e); break;
    }
}

function handleMouseMove(e) {
    const pt = screenToSVG(e.clientX, e.clientY);
    document.getElementById('status-coords').textContent = `X: ${Math.round(pt.x)}  Y: ${Math.round(pt.y)}`;
    if (state.isPanning) {
        const dx = e.clientX - state.panStart.x, dy = e.clientY - state.panStart.y;
        const scale = state.viewBox.w / svg.getBoundingClientRect().width;
        state.viewBox.x = state.panViewBoxStart.x - dx*scale;
        state.viewBox.y = state.panViewBoxStart.y - dy*scale;
        updateViewBox(); return;
    }
    if (state.isResizing) { handleResizeMove(pt, e); return; }
    if (state.isDragging) { handleDragMove(pt); return; }
    if (state.isDrawing) { handleDrawMove(pt, e); return; }
    if (state.tool === 'bspline' && state.bsplinePoints.length > 0) updateBSplinePreview(pt);
    // Snap indicators
    drawSnapIndicators(pt);
    if (state.tool === 'select' && !state.spaceHeld) {
        const handle = getHandleAtPoint(pt);
        if (handle) {
            svg.style.cursor = HANDLE_CURSORS[handle.handle];
        } else {
            svg.style.cursor = objectAtPoint(pt) ? 'move' : 'default';
        }
    }
}

function handleMouseUp() {
    if (state.isPanning) { state.isPanning = false; svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; return; }
    if (state.isResizing) {
        state.isResizing = false;
        state.resizeHandle = null;
        drawSelection(); updatePropsPanel(); return;
    }
    if (state.isDragging) {
        state.isDragging = false;
        clearPCHighlight();
        // Auto-insert into PowerClip: if dragging a single non-powerclip obj and any part overlaps a powerclip
        if (state.selectedIds.length === 1) {
            const draggedId = state.selectedIds[0];
            const dragged = findObject(draggedId);
            if (dragged && dragged.type !== 'powerclip') {
                const db = getObjBounds(dragged);
                // Check corners and center for overlap with any powerclip
                const testPts = [
                    {x: db.x, y: db.y}, {x: db.x+db.w, y: db.y},
                    {x: db.x, y: db.y+db.h}, {x: db.x+db.w, y: db.y+db.h},
                    {x: db.x+db.w/2, y: db.y+db.h/2},
                    {x: db.x+db.w/2, y: db.y}, {x: db.x+db.w/2, y: db.y+db.h},
                    {x: db.x, y: db.y+db.h/2}, {x: db.x+db.w, y: db.y+db.h/2},
                ];
                let pcTarget = null;
                for (const tp of testPts) {
                    pcTarget = findPowerClipAtPoint(tp, draggedId);
                    if (pcTarget) break;
                }
                if (pcTarget) {
                    addToPowerClip(draggedId, pcTarget.id);
                    return;
                }
            }
        }
        drawSelection(); updatePropsPanel(); return;
    }
    if (state.isDrawing) handleDrawEnd();
}

// --- Resize handle detection ---
function getHandleAtPoint(pt) {
    if (state.selectedIds.length !== 1) return null;
    const obj = findObject(state.selectedIds[0]);
    if (!obj) return null;
    const b = getObjBounds(obj);
    const rot = obj.rotation || 0;
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const screenScale = state.viewBox.w / svg.getBoundingClientRect().width;
    const threshold = 8 * screenScale;
    // Corner handles
    const corners = [
        { name: 'nw', x: b.x, y: b.y },
        { name: 'ne', x: b.x + b.w, y: b.y },
        { name: 'sw', x: b.x, y: b.y + b.h },
        { name: 'se', x: b.x + b.w, y: b.y + b.h },
    ];
    for (const c of corners) {
        const rp = rotatePoint(c.x, c.y, cx, cy, rot);
        if (Math.hypot(pt.x - rp.x, pt.y - rp.y) <= threshold) return { handle: c.name, obj };
    }
    // Midpoint handles
    const mids = [
        { name: 'n', x: b.x + b.w/2, y: b.y },
        { name: 's', x: b.x + b.w/2, y: b.y + b.h },
        { name: 'w', x: b.x, y: b.y + b.h/2 },
        { name: 'e', x: b.x + b.w, y: b.y + b.h/2 },
    ];
    for (const m of mids) {
        const rp = rotatePoint(m.x, m.y, cx, cy, rot);
        if (Math.hypot(pt.x - rp.x, pt.y - rp.y) <= threshold) return { handle: m.name, obj };
    }
    return null;
}

const HANDLE_CURSORS = {
    nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
    n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
};

// --- Select ---
function handleSelectDown(pt, e) {
    // Check if clicking on a resize handle first
    const handle = getHandleAtPoint(pt);
    if (handle) {
        saveUndoState();
        state.isResizing = true;
        state.resizeHandle = handle.handle;
        state.resizeObjId = handle.obj.id;
        state.resizeStart = { x: pt.x, y: pt.y };
        state.resizeObjBounds = { ...getObjBounds(handle.obj) };
        state.resizeObjSnapshot = serializeObj(handle.obj);
        return;
    }
    const obj = objectAtPoint(pt);
    if (obj) {
        selectObject(obj.id, e.shiftKey);
        state.isDragging = true;
        state.dragStart = {x:pt.x,y:pt.y};
        saveUndoState();
        // Snapshot positions of all selected objects
        state.dragObjProps = {};
        for (const id of state.selectedIds) {
            const o = findObject(id);
            if (o) state.dragObjProps[id] = snapshotPos(o);
        }
    } else {
        selectObject(null);
    }
}

let pcHighlightEl = null;
let pcHighlightId = null;

function clearPCHighlight() {
    if (pcHighlightEl) { pcHighlightEl.remove(); pcHighlightEl = null; }
    pcHighlightId = null;
}

function showPCHighlight(pc) {
    if (pcHighlightId === pc.id && pcHighlightEl) return; // already showing
    clearPCHighlight();
    pcHighlightId = pc.id;
    const ns = 'http://www.w3.org/2000/svg';
    const c = pc.container;
    pcHighlightEl = document.createElementNS(ns, c.type === 'ellipse' ? 'ellipse' : 'rect');
    pcHighlightEl.setAttribute('pointer-events', 'none');
    pcHighlightEl.setAttribute('fill', 'rgba(168, 130, 255, 0.30)');
    pcHighlightEl.setAttribute('stroke', '#9366f0');
    const screenScale = state.viewBox.w / svg.getBoundingClientRect().width;
    pcHighlightEl.setAttribute('stroke-width', 2 * screenScale);
    pcHighlightEl.setAttribute('stroke-dasharray', `${6*screenScale} ${3*screenScale}`);
    if (c.type === 'ellipse') {
        pcHighlightEl.setAttribute('cx', c.cx);
        pcHighlightEl.setAttribute('cy', c.cy);
        pcHighlightEl.setAttribute('rx', c.rx);
        pcHighlightEl.setAttribute('ry', c.ry);
    } else {
        pcHighlightEl.setAttribute('x', c.x);
        pcHighlightEl.setAttribute('y', c.y);
        pcHighlightEl.setAttribute('width', c.width);
        pcHighlightEl.setAttribute('height', c.height);
        if (c.rotation) pcHighlightEl.setAttribute('transform', `rotate(${c.rotation} ${c.x+c.width/2} ${c.y+c.height/2})`);
    }
    selectionLayer.appendChild(pcHighlightEl);
}

function handleDragMove(pt) {
    const dx = pt.x - state.dragStart.x, dy = pt.y - state.dragStart.y;
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj || !state.dragObjProps[id]) continue;
        applyMove(obj, state.dragObjProps[id], dx, dy);
        refreshElement(obj);
    }
    drawSelection();

    // Highlight powerclip drop target
    if (state.selectedIds.length === 1) {
        const draggedId = state.selectedIds[0];
        const dragged = findObject(draggedId);
        if (dragged && dragged.type !== 'powerclip') {
            const db = getObjBounds(dragged);
            const testPts = [
                {x: db.x, y: db.y}, {x: db.x+db.w, y: db.y},
                {x: db.x, y: db.y+db.h}, {x: db.x+db.w, y: db.y+db.h},
                {x: db.x+db.w/2, y: db.y+db.h/2},
                {x: db.x+db.w/2, y: db.y}, {x: db.x+db.w/2, y: db.y+db.h},
                {x: db.x, y: db.y+db.h/2}, {x: db.x+db.w, y: db.y+db.h/2},
            ];
            let pcTarget = null;
            for (const tp of testPts) {
                pcTarget = findPowerClipAtPoint(tp, draggedId);
                if (pcTarget) break;
            }
            if (pcTarget) { showPCHighlight(pcTarget); } else { clearPCHighlight(); }
        } else { clearPCHighlight(); }
    } else { clearPCHighlight(); }
}

function handleResizeMove(pt, e) {
    const obj = findObject(state.resizeObjId);
    if (!obj) return;
    const ob = state.resizeObjBounds; // original bounds
    const h = state.resizeHandle;
    const fromCenter = e.shiftKey;
    const isCorner = ['nw','ne','sw','se'].includes(h);
    const isMid = ['n','s','w','e'].includes(h);

    let newX = ob.x, newY = ob.y, newW = ob.w, newH = ob.h;
    const dx = pt.x - state.resizeStart.x;
    const dy = pt.y - state.resizeStart.y;

    if (isCorner) {
        // Corner handles: always proportional
        const aspect = ob.w / ob.h;
        let rawW, rawH;
        if (h === 'se') { rawW = ob.w + dx; rawH = ob.h + dy; }
        else if (h === 'nw') { rawW = ob.w - dx; rawH = ob.h - dy; }
        else if (h === 'ne') { rawW = ob.w + dx; rawH = ob.h - dy; }
        else { rawW = ob.w - dx; rawH = ob.h + dy; }
        // Use the larger change to determine scale
        const scaleW = rawW / ob.w, scaleH = rawH / ob.h;
        const scale = Math.max(0.01, Math.abs(scaleW) > Math.abs(scaleH) ? scaleW : scaleH);
        newW = Math.max(2, ob.w * scale);
        newH = Math.max(2, newW / aspect);

        if (fromCenter) {
            const cx = ob.x + ob.w/2, cy = ob.y + ob.h/2;
            newX = cx - newW/2;
            newY = cy - newH/2;
        } else {
            if (h === 'nw') { newX = ob.x + ob.w - newW; newY = ob.y + ob.h - newH; }
            else if (h === 'ne') { newY = ob.y + ob.h - newH; }
            else if (h === 'sw') { newX = ob.x + ob.w - newW; }
            // se: newX/newY stay at ob.x/ob.y
        }
    } else if (isMid) {
        // Midpoint handles: single-axis stretch
        if (h === 'e') {
            newW = Math.max(2, ob.w + dx);
        } else if (h === 'w') {
            newW = Math.max(2, ob.w - dx);
            newX = ob.x + ob.w - newW;
        } else if (h === 's') {
            newH = Math.max(2, ob.h + dy);
        } else if (h === 'n') {
            newH = Math.max(2, ob.h - dy);
            newY = ob.y + ob.h - newH;
        }

        if (fromCenter) {
            const cx = ob.x + ob.w/2, cy = ob.y + ob.h/2;
            if (h === 'e' || h === 'w') {
                const dw = newW - ob.w;
                newW = Math.max(2, ob.w + Math.abs(dw) * 2 * Math.sign(dw));
                newX = cx - newW/2;
            } else {
                const dh = newH - ob.h;
                newH = Math.max(2, ob.h + Math.abs(dh) * 2 * Math.sign(dh));
                newY = cy - newH/2;
            }
        }
    }

    // Apply new position and size
    applyPropPosition(obj, toUnit(newX), toUnit(newY));
    applyPropSize(obj, newW, newH);
    refreshElement(obj);
    drawSelection();
    updatePropsPanel();
}

function snapshotPos(obj) {
    switch (obj.type) {
        case 'rect': case 'image': case 'text': case 'curvepath': return {x:obj.x,y:obj.y};
        case 'ellipse': return {cx:obj.cx,cy:obj.cy};
        case 'line':    return {x1:obj.x1,y1:obj.y1,x2:obj.x2,y2:obj.y2};
        case 'bspline': return {points:obj.points.map(p=>({...p}))};
        case 'group': {
            const snaps = {};
            for (const c of obj.children) snaps[c.id] = snapshotPos(c);
            return {children: snaps};
        }
        case 'powerclip': {
            const containerSnap = snapshotPos(obj.container);
            const contentSnaps = {};
            for (const c of obj.contents) contentSnaps[c.id] = snapshotPos(c);
            return { container: containerSnap, contents: contentSnaps };
        }
    }
}

function applyMove(obj, snap, dx, dy) {
    switch (obj.type) {
        case 'rect': case 'image': case 'text': case 'curvepath': obj.x = snap.x+dx; obj.y = snap.y+dy; break;
        case 'ellipse': obj.cx = snap.cx+dx; obj.cy = snap.cy+dy; break;
        case 'line':    obj.x1=snap.x1+dx;obj.y1=snap.y1+dy;obj.x2=snap.x2+dx;obj.y2=snap.y2+dy; break;
        case 'bspline': obj.points = snap.points.map(p=>({x:p.x+dx,y:p.y+dy})); break;
        case 'group':
            for (const c of obj.children) {
                if (snap.children[c.id]) applyMove(c, snap.children[c.id], dx, dy);
            }
            break;
        case 'powerclip':
            applyMove(obj.container, snap.container, dx, dy);
            for (const c of obj.contents) {
                if (snap.contents[c.id]) applyMove(c, snap.contents[c.id], dx, dy);
            }
            break;
    }
}

// --- Shapes (rect, ellipse, line) with Ctrl/Shift ---
function handleShapeDown(pt) {
    state.isDrawing = true;
    state.drawStart = {x:pt.x,y:pt.y};
    clearPreview();
    const ns = 'http://www.w3.org/2000/svg';
    if (state.tool === 'rect') {
        state.previewElement = document.createElementNS(ns, 'rect');
        state.previewElement.setAttribute('x', pt.x); state.previewElement.setAttribute('y', pt.y);
        state.previewElement.setAttribute('width', 0); state.previewElement.setAttribute('height', 0);
    } else if (state.tool === 'ellipse') {
        state.previewElement = document.createElementNS(ns, 'ellipse');
        state.previewElement.setAttribute('cx', pt.x); state.previewElement.setAttribute('cy', pt.y);
        state.previewElement.setAttribute('rx', 0); state.previewElement.setAttribute('ry', 0);
    } else if (state.tool === 'line') {
        state.previewElement = document.createElementNS(ns, 'line');
        state.previewElement.setAttribute('x1', pt.x); state.previewElement.setAttribute('y1', pt.y);
        state.previewElement.setAttribute('x2', pt.x); state.previewElement.setAttribute('y2', pt.y);
    }
    const el = state.previewElement;
    el.setAttribute('fill', state.tool === 'line' ? 'none' : state.fillColor);
    el.setAttribute('stroke', state.strokeColor);
    el.setAttribute('stroke-width', state.strokeWidth);
    el.setAttribute('stroke-dasharray', `${state.strokeWidth*2} ${state.strokeWidth}`);
    el.setAttribute('pointer-events', 'none');
    previewLayer.appendChild(el);
}

function handleDrawMove(pt, e) {
    const el = state.previewElement;
    if (!el) return;
    const sx = state.drawStart.x, sy = state.drawStart.y;

    if (state.tool === 'rect') {
        let w = pt.x - sx, h = pt.y - sy;
        if (e && e.ctrlKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w)*s; h = Math.sign(h)*s; }
        const x = w < 0 ? sx + w : sx, y = h < 0 ? sy + h : sy;
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', Math.abs(w)); el.setAttribute('height', Math.abs(h));
    } else if (state.tool === 'ellipse') {
        let dx = pt.x - sx, dy = pt.y - sy;
        if (e && e.ctrlKey) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx)*s; dy = Math.sign(dy)*s; }
        el.setAttribute('cx', sx + dx/2); el.setAttribute('cy', sy + dy/2);
        el.setAttribute('rx', Math.abs(dx)/2); el.setAttribute('ry', Math.abs(dy)/2);
    } else if (state.tool === 'line') {
        let ex = pt.x, ey = pt.y;
        if (e && e.shiftKey) {
            const angle = Math.atan2(ey - sy, ex - sx);
            const snapAngle = Math.round(angle / (Math.PI/4)) * (Math.PI/4);
            const dist = Math.hypot(ex - sx, ey - sy);
            ex = sx + dist * Math.cos(snapAngle);
            ey = sy + dist * Math.sin(snapAngle);
        }
        el.setAttribute('x2', ex); el.setAttribute('y2', ey);
    }
}

function handleDrawEnd() {
    state.isDrawing = false;
    const el = state.previewElement;
    if (!el) return;
    const sx = state.drawStart.x, sy = state.drawStart.y;
    let obj = null;
    if (state.tool === 'rect') {
        const x=+el.getAttribute('x'),y=+el.getAttribute('y'),w=+el.getAttribute('width'),h=+el.getAttribute('height');
        if (w > 1 && h > 1) obj = createObject('rect', {x,y,width:w,height:h});
    } else if (state.tool === 'ellipse') {
        const cx=+el.getAttribute('cx'),cy=+el.getAttribute('cy'),rx=+el.getAttribute('rx'),ry=+el.getAttribute('ry');
        if (rx > 1 && ry > 1) obj = createObject('ellipse', {cx,cy,rx,ry});
    } else if (state.tool === 'line') {
        const x2=+el.getAttribute('x2'),y2=+el.getAttribute('y2');
        if (Math.hypot(x2-sx,y2-sy) > 1) obj = createObject('line', {x1:sx,y1:sy,x2,y2});
    }
    clearPreview();
    if (obj) selectObject(obj.id);
}

// --- B-Spline ---
function handleBSplineClick(pt) { state.bsplinePoints.push({x:pt.x,y:pt.y}); updateBSplinePreview(pt); }

function handleBSplineDblClick() {
    if (state.bsplinePoints.length >= 2) state.bsplinePoints.pop();
    if (state.bsplinePoints.length >= 2) {
        const obj = createObject('bspline', {points:[...state.bsplinePoints]});
        selectObject(obj.id);
    }
    state.bsplinePoints = [];
    clearPreview();
}

function updateBSplinePreview(mousePt) {
    clearPreview();
    const ns = 'http://www.w3.org/2000/svg';
    const all = [...state.bsplinePoints, {x:mousePt.x,y:mousePt.y}];
    const sw = state.viewBox.w * 0.001, cs = state.viewBox.w * 0.005;
    if (all.length > 1) {
        const pl = document.createElementNS(ns, 'polyline');
        pl.setAttribute('points', all.map(p=>`${p.x},${p.y}`).join(' '));
        pl.setAttribute('fill','none'); pl.setAttribute('stroke','#b8aed0');
        pl.setAttribute('stroke-width',sw); pl.setAttribute('stroke-dasharray',`${sw*4} ${sw*2}`);
        pl.setAttribute('pointer-events','none'); previewLayer.appendChild(pl);
    }
    for (let i = 0; i < all.length; i++) {
        const cp = document.createElementNS(ns, 'rect');
        cp.setAttribute('x',all[i].x-cs/2); cp.setAttribute('y',all[i].y-cs/2);
        cp.setAttribute('width',cs); cp.setAttribute('height',cs);
        cp.setAttribute('fill', i < state.bsplinePoints.length ? '#7c5cf0' : '#fff');
        cp.setAttribute('stroke','#7c5cf0'); cp.setAttribute('stroke-width',sw);
        cp.setAttribute('pointer-events','none'); previewLayer.appendChild(cp);
    }
    if (all.length >= 2) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', bsplineToPath(all));
        path.setAttribute('fill','none'); path.setAttribute('stroke',state.strokeColor);
        path.setAttribute('stroke-width',state.strokeWidth); path.setAttribute('pointer-events','none');
        previewLayer.appendChild(path);
    }
}

function clearPreview() { previewLayer.innerHTML = ''; state.previewElement = null; }

// --- Text ---
function editTextObject(obj, e) {
    if (state.isTyping) return;
    state.isTyping = true;
    obj.element.style.opacity = '0';

    requestAnimationFrame(() => {
        const overlay = document.getElementById('text-input-overlay');
        const svgRect = svg.getBoundingClientRect();
        const scale = svgRect.width / state.viewBox.w;
        const b = getObjBounds(obj);
        const screenX = svgRect.left + (b.x - state.viewBox.x) * scale;
        const screenY = svgRect.top + (b.y - state.viewBox.y) * scale;
        const fontDef = FONTS.find(f => f.name === obj.fontFamily) || FONTS[0];
        const screenFontSize = obj.fontSize * scale;

        overlay.style.left = screenX + 'px';
        overlay.style.top = screenY + 'px';
        overlay.style.fontFamily = fontDef.css;
        overlay.style.fontSize = screenFontSize + 'px';
        overlay.style.lineHeight = '1.2';
        overlay.style.color = obj.fill === 'none' ? '#000' : obj.fill;
        overlay.value = obj.text;
        overlay.classList.remove('hidden');
        overlay.focus();
        overlay.select();

        let finished = false;
        const finishEdit = () => {
            if (finished) return;
            finished = true;
            const txt = overlay.value.trim();
            overlay.classList.add('hidden');
            state.isTyping = false;
            obj.element.style.opacity = '1';
            if (txt && txt !== obj.text) {
                saveUndoState();
                obj.text = txt;
                refreshElement(obj);
                drawSelection();
            } else if (!txt) {
                deleteObject(obj.id);
            }
        };

        const onKey = (ev) => {
            if (ev.key === 'Escape') { overlay.value = obj.text; finishEdit(); }
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finishEdit(); }
            overlay.style.height = 'auto';
            overlay.style.height = overlay.scrollHeight + 'px';
        };

        overlay.addEventListener('keydown', onKey);
        overlay.addEventListener('input', () => {
            overlay.style.height = 'auto';
            overlay.style.height = overlay.scrollHeight + 'px';
        });
        overlay.addEventListener('blur', () => {
            setTimeout(finishEdit, 150);
        }, { once: true });
    });
}

function handleTextClick(pt, e) {
    if (state.isTyping) return;
    state.isTyping = true;
    state._textPt = { x: pt.x, y: pt.y };

    // Delay showing the overlay so the mousedown doesn't steal focus
    requestAnimationFrame(() => {
        const overlay = document.getElementById('text-input-overlay');
        const svgRect = svg.getBoundingClientRect();
        const scale = svgRect.width / state.viewBox.w;
        const screenX = svgRect.left + (pt.x - state.viewBox.x) * scale;
        const screenY = svgRect.top + (pt.y - state.viewBox.y) * scale;
        const fontDef = FONTS.find(f => f.name === state.fontFamily) || FONTS[0];
        const screenFontSize = state.fontSize * scale;

        overlay.style.left = screenX + 'px';
        overlay.style.top = (screenY - screenFontSize) + 'px';
        overlay.style.fontFamily = fontDef.css;
        overlay.style.fontSize = screenFontSize + 'px';
        overlay.style.lineHeight = '1.2';
        overlay.style.color = state.fillColor === 'none' ? '#000' : state.fillColor;
        overlay.value = '';
        overlay.classList.remove('hidden');
        overlay.focus();

        let finished = false;
        const finishText = () => {
            if (finished) return;
            finished = true;
            const txt = overlay.value.trim();
            overlay.classList.add('hidden');
            state.isTyping = false;
            if (txt) {
                const obj = createObject('text', {
                    x: state._textPt.x,
                    y: state._textPt.y,
                    text: txt,
                    fontFamily: state.fontFamily,
                    fontSize: state.fontSize,
                    fill: state.fillColor === 'none' ? '#000000' : state.fillColor,
                    stroke: 'none',
                    strokeWidth: 0,
                });
                selectObject(obj.id);
                setTool('select');
            }
        };

        const onKey = (ev) => {
            if (ev.key === 'Escape') { overlay.value = ''; finishText(); }
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finishText(); }
            overlay.style.height = 'auto';
            overlay.style.height = overlay.scrollHeight + 'px';
        };

        overlay.addEventListener('keydown', onKey);
        overlay.addEventListener('input', () => {
            overlay.style.height = 'auto';
            overlay.style.height = overlay.scrollHeight + 'px';
        });
        overlay.addEventListener('blur', () => {
            setTimeout(finishText, 150);
        }, { once: true });
    });
}

// =============================================
// GROUP / UNGROUP
// =============================================
function groupSelected() {
    if (state.selectedIds.length < 2) return;
    saveUndoState();
    const children = [];
    const ids = [...state.selectedIds];
    // Collect objects in order
    for (const o of state.objects) {
        if (ids.includes(o.id)) children.push(o);
    }
    if (children.length < 2) return;
    // Remove children from objects array and DOM
    for (const c of children) {
        c.element.remove();
        const idx = state.objects.findIndex(o => o.id === c.id);
        if (idx !== -1) state.objects.splice(idx, 1);
    }
    const group = createObject('group', { children });
    selectObject(group.id);
}

function ungroupSelected() {
    const id = primaryId();
    if (!id) return;
    saveUndoState();
    const obj = findObject(id);
    if (!obj || obj.type !== 'group') return;
    const children = obj.children;
    // Remove group
    obj.element.remove();
    const idx = state.objects.findIndex(o => o.id === obj.id);
    if (idx !== -1) state.objects.splice(idx, 1);
    // Re-add children
    const newIds = [];
    for (const c of children) {
        const elem = buildSVGElement(c);
        c.element = elem;
        elem.dataset.objectId = c.id;
        objectsLayer.appendChild(elem);
        state.objects.push(c);
        newIds.push(c.id);
        if (c.id >= state.nextId) state.nextId = c.id + 1;
    }
    state.selectedIds = newIds;
    drawSelection();
    updatePropsPanel();
}

// =============================================
// DUPLICATE
// =============================================
function duplicateSelected() {
    if (state.selectedIds.length === 0) return;
    saveUndoState();
    const offset = 10; // px offset for the duplicate
    const newIds = [];
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;
        const clone = JSON.parse(JSON.stringify(obj, (k, v) => k === 'element' ? undefined : v));
        clone.id = state.nextId++;
        // Assign new ids to children recursively
        assignNewIds(clone);
        offsetObject(clone, offset, offset);
        const elem = buildSVGElement(clone);
        clone.element = elem;
        elem.dataset.objectId = clone.id;
        objectsLayer.appendChild(elem);
        state.objects.push(clone);
        newIds.push(clone.id);
    }
    state.selectedIds = newIds;
    drawSelection();
    updatePropsPanel();
}

function assignNewIds(obj) {
    if (obj.type === 'group' && obj.children) {
        for (const c of obj.children) { c.id = state.nextId++; assignNewIds(c); }
    }
    if (obj.type === 'powerclip') {
        if (obj.container) { obj.container.id = state.nextId++; assignNewIds(obj.container); }
        if (obj.contents) { for (const c of obj.contents) { c.id = state.nextId++; assignNewIds(c); } }
    }
}

// =============================================
// POWERCLIP
// =============================================
// A PowerClip is a special object: { type:'powerclip', container: <shape obj>, contents: [<obj>...] }
// The container defines the clip shape, contents are clipped inside it.

function makePowerClip(objId) {
    const obj = findObject(objId);
    if (!obj || obj.type === 'powerclip' || obj.type === 'line' || obj.type === 'bspline' || obj.type === 'image') return;
    saveUndoState();
    const idx = state.objects.findIndex(o => o.id === objId);
    if (idx === -1) return;
    // Remove from DOM
    obj.element.remove();
    // Create powerclip wrapper
    const pc = {
        id: state.nextId++,
        type: 'powerclip',
        container: { ...obj, element: null },
        contents: [],
        rotation: 0,
    };
    const elem = buildSVGElement(pc);
    pc.element = elem;
    elem.dataset.objectId = pc.id;
    objectsLayer.appendChild(elem);
    state.objects.splice(idx, 1, pc);
    selectObject(pc.id);
}

function addToPowerClip(contentId, powerclipId) {
    const pc = findObject(powerclipId);
    const content = findObject(contentId);
    if (!pc || !content || pc.type !== 'powerclip') return;
    saveUndoState();
    // Remove content from objects array and DOM
    content.element.remove();
    const idx = state.objects.findIndex(o => o.id === contentId);
    if (idx !== -1) state.objects.splice(idx, 1);
    state.selectedIds = state.selectedIds.filter(i => i !== contentId);
    // Add to powerclip contents
    pc.contents.push(content);
    // Rebuild powerclip element
    rebuildPowerClipElement(pc);
    selectObject(pc.id);
}

function rebuildPowerClipElement(pc) {
    const oldElem = pc.element;
    const parent = oldElem.parentNode;
    const newElem = buildSVGElement(pc);
    pc.element = newElem;
    newElem.dataset.objectId = pc.id;
    parent.replaceChild(newElem, oldElem);
}

function findPowerClipAtPoint(pt, excludeId) {
    for (let i = state.objects.length - 1; i >= 0; i--) {
        const obj = state.objects[i];
        if (obj.type === 'powerclip' && obj.id !== excludeId) {
            if (hitTest({...obj.container, type: obj.container.type}, pt)) return obj;
        }
    }
    return null;
}

// =============================================
// POWERCLIP FLOATING MENU
// =============================================
let pcEditingId = null; // ID of powerclip being edited

function updatePowerClipMenu() {
    const menu = document.getElementById('powerclip-menu');
    const pid = primaryId();
    if (!pid || state.selectedIds.length !== 1) { menu.classList.add('hidden'); return; }
    const obj = findObject(pid);
    if (!obj || obj.type !== 'powerclip') { menu.classList.add('hidden'); return; }

    // Position above the object
    const b = getObjBounds(obj);
    const rot = obj.rotation || 0;
    const cx = b.x + b.w/2, cy = b.y;
    const rp = rotatePoint(cx, cy, b.x + b.w/2, b.y + b.h/2, rot);
    const svgRect = svg.getBoundingClientRect();
    const scale = svgRect.width / state.viewBox.w;
    const screenX = svgRect.left + (rp.x - state.viewBox.x) * scale;
    const screenY = svgRect.top + (rp.y - state.viewBox.y) * scale - 40;

    menu.style.left = screenX + 'px';
    menu.style.top = Math.max(0, screenY) + 'px';
    menu.style.transform = 'translateX(-50%)';
    menu.classList.remove('hidden');

    // Toggle editing state
    const editBtn = menu.querySelector('[data-pc="edit"]');
    const extractBtn = menu.querySelector('[data-pc="extract"]');
    if (pcEditingId === pid) {
        menu.classList.add('editing');
        editBtn.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 13l4 4L17 5"/></svg> Listo';
    } else {
        menu.classList.remove('editing');
        editBtn.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4l5 5-9 9H2v-5z"/></svg> Editar';
    }
    extractBtn.style.display = obj.contents.length > 0 ? '' : 'none';
}

function extractFromPowerClip(pcId) {
    const pc = findObject(pcId);
    if (!pc || pc.type !== 'powerclip' || pc.contents.length === 0) return;
    saveUndoState();
    const extracted = [...pc.contents];
    pc.contents = [];
    rebuildPowerClipElement(pc);
    const newIds = [];
    for (const c of extracted) {
        const elem = buildSVGElement(c);
        c.element = elem;
        elem.dataset.objectId = c.id;
        objectsLayer.appendChild(elem);
        state.objects.push(c);
        newIds.push(c.id);
        if (c.id >= state.nextId) state.nextId = c.id + 1;
    }
    state.selectedIds = newIds;
    pcEditingId = null;
    drawSelection();
    updatePropsPanel();
}

function togglePowerClipEdit(pcId) {
    if (pcEditingId === pcId) {
        // Finish editing
        pcEditingId = null;
        selectObject(pcId);
    } else {
        // Start editing - select the contents instead
        const pc = findObject(pcId);
        if (!pc || pc.type !== 'powerclip') return;
        pcEditingId = pcId;
        if (pc.contents.length > 0) {
            // Make contents selectable temporarily - we'll select the first content
            // For edit mode we need to allow modifying content positions
            selectObject(pcId); // keep the PC selected to show menu
        }
        updatePowerClipMenu();
    }
}

function setupPowerClipMenu() {
    const menu = document.getElementById('powerclip-menu');
    menu.querySelector('[data-pc="edit"]').addEventListener('click', () => {
        const pid = primaryId();
        if (pid) togglePowerClipEdit(pid);
    });
    menu.querySelector('[data-pc="extract"]').addEventListener('click', () => {
        const pid = primaryId();
        if (pid) extractFromPowerClip(pid);
    });
}

// =============================================
// CONTEXT MENU
// =============================================
let contextMenu;
let contextTarget = null;

function showContextMenu(e, obj) {
    contextMenu = document.getElementById('context-menu');
    contextTarget = obj;
    const makeOpt = contextMenu.querySelector('[data-ctx="make-powerclip"]');
    const addOpt = contextMenu.querySelector('[data-ctx="add-to-powerclip"]');

    // Show/hide options based on context
    if (obj.type === 'powerclip') {
        makeOpt.classList.add('disabled');
        makeOpt.textContent = '✓ Es PowerClip';
    } else if (obj.type === 'line' || obj.type === 'bspline' || obj.type === 'image') {
        makeOpt.classList.add('disabled');
        makeOpt.innerHTML = contextMenu.querySelector('[data-ctx="make-powerclip"]').innerHTML;
    } else {
        makeOpt.classList.remove('disabled');
        makeOpt.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="16" height="16" rx="2"/><rect x="5" y="5" width="10" height="10" rx="1" stroke-dasharray="2 1"/></svg> Crear PowerClip';
    }

    // Check if there are any powerclips to add into
    const powerclips = state.objects.filter(o => o.type === 'powerclip' && o.id !== obj.id);
    if (powerclips.length > 0 && obj.type !== 'powerclip') {
        addOpt.classList.remove('disabled');
    } else {
        addOpt.classList.add('disabled');
    }

    // Convert to curves — only for text objects
    const curvesOpt = contextMenu.querySelector('[data-ctx="convert-to-curves"]');
    if (obj.type === 'text') {
        curvesOpt.classList.remove('disabled');
        curvesOpt.style.display = '';
    } else {
        curvesOpt.style.display = 'none';
    }

    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.remove('hidden');

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeContextMenu, { once: true });
    }, 10);
}

function closeContextMenu() {
    const cm = document.getElementById('context-menu');
    cm.classList.add('hidden');
    contextTarget = null;
}

function setupContextMenu() {
    document.querySelectorAll('.ctx-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (opt.classList.contains('disabled')) return;
            const action = opt.dataset.ctx;
            if (!contextTarget) return;
            switch (action) {
                case 'make-powerclip':
                    makePowerClip(contextTarget.id);
                    break;
                case 'add-to-powerclip': {
                    // Find powerclips and pick nearest one or first
                    const pcs = state.objects.filter(o => o.type === 'powerclip' && o.id !== contextTarget.id);
                    if (pcs.length === 1) {
                        addToPowerClip(contextTarget.id, pcs[0].id);
                    } else if (pcs.length > 1) {
                        // Find the powerclip under/nearest the content
                        const b = getObjBounds(contextTarget);
                        const center = { x: b.x + b.w/2, y: b.y + b.h/2 };
                        const under = findPowerClipAtPoint(center, contextTarget.id);
                        if (under) {
                            addToPowerClip(contextTarget.id, under.id);
                        } else {
                            addToPowerClip(contextTarget.id, pcs[0].id);
                        }
                    }
                    break;
                }
                case 'convert-to-curves':
                    convertTextToCurves(contextTarget.id);
                    break;
                case 'delete':
                    for (const id of [...state.selectedIds]) deleteObject(id);
                    updatePropsPanel();
                    break;
            }
            closeContextMenu();
        });
    });
}

// =============================================
// COLOR PALETTE
// =============================================
function buildColorPalette() {
    const container = document.getElementById('palette-colors');
    for (const color of PALETTE_COLORS) {
        const sw = document.createElement('div');
        sw.className = 'palette-color'; sw.style.background = color;
        sw.dataset.color = color; sw.title = `Izq: relleno | Der: línea — ${color}`;
        container.appendChild(sw);
    }
    const palette = document.getElementById('color-palette');
    palette.addEventListener('mousedown', (e) => {
        const swatch = e.target.closest('.palette-color');
        if (!swatch) return;
        e.preventDefault();
        const color = swatch.dataset.color;
        const noFillBg = 'linear-gradient(135deg,#f5f3ff 40%,#d4b4c8 40%,#d4b4c8 60%,#f5f3ff 60%)';
        if (e.button === 0) {
            state.fillColor = color;
            document.querySelector('#fill-swatch .swatch-inner').style.background = color === 'none' ? noFillBg : color;
            for (const id of state.selectedIds) {
                const obj = findObject(id);
                if (obj && obj.type !== 'line' && obj.type !== 'bspline') { obj.fill = color; refreshElement(obj); }
            }
        } else if (e.button === 2) {
            state.strokeColor = color;
            document.querySelector('#stroke-swatch .swatch-inner').style.background = color === 'none' ? noFillBg : color;
            for (const id of state.selectedIds) {
                const obj = findObject(id);
                if (obj) { obj.stroke = color; refreshElement(obj); }
            }
            drawSelection();
        }
    });
    palette.addEventListener('contextmenu', (e) => e.preventDefault());
}

// =============================================
// MENUS
// =============================================
let openMenu = null;
function setupMenus() {
    document.querySelectorAll('.menu-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById(`menu-${trigger.dataset.menu}`);
            if (openMenu === dropdown) { dropdown.classList.remove('open'); openMenu = null; }
            else { if (openMenu) openMenu.classList.remove('open'); dropdown.classList.add('open'); openMenu = dropdown; }
        });
    });
    document.addEventListener('click', () => { if (openMenu) { openMenu.classList.remove('open'); openMenu = null; } });
    document.querySelectorAll('.menu-option').forEach(opt => {
        opt.addEventListener('click', () => {
            handleMenuAction(opt.dataset.action);
            if (openMenu) { openMenu.classList.remove('open'); openMenu = null; }
        });
    });
}

function handleMenuAction(action) {
    switch (action) {
        case 'export-svg':  exportSVG(); break;
        case 'clear-all':   clearAll(); break;
        case 'page-size':   showPageSizeModal(); break;
        case 'fit-page':    resetView(); break;
        case 'group':       groupSelected(); break;
        case 'ungroup':     ungroupSelected(); break;
        case 'import-names': showImportNamesModal(); break;
    }
}

// =============================================
// SVG EXPORT
// =============================================
async function exportSVG() {
    // Ensure all fonts used by text objects are loaded for text-to-curves
    const usedFonts = new Set(state.objects.filter(o => o.type === 'text').map(o => o.fontFamily));
    for (const fn of usedFonts) {
        if (!loadedOTFonts[fn]) await loadOTFont(fn);
    }
    const ns = 'http://www.w3.org/2000/svg';
    const xlink = 'http://www.w3.org/1999/xlink';
    const root = document.createElementNS(ns, 'svg');
    root.setAttribute('xmlns', ns);
    root.setAttribute('xmlns:xlink', xlink);
    root.setAttribute('width', state.pageWidth); root.setAttribute('height', state.pageHeight);
    root.setAttribute('viewBox', `0 0 ${state.pageWidth} ${state.pageHeight}`);
    function exportObj(obj, parent) {
        if (obj.type === 'text') {
            // Convert text to curves (path) using opentype.js
            const pathData = textToPath(obj);
            if (pathData) {
                const p = document.createElementNS(ns, 'path');
                p.setAttribute('d', pathData);
                p.setAttribute('fill', obj.fill);
                p.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
                p.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth);
                if (obj.rotation) {
                    const b = getObjBounds(obj);
                    const cx = b.x + b.w/2, cy = b.y + b.h/2;
                    p.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
                }
                parent.appendChild(p);
            } else {
                // Fallback: render text to canvas bitmap and embed as image
                const fallback = textToFallbackSVG(obj, ns);
                parent.appendChild(fallback);
            }
            return;
        }
        if (obj.type === 'image') {
            const img = document.createElementNS(ns, 'image');
            img.setAttribute('x', obj.x); img.setAttribute('y', obj.y);
            img.setAttribute('width', obj.width); img.setAttribute('height', obj.height);
            img.setAttribute('preserveAspectRatio', 'none');
            img.setAttributeNS(xlink, 'xlink:href', obj.href);
            img.setAttribute('href', obj.href);
            if (obj.rotation) {
                const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
                img.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
            }
            parent.appendChild(img);
        } else if (obj.type === 'powerclip') {
            // Export powerclip as group with clipPath
            const g = document.createElementNS(ns, 'g');
            const clipId = 'export-clip-' + obj.id;
            const defs = document.createElementNS(ns, 'defs');
            const cp = document.createElementNS(ns, 'clipPath');
            cp.setAttribute('id', clipId);
            cp.appendChild(buildClipShape(obj.container, ns));
            defs.appendChild(cp);
            g.appendChild(defs);
            // Container shape (visible)
            exportObj(obj.container, g);
            // Clipped contents
            const cg = document.createElementNS(ns, 'g');
            cg.setAttribute('clip-path', `url(#${clipId})`);
            for (const c of obj.contents) exportObj(c, cg);
            g.appendChild(cg);
            parent.appendChild(g);
        } else {
            const clone = obj.element.cloneNode(true);
            clone.removeAttribute('data-object-id'); clone.removeAttribute('style');
            parent.appendChild(clone);
        }
    }
    for (const obj of state.objects) exportObj(obj, root);
    let str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
    // Fix namespace: some serializers output "ns0:href" instead of "xlink:href"
    str = str.replace(/ns\d+:href/g, 'xlink:href');
    const blob = new Blob([str], {type:'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dibujo.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =============================================
// CLEAR ALL
// =============================================
function clearAll() {
    if (!state.objects.length) return;
    if (!confirm('¿Eliminar todos los objetos?')) return;
    objectsLayer.innerHTML = ''; state.objects = []; state.selectedIds = [];
    selectionLayer.innerHTML = ''; clearPreview(); state.bsplinePoints = [];
    updatePropsPanel();
}

// =============================================
// PAGE SIZE MODAL
// =============================================
function showPageSizeModal() {
    const unitSel = document.getElementById('page-unit-select');
    unitSel.value = state.unit;
    updatePageModalUnit();
    document.getElementById('page-preset').value = 'custom';
    document.getElementById('page-size-modal').classList.remove('hidden');
}
function hidePageSizeModal() { document.getElementById('page-size-modal').classList.add('hidden'); }
function updatePageModalUnit() {
    const u = document.getElementById('page-unit-select').value;
    const factor = UNITS[u].factor, dec = UNITS[u].dec;
    document.getElementById('page-width-label').textContent = `Ancho (${u})`;
    document.getElementById('page-height-label').textContent = `Alto (${u})`;
    document.getElementById('page-width-input').value = +(state.pageWidth * factor).toFixed(dec);
    document.getElementById('page-height-input').value = +(state.pageHeight * factor).toFixed(dec);
}
function setupPageSizeModal() {
    document.getElementById('page-unit-select').addEventListener('change', () => updatePageModalUnit());
    document.getElementById('page-preset').addEventListener('change', (e) => {
        const p = PAGE_PRESETS[e.target.value];
        if (p) {
            // Temporarily store in px, then display in current modal unit
            state._tempPageW = p.w; state._tempPageH = p.h;
            const u = document.getElementById('page-unit-select').value;
            const factor = UNITS[u].factor, dec = UNITS[u].dec;
            document.getElementById('page-width-input').value = +(p.w * factor).toFixed(dec);
            document.getElementById('page-height-input').value = +(p.h * factor).toFixed(dec);
        }
    });
    const modal = document.getElementById('page-size-modal');
    modal.querySelector('[data-action="cancel"]').addEventListener('click', hidePageSizeModal);
    modal.querySelector('[data-action="apply"]').addEventListener('click', () => {
        const u = document.getElementById('page-unit-select').value;
        const factor = UNITS[u].factor;
        const wVal = parseFloat(document.getElementById('page-width-input').value);
        const hVal = parseFloat(document.getElementById('page-height-input').value);
        const w = Math.round(wVal / factor);
        const h = Math.round(hVal / factor);
        if (w > 0 && h > 0) { state.pageWidth = w; state.pageHeight = h; updatePage(); resetView(); }
        hidePageSizeModal();
    });
    modal.querySelector('.modal-overlay').addEventListener('click', hidePageSizeModal);
}

// =============================================
// IMPORT NAMES
// =============================================
function showImportNamesModal() {
    document.getElementById('names-input').value = '';
    document.getElementById('import-names-modal').classList.remove('hidden');
}
function hideImportNamesModal() {
    document.getElementById('import-names-modal').classList.add('hidden');
}
function setupImportNamesModal() {
    const modal = document.getElementById('import-names-modal');
    modal.querySelector('[data-action="cancel"]').addEventListener('click', hideImportNamesModal);
    modal.querySelector('.modal-overlay').addEventListener('click', hideImportNamesModal);
    modal.querySelector('.modal-close').addEventListener('click', hideImportNamesModal);
    modal.querySelector('[data-action="import"]').addEventListener('click', () => {
        const raw = document.getElementById('names-input').value;
        const names = raw.split('\n').map(n => n.trim()).filter(n => n.length > 0);
        if (names.length === 0) return;
        hideImportNamesModal();
        generateNamesFromTemplate(names);
    });
}

async function generateNamesFromTemplate(names) {
    // Find the first rect in the design as template
    const templateRect = state.objects.find(o => o.type === 'rect');
    if (!templateRect) {
        alert('Necesitas tener un rectángulo en el diseño como plantilla.');
        return;
    }
    saveUndoState();

    const padding = 0;
    const fontName = 'Rows of Sunflowers';
    const fontDef = FONTS.find(f => f.name === fontName) || FONTS[0];

    // Ensure the font is loaded for precise measurement
    if (!loadedOTFonts[fontName]) await loadOTFont(fontName);

    // Collect all current objects as template (serialize them)
    const templateObjects = state.objects.map(serializeObj);

    // Clear everything
    objectsLayer.innerHTML = '';
    state.objects = [];
    state.selectedIds = [];
    selectionLayer.innerHTML = '';

    // Use the rect bounds as cell size with a small gap
    const gap = 4;
    const cellW = templateRect.width + gap;
    const cellH = templateRect.height + gap;
    // Layout: start from rect's position, fill in a grid
    const startX = templateRect.x;
    const startY = templateRect.y;
    const cols = Math.max(1, Math.floor(Math.sqrt(names.length)));
    const rows = Math.ceil(names.length / cols);

    // Resize page to fit all copies
    const neededW = startX + cols * cellW + gap;
    const neededH = startY + rows * cellH + gap;
    state.pageWidth = Math.max(state.pageWidth, neededW);
    state.pageHeight = Math.max(state.pageHeight, neededH);
    updatePage();

    for (let i = 0; i < names.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const offsetX = col * cellW;
        const offsetY = row * cellH;

        // Duplicate all template objects with offset
        for (const tpl of templateObjects) {
            const clone = JSON.parse(JSON.stringify(tpl));
            clone.id = state.nextId++;
            offsetObject(clone, offsetX, offsetY);
            const elem = buildSVGElement(clone);
            clone.element = elem;
            elem.dataset.objectId = clone.id;
            objectsLayer.appendChild(elem);
            state.objects.push(clone);
        }

        // Find the duplicated rect (the one at the offset position)
        const rectX = templateRect.x + offsetX;
        const rectY = templateRect.y + offsetY;
        const rectW = templateRect.width;
        const rectH = templateRect.height;

        // Create text, measure with opentype.js for tight bounding box
        const name = names[i];
        const ns = 'http://www.w3.org/2000/svg';
        const otFont = loadedOTFonts[fontName];

        let relW, relH, relX, relY;
        const refSize = 100;

        if (otFont) {
            // Use opentype.js for tight glyph bounding box (no ascender/descender padding)
            const path = otFont.getPath(name, 0, 0, refSize);
            const bb = path.getBoundingBox();
            relW = bb.x2 - bb.x1;
            relH = bb.y2 - bb.y1;
            relX = bb.x1; // offset from anchor x to bbox left
            relY = bb.y1; // offset from anchor y (baseline) to bbox top
        } else {
            // Fallback: SVG measurement
            const tmpText = document.createElementNS(ns, 'text');
            tmpText.setAttribute('font-family', fontDef.css);
            tmpText.setAttribute('font-size', refSize);
            tmpText.setAttribute('x', 0); tmpText.setAttribute('y', 0);
            tmpText.textContent = name;
            objectsLayer.appendChild(tmpText);
            const refBBox = tmpText.getBBox();
            objectsLayer.removeChild(tmpText);
            relW = refBBox.width;
            relH = refBBox.height;
            relX = refBBox.x;
            relY = refBBox.y;
        }

        if (relW < 0.1 || relH < 0.1) continue;

        // Scale to fill the rect
        const availW = rectW - padding * 2;
        const availH = rectH - padding * 2;
        const scale = Math.min(availW / relW, availH / relH);
        const finalFontSize = refSize * scale;

        // At final size, the bbox and offsets scale linearly
        const fW = relW * scale;
        const fH = relH * scale;
        const fOffX = relX * scale;
        const fOffY = relY * scale;

        // Center the tight glyph bbox in the rect
        const textX = rectX + (rectW - fW) / 2 - fOffX;
        const textY = rectY + (rectH - fH) / 2 - fOffY;

        const textObj = {
            id: state.nextId++,
            type: 'text',
            x: textX, y: textY,
            text: name,
            fontFamily: fontName,
            fontSize: finalFontSize,
            fill: '#000000',
            stroke: 'none',
            strokeWidth: 0,
            rotation: 0,
        };

        const elem = buildSVGElement(textObj);
        textObj.element = elem;
        elem.dataset.objectId = textObj.id;
        objectsLayer.appendChild(elem);
        state.objects.push(textObj);
    }

    resetView();
    updatePropsPanel();
}

function offsetObject(obj, dx, dy) {
    switch (obj.type) {
        case 'rect': case 'image': case 'text': case 'curvepath':
            obj.x += dx; obj.y += dy; break;
        case 'ellipse':
            obj.cx += dx; obj.cy += dy; break;
        case 'line':
            obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy; break;
        case 'bspline':
            obj.points = obj.points.map(p => ({ x: p.x + dx, y: p.y + dy })); break;
        case 'group':
            for (const c of obj.children) offsetObject(c, dx, dy); break;
        case 'powerclip':
            offsetObject(obj.container, dx, dy);
            for (const c of obj.contents) offsetObject(c, dx, dy); break;
    }
    if (obj._origBounds) {
        obj._origBounds.x += dx;
        obj._origBounds.y += dy;
    }
}

// =============================================
// ZOOM
// =============================================
function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1/1.1;
    const pt = screenToSVG(e.clientX, e.clientY);
    const newW = state.viewBox.w * factor, newH = state.viewBox.h * factor;
    if (newW < 10 || newW > 50000) return;
    state.viewBox.x = pt.x - (pt.x - state.viewBox.x) * factor;
    state.viewBox.y = pt.y - (pt.y - state.viewBox.y) * factor;
    state.viewBox.w = newW; state.viewBox.h = newH;
    updateViewBox();
    if (state.selectedIds.length) { drawSelection(); updatePowerClipMenu(); }
}

// =============================================
// UNITS & PROPERTIES PANEL
// =============================================
function toUnit(px) { return +(px * UNITS[state.unit].factor).toFixed(UNITS[state.unit].dec); }
function fromUnit(val) { return val / UNITS[state.unit].factor; }

// Get the axis-aligned bounding box after rotation
function getRotatedBounds(obj) {
    const b = getObjBounds(obj);
    const rot = obj.rotation || 0;
    if (!rot) return b;
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const corners = [
        rotatePoint(b.x, b.y, cx, cy, rot),
        rotatePoint(b.x + b.w, b.y, cx, cy, rot),
        rotatePoint(b.x, b.y + b.h, cx, cy, rot),
        rotatePoint(b.x + b.w, b.y + b.h, cx, cy, rot),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of corners) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function updatePropsPanel() {
    const panel = document.getElementById('props-panel');
    const pid = primaryId();
    if (!pid) { panel.classList.add('hidden'); return; }
    const obj = findObject(pid);
    if (!obj) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const rb = getRotatedBounds(obj);
    document.getElementById('prop-x').value = toUnit(rb.x);
    document.getElementById('prop-y').value = toUnit(rb.y);
    document.getElementById('prop-w').value = toUnit(rb.w);
    document.getElementById('prop-h').value = toUnit(rb.h);
    document.getElementById('prop-rotation').value = Math.round(obj.rotation || 0);
    document.getElementById('props-unit-label').textContent = state.unit;
}

function applyPropPosition(obj, newXu, newYu) {
    const newX = fromUnit(newXu), newY = fromUnit(newYu);
    const b = getObjBounds(obj);
    const dx = newX - b.x, dy = newY - b.y;
    switch (obj.type) {
        case 'rect': case 'image': case 'text': case 'curvepath': obj.x+=dx;obj.y+=dy; break;
        case 'ellipse': obj.cx+=dx;obj.cy+=dy; break;
        case 'line':    obj.x1+=dx;obj.y1+=dy;obj.x2+=dx;obj.y2+=dy; break;
        case 'bspline': obj.points=obj.points.map(p=>({x:p.x+dx,y:p.y+dy})); break;
        case 'group':   for(const c of obj.children) { const cb=getObjBounds(c); applyPropPosition(c,toUnit(cb.x+dx),toUnit(cb.y+dy)); } break;
        case 'powerclip':
            applyPropPosition(obj.container, newXu, newYu);
            for(const c of obj.contents) { const cb=getObjBounds(c); applyPropPosition(c,toUnit(cb.x+dx),toUnit(cb.y+dy)); }
            break;
    }
}

function applyPropSize(obj, newWpx, newHpx) {
    const b = getObjBounds(obj);
    if (b.w < 0.01 || b.h < 0.01) return;
    const sx = newWpx / b.w, sy = newHpx / b.h;
    switch (obj.type) {
        case 'rect': case 'image': case 'curvepath': obj.width=newWpx; obj.height=newHpx; break;
        case 'text': {
            // Scale font size proportionally to height change
            obj.fontSize = Math.max(6, obj.fontSize * sy);
            break;
        }
        case 'ellipse': obj.rx=newWpx/2; obj.ry=newHpx/2; break;
        case 'line': {
            const ox=Math.min(obj.x1,obj.x2), oy=Math.min(obj.y1,obj.y2);
            obj.x1=ox+(obj.x1-ox)*sx; obj.y1=oy+(obj.y1-oy)*sy;
            obj.x2=ox+(obj.x2-ox)*sx; obj.y2=oy+(obj.y2-oy)*sy; break;
        }
        case 'bspline': {
            const ox=b.x,oy=b.y;
            obj.points=obj.points.map(p=>({x:ox+(p.x-ox)*sx,y:oy+(p.y-oy)*sy})); break;
        }
        case 'group': {
            const ox=b.x,oy=b.y;
            for (const c of obj.children) {
                const cb=getObjBounds(c);
                const nx=ox+(cb.x-ox)*sx, ny=oy+(cb.y-oy)*sy;
                applyPropSize(c, cb.w*sx, cb.h*sy);
                applyPropPosition(c, toUnit(nx), toUnit(ny));
            }
            break;
        }
        case 'powerclip': {
            const ox=b.x,oy=b.y;
            applyPropSize(obj.container, newWpx, newHpx);
            for (const c of obj.contents) {
                const cb=getObjBounds(c);
                const nx=ox+(cb.x-ox)*sx, ny=oy+(cb.y-oy)*sy;
                applyPropSize(c, cb.w*sx, cb.h*sy);
                applyPropPosition(c, toUnit(nx), toUnit(ny));
            }
            break;
        }
    }
}

function setupPropsPanel() {
    const propX = document.getElementById('prop-x'), propY = document.getElementById('prop-y');
    const propW = document.getElementById('prop-w'), propH = document.getElementById('prop-h');
    const propRot = document.getElementById('prop-rotation');
    const lockBtn = document.getElementById('lock-aspect');

    lockBtn.addEventListener('click', () => { state.lockAspect = !state.lockAspect; lockBtn.classList.toggle('active', state.lockAspect); });

    const applyPos = () => {
        const obj = findObject(primaryId()); if (!obj) return;
        saveUndoState();
        applyPropPosition(obj, parseFloat(propX.value), parseFloat(propY.value));
        refreshElement(obj); selectObject(obj.id);
    };
    propX.addEventListener('change', applyPos);
    propY.addEventListener('change', applyPos);

    propW.addEventListener('change', () => {
        const obj = findObject(primaryId()); if (!obj) return;
        saveUndoState();
        const b = getObjBounds(obj);
        let newW = fromUnit(parseFloat(propW.value)), newH = b.h;
        if (newW < 0.1) newW = 0.1;
        if (state.lockAspect && b.w > 0.01) newH = newW * (b.h / b.w);
        applyPropSize(obj, newW, newH); refreshElement(obj); selectObject(obj.id);
    });

    propH.addEventListener('change', () => {
        const obj = findObject(primaryId()); if (!obj) return;
        saveUndoState();
        const b = getObjBounds(obj);
        let newH = fromUnit(parseFloat(propH.value)), newW = b.w;
        if (newH < 0.1) newH = 0.1;
        if (state.lockAspect && b.h > 0.01) newW = newH * (b.w / b.h);
        applyPropSize(obj, newW, newH); refreshElement(obj); selectObject(obj.id);
    });

    propRot.addEventListener('change', () => {
        saveUndoState();
        const obj = findObject(primaryId()); if (!obj) return;
        obj.rotation = parseFloat(propRot.value) || 0;
        refreshElement(obj); drawSelection();
    });

    document.getElementById('unit-select').addEventListener('change', (e) => {
        state.unit = e.target.value; updatePropsPanel(); updatePage();
    });
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
    svg.addEventListener('mousedown', handleMouseDown);
    svg.addEventListener('mousemove', handleMouseMove);
    svg.addEventListener('mouseup', handleMouseUp);
    svg.addEventListener('wheel', handleWheel, {passive:false});
    svg.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const pt = screenToSVG(e.clientX, e.clientY);
        const obj = objectAtPoint(pt);
        if (obj) {
            selectObject(obj.id);
            showContextMenu(e, obj);
        } else {
            closeContextMenu();
        }
    });
    svg.addEventListener('dblclick', (e) => {
        if (state.tool === 'bspline') { handleBSplineDblClick(); return; }
        // Double-click on text to edit
        const pt = screenToSVG(e.clientX, e.clientY);
        const obj = objectAtPoint(pt);
        if (obj && obj.type === 'text') {
            editTextObject(obj, e);
        }
    });

    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    document.getElementById('stroke-width').addEventListener('change', (e) => {
        state.strokeWidth = parseFloat(e.target.value) || 1;
        for (const id of state.selectedIds) {
            const obj = findObject(id); if (obj) { obj.strokeWidth = state.strokeWidth; refreshElement(obj); }
        }
    });

    document.getElementById('font-select').addEventListener('change', (e) => {
        state.fontFamily = e.target.value;
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (obj && obj.type === 'text') { saveUndoState(); obj.fontFamily = state.fontFamily; refreshElement(obj); drawSelection(); }
        }
    });

    document.getElementById('font-size').addEventListener('change', (e) => {
        state.fontSize = parseFloat(e.target.value) || 32;
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (obj && obj.type === 'text') { saveUndoState(); obj.fontSize = state.fontSize; refreshElement(obj); drawSelection(); }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        // Undo/Redo
        if (e.key.toLowerCase() === 'z' && e.ctrlKey && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.key.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); redo(); return; }
        if (e.key.toLowerCase() === 'z' && e.ctrlKey && e.shiftKey) { e.preventDefault(); redo(); return; }
        // Group/Ungroup shortcuts
        if (e.key.toLowerCase() === 'u' && e.ctrlKey) { e.preventDefault(); ungroupSelected(); return; }
        if (e.key.toLowerCase() === 'g' && e.ctrlKey) { e.preventDefault(); groupSelected(); return; }
        if (e.key.toLowerCase() === 'd' && e.ctrlKey) { e.preventDefault(); duplicateSelected(); return; }
        switch (e.key.toLowerCase()) {
            case 'v': setTool('select'); break;
            case 'r': setTool('rect'); break;
            case 'e': setTool('ellipse'); break;
            case 'l': setTool('line'); break;
            case 'b': setTool('bspline'); break;
            case 't': setTool('text'); break;
            case 'delete': case 'backspace':
                for (const id of [...state.selectedIds]) deleteObject(id);
                updatePropsPanel(); break;
            case 'escape':
                if (state.tool === 'bspline' && state.bsplinePoints.length > 0) { state.bsplinePoints=[]; clearPreview(); }
                else if (state.tool !== 'select') setTool('select');
                else selectObject(null);
                break;
            case ' ':
                e.preventDefault(); state.spaceHeld = true; svg.style.cursor = 'grab'; break;
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === ' ') { state.spaceHeld = false; svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; }
    });

    // Paste images from clipboard
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target.result;
                    const img = new Image();
                    img.onload = () => {
                        // Place image centered on the visible area
                        const vb = state.viewBox;
                        const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
                        let w = img.naturalWidth, h = img.naturalHeight;
                        // Scale down if larger than half the page
                        const maxW = state.pageWidth * 0.8, maxH = state.pageHeight * 0.8;
                        if (w > maxW || h > maxH) {
                            const scale = Math.min(maxW / w, maxH / h);
                            w *= scale; h *= scale;
                        }
                        const obj = createObject('image', {
                            x: cx - w/2, y: cy - h/2,
                            width: w, height: h,
                            href: dataUrl,
                        });
                        selectObject(obj.id);
                        setTool('select');
                    };
                    img.src = dataUrl;
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    });

    window.addEventListener('resize', () => resetView());
    setupMenus();
    setupPageSizeModal();
    setupPropsPanel();
    setupContextMenu();
    setupPowerClipMenu();
    setupImportNamesModal();
}

function setTool(tool) {
    if (state.tool === 'bspline' && tool !== 'bspline') {
        if (state.bsplinePoints.length >= 2) { const obj = createObject('bspline',{points:[...state.bsplinePoints]}); selectObject(obj.id); }
        state.bsplinePoints=[]; clearPreview();
    }
    state.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    document.getElementById('status-tool').textContent = TOOL_NAMES[tool];
    svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

function updateStatusBar() {
    document.getElementById('status-tool').textContent = TOOL_NAMES[state.tool];
    document.getElementById('status-page').textContent = `${toUnit(state.pageWidth)} × ${toUnit(state.pageHeight)} ${state.unit}`;
}

// =============================================
// FONT LOADING (opentype.js) for text-to-curves
// =============================================
async function loadOTFont(fontName) {
    if (loadedOTFonts[fontName]) return loadedOTFonts[fontName];
    const fontDef = FONTS.find(f => f.name === fontName);
    if (!fontDef || !fontDef.url) return null;
    try {
        const resp = await fetch(fontDef.url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        // Try normal parse first
        try {
            const font = opentype.parse(buf);
            loadedOTFonts[fontName] = font;
            return font;
        } catch(e1) {
            // If GPOS/GSUB ClassDef error, strip those tables and retry
            if (e1.message && e1.message.includes('ClassDef')) {
                const stripped = stripProblematicTables(buf);
                const font = opentype.parse(stripped);
                loadedOTFonts[fontName] = font;
                return font;
            }
            throw e1;
        }
    } catch(e) {
        console.warn('Could not load font:', fontName, e);
        return null;
    }
}

// Zero out GPOS and GSUB table offsets in a TTF/OTF buffer to skip problematic tables
function stripProblematicTables(buf) {
    const copy = buf.slice(0);
    const view = new DataView(copy);
    const numTables = view.getUint16(4);
    const strip = ['GPOS', 'GSUB', 'GDEF', 'BASE', 'JSTF'];
    for (let i = 0; i < numTables; i++) {
        const off = 12 + i * 16;
        const tag = String.fromCharCode(
            view.getUint8(off), view.getUint8(off+1),
            view.getUint8(off+2), view.getUint8(off+3)
        );
        if (strip.includes(tag)) {
            // Rename the tag to something opentype.js will ignore (e.g. "XXXX")
            view.setUint8(off, 0x58);     // X
            view.setUint8(off + 1, 0x58); // X
            view.setUint8(off + 2, 0x58); // X
            view.setUint8(off + 3, 0x58); // X
        }
    }
    return copy;
}

function textToPath(obj) {
    const font = loadedOTFonts[obj.fontFamily];
    if (font) {
        const path = font.getPath(obj.text, obj.x, obj.y, obj.fontSize);
        return path.toPathData(2);
    }
    return null;
}

async function convertTextToCurves(id) {
    const obj = findObject(id);
    if (!obj || obj.type !== 'text') return;
    // Ensure font is loaded
    if (!loadedOTFonts[obj.fontFamily]) await loadOTFont(obj.fontFamily);
    const pathData = textToPath(obj);
    if (!pathData) { alert('No se pudo cargar la fuente para convertir a curvas.'); return; }
    saveUndoState();
    const b = getObjBounds(obj);
    const idx = state.objects.findIndex(o => o.id === id);
    // Remove old text
    obj.element.remove();
    // Create bspline-like path object (using a generic 'path' wouldn't fit our model,
    // so we create it as a rect-like object with a custom SVG path element)
    // Create a temp SVG path to measure the actual path bounds
    const ns = 'http://www.w3.org/2000/svg';
    const tempPath = document.createElementNS(ns, 'path');
    tempPath.setAttribute('d', pathData);
    objectsLayer.appendChild(tempPath);
    const pathBBox = tempPath.getBBox();
    objectsLayer.removeChild(tempPath);
    const origBounds = { x: pathBBox.x, y: pathBBox.y, w: pathBBox.width || 1, h: pathBBox.height || 1 };

    const newObj = {
        id: state.nextId++,
        type: 'curvepath',
        d: pathData,
        x: origBounds.x, y: origBounds.y, width: origBounds.w, height: origBounds.h,
        _origBounds: { ...origBounds },
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        rotation: obj.rotation || 0,
    };
    const elem = document.createElementNS(ns, 'path');
    elem.setAttribute('d', pathData);
    elem.setAttribute('fill', newObj.fill);
    elem.setAttribute('stroke', newObj.stroke === 'none' ? 'none' : newObj.stroke);
    elem.setAttribute('stroke-width', newObj.stroke === 'none' ? 0 : newObj.strokeWidth);
    elem.style.cursor = 'pointer';
    elem.dataset.objectId = newObj.id;
    newObj.element = elem;
    objectsLayer.appendChild(elem);
    if (idx !== -1) state.objects.splice(idx, 1, newObj);
    else state.objects.push(newObj);
    selectObject(newObj.id);
}

// Canvas-based fallback: render text to canvas, trace, return as image data URL in SVG
function textToFallbackSVG(obj, ns) {
    // Create a canvas to measure and render the text
    const canvas = document.createElement('canvas');
    const fontDef = FONTS.find(f => f.name === obj.fontFamily) || FONTS[0];
    const fontSize = obj.fontSize;
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px ${fontDef.css}`;
    const metrics = ctx.measureText(obj.text);
    const w = Math.ceil(metrics.width) + 4;
    const h = Math.ceil(fontSize * 1.4) + 4;
    canvas.width = w; canvas.height = h;
    ctx.font = `${fontSize}px ${fontDef.css}`;
    ctx.fillStyle = obj.fill || '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(obj.text, 2, fontSize + 2);
    if (obj.stroke && obj.stroke !== 'none') {
        ctx.strokeStyle = obj.stroke;
        ctx.lineWidth = obj.strokeWidth || 1;
        ctx.strokeText(obj.text, 2, fontSize + 2);
    }
    // Convert to data URL and create an SVG image element
    const dataUrl = canvas.toDataURL('image/png');
    const img = document.createElementNS(ns, 'image');
    const bx = obj.x - 2;
    const by = obj.y - fontSize - 2;
    img.setAttribute('x', bx); img.setAttribute('y', by);
    img.setAttribute('width', w); img.setAttribute('height', h);
    img.setAttribute('href', dataUrl);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl);
    if (obj.rotation) {
        const rcx = bx + w/2, rcy = by + h/2;
        img.setAttribute('transform', `rotate(${obj.rotation} ${rcx} ${rcy})`);
    }
    return img;
}

// Pre-load all fonts for text-to-curves export
async function preloadFonts() {
    for (const f of FONTS) {
        try { await loadOTFont(f.name); } catch(e) {}
    }
}

// =============================================
// THEME
// =============================================
function initTheme() {
    const saved = localStorage.getItem('dekoor-editor-theme');
    if (saved === 'dark') document.body.classList.add('dark');
    updateThemeShadow();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
}

function toggleTheme() {
    document.body.classList.toggle('dark');
    localStorage.setItem('dekoor-editor-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    updateThemeShadow();
}

function updateThemeShadow() {
    const isDark = document.body.classList.contains('dark');
    const s1 = document.querySelector('#page-shadow-filter feDropShadow:first-child');
    const s2 = document.querySelector('#page-shadow-filter feDropShadow:last-child');
    if (s1 && s2) {
        s1.setAttribute('flood-color', isDark ? '#000' : '#3d2e5c'); s1.setAttribute('flood-opacity', isDark ? '0.25' : '0.10');
        s2.setAttribute('flood-color', isDark ? '#000' : '#3d2e5c'); s2.setAttribute('flood-opacity', isDark ? '0.15' : '0.06');
    }
}

// =============================================
// START
// =============================================
document.addEventListener('DOMContentLoaded', () => { initTheme(); init(); preloadFonts(); });
