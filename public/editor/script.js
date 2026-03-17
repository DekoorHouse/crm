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
};

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
    selectedId: null,

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

    unit: 'px',
    lockAspect: true,
};

// =============================================
// DOM REFERENCES
// =============================================
let svg, objectsLayer, selectionLayer, previewLayer;
let pageRect, pageGrid;

// =============================================
// INITIALIZATION
// =============================================
function init() {
    svg          = document.getElementById('canvas');
    objectsLayer   = document.getElementById('objects-layer');
    selectionLayer = document.getElementById('selection-layer');
    previewLayer   = document.getElementById('preview-layer');
    pageRect     = document.getElementById('page');
    pageGrid     = document.getElementById('page-grid');

    updatePage();
    // Delay resetView so the workspace has its final size
    requestAnimationFrame(() => {
        resetView();
    });
    buildColorPalette();
    setupEventListeners();
    updateStatusBar();
}

// =============================================
// PAGE MANAGEMENT
// =============================================
function updatePage() {
    const attrs = { x: 0, y: 0, width: state.pageWidth, height: state.pageHeight };
    for (const [k, v] of Object.entries(attrs)) {
        pageRect.setAttribute(k, v);
        pageGrid.setAttribute(k, v);
    }
    document.getElementById('status-page').textContent =
        `${toUnit(state.pageWidth)} × ${toUnit(state.pageHeight)} ${state.unit}`;
}

function resetView() {
    const margin = 60;
    const ws = document.getElementById('workspace');
    const rect = ws.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const wsAspect   = rect.width / rect.height;
    const pageAspect = (state.pageWidth + 2 * margin) / (state.pageHeight + 2 * margin);

    let vw, vh;
    if (wsAspect > pageAspect) {
        vh = state.pageHeight + 2 * margin;
        vw = vh * wsAspect;
    } else {
        vw = state.pageWidth + 2 * margin;
        vh = vw / wsAspect;
    }
    state.viewBox = {
        x: -(vw - state.pageWidth) / 2,
        y: -(vh - state.pageHeight) / 2,
        w: vw,
        h: vh,
    };
    updateViewBox();
}

