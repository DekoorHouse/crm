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

    unit: 'px',
    lockAspect: true,
};

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
    const obj = {
        id: state.nextId++,
        type,
        fill: (type === 'line' || type === 'bspline') ? 'none' : state.fillColor,
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
        rotation: 0,
        ...props,
    };
    if (type === 'group') { obj.fill = 'none'; obj.stroke = 'none'; obj.strokeWidth = 0; }
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
        case 'group':
            elem = document.createElementNS(ns, 'g');
            for (const child of obj.children) {
                const ce = buildSVGElement(child);
                child.element = ce;
                ce.dataset.objectId = obj.id; // clicks on children → group
                elem.appendChild(ce);
            }
            break;
    }
    if (obj.type !== 'group') {
        elem.setAttribute('fill', obj.fill);
        elem.setAttribute('stroke', obj.stroke);
        elem.setAttribute('stroke-width', obj.strokeWidth);
    }
    applyRotation(obj, elem);
    elem.style.cursor = 'pointer';
    return elem;
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
        case 'group':
            for (const child of obj.children) refreshElement(child);
            break;
    }
    if (obj.type !== 'group') {
        elem.setAttribute('fill', obj.fill);
        elem.setAttribute('stroke', obj.stroke);
        elem.setAttribute('stroke-width', obj.strokeWidth);
    }
    applyRotation(obj, elem);
}

function deleteObject(id) {
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
    switch (obj.type) {
        case 'rect':
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
    } else if (id !== null) {
        if (addToSelection) {
            if (isSelected(id)) state.selectedIds = state.selectedIds.filter(i => i !== id);
            else state.selectedIds.push(id);
        } else {
            state.selectedIds = [id];
        }
    }
    drawSelection();
    updatePropsPanel();
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
        // Dashed box
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', bounds.x); r.setAttribute('y', bounds.y);
        r.setAttribute('width', bounds.w); r.setAttribute('height', bounds.h);
        r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#7c5cf0');
        r.setAttribute('stroke-width', sw);
        r.setAttribute('stroke-dasharray', `${sw*4} ${sw*2}`);
        r.setAttribute('pointer-events', 'none');
        if (obj.rotation) {
            const cx = bounds.x + bounds.w/2, cy = bounds.y + bounds.h/2;
            r.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
        }
        selectionLayer.appendChild(r);
        // Corner handles
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
            if (obj.rotation) h.setAttribute('transform', `rotate(${obj.rotation} ${bounds.x + bounds.w/2} ${bounds.y + bounds.h/2})`);
            selectionLayer.appendChild(h);
        }
        // B-spline control points
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
        case 'rect': return { x: obj.x, y: obj.y, w: obj.width, h: obj.height };
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
    }
}

// =============================================
// SNAP POINTS (hover indicators)
// =============================================
function getSnapPoints(obj) {
    const pts = [];
    const b = getObjBounds(obj);
    // Center
    pts.push({ x: b.x + b.w/2, y: b.y + b.h/2, type: 'center' });
    if (obj.type === 'rect' || obj.type === 'group') {
        // Corners
        pts.push({x:b.x,y:b.y,type:'corner'},{x:b.x+b.w,y:b.y,type:'corner'},
                 {x:b.x,y:b.y+b.h,type:'corner'},{x:b.x+b.w,y:b.y+b.h,type:'corner'});
        // Edge midpoints
        pts.push({x:b.x+b.w/2,y:b.y,type:'edge'},{x:b.x+b.w/2,y:b.y+b.h,type:'edge'},
                 {x:b.x,y:b.y+b.h/2,type:'edge'},{x:b.x+b.w,y:b.y+b.h/2,type:'edge'});
    } else if (obj.type === 'ellipse') {
        // Quadrant points (cardinal)
        pts.push({x:obj.cx,y:obj.cy-obj.ry,type:'quadrant'},{x:obj.cx,y:obj.cy+obj.ry,type:'quadrant'},
                 {x:obj.cx-obj.rx,y:obj.cy,type:'quadrant'},{x:obj.cx+obj.rx,y:obj.cy,type:'quadrant'});
    } else if (obj.type === 'line') {
        pts.push({x:obj.x1,y:obj.y1,type:'endpoint'},{x:obj.x2,y:obj.y2,type:'endpoint'});
        pts.push({x:(obj.x1+obj.x2)/2,y:(obj.y1+obj.y2)/2,type:'edge'});
    }
    return pts;
}