function updateViewBox() {
    svg.setAttribute('viewBox',
        `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);

    // Adaptive grid
    const idealCells = 80;
    let gridSize = Math.pow(10, Math.floor(Math.log10(state.viewBox.w / idealCells)));
    if (state.viewBox.w / gridSize > idealCells * 3) gridSize *= 5;
    else if (state.viewBox.w / gridSize > idealCells * 1.5) gridSize *= 2;

    const pattern = document.getElementById('grid-pattern');
    pattern.setAttribute('width', gridSize);
    pattern.setAttribute('height', gridSize);
    pattern.querySelector('path').setAttribute('d',
        `M ${gridSize} 0 L 0 0 0 ${gridSize}`);

    // Zoom %
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
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// =============================================
// OBJECT MANAGEMENT
// =============================================
function createObject(type, props) {
    const obj = {
        id: state.nextId++,
        type,
        fill: (type === 'line' || type === 'bspline') ? 'none' : state.fillColor,
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
        ...props,
    };
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
            elem.setAttribute('x', obj.x);
            elem.setAttribute('y', obj.y);
            elem.setAttribute('width', obj.width);
            elem.setAttribute('height', obj.height);
            break;
        case 'ellipse':
            elem = document.createElementNS(ns, 'ellipse');
            elem.setAttribute('cx', obj.cx);
            elem.setAttribute('cy', obj.cy);
            elem.setAttribute('rx', obj.rx);
            elem.setAttribute('ry', obj.ry);
            break;
        case 'line':
            elem = document.createElementNS(ns, 'line');
            elem.setAttribute('x1', obj.x1);
            elem.setAttribute('y1', obj.y1);
            elem.setAttribute('x2', obj.x2);
            elem.setAttribute('y2', obj.y2);
            break;
        case 'bspline':
            elem = document.createElementNS(ns, 'path');
            elem.setAttribute('d', bsplineToPath(obj.points));
            break;
    }
    elem.setAttribute('fill', obj.fill);
    elem.setAttribute('stroke', obj.stroke);
    elem.setAttribute('stroke-width', obj.strokeWidth);
    elem.style.cursor = 'pointer';
    return elem;
}

function refreshElement(obj) {
    const elem = obj.element;
    switch (obj.type) {
        case 'rect':
            elem.setAttribute('x', obj.x);
            elem.setAttribute('y', obj.y);
            elem.setAttribute('width', obj.width);
            elem.setAttribute('height', obj.height);
            break;
        case 'ellipse':
            elem.setAttribute('cx', obj.cx);
            elem.setAttribute('cy', obj.cy);
            elem.setAttribute('rx', obj.rx);
            elem.setAttribute('ry', obj.ry);
            break;
        case 'line':
            elem.setAttribute('x1', obj.x1);
            elem.setAttribute('y1', obj.y1);
            elem.setAttribute('x2', obj.x2);
            elem.setAttribute('y2', obj.y2);
            break;
        case 'bspline':
            elem.setAttribute('d', bsplineToPath(obj.points));
            break;
    }
    elem.setAttribute('fill', obj.fill);
    elem.setAttribute('stroke', obj.stroke);
    elem.setAttribute('stroke-width', obj.strokeWidth);
}

function deleteObject(id) {
    const idx = state.objects.findIndex(o => o.id === id);
    if (idx === -1) return;
    state.objects[idx].element.remove();
    state.objects.splice(idx, 1);
    if (state.selectedId === id) {
        state.selectedId = null;
        clearSelection();
    }
}

function findObject(id) {
    return state.objects.find(o => o.id === id);
}

function objectAtPoint(pt) {
    for (let i = state.objects.length - 1; i >= 0; i--) {
        if (hitTest(state.objects[i], pt)) return state.objects[i];
    }
    return null;
}

function hitTest(obj, pt) {
    const m = Math.max(state.viewBox.w, state.viewBox.h) * 0.006;
    switch (obj.type) {
        case 'rect':
            return pt.x >= obj.x - m && pt.x <= obj.x + obj.width + m &&
                   pt.y >= obj.y - m && pt.y <= obj.y + obj.height + m;
        case 'ellipse': {
            const dx = (pt.x - obj.cx) / (obj.rx + m);
            const dy = (pt.y - obj.cy) / (obj.ry + m);
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
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x)*dx + (p.y - a.y)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t*dx), p.y - (a.y + t*dy));
}

// =============================================
// SELECTION
// =============================================
function selectObject(id) {
    state.selectedId = id;
    clearSelection();
    if (id === null) { updatePropsPanel(); return; }

    const obj = findObject(id);
    if (!obj) return;

    const bounds = getObjBounds(obj);
    const sw = state.viewBox.w * 0.0015;
    const hs = state.viewBox.w * 0.007;
    const ns = 'http://www.w3.org/2000/svg';

    // Dashed selection box
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', bounds.x);
    r.setAttribute('y', bounds.y);
    r.setAttribute('width', bounds.w);
    r.setAttribute('height', bounds.h);
    r.setAttribute('fill', 'none');
    r.setAttribute('stroke', '#7c5cf0');
    r.setAttribute('stroke-width', sw);
    r.setAttribute('stroke-dasharray', `${sw*4} ${sw*2}`);
    r.setAttribute('pointer-events', 'none');
    selectionLayer.appendChild(r);

    // Corner handles
    const corners = [
        [bounds.x, bounds.y],
        [bounds.x + bounds.w, bounds.y],
        [bounds.x, bounds.y + bounds.h],
        [bounds.x + bounds.w, bounds.y + bounds.h],
    ];
    for (const [cx, cy] of corners) {
        const h = document.createElementNS(ns, 'rect');
        h.setAttribute('x', cx - hs/2);
        h.setAttribute('y', cy - hs/2);
        h.setAttribute('width', hs);
        h.setAttribute('height', hs);
        h.setAttribute('fill', '#fff');
        h.setAttribute('stroke', '#7c5cf0');
        h.setAttribute('stroke-width', sw);
        h.setAttribute('pointer-events', 'none');
        selectionLayer.appendChild(h);
    }

    updatePropsPanel();

    // B-spline control points + polygon
    if (obj.type === 'bspline' && obj.points.length > 0) {
        const cs = hs * 0.7;
        // Control polygon
        if (obj.points.length > 1) {
            const pl = document.createElementNS(ns, 'polyline');
            pl.setAttribute('points', obj.points.map(p => `${p.x},${p.y}`).join(' '));
            pl.setAttribute('fill', 'none');
            pl.setAttribute('stroke', '#7c5cf0');
            pl.setAttribute('stroke-width', sw * 0.6);
            pl.setAttribute('stroke-dasharray', `${sw*3} ${sw*1.5}`);
            pl.setAttribute('pointer-events', 'none');
            selectionLayer.appendChild(pl);
        }
        // Points
        for (const p of obj.points) {
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('cx', p.x);
            c.setAttribute('cy', p.y);
            c.setAttribute('r', cs/2);
            c.setAttribute('fill', '#fff');
            c.setAttribute('stroke', '#7c5cf0');
            c.setAttribute('stroke-width', sw);
            c.setAttribute('pointer-events', 'none');
            selectionLayer.appendChild(c);
        }
    }
}

function clearSelection() {
    selectionLayer.innerHTML = '';
}

function getObjBounds(obj) {
    switch (obj.type) {
        case 'rect':
            return { x: obj.x, y: obj.y, w: obj.width, h: obj.height };
        case 'ellipse':
            return { x: obj.cx - obj.rx, y: obj.cy - obj.ry, w: obj.rx*2, h: obj.ry*2 };
        case 'line': {
            const x = Math.min(obj.x1, obj.x2), y = Math.min(obj.y1, obj.y2);
            return { x, y, w: Math.abs(obj.x2-obj.x1)||1, h: Math.abs(obj.y2-obj.y1)||1 };
        }
        case 'bspline': {
            if (!obj.points.length) return { x:0, y:0, w:0, h:0 };
            const pts = sampleBSpline(obj.points, 80);
            let x1=Infinity, y1=Infinity, x2=-Infinity, y2=-Infinity;
            for (const p of pts) {
                if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
                if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
            }
            return { x:x1, y:y1, w:(x2-x1)||1, h:(y2-y1)||1 };
        }
    }
}

// =============================================
// B-SPLINE (De Boor evaluation)
// =============================================
function bsplineToPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2)
        return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

    const samples = sampleBSpline(points, Math.max(60, points.length * 20));
    let d = `M ${samples[0].x.toFixed(2)} ${samples[0].y.toFixed(2)}`;
    for (let i = 1; i < samples.length; i++) {
        d += ` L ${samples[i].x.toFixed(2)} ${samples[i].y.toFixed(2)}`;
    }
    return d;
}

function sampleBSpline(ctrlPts, numSamples) {
    const n = ctrlPts.length - 1;
    if (n < 0) return [];
    if (n === 0) return [{ x: ctrlPts[0].x, y: ctrlPts[0].y }];
    if (n === 1) {
        const out = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            out.push({
                x: ctrlPts[0].x * (1-t) + ctrlPts[1].x * t,
                y: ctrlPts[0].y * (1-t) + ctrlPts[1].y * t,
            });
        }
        return out;
    }

    const degree = Math.min(3, n);

    // Clamped knot vector
    const m = n + degree + 1;
    const knots = [];
    for (let i = 0; i <= m; i++) {
        if (i <= degree)        knots.push(0);
        else if (i >= m - degree) knots.push(n - degree + 1);
        else                      knots.push(i - degree);
    }

    const tMax = knots[m - degree];
    const out = [];

    for (let s = 0; s <= numSamples; s++) {
        let t = (s / numSamples) * tMax;
        if (t >= tMax) t = tMax - 1e-10;

        // Find knot span
        let k = degree;
        for (let j = degree; j < m - degree; j++) {
            if (t >= knots[j] && t < knots[j+1]) { k = j; break; }
        }

        // De Boor
        const d = [];
        for (let j = 0; j <= degree; j++) {
            const idx = k - degree + j;
            d.push({ x: ctrlPts[idx].x, y: ctrlPts[idx].y });
        }
        for (let r = 1; r <= degree; r++) {
            for (let j = degree; j >= r; j--) {
                const idx = k - degree + j;
                const denom = knots[idx + degree - r + 1] - knots[idx];
                const alpha = denom === 0 ? 0 : (t - knots[idx]) / denom;
                d[j].x = (1-alpha)*d[j-1].x + alpha*d[j].x;
                d[j].y = (1-alpha)*d[j-1].y + alpha*d[j].y;
            }
        }
        out.push({ x: d[degree].x, y: d[degree].y });
    }
    return out;
}

// =============================================
// TOOL HANDLERS
// =============================================
function handleMouseDown(e) {
    // Pan: middle button or space+left
    if (e.button === 1 || (e.button === 0 && state.spaceHeld)) {
        e.preventDefault();
        state.isPanning = true;
        state.panStart = { x: e.clientX, y: e.clientY };
        state.panViewBoxStart = { ...state.viewBox };
        svg.style.cursor = 'grabbing';
        return;
    }
    if (e.button !== 0) return;

    const pt = screenToSVG(e.clientX, e.clientY);
    switch (state.tool) {
        case 'select':  handleSelectDown(pt); break;
        case 'rect':
        case 'ellipse':
        case 'line':    handleShapeDown(pt);  break;
        case 'bspline': handleBSplineClick(pt); break;
    }
}

function handleMouseMove(e) {
    const pt = screenToSVG(e.clientX, e.clientY);
    document.getElementById('status-coords').textContent =
        `X: ${Math.round(pt.x)}  Y: ${Math.round(pt.y)}`;

    if (state.isPanning) {
        const dx = e.clientX - state.panStart.x;
        const dy = e.clientY - state.panStart.y;
        const scale = state.viewBox.w / svg.getBoundingClientRect().width;
        state.viewBox.x = state.panViewBoxStart.x - dx * scale;
        state.viewBox.y = state.panViewBoxStart.y - dy * scale;
        updateViewBox();
        return;
    }
    if (state.isDragging) { handleDragMove(pt); return; }
    if (state.isDrawing)  { handleDrawMove(pt); return; }

    if (state.tool === 'bspline' && state.bsplinePoints.length > 0) {
        updateBSplinePreview(pt);
    }

    // Cursor
    if (state.tool === 'select' && !state.spaceHeld) {
        svg.style.cursor = objectAtPoint(pt) ? 'move' : 'default';
    }
}

function handleMouseUp() {
    if (state.isPanning) {
        state.isPanning = false;
        svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
        return;
    }
    if (state.isDragging) {
        state.isDragging = false;
        selectObject(state.selectedId);
        return;
    }
    if (state.isDrawing) {
        handleDrawEnd();
    }
}

// --- Select ---
function handleSelectDown(pt) {
    const obj = objectAtPoint(pt);
    if (obj) {
        selectObject(obj.id);
        state.isDragging = true;
        state.dragStart = { x: pt.x, y: pt.y };
        state.dragObjProps = snapshotPos(obj);
    } else {
        selectObject(null);
    }
}

function handleDragMove(pt) {
    const obj = findObject(state.selectedId);
    if (!obj) return;
    const dx = pt.x - state.dragStart.x;
    const dy = pt.y - state.dragStart.y;
    applyMove(obj, state.dragObjProps, dx, dy);
    refreshElement(obj);
    selectObject(obj.id);
}

function snapshotPos(obj) {
    switch (obj.type) {
        case 'rect':    return { x: obj.x, y: obj.y };
        case 'ellipse': return { cx: obj.cx, cy: obj.cy };
        case 'line':    return { x1:obj.x1, y1:obj.y1, x2:obj.x2, y2:obj.y2 };
        case 'bspline': return { points: obj.points.map(p => ({...p})) };
    }
}

function applyMove(obj, snap, dx, dy) {
    switch (obj.type) {
        case 'rect':
            obj.x = snap.x + dx;
            obj.y = snap.y + dy;
            break;
        case 'ellipse':
            obj.cx = snap.cx + dx;
            obj.cy = snap.cy + dy;
            break;
        case 'line':
            obj.x1 = snap.x1 + dx; obj.y1 = snap.y1 + dy;
            obj.x2 = snap.x2 + dx; obj.y2 = snap.y2 + dy;
            break;
        case 'bspline':
            obj.points = snap.points.map(p => ({ x: p.x+dx, y: p.y+dy }));
            break;
    }
}

// --- Shapes (rect, ellipse, line) ---
function handleShapeDown(pt) {
    state.isDrawing = true;
    state.drawStart = { x: pt.x, y: pt.y };
    clearPreview();

    const ns = 'http://www.w3.org/2000/svg';
    if (state.tool === 'rect') {
        state.previewElement = document.createElementNS(ns, 'rect');
        state.previewElement.setAttribute('x', pt.x);
        state.previewElement.setAttribute('y', pt.y);
        state.previewElement.setAttribute('width', 0);
        state.previewElement.setAttribute('height', 0);
    } else if (state.tool === 'ellipse') {
        state.previewElement = document.createElementNS(ns, 'ellipse');
        state.previewElement.setAttribute('cx', pt.x);
        state.previewElement.setAttribute('cy', pt.y);
        state.previewElement.setAttribute('rx', 0);
        state.previewElement.setAttribute('ry', 0);
    } else if (state.tool === 'line') {
        state.previewElement = document.createElementNS(ns, 'line');
        state.previewElement.setAttribute('x1', pt.x);
        state.previewElement.setAttribute('y1', pt.y);
        state.previewElement.setAttribute('x2', pt.x);
        state.previewElement.setAttribute('y2', pt.y);
    }

    const el = state.previewElement;
    el.setAttribute('fill', state.tool === 'line' ? 'none' : state.fillColor);
    el.setAttribute('stroke', state.strokeColor);
    el.setAttribute('stroke-width', state.strokeWidth);
    el.setAttribute('stroke-dasharray', `${state.strokeWidth * 2} ${state.strokeWidth}`);
    el.setAttribute('pointer-events', 'none');
    previewLayer.appendChild(el);
}

function handleDrawMove(pt) {
    const el = state.previewElement;
    if (!el) return;
    const sx = state.drawStart.x, sy = state.drawStart.y;

    if (state.tool === 'rect') {
        el.setAttribute('x', Math.min(sx, pt.x));
        el.setAttribute('y', Math.min(sy, pt.y));
        el.setAttribute('width', Math.abs(pt.x - sx));
        el.setAttribute('height', Math.abs(pt.y - sy));
    } else if (state.tool === 'ellipse') {
        el.setAttribute('cx', (sx + pt.x) / 2);
        el.setAttribute('cy', (sy + pt.y) / 2);
        el.setAttribute('rx', Math.abs(pt.x - sx) / 2);
        el.setAttribute('ry', Math.abs(pt.y - sy) / 2);
    } else if (state.tool === 'line') {
        el.setAttribute('x2', pt.x);
        el.setAttribute('y2', pt.y);
    }
}

function handleDrawEnd() {
    state.isDrawing = false;
    const el = state.previewElement;
    if (!el) return;
    const sx = state.drawStart.x, sy = state.drawStart.y;
    let obj = null;

    if (state.tool === 'rect') {
        const x = +el.getAttribute('x'), y = +el.getAttribute('y');
        const w = +el.getAttribute('width'), h = +el.getAttribute('height');
        if (w > 1 && h > 1) obj = createObject('rect', { x, y, width: w, height: h });
    } else if (state.tool === 'ellipse') {
        const cx = +el.getAttribute('cx'), cy = +el.getAttribute('cy');
        const rx = +el.getAttribute('rx'), ry = +el.getAttribute('ry');
        if (rx > 1 && ry > 1) obj = createObject('ellipse', { cx, cy, rx, ry });
    } else if (state.tool === 'line') {
        const x2 = +el.getAttribute('x2'), y2 = +el.getAttribute('y2');
        if (Math.hypot(x2 - sx, y2 - sy) > 1)
            obj = createObject('line', { x1: sx, y1: sy, x2, y2 });
    }

    clearPreview();
    if (obj) selectObject(obj.id);
}

// --- B-Spline ---
function handleBSplineClick(pt) {
    state.bsplinePoints.push({ x: pt.x, y: pt.y });
    updateBSplinePreview(pt);
}

function handleBSplineDblClick() {
    // Remove duplicate from the second click of the double-click
    if (state.bsplinePoints.length >= 2) state.bsplinePoints.pop();
    if (state.bsplinePoints.length >= 2) {
        const obj = createObject('bspline', { points: [...state.bsplinePoints] });
        selectObject(obj.id);
    }
    state.bsplinePoints = [];
    clearPreview();
}

function updateBSplinePreview(mousePt) {
    clearPreview();
    const ns = 'http://www.w3.org/2000/svg';
    const all = [...state.bsplinePoints, { x: mousePt.x, y: mousePt.y }];
    const sw = state.viewBox.w * 0.001;
    const cs = state.viewBox.w * 0.005;

    // Control polygon
    if (all.length > 1) {
        const pl = document.createElementNS(ns, 'polyline');
        pl.setAttribute('points', all.map(p => `${p.x},${p.y}`).join(' '));
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', '#b8aed0');
        pl.setAttribute('stroke-width', sw);
        pl.setAttribute('stroke-dasharray', `${sw*4} ${sw*2}`);
        pl.setAttribute('pointer-events', 'none');
        previewLayer.appendChild(pl);
    }

    // Control points
    for (let i = 0; i < all.length; i++) {
        const cp = document.createElementNS(ns, 'rect');
        cp.setAttribute('x', all[i].x - cs/2);
        cp.setAttribute('y', all[i].y - cs/2);
        cp.setAttribute('width', cs);
        cp.setAttribute('height', cs);
        cp.setAttribute('fill', i < state.bsplinePoints.length ? '#7c5cf0' : '#fff');
        cp.setAttribute('stroke', '#7c5cf0');
        cp.setAttribute('stroke-width', sw);
        cp.setAttribute('pointer-events', 'none');
        previewLayer.appendChild(cp);
    }

    // Curve
    if (all.length >= 2) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', bsplineToPath(all));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', state.strokeColor);
        path.setAttribute('stroke-width', state.strokeWidth);
        path.setAttribute('pointer-events', 'none');
        previewLayer.appendChild(path);
    }
}

function clearPreview() {
    previewLayer.innerHTML = '';
    state.previewElement = null;
}

// =============================================
// COLOR PALETTE
// =============================================
function buildColorPalette() {
    const container = document.getElementById('palette-colors');
    for (const color of PALETTE_COLORS) {
        const sw = document.createElement('div');
        sw.className = 'palette-color';
        sw.style.background = color;
        sw.dataset.color = color;
        sw.title = `Izq: relleno | Der: línea — ${color}`;
        container.appendChild(sw);
    }

    const palette = document.getElementById('color-palette');

    palette.addEventListener('mousedown', (e) => {
        const swatch = e.target.closest('.palette-color');
        if (!swatch) return;
        e.preventDefault();
        const color = swatch.dataset.color;

        if (e.button === 0) {
            // Left click → fill
            state.fillColor = color;
            document.querySelector('#fill-swatch .swatch-inner').style.background =
                color === 'none' ? 'linear-gradient(135deg,#f5f3ff 40%,#d4b4c8 40%,#d4b4c8 60%,#f5f3ff 60%)' : color;

            const obj = findObject(state.selectedId);
            if (obj && obj.type !== 'line' && obj.type !== 'bspline') {
                obj.fill = color;
                refreshElement(obj);
            }
        } else if (e.button === 2) {
            // Right click → stroke
            state.strokeColor = color;
            document.querySelector('#stroke-swatch .swatch-inner').style.background =
                color === 'none' ? 'linear-gradient(135deg,#f5f3ff 40%,#d4b4c8 40%,#d4b4c8 60%,#f5f3ff 60%)' : color;

            const obj = findObject(state.selectedId);
            if (obj) {
                obj.stroke = color;
                refreshElement(obj);
                selectObject(obj.id);
            }
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
            if (openMenu === dropdown) {
                dropdown.classList.remove('open');
                openMenu = null;
            } else {
                if (openMenu) openMenu.classList.remove('open');
                dropdown.classList.add('open');
                openMenu = dropdown;
            }
        });
    });

    document.addEventListener('click', () => {
        if (openMenu) { openMenu.classList.remove('open'); openMenu = null; }
    });

    document.querySelectorAll('.menu-option').forEach(opt => {
        opt.addEventListener('click', () => {
            handleMenuAction(opt.dataset.action);
            if (openMenu) { openMenu.classList.remove('open'); openMenu = null; }
        });
    });
}

function handleMenuAction(action) {
    switch (action) {
        case 'export-svg': exportSVG(); break;
        case 'clear-all':  clearAll();  break;
        case 'page-size':  showPageSizeModal(); break;
        case 'fit-page':   resetView(); break;
    }
}

// =============================================
// SVG EXPORT
// =============================================
function exportSVG() {
    const ns = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(ns, 'svg');
    root.setAttribute('xmlns', ns);
    root.setAttribute('width', state.pageWidth);
    root.setAttribute('height', state.pageHeight);
    root.setAttribute('viewBox', `0 0 ${state.pageWidth} ${state.pageHeight}`);

    // White background
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', state.pageWidth);
    bg.setAttribute('height', state.pageHeight);
    bg.setAttribute('fill', '#ffffff');
    root.appendChild(bg);

    // Objects
    for (const obj of state.objects) {
        const clone = obj.element.cloneNode(true);
        clone.removeAttribute('data-object-id');
        clone.removeAttribute('style');
        root.appendChild(clone);
    }

    const serializer = new XMLSerializer();
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(root);
    const blob = new Blob([str], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dibujo.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =============================================
// CLEAR ALL
// =============================================
function clearAll() {
    if (!state.objects.length) return;
    if (!confirm('¿Eliminar todos los objetos?')) return;
    objectsLayer.innerHTML = '';
    state.objects = [];
    state.selectedId = null;
    clearSelection();
    clearPreview();
    state.bsplinePoints = [];
}

// =============================================
// PAGE SIZE MODAL
// =============================================
function showPageSizeModal() {
    document.getElementById('page-width-input').value = state.pageWidth;
    document.getElementById('page-height-input').value = state.pageHeight;
    document.getElementById('page-preset').value = 'custom';
    document.getElementById('page-size-modal').classList.remove('hidden');
}

function hidePageSizeModal() {
    document.getElementById('page-size-modal').classList.add('hidden');
}

function setupPageSizeModal() {
    document.getElementById('page-preset').addEventListener('change', (e) => {
        const p = PAGE_PRESETS[e.target.value];
        if (p) {
            document.getElementById('page-width-input').value = p.w;
            document.getElementById('page-height-input').value = p.h;
        }
    });

    const modal = document.getElementById('page-size-modal');
    modal.querySelector('[data-action="cancel"]').addEventListener('click', hidePageSizeModal);
    modal.querySelector('[data-action="apply"]').addEventListener('click', () => {
        const w = parseInt(document.getElementById('page-width-input').value);
        const h = parseInt(document.getElementById('page-height-input').value);
        if (w > 0 && h > 0) {
            state.pageWidth = w;
            state.pageHeight = h;
            updatePage();
            resetView();
        }
        hidePageSizeModal();
    });
    modal.querySelector('.modal-overlay').addEventListener('click', hidePageSizeModal);
}

// =============================================
// ZOOM
// =============================================
function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1/1.1;
    const pt = screenToSVG(e.clientX, e.clientY);
    const newW = state.viewBox.w * factor;
    const newH = state.viewBox.h * factor;
    if (newW < 10 || newW > 50000) return;

    state.viewBox.x = pt.x - (pt.x - state.viewBox.x) * factor;
    state.viewBox.y = pt.y - (pt.y - state.viewBox.y) * factor;
    state.viewBox.w = newW;
    state.viewBox.h = newH;
    updateViewBox();

    if (state.selectedId) selectObject(state.selectedId);
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
    svg.addEventListener('mousedown', handleMouseDown);
    svg.addEventListener('mousemove', handleMouseMove);
    svg.addEventListener('mouseup', handleMouseUp);
    svg.addEventListener('wheel', handleWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());

    svg.addEventListener('dblclick', () => {
        if (state.tool === 'bspline') handleBSplineDblClick();
    });

    // Tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    // Stroke width
    document.getElementById('stroke-width').addEventListener('change', (e) => {
        state.strokeWidth = parseFloat(e.target.value) || 1;
        const obj = findObject(state.selectedId);
        if (obj) { obj.strokeWidth = state.strokeWidth; refreshElement(obj); }
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        switch (e.key.toLowerCase()) {
            case 'v': setTool('select');  break;
            case 'r': setTool('rect');    break;
            case 'e': setTool('ellipse'); break;
            case 'l': setTool('line');    break;
            case 'b': setTool('bspline'); break;
            case 'delete':
            case 'backspace':
                if (state.selectedId) deleteObject(state.selectedId);
                break;
            case 'escape':
                if (state.tool === 'bspline' && state.bsplinePoints.length > 0) {
                    state.bsplinePoints = [];
                    clearPreview();
                } else {
                    selectObject(null);
                }
                break;
            case ' ':
                e.preventDefault();
                state.spaceHeld = true;
                svg.style.cursor = 'grab';
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === ' ') {
            state.spaceHeld = false;
            svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
        }
    });

    window.addEventListener('resize', () => resetView());

    setupMenus();
    setupPageSizeModal();
    setupPropsPanel();
}

function setTool(tool) {
    // Finish in-progress B-spline
    if (state.tool === 'bspline' && tool !== 'bspline') {
        if (state.bsplinePoints.length >= 2) {
            const obj = createObject('bspline', { points: [...state.bsplinePoints] });
            selectObject(obj.id);
        }
        state.bsplinePoints = [];
        clearPreview();
    }

    state.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tool === tool));
    document.getElementById('status-tool').textContent = TOOL_NAMES[tool];
    svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

function updateStatusBar() {
    document.getElementById('status-tool').textContent = TOOL_NAMES[state.tool];
    document.getElementById('status-page').textContent =
        `${toUnit(state.pageWidth)} × ${toUnit(state.pageHeight)} ${state.unit}`;
}

// =============================================
// UNITS & PROPERTIES PANEL
// =============================================
function toUnit(px) {
    return +(px * UNITS[state.unit].factor).toFixed(UNITS[state.unit].dec);
}

function fromUnit(val) {
    return val / UNITS[state.unit].factor;
}

function updatePropsPanel() {
    const panel = document.getElementById('props-panel');
    if (!state.selectedId) { panel.classList.add('hidden'); return; }
    const obj = findObject(state.selectedId);
    if (!obj) { panel.classList.add('hidden'); return; }

    panel.classList.remove('hidden');
    const b = getObjBounds(obj);
    document.getElementById('prop-x').value = toUnit(b.x);
    document.getElementById('prop-y').value = toUnit(b.y);
    document.getElementById('prop-w').value = toUnit(b.w);
    document.getElementById('prop-h').value = toUnit(b.h);
    document.getElementById('props-unit-label').textContent = state.unit;
}

function applyPropPosition(obj, newXu, newYu) {
    const newX = fromUnit(newXu);
    const newY = fromUnit(newYu);
    const b = getObjBounds(obj);
    const dx = newX - b.x, dy = newY - b.y;
    switch (obj.type) {
        case 'rect':    obj.x += dx; obj.y += dy; break;
        case 'ellipse': obj.cx += dx; obj.cy += dy; break;
        case 'line':    obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy; break;
        case 'bspline': obj.points = obj.points.map(p => ({ x: p.x+dx, y: p.y+dy })); break;
    }
}

function applyPropSize(obj, newWpx, newHpx) {
    const b = getObjBounds(obj);
    if (b.w < 0.01 || b.h < 0.01) return;
    const sx = newWpx / b.w, sy = newHpx / b.h;
    switch (obj.type) {
        case 'rect':
            obj.width = newWpx;
            obj.height = newHpx;
            break;
        case 'ellipse':
            obj.rx = newWpx / 2;
            obj.ry = newHpx / 2;
            break;
        case 'line': {
            const ox = Math.min(obj.x1, obj.x2), oy = Math.min(obj.y1, obj.y2);
            obj.x1 = ox + (obj.x1 - ox) * sx;
            obj.y1 = oy + (obj.y1 - oy) * sy;
            obj.x2 = ox + (obj.x2 - ox) * sx;
            obj.y2 = oy + (obj.y2 - oy) * sy;
            break;
        }
        case 'bspline': {
            const ox = b.x, oy = b.y;
            obj.points = obj.points.map(p => ({
                x: ox + (p.x - ox) * sx,
                y: oy + (p.y - oy) * sy,
            }));
            break;
        }
    }
}

function setupPropsPanel() {
    const propX = document.getElementById('prop-x');
    const propY = document.getElementById('prop-y');
    const propW = document.getElementById('prop-w');
    const propH = document.getElementById('prop-h');
    const lockBtn = document.getElementById('lock-aspect');

    lockBtn.addEventListener('click', () => {
        state.lockAspect = !state.lockAspect;
        lockBtn.classList.toggle('active', state.lockAspect);
    });

    propX.addEventListener('change', () => {
        const obj = findObject(state.selectedId);
        if (!obj) return;
        applyPropPosition(obj, parseFloat(propX.value), parseFloat(propY.value));
        refreshElement(obj);
        selectObject(obj.id);
    });

    propY.addEventListener('change', () => {
        const obj = findObject(state.selectedId);
        if (!obj) return;
        applyPropPosition(obj, parseFloat(propX.value), parseFloat(propY.value));
        refreshElement(obj);
        selectObject(obj.id);
    });

    propW.addEventListener('change', () => {
        const obj = findObject(state.selectedId);
        if (!obj) return;
        const b = getObjBounds(obj);
        let newW = fromUnit(parseFloat(propW.value));
        let newH = b.h;
        if (newW < 0.1) newW = 0.1;
        if (state.lockAspect && b.w > 0.01) {
            newH = newW * (b.h / b.w);
        }
        applyPropSize(obj, newW, newH);
        refreshElement(obj);
        selectObject(obj.id);
    });

    propH.addEventListener('change', () => {
        const obj = findObject(state.selectedId);
        if (!obj) return;
        const b = getObjBounds(obj);
        let newH = fromUnit(parseFloat(propH.value));
        let newW = b.w;
        if (newH < 0.1) newH = 0.1;
        if (state.lockAspect && b.h > 0.01) {
            newW = newH * (b.w / b.h);
        }
        applyPropSize(obj, newW, newH);
        refreshElement(obj);
        selectObject(obj.id);
    });

    document.getElementById('unit-select').addEventListener('change', (e) => {
        state.unit = e.target.value;
        updatePropsPanel();
        updatePage();
    });
}

// =============================================
// THEME
// =============================================
function initTheme() {
    const saved = localStorage.getItem('dekoor-editor-theme');
    if (saved === 'dark') document.body.classList.add('dark');
    updateGridColor();

    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
}

function toggleTheme() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('dekoor-editor-theme', isDark ? 'dark' : 'light');
    updateGridColor();
}

function updateGridColor() {
    const isDark = document.body.classList.contains('dark');
    const gridPath = document.querySelector('#grid-pattern path');
    gridPath.setAttribute('stroke', isDark ? '#3a3548' : '#cdc6d8');

    // Update page shadow for dark mode
    const shadow1 = document.querySelector('#page-shadow-filter feDropShadow:first-child');
    const shadow2 = document.querySelector('#page-shadow-filter feDropShadow:last-child');
    if (shadow1 && shadow2) {
        shadow1.setAttribute('flood-color', isDark ? '#000000' : '#3d2e5c');
        shadow1.setAttribute('flood-opacity', isDark ? '0.25' : '0.10');
        shadow2.setAttribute('flood-color', isDark ? '#000000' : '#3d2e5c');
        shadow2.setAttribute('flood-opacity', isDark ? '0.15' : '0.06');
    }
}

// =============================================
// START
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    init();
});