// Find the nearest point on an object's perimeter to a given point
function nearestEdgePoint(obj, pt) {
    if (obj.type === 'rect' || obj.type === 'group') {
        const b = getObjBounds(obj);
        // Check all 4 edges, find closest point on each
        const edges = [
            [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y}],
            [{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h}],
            [{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}],
            [{x:b.x,y:b.y+b.h},{x:b.x,y:b.y}],
        ];
        let best = null, bestD = Infinity;
        for (const [a, b2] of edges) {
            const p = closestPointOnSeg(pt, a, b2);
            const d = Math.hypot(pt.x - p.x, pt.y - p.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        return { point: best, dist: bestD };
    } else if (obj.type === 'ellipse') {
        // Sample points around the ellipse to find nearest
        let best = null, bestD = Infinity;
        const steps = 64;
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const px = obj.cx + obj.rx * Math.cos(angle);
            const py = obj.cy + obj.ry * Math.sin(angle);
            const d = Math.hypot(pt.x - px, pt.y - py);
            if (d < bestD) { bestD = d; best = {x: px, y: py}; }
        }
        return { point: best, dist: bestD };
    } else if (obj.type === 'line') {
        const p = closestPointOnSeg(pt, {x:obj.x1,y:obj.y1}, {x:obj.x2,y:obj.y2});
        return { point: p, dist: Math.hypot(pt.x - p.x, pt.y - p.y) };
    } else if (obj.type === 'bspline') {
        if (obj.points.length < 2) return null;
        const samples = sampleBSpline(obj.points, 80);
        let best = null, bestD = Infinity;
        for (let i = 0; i < samples.length - 1; i++) {
            const p = closestPointOnSeg(pt, samples[i], samples[i+1]);
            const d = Math.hypot(pt.x - p.x, pt.y - p.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        return best ? { point: best, dist: bestD } : null;
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
    if (state.tool !== 'select' || state.selectedIds.length === 0) return;
    const ns = 'http://www.w3.org/2000/svg';
    const screenScale = state.viewBox.w / svg.getBoundingClientRect().width;
    const threshold = SNAP_DIST * screenScale;
    const edgeThreshold = threshold * 1.5; // wider detection for edge proximity
    const r = 3 * screenScale;

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
    } else if (sp.type === 'corner' || sp.type === 'endpoint') {
        const sq = document.createElementNS(ns, 'rect');
        sq.setAttribute('x', sp.x - r); sq.setAttribute('y', sp.y - r);
        sq.setAttribute('width', r*2); sq.setAttribute('height', r*2);
        sq.setAttribute('fill', 'none'); sq.setAttribute('stroke', color);
        sq.setAttribute('stroke-width', sw);
        sq.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(sq);
    } else if (sp.type === 'edge') {
        const tr = document.createElementNS(ns, 'polygon');
        tr.setAttribute('points', `${sp.x},${sp.y-r*1.3} ${sp.x-r},${sp.y+r*0.7} ${sp.x+r},${sp.y+r*0.7}`);
        tr.setAttribute('fill', 'none'); tr.setAttribute('stroke', color);
        tr.setAttribute('stroke-width', sw);
        tr.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(tr);
    } else if (sp.type === 'quadrant') {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', sp.x); c.setAttribute('cy', sp.y); c.setAttribute('r', r);
        c.setAttribute('fill', 'none'); c.setAttribute('stroke', color);
        c.setAttribute('stroke-width', sw);
        c.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(c);
    } else if (sp.type === 'edge-dynamic') {
        // Diamond marker for nearest edge point
        const s = r * 1.2;
        const diamond = document.createElementNS(ns, 'polygon');
        diamond.setAttribute('points',
            `${sp.x},${sp.y-s} ${sp.x+s},${sp.y} ${sp.x},${sp.y+s} ${sp.x-s},${sp.y}`);
        diamond.setAttribute('fill', color); diamond.setAttribute('fill-opacity', '0.3');
        diamond.setAttribute('stroke', color); diamond.setAttribute('stroke-width', sw);
        diamond.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(diamond);
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
    const pt = screenToSVG(e.clientX, e.clientY);
    switch (state.tool) {
        case 'select':  handleSelectDown(pt, e); break;
        case 'rect': case 'ellipse': case 'line': handleShapeDown(pt); break;
        case 'bspline': handleBSplineClick(pt); break;
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
    if (state.isDragging) { handleDragMove(pt); return; }
    if (state.isDrawing) { handleDrawMove(pt, e); return; }
    if (state.tool === 'bspline' && state.bsplinePoints.length > 0) updateBSplinePreview(pt);
    // Snap indicators
    drawSnapIndicators(pt);
    if (state.tool === 'select' && !state.spaceHeld) {
        svg.style.cursor = objectAtPoint(pt) ? 'move' : 'default';
    }
}

function handleMouseUp() {
    if (state.isPanning) { state.isPanning = false; svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; return; }
    if (state.isDragging) { state.isDragging = false; drawSelection(); updatePropsPanel(); return; }
    if (state.isDrawing) handleDrawEnd();
}

// --- Select ---
function handleSelectDown(pt, e) {
    const obj = objectAtPoint(pt);
    if (obj) {
        selectObject(obj.id, e.shiftKey);
        state.isDragging = true;
        state.dragStart = {x:pt.x,y:pt.y};
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

function handleDragMove(pt) {
    const dx = pt.x - state.dragStart.x, dy = pt.y - state.dragStart.y;
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj || !state.dragObjProps[id]) continue;
        applyMove(obj, state.dragObjProps[id], dx, dy);
        refreshElement(obj);
    }
    drawSelection();
}

function snapshotPos(obj) {
    switch (obj.type) {
        case 'rect':    return {x:obj.x,y:obj.y};
        case 'ellipse': return {cx:obj.cx,cy:obj.cy};
        case 'line':    return {x1:obj.x1,y1:obj.y1,x2:obj.x2,y2:obj.y2};
        case 'bspline': return {points:obj.points.map(p=>({...p}))};
        case 'group': {
            const snaps = {};
            for (const c of obj.children) snaps[c.id] = snapshotPos(c);
            return {children: snaps};
        }
    }
}

function applyMove(obj, snap, dx, dy) {
    switch (obj.type) {
        case 'rect':    obj.x = snap.x+dx; obj.y = snap.y+dy; break;
        case 'ellipse': obj.cx = snap.cx+dx; obj.cy = snap.cy+dy; break;
        case 'line':    obj.x1=snap.x1+dx;obj.y1=snap.y1+dy;obj.x2=snap.x2+dx;obj.y2=snap.y2+dy; break;
        case 'bspline': obj.points = snap.points.map(p=>({x:p.x+dx,y:p.y+dy})); break;
        case 'group':
            for (const c of obj.children) {
                if (snap.children[c.id]) applyMove(c, snap.children[c.id], dx, dy);
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

// =============================================
// GROUP / UNGROUP
// =============================================
function groupSelected() {
    if (state.selectedIds.length < 2) return;
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
    }
}

// =============================================
// SVG EXPORT
// =============================================
function exportSVG() {
    const ns = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(ns, 'svg');
    root.setAttribute('xmlns', ns);
    root.setAttribute('width', state.pageWidth); root.setAttribute('height', state.pageHeight);
    root.setAttribute('viewBox', `0 0 ${state.pageWidth} ${state.pageHeight}`);
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', state.pageWidth); bg.setAttribute('height', state.pageHeight); bg.setAttribute('fill', '#ffffff');
    root.appendChild(bg);
    for (const obj of state.objects) {
        const clone = obj.element.cloneNode(true);
        clone.removeAttribute('data-object-id'); clone.removeAttribute('style');
        root.appendChild(clone);
    }
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
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
    document.getElementById('page-width-input').value = state.pageWidth;
    document.getElementById('page-height-input').value = state.pageHeight;
    document.getElementById('page-preset').value = 'custom';
    document.getElementById('page-size-modal').classList.remove('hidden');
}
function hidePageSizeModal() { document.getElementById('page-size-modal').classList.add('hidden'); }
function setupPageSizeModal() {
    document.getElementById('page-preset').addEventListener('change', (e) => {
        const p = PAGE_PRESETS[e.target.value];
        if (p) { document.getElementById('page-width-input').value = p.w; document.getElementById('page-height-input').value = p.h; }
    });
    const modal = document.getElementById('page-size-modal');
    modal.querySelector('[data-action="cancel"]').addEventListener('click', hidePageSizeModal);
    modal.querySelector('[data-action="apply"]').addEventListener('click', () => {
        const w = parseInt(document.getElementById('page-width-input').value);
        const h = parseInt(document.getElementById('page-height-input').value);
        if (w > 0 && h > 0) { state.pageWidth = w; state.pageHeight = h; updatePage(); resetView(); }
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
    const newW = state.viewBox.w * factor, newH = state.viewBox.h * factor;
    if (newW < 10 || newW > 50000) return;
    state.viewBox.x = pt.x - (pt.x - state.viewBox.x) * factor;
    state.viewBox.y = pt.y - (pt.y - state.viewBox.y) * factor;
    state.viewBox.w = newW; state.viewBox.h = newH;
    updateViewBox();
    if (state.selectedIds.length) drawSelection();
}

// =============================================
// UNITS & PROPERTIES PANEL
// =============================================
function toUnit(px) { return +(px * UNITS[state.unit].factor).toFixed(UNITS[state.unit].dec); }
function fromUnit(val) { return val / UNITS[state.unit].factor; }

function updatePropsPanel() {
    const panel = document.getElementById('props-panel');
    const pid = primaryId();
    if (!pid) { panel.classList.add('hidden'); return; }
    const obj = findObject(pid);
    if (!obj) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const b = getObjBounds(obj);
    document.getElementById('prop-x').value = toUnit(b.x);
    document.getElementById('prop-y').value = toUnit(b.y);
    document.getElementById('prop-w').value = toUnit(b.w);
    document.getElementById('prop-h').value = toUnit(b.h);
    document.getElementById('prop-rotation').value = Math.round(obj.rotation || 0);
    document.getElementById('props-unit-label').textContent = state.unit;
}

function applyPropPosition(obj, newXu, newYu) {
    const newX = fromUnit(newXu), newY = fromUnit(newYu);
    const b = getObjBounds(obj);
    const dx = newX - b.x, dy = newY - b.y;
    switch (obj.type) {
        case 'rect':    obj.x+=dx;obj.y+=dy; break;
        case 'ellipse': obj.cx+=dx;obj.cy+=dy; break;
        case 'line':    obj.x1+=dx;obj.y1+=dy;obj.x2+=dx;obj.y2+=dy; break;
        case 'bspline': obj.points=obj.points.map(p=>({x:p.x+dx,y:p.y+dy})); break;
        case 'group':   for(const c of obj.children) { const cb=getObjBounds(c); applyPropPosition(c,toUnit(cb.x+dx),toUnit(cb.y+dy)); } break;
    }
}

function applyPropSize(obj, newWpx, newHpx) {
    const b = getObjBounds(obj);
    if (b.w < 0.01 || b.h < 0.01) return;
    const sx = newWpx / b.w, sy = newHpx / b.h;
    switch (obj.type) {
        case 'rect': obj.width=newWpx; obj.height=newHpx; break;
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
        applyPropPosition(obj, parseFloat(propX.value), parseFloat(propY.value));
        refreshElement(obj); selectObject(obj.id);
    };
    propX.addEventListener('change', applyPos);
    propY.addEventListener('change', applyPos);

    propW.addEventListener('change', () => {
        const obj = findObject(primaryId()); if (!obj) return;
        const b = getObjBounds(obj);
        let newW = fromUnit(parseFloat(propW.value)), newH = b.h;
        if (newW < 0.1) newW = 0.1;
        if (state.lockAspect && b.w > 0.01) newH = newW * (b.h / b.w);
        applyPropSize(obj, newW, newH); refreshElement(obj); selectObject(obj.id);
    });

    propH.addEventListener('change', () => {
        const obj = findObject(primaryId()); if (!obj) return;
        const b = getObjBounds(obj);
        let newH = fromUnit(parseFloat(propH.value)), newW = b.w;
        if (newH < 0.1) newH = 0.1;
        if (state.lockAspect && b.h > 0.01) newW = newH * (b.w / b.h);
        applyPropSize(obj, newW, newH); refreshElement(obj); selectObject(obj.id);
    });

    propRot.addEventListener('change', () => {
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
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('dblclick', () => { if (state.tool === 'bspline') handleBSplineDblClick(); });

    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    document.getElementById('stroke-width').addEventListener('change', (e) => {
        state.strokeWidth = parseFloat(e.target.value) || 1;
        for (const id of state.selectedIds) {
            const obj = findObject(id); if (obj) { obj.strokeWidth = state.strokeWidth; refreshElement(obj); }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        // Group/Ungroup shortcuts
        if (e.key.toLowerCase() === 'u' && e.ctrlKey) { e.preventDefault(); ungroupSelected(); return; }
        if (e.key.toLowerCase() === 'g' && e.ctrlKey) { e.preventDefault(); groupSelected(); return; }
        switch (e.key.toLowerCase()) {
            case 'v': setTool('select'); break;
            case 'r': setTool('rect'); break;
            case 'e': setTool('ellipse'); break;
            case 'l': setTool('line'); break;
            case 'b': setTool('bspline'); break;
            case 'delete': case 'backspace':
                for (const id of [...state.selectedIds]) deleteObject(id);
                updatePropsPanel(); break;
            case 'escape':
                if (state.tool === 'bspline' && state.bsplinePoints.length > 0) { state.bsplinePoints=[]; clearPreview(); }
                else selectObject(null);
                break;
            case ' ':
                e.preventDefault(); state.spaceHeld = true; svg.style.cursor = 'grab'; break;
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === ' ') { state.spaceHeld = false; svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; }
    });

    window.addEventListener('resize', () => resetView());
    setupMenus();
    setupPageSizeModal();
    setupPropsPanel();
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
document.addEventListener('DOMContentLoaded', () => { initTheme(); init(); });
