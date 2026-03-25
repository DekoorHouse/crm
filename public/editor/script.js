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
    mm: { factor: 25.4 / 96, dec: 1 },
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
    vsdelete: 'Eliminar Segmento Virtual',
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
    fillColor: 'none',
    strokeColor: '#000000',
    strokeWidth: 2,

    pageWidth: Math.round(350 * 96 / 25.4),
    pageHeight: Math.round(330 * 96 / 25.4),

    objects: [],
    nextId: 1,
    selectedIds: [],

    isDrawing: false,
    drawStart: null,

    bsplinePoints: [],

    viewBox: { x: 0, y: 0, w: 1000, h: 800 },
    isPanning: false,
    rightClickPanning: false,
    panStart: null,
    panViewBoxStart: null,

    isDragging: false,
    dragStart: null,
    dragObjProps: null,

    previewElement: null,
    spaceHeld: false,
    wHeld: false,

    unit: 'mm',
    lockAspect: true,

    fontFamily: 'Inter',
    fontSize: 32,
    textAlign: 'left',
    isTyping: false,
    typingObj: null,

    isResizing: false,
    resizeHandle: null, // 'nw','ne','sw','se'
    resizeStart: null,
    resizeObjBounds: null,
    resizeObjId: null,

    isMarquee: false,
    marqueeStart: null,
    marqueeEl: null,

    // Node editing mode
    nodeEditId: null,       // ID of the object being node-edited
    nodeEditDragging: false,
    nodeEditIdx: -1,        // index of the node being dragged
    nodeEditStart: null,    // {x,y} start point of drag
    nodeEditOrigPts: null,  // original points snapshot
};

// Undo/Redo
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

// =============================================
// FILE MANAGEMENT STATE
// =============================================
let currentFileId = null;
let currentFileName = null;
let _autoSaveTimer = null;
let _isDirty = false;
let _isSaving = false;

// =============================================
// TAB SYSTEM
// =============================================
const editorTabs = []; // { id, name, fileId, stateSnapshot, undoStack, redoStack, pageWidth, pageHeight, isDirty }
let activeTabId = null;
let _nextTabId = 1;

function createTab(name, fileId) {
    const tab = {
        id: _nextTabId++,
        name: name || 'Sin t\u00edtulo',
        fileId: fileId || null,
        stateSnapshot: null,
        undoStack: [],
        redoStack: [],
        pageWidth: state.pageWidth,
        pageHeight: state.pageHeight,
        isDirty: false,
    };
    editorTabs.push(tab);
    renderTabs();
    switchToTab(tab.id);
    return tab;
}

function saveCurrentTabState() {
    const tab = editorTabs.find(t => t.id === activeTabId);
    if (!tab) return;
    tab.stateSnapshot = JSON.stringify({
        objects: state.objects.map(serializeObj),
        nextId: state.nextId,
        selectedIds: [],
    });
    tab.undoStack = [...undoStack];
    tab.redoStack = [...redoStack];
    tab.pageWidth = state.pageWidth;
    tab.pageHeight = state.pageHeight;
    tab.fileId = currentFileId;
    tab.name = currentFileName || tab.name;
    tab.isDirty = _isDirty;
}

function switchToTab(tabId) {
    if (activeTabId === tabId) return;
    // Save current tab state
    if (activeTabId) saveCurrentTabState();
    const tab = editorTabs.find(t => t.id === tabId);
    if (!tab) return;
    activeTabId = tabId;

    // Restore tab state
    if (tab.stateSnapshot) {
        restoreSnapshot(tab.stateSnapshot);
    } else {
        // New empty tab
        objectsLayer.innerHTML = '';
        selectionLayer.innerHTML = '';
        state.objects = [];
        state.selectedIds = [];
        state.nextId = 1;
    }
    state.pageWidth = tab.pageWidth;
    state.pageHeight = tab.pageHeight;
    undoStack.length = 0; undoStack.push(...tab.undoStack);
    redoStack.length = 0; redoStack.push(...tab.redoStack);
    currentFileId = tab.fileId;
    currentFileName = tab.fileId ? tab.name : null;
    _isDirty = tab.isDirty;
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }

    updatePage();
    resetView();
    updateFileNameDisplay();
    drawSelection();
    updatePropsPanel();
    renderTabs();
}

function closeTab(tabId) {
    const idx = editorTabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    const tab = editorTabs[idx];
    if (tab.isDirty && !confirm('\u00bfCerrar "' + tab.name + '" sin guardar?')) return;
    editorTabs.splice(idx, 1);
    if (editorTabs.length === 0) {
        createTab();
        return;
    }
    if (activeTabId === tabId) {
        const newIdx = Math.min(idx, editorTabs.length - 1);
        activeTabId = null; // force switch
        switchToTab(editorTabs[newIdx].id);
    }
    renderTabs();
}

function renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    const tabList = document.getElementById('tab-list');
    tabBar.classList.toggle('visible', editorTabs.length >= 1);
    tabList.innerHTML = '';
    for (const tab of editorTabs) {
        const el = document.createElement('div');
        el.className = 'editor-tab' + (tab.id === activeTabId ? ' active' : '') + (tab.isDirty ? ' dirty' : '');
        el.innerHTML =
            '<span class="editor-tab-dot"></span>' +
            '<span class="editor-tab-name">' + escapeHtml(tab.name) + '</span>' +
            '<button class="editor-tab-close" title="Cerrar">\u00d7</button>';
        el.querySelector('.editor-tab-name').addEventListener('click', () => switchToTab(tab.id));
        el.querySelector('.editor-tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
        tabList.appendChild(el);
    }
}

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
    if (_batchImporting) return; // Skip during batch operations (import, AI actions)
    const snapshot = {
        objects: state.objects.map(serializeObj),
        nextId: state.nextId,
        selectedIds: [...state.selectedIds],
    };
    const json = JSON.stringify(snapshot);
    // Skip if identical to the last saved state
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === json) return;
    undoStack.push(json);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0; // clear redo on new action
    markDirty();
    if (typeof vsDeleteInvalidateCache === 'function') vsDeleteInvalidateCache();
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
        if (obj.isRefArea) applyRefAreaStyle(obj);
        state.objects.push(obj);
    }
    state.nextId = snapshot.nextId;
    state.selectedIds = snapshot.selectedIds;
    drawSelection();
    updatePropsPanel();
    if (typeof vsDeleteInvalidateCache === 'function') vsDeleteInvalidateCache();
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

    // Initialize first tab
    const firstTab = { id: _nextTabId++, name: 'Sin t\u00edtulo', fileId: null, stateSnapshot: null, undoStack: [], redoStack: [], pageWidth: state.pageWidth, pageHeight: state.pageHeight, isDirty: false };
    editorTabs.push(firstTab);
    activeTabId = firstTab.id;
    renderTabs();
}

// =============================================
// PAGE MANAGEMENT
// =============================================
function updatePage() {
    pageRect.setAttribute('x', 0);
    pageRect.setAttribute('y', 0);
    pageRect.setAttribute('width', state.pageWidth);
    pageRect.setAttribute('height', state.pageHeight);
    // Position shadow rects behind the page
    const s1 = document.getElementById('page-shadow-1');
    const s2 = document.getElementById('page-shadow-2');
    if (s1) { s1.setAttribute('x', 2); s1.setAttribute('y', 4); s1.setAttribute('width', state.pageWidth); s1.setAttribute('height', state.pageHeight); }
    if (s2) { s2.setAttribute('x', 4); s2.setAttribute('y', 10); s2.setAttribute('width', state.pageWidth + 2); s2.setAttribute('height', state.pageHeight + 2); }
    document.getElementById('status-page').textContent =
        `${toUnit(state.pageWidth)} × ${toUnit(state.pageHeight)} ${state.unit}`;
}

function resetView() {
    const margin = 60;
    const ws = document.getElementById('canvas-wrapper') || document.getElementById('workspace');
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

// Cached layout values — updated on zoom/resize instead of every frame
let _cachedSvgRect = null;
let _cachedScreenScale = 1;
let _cachedCTMInverse = null;
let _statusCoordsEl = null;

function invalidateLayoutCache() {
    _cachedSvgRect = svg.getBoundingClientRect();
    _cachedScreenScale = state.viewBox.w / (_cachedSvgRect.width || 1);
    _cachedCTMInverse = null; // recomputed lazily in screenToSVG
}

function updateViewBox() {
    svg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
    invalidateLayoutCache();
    if (_cachedSvgRect.width > 0) {
        const zoom = Math.round((_cachedSvgRect.width / state.viewBox.w) * 100);
        document.getElementById('status-zoom').textContent = `${zoom}%`;
    }
}

// =============================================
// COORDINATE CONVERSION
// =============================================
function screenToSVG(clientX, clientY) {
    if (!_cachedCTMInverse) _cachedCTMInverse = svg.getScreenCTM().inverse();
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(_cachedCTMInverse);
}

// =============================================
// OBJECT MANAGEMENT
// =============================================
let _batchImporting = false;
function createObject(type, props) {
    if (!_batchImporting) saveUndoState();
    const obj = {
        id: state.nextId++,
        type,
        fill: type === 'text' ? (state.fillColor === 'none' ? '#000000' : state.fillColor)
            : (type === 'line' || type === 'bspline') ? 'none' : state.fillColor,
        stroke: type === 'text' ? 'none' : state.strokeColor,
        strokeWidth: type === 'text' ? 0 : state.strokeWidth,
        rotation: 0,
        ...props,
    };
    if (type === 'group' || type === 'image' || type === 'powerclip') { obj.fill = 'none'; obj.stroke = 'none'; obj.strokeWidth = 0; }
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
            elem.setAttribute('d', bsplineToPath(obj.points, obj.closed));
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
            const anchor = obj.textAlign === 'center' ? 'middle' : obj.textAlign === 'right' ? 'end' : 'start';
            elem.setAttribute('text-anchor', anchor);
            elem.textContent = obj.text || '';
            break;
        }
        case 'curvepath': {
            elem = document.createElementNS(ns, 'path');
            elem.setAttribute('d', obj.d);
            elem.setAttribute('fill', obj.fill);
            if (obj.fillRule) elem.setAttribute('fill-rule', obj.fillRule);
            elem.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
            elem.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth);
            // Apply transform for position/scale/flip
            if (obj._origBounds) {
                const orig = obj._origBounds;
                const sx = obj.width / orig.w, sy = obj.height / orig.h;
                const tx = obj.x - orig.x * sx, ty = obj.y - orig.y * sy;
                let t = `translate(${tx}, ${ty}) scale(${sx}, ${sy})`;
                if (obj.rotation) {
                    const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
                    t = `rotate(${obj.rotation} ${cx} ${cy}) ` + t;
                }
                if (obj.flipX || obj.flipY) {
                    const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
                    const fsx = obj.flipX ? -1 : 1, fsy = obj.flipY ? -1 : 1;
                    t = `translate(${cx} ${cy}) scale(${fsx} ${fsy}) translate(${-cx} ${-cy}) ` + t;
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
                if (child.isRefArea) applyRefAreaStyle(child);
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
            // 1) Container FILL (background, behind everything)
            const fillElem = buildClipShape(obj.container, ns);
            fillElem.setAttribute('fill', obj.container.fill || 'none');
            fillElem.setAttribute('stroke', 'none');
            fillElem.setAttribute('pointer-events', 'none');
            elem.appendChild(fillElem);
            // 2) Clipped content group (on top of fill)
            const contentGroup = document.createElementNS(ns, 'g');
            contentGroup.setAttribute('clip-path', `url(#${clipId})`);
            for (const content of obj.contents) {
                const ce = buildSVGElement(content);
                content.element = ce;
                ce.dataset.objectId = obj.id;
                contentGroup.appendChild(ce);
            }
            elem.appendChild(contentGroup);
            // 3) Container STROKE only (border, on top of contents)
            const containerElem = buildSVGElement(obj.container);
            obj.container.element = containerElem;
            containerElem.dataset.objectId = obj.id;
            containerElem.setAttribute('fill', 'none'); // fill already rendered behind
            elem.appendChild(containerElem);
            // If empty, show crosshatch fill clipped to container
            if (obj.contents.length === 0) {
                const hatch = buildClipShape(obj.container, ns);
                hatch.setAttribute('fill', `url(#${patId})`);
                hatch.setAttribute('stroke', 'none');
                hatch.setAttribute('pointer-events', 'none');
                elem.appendChild(hatch);
            }
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
    // Build the exact same element as the container and clone it for the clip
    const tempElem = buildSVGElement(container);
    const shape = tempElem.cloneNode(true);
    shape.removeAttribute('data-object-id');
    shape.removeAttribute('style');
    return shape;
}

function applyRotation(obj, elem) {
    if (!elem) elem = obj.element;
    const hasRotation = obj.rotation && obj.rotation !== 0;
    const hasFlip = obj.flipX || obj.flipY;
    if (hasRotation || hasFlip) {
        const b = getObjBounds(obj);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        let t = '';
        if (hasRotation) t += `rotate(${obj.rotation} ${cx} ${cy}) `;
        if (hasFlip) {
            const sx = obj.flipX ? -1 : 1;
            const sy = obj.flipY ? -1 : 1;
            t += `translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`;
        }
        elem.setAttribute('transform', t.trim());
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
            elem.setAttribute('d', bsplineToPath(obj.points, obj.closed));
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
            const anchor = obj.textAlign === 'center' ? 'middle' : obj.textAlign === 'right' ? 'end' : 'start';
            elem.setAttribute('text-anchor', anchor);
            elem.textContent = obj.text || '';
            break;
        }
        case 'curvepath': {
            const orig = obj._origBounds;
            if (!orig) break; // safety
            elem.setAttribute('d', obj.d); // update path data (may change during node editing)
            const sx = obj.width / orig.w;
            const sy = obj.height / orig.h;
            // translate so the scaled path lands at obj.x, obj.y
            const tx = obj.x - orig.x * sx;
            const ty = obj.y - orig.y * sy;
            let t = `translate(${tx}, ${ty}) scale(${sx}, ${sy})`;
            if (obj.rotation) {
                const cpx = obj.x + obj.width/2, cpy = obj.y + obj.height/2;
                t = `rotate(${obj.rotation} ${cpx} ${cpy}) ` + t;
            }
            if (obj.flipX || obj.flipY) {
                const cpx = obj.x + obj.width/2, cpy = obj.y + obj.height/2;
                const fsx = obj.flipX ? -1 : 1, fsy = obj.flipY ? -1 : 1;
                t = `translate(${cpx} ${cpy}) scale(${fsx} ${fsy}) translate(${-cpx} ${-cpy}) ` + t;
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
    if (obj.isRefArea) applyRefAreaStyle(obj);
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
    // Hide powerclip menu if the deleted object was selected
    updatePowerClipMenu();
}

function findObject(id) { return state.objects.find(o => o.id === id); }
function findObjectDeep(id) {
    function search(list) {
        for (const o of list) {
            if (o.id === id) return o;
            if (o.type === 'group' && o.children) { const f = search(o.children); if (f) return f; }
            if (o.type === 'powerclip') {
                if (o.container && o.container.id === id) return o.container;
                if (o.contents) { const f = search(o.contents); if (f) return f; }
            }
        }
        return null;
    }
    return search(state.objects);
}

function objectAtPoint(pt) {
    // In powerclip edit mode, only content objects are selectable
    if (pcEditingId) {
        const pc = findObject(pcEditingId);
        if (pc && pc._editContentIds) {
            for (let i = state.objects.length - 1; i >= 0; i--) {
                const obj = state.objects[i];
                if (pc._editContentIds.includes(obj.id) && hitTest(obj, pt)) return obj;
            }
        }
        return null;
    }
    // Find all objects at point, prefer the smallest one (so small objects
    // aren't hidden behind large PowerClips or overlapping shapes)
    let best = null, bestArea = Infinity;
    for (let i = state.objects.length - 1; i >= 0; i--) {
        if (hitTest(state.objects[i], pt)) {
            const b = getObjBounds(state.objects[i]);
            const area = b.w * b.h;
            if (area < bestArea) { best = state.objects[i]; bestArea = area; }
        }
    }
    return best;
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
            const samples = sampleBSplineAll(obj.points, 80, obj.closed);
            // If closed, use point-in-polygon test (selectable by clicking inside)
            if (obj.closed) {
                let inside = false;
                for (let i = 0, j = samples.length - 1; i < samples.length; j = i++) {
                    const xi = samples[i].x, yi = samples[i].y;
                    const xj = samples[j].x, yj = samples[j].y;
                    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi))
                        inside = !inside;
                }
                if (inside) return true;
            }
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
        // Don't call exitPowerClipEdit here to avoid recursion — it calls selectObject internally
        // pcEditingId will be cleared by Escape or the "Listo" button
    } else if (id !== null) {
        if (addToSelection) {
            if (isSelected(id)) state.selectedIds = state.selectedIds.filter(i => i !== id);
            else state.selectedIds.push(id);
        } else {
            state.selectedIds = [id];
        }
        const obj = findObject(id);
        // Don't clear pcEditingId when selecting content objects of the PC being edited
        if (pcEditingId) {
            const pc = findObject(pcEditingId);
            const isEditContent = pc && pc._editContentIds && pc._editContentIds.includes(id);
            if (!isEditContent && (!obj || obj.type !== 'powerclip' || obj.id !== pcEditingId)) {
                exitPowerClipEdit();
            }
        }
    }
    drawSelection();
    updatePropsPanel();
    updatePowerClipMenu();
}

function drawSelection() {
    selectionLayer.innerHTML = '';
    if (state.nodeEditId) { drawNodeEdit(); return; }
    if (state.selectedIds.length === 0) return;
    const ns = 'http://www.w3.org/2000/svg';
    const sw = state.viewBox.w * 0.0015;
    const hs = state.viewBox.w * 0.007;
    const off = hs * 0.8;
    const ms = hs * 0.8;

    // Compute combined bounding box for all selected objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;
        // Use container bounds for PowerClips (getBBox ignores clip-path
        // and would include invisible overflow content, causing offset frames)
        const b = getObjBounds(obj);
        // For rotated objects, use the rotated corners for the combined bbox
        const rot = obj.rotation || 0;
        const cx = b.x + b.w/2, cy = b.y + b.h/2;
        const pts = [
            rotatePoint(b.x, b.y, cx, cy, rot),
            rotatePoint(b.x+b.w, b.y, cx, cy, rot),
            rotatePoint(b.x, b.y+b.h, cx, cy, rot),
            rotatePoint(b.x+b.w, b.y+b.h, cx, cy, rot),
        ];
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }
    const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

    // For a single object with rotation, draw the rotated bounding box
    if (state.selectedIds.length === 1) {
        const obj = findObject(state.selectedIds[0]);
        if (obj) {
            const ob = getObjBounds(obj);
            const g = document.createElementNS(ns, 'g');
            g.setAttribute('pointer-events', 'none');
            if (obj.rotation) {
                const rcx = ob.x + ob.w/2, rcy = ob.y + ob.h/2;
                g.setAttribute('transform', `rotate(${obj.rotation} ${rcx} ${rcy})`);
            }
            // Dashed box
            const r = document.createElementNS(ns, 'rect');
            r.setAttribute('x', ob.x); r.setAttribute('y', ob.y);
            r.setAttribute('width', ob.w); r.setAttribute('height', ob.h);
            r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#7c5cf0');
            r.setAttribute('stroke-width', sw);
            r.setAttribute('stroke-dasharray', `${sw*4} ${sw*2}`);
            r.setAttribute('pointer-events', 'none');
            g.appendChild(r);
            // Corner handles
            const corners = [
                [ob.x - off, ob.y - off], [ob.x + ob.w + off, ob.y - off],
                [ob.x - off, ob.y + ob.h + off], [ob.x + ob.w + off, ob.y + ob.h + off],
            ];
            for (const [cx, cy] of corners) {
                const h = document.createElementNS(ns, 'rect');
                h.setAttribute('x', cx - hs/2); h.setAttribute('y', cy - hs/2);
                h.setAttribute('width', hs); h.setAttribute('height', hs);
                h.setAttribute('fill', '#fff'); h.setAttribute('stroke', '#7c5cf0');
                h.setAttribute('stroke-width', sw); h.setAttribute('pointer-events', 'none');
                g.appendChild(h);
            }
            // Midpoint handles
            const mids = [
                [ob.x + ob.w/2, ob.y - off], [ob.x + ob.w/2, ob.y + ob.h + off],
                [ob.x - off, ob.y + ob.h/2], [ob.x + ob.w + off, ob.y + ob.h/2],
            ];
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
            return;
        }
    }

    // Multiple objects: one combined dashed box + handles
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('pointer-events', 'none');
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', bounds.x); r.setAttribute('y', bounds.y);
    r.setAttribute('width', bounds.w); r.setAttribute('height', bounds.h);
    r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#7c5cf0');
    r.setAttribute('stroke-width', sw);
    r.setAttribute('stroke-dasharray', `${sw*4} ${sw*2}`);
    r.setAttribute('pointer-events', 'none');
    g.appendChild(r);
    const corners = [
        [bounds.x - off, bounds.y - off], [bounds.x + bounds.w + off, bounds.y - off],
        [bounds.x - off, bounds.y + bounds.h + off], [bounds.x + bounds.w + off, bounds.y + bounds.h + off],
    ];
    for (const [cx, cy] of corners) {
        const h = document.createElementNS(ns, 'rect');
        h.setAttribute('x', cx - hs/2); h.setAttribute('y', cy - hs/2);
        h.setAttribute('width', hs); h.setAttribute('height', hs);
        h.setAttribute('fill', '#fff'); h.setAttribute('stroke', '#7c5cf0');
        h.setAttribute('stroke-width', sw); h.setAttribute('pointer-events', 'none');
        g.appendChild(h);
    }
    const mids = [
        [bounds.x + bounds.w/2, bounds.y - off], [bounds.x + bounds.w/2, bounds.y + bounds.h + off],
        [bounds.x - off, bounds.y + bounds.h/2], [bounds.x + bounds.w + off, bounds.y + bounds.h/2],
    ];
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
}

function getObjBounds(obj) {
    switch (obj.type) {
        case 'rect': case 'image': case 'curvepath': return { x: obj.x, y: obj.y, w: obj.width, h: obj.height };
        case 'ellipse': return { x: obj.cx - obj.rx, y: obj.cy - obj.ry, w: obj.rx*2, h: obj.ry*2 };
        case 'line': {
            const x = Math.min(obj.x1, obj.x2), y = Math.min(obj.y1, obj.y2);
            return { x, y, w: Math.abs(obj.x2-obj.x1), h: Math.abs(obj.y2-obj.y1) };
        }
        case 'bspline': {
            if (!obj.points.length) return {x:0,y:0,w:0,h:0};
            const pts = sampleBSplineAll(obj.points, 80, obj.closed);
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
        default:
            return { x: 0, y: 0, w: 0, h: 0 };
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
    if (obj.type === 'curvepath') {
        // Only path nodes — no bounding box corners/edges
        const nodePts = getEditableNodes(obj);
        for (const np of nodePts) {
            const rp = rotatePoint(np.x, np.y, cx, cy, rot);
            pts.push({...rp, type: 'node'});
        }
    } else if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'text') {
        // Corners
        const rawCorners = [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}];
        for (const c of rawCorners) { const rp = rotatePoint(c.x,c.y,cx,cy,rot); pts.push({...rp,type:'corner'}); }
        // Edge midpoints
        const rawEdges = [{x:b.x+b.w/2,y:b.y},{x:b.x+b.w/2,y:b.y+b.h},{x:b.x,y:b.y+b.h/2},{x:b.x+b.w,y:b.y+b.h/2}];
        for (const e of rawEdges) { const rp = rotatePoint(e.x,e.y,cx,cy,rot); pts.push({...rp,type:'edge'}); }
    } else if (obj.type === 'group') {
        // Group bounding box snap points
        const rawCorners = [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}];
        for (const c of rawCorners) pts.push({...c, type:'corner'});
        const rawEdges = [{x:b.x+b.w/2,y:b.y},{x:b.x+b.w/2,y:b.y+b.h},{x:b.x,y:b.y+b.h/2},{x:b.x+b.w,y:b.y+b.h/2}];
        for (const e of rawEdges) pts.push({...e, type:'edge'});
        // Also add snap points from each child
        for (const child of obj.children) {
            const childPts = getSnapPoints(child);
            pts.push(...childPts);
        }
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

    if (obj.type === 'curvepath') {
        // Sample the actual path geometry for edge snapping
        const elem = obj.element;
        if (elem && typeof elem.getTotalLength === 'function') {
            try {
                const len = elem.getTotalLength();
                if (len > 0.01) {
                    const ctm = elem.getCTM();
                    const svgCTM = svg.getCTM();
                    if (ctm && svgCTM) {
                        const inv = svgCTM.inverse();
                        const rel = inv.multiply(ctm);
                        const steps = Math.min(120, Math.max(60, Math.ceil(len / 4)));
                        const samples = [];
                        for (let i = 0; i <= steps; i++) {
                            const p = elem.getPointAtLength((i / steps) * len);
                            samples.push({ x: rel.a * p.x + rel.c * p.y + rel.e, y: rel.b * p.x + rel.d * p.y + rel.f });
                        }
                        let best = null, bestD = Infinity;
                        for (let i = 0; i < samples.length - 1; i++) {
                            const p = closestPointOnSeg(pt, samples[i], samples[i+1]);
                            const d = Math.hypot(pt.x - p.x, pt.y - p.y);
                            if (d < bestD) { bestD = d; best = p; }
                        }
                        if (best) return { point: best, dist: bestD };
                    }
                }
            } catch(e) { /* fall through to bounding box */ }
        }
        // Fallback: bounding box edges
        const edges = [
            [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y}],
            [{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h}],
            [{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}],
            [{x:b.x,y:b.y+b.h},{x:b.x,y:b.y}],
        ];
        let best2 = null, bestD2 = Infinity;
        for (const [a, b2] of edges) {
            const p = closestPointOnSeg(localPt, a, b2);
            const d = Math.hypot(localPt.x - p.x, localPt.y - p.y);
            if (d < bestD2) { bestD2 = d; best2 = p; }
        }
        const rp2 = rotatePoint(best2.x, best2.y, ccx, ccy, rot);
        return { point: rp2, dist: bestD2 };
    } else if (obj.type === 'rect' || obj.type === 'group' || obj.type === 'image' || obj.type === 'text') {
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
    const ns = 'http://www.w3.org/2000/svg';
    const screenScale = _cachedScreenScale;
    const threshold = SNAP_DIST * screenScale;
    const edgeThreshold = threshold * 1.5;
    const r = 4.5 * screenScale;

    // Collect all candidate snap points, keep only the closest one
    let bestSnap = null, bestDist = Infinity;

    for (const obj of state.objects) {
        const b = getObjBounds(obj);
        const margin = edgeThreshold;
        if (mousePt.x < b.x - margin || mousePt.x > b.x + b.w + margin ||
            mousePt.y < b.y - margin || mousePt.y > b.y + b.h + margin) continue;

        // Fixed snap points (center, corners, quadrants, edges, endpoints, nodes)
        for (const sp of getSnapPoints(obj)) {
            const d = Math.hypot(mousePt.x - sp.x, mousePt.y - sp.y);
            if (d < bestDist && d <= threshold) { bestDist = d; bestSnap = sp; }
        }

        // Dynamic nearest-edge point (skip if a fixed node snap already won)
        if (!bestSnap || bestSnap.type !== 'node') {
            const ne = nearestEdgePoint(obj, mousePt);
            if (ne && ne.dist < bestDist && ne.dist <= edgeThreshold) {
                bestDist = ne.dist;
                bestSnap = { x: ne.point.x, y: ne.point.y, type: 'edge-dynamic' };
            }
        }
    }

    // Page snap points
    const pagePts = [
        {x:0,y:0,type:'corner'},{x:state.pageWidth,y:0,type:'corner'},
        {x:0,y:state.pageHeight,type:'corner'},{x:state.pageWidth,y:state.pageHeight,type:'corner'},
        {x:state.pageWidth/2,y:state.pageHeight/2,type:'center'},
        {x:state.pageWidth/2,y:0,type:'edge'},{x:state.pageWidth/2,y:state.pageHeight,type:'edge'},
        {x:0,y:state.pageHeight/2,type:'edge'},{x:state.pageWidth,y:state.pageHeight/2,type:'edge'}
    ];
    for (const sp of pagePts) {
        const d = Math.hypot(mousePt.x - sp.x, mousePt.y - sp.y);
        if (d < bestDist && d <= threshold) { bestDist = d; bestSnap = sp; }
    }

    // Draw only the single closest snap
    if (bestSnap) drawSnapMarker(ns, bestSnap, r, screenScale);
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
    } else if (sp.type === 'node') {
        // Diamond marker for path nodes
        const s = r * 1.2;
        const diamond = document.createElementNS(ns, 'polygon');
        diamond.setAttribute('points', `${sp.x},${sp.y-s} ${sp.x+s},${sp.y} ${sp.x},${sp.y+s} ${sp.x-s},${sp.y}`);
        diamond.setAttribute('fill', 'none'); diamond.setAttribute('stroke', color);
        diamond.setAttribute('stroke-width', sw);
        diamond.setAttribute('pointer-events', 'none');
        snapLayer.appendChild(diamond);
        addLabel(sp.x + labelOffset, sp.y + fontSize*0.35, 'nodo');
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
function bsplineToPath(points, closed) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) {
        let d = `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
        if (closed) d += ' Z';
        return d;
    }
    const samples = sampleBSpline(points, Math.max(60, points.length * 20));
    let d = `M ${samples[0].x.toFixed(2)} ${samples[0].y.toFixed(2)}`;
    for (let i = 1; i < samples.length; i++) d += ` L ${samples[i].x.toFixed(2)} ${samples[i].y.toFixed(2)}`;
    if (closed) {
        // Close with a smooth cubic Bezier maintaining C1 tangent continuity
        const cb = bsplineClosingBezier(points);
        if (cb) {
            d += ` C ${cb.cp1.x.toFixed(2)} ${cb.cp1.y.toFixed(2)}, ${cb.cp2.x.toFixed(2)} ${cb.cp2.y.toFixed(2)}, ${cb.p3.x.toFixed(2)} ${cb.p3.y.toFixed(2)}`;
        }
        d += ' Z';
    }
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

// Returns cubic Bezier control points for smoothly closing a clamped B-spline
function bsplineClosingBezier(points) {
    const n = points.length;
    if (n < 3) return null;
    const endPt = points[n - 1];
    const startPt = points[0];
    // Tangent at end: continues direction P_{n-2} → P_{n-1}
    const endDir = { x: endPt.x - points[n - 2].x, y: endPt.y - points[n - 2].y };
    // Tangent at start: approaches P0 from opposite of P0 → P1 direction
    const startDir = { x: startPt.x - points[1].x, y: startPt.y - points[1].y };
    const dist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
    if (dist < 1e-6) return null;
    const endLen = Math.hypot(endDir.x, endDir.y) || 1;
    const startLen = Math.hypot(startDir.x, startDir.y) || 1;
    const k = dist / 3;
    return {
        p0: endPt,
        cp1: { x: endPt.x + k * endDir.x / endLen, y: endPt.y + k * endDir.y / endLen },
        cp2: { x: startPt.x + k * startDir.x / startLen, y: startPt.y + k * startDir.y / startLen },
        p3: startPt,
    };
}

// Returns all sample points of a B-spline including closing segment samples
function sampleBSplineAll(points, numSamples, closed) {
    const samples = sampleBSpline(points, numSamples);
    if (closed && points.length >= 3) {
        const cb = bsplineClosingBezier(points);
        if (cb) {
            const cs = 20;
            for (let i = 1; i <= cs; i++) {
                const t = i / cs, mt = 1 - t;
                samples.push({
                    x: mt*mt*mt*cb.p0.x + 3*mt*mt*t*cb.cp1.x + 3*mt*t*t*cb.cp2.x + t*t*t*cb.p3.x,
                    y: mt*mt*mt*cb.p0.y + 3*mt*mt*t*cb.cp1.y + 3*mt*t*t*cb.cp2.y + t*t*t*cb.p3.y,
                });
            }
        }
    }
    return samples;
}

// =============================================
// SVG PATH D-STRING PARSER (for curvepath node editing)
// =============================================
function parseSVGPath(d) {
    // Returns array of { cmd: 'M'|'L'|'C'|'Q'|'A'|'S'|'T'|'Z', pts: [{x,y},...] }
    // All coordinates are converted to absolute.
    const cmds = [];
    const re = /([MLCQZASTHVmlcqzasthv])\s*([-\d.,eE+\s]*)/g;
    let m;
    let curX = 0, curY = 0, startX = 0, startY = 0;
    while ((m = re.exec(d)) !== null) {
        const origCmd = m[1];
        const isRel = origCmd === origCmd.toLowerCase() && origCmd !== 'z' && origCmd !== 'Z';
        const cmd = origCmd.toUpperCase();
        const raw = m[2].trim();
        const nums = raw.length > 0 ? raw.split(/[\s,]+/).map(Number) : [];
        const pts = [];
        if (cmd === 'Z') {
            curX = startX; curY = startY;
            cmds.push({ cmd: 'Z', pts: [] });
            continue;
        }
        if (cmd === 'H') {
            const x = isRel ? curX + (nums[0] || 0) : (nums[0] || 0);
            curX = x;
            pts.push({ x: curX, y: curY });
            cmds.push({ cmd: 'L', pts });
            continue;
        }
        if (cmd === 'V') {
            const y = isRel ? curY + (nums[0] || 0) : (nums[0] || 0);
            curY = y;
            pts.push({ x: curX, y: curY });
            cmds.push({ cmd: 'L', pts });
            continue;
        }
        if (cmd === 'A') {
            for (let i = 0; i + 6 < nums.length; i += 7) {
                const ex = isRel ? curX + nums[i + 5] : nums[i + 5];
                const ey = isRel ? curY + nums[i + 6] : nums[i + 6];
                pts.push({ x: ex, y: ey });
                curX = ex; curY = ey;
            }
        } else {
            // M, L, C, Q, S, T — pairs of (x, y)
            for (let i = 0; i + 1 < nums.length; i += 2) {
                const ax = isRel ? curX + nums[i] : nums[i];
                const ay = isRel ? curY + nums[i + 1] : nums[i + 1];
                pts.push({ x: ax, y: ay });
                // Update current point at the end of each command's parameter set
                const pairsPerCmd = { M: 2, L: 2, C: 6, Q: 4, S: 4, T: 2 };
                const ppc = (pairsPerCmd[cmd] || 2) / 2; // number of point pairs per command
                if ((i / 2 + 1) % ppc === 0) {
                    curX = ax; curY = ay;
                }
            }
        }
        if (cmd === 'M' && pts.length > 0) { startX = pts[0].x; startY = pts[0].y; }
        cmds.push({ cmd, pts });
    }
    return cmds;
}

function buildSVGPathD(cmds) {
    let d = '';
    for (const seg of cmds) {
        if (seg.cmd === 'Z') { d += 'Z '; continue; }
        d += seg.cmd + ' ';
        for (const p of seg.pts) d += p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ';
    }
    return d.trim();
}

// Extract all editable point references from parsed path commands
// Returns array of { segIdx, ptIdx, x, y } (references into cmds[segIdx].pts[ptIdx])
function extractPathPoints(cmds) {
    const pts = [];
    for (let si = 0; si < cmds.length; si++) {
        const seg = cmds[si];
        const cmd = seg.cmd;
        if (cmd === 'C' && seg.pts.length === 3) {
            // Cubic bezier: only the endpoint (index 2) is on-curve
            pts.push({ segIdx: si, ptIdx: 2, x: seg.pts[2].x, y: seg.pts[2].y });
        } else if (cmd === 'Q' && seg.pts.length === 2) {
            // Quadratic bezier: only the endpoint (index 1) is on-curve
            pts.push({ segIdx: si, ptIdx: 1, x: seg.pts[1].x, y: seg.pts[1].y });
        } else if (cmd === 'S' && seg.pts.length === 2) {
            // Smooth cubic: only the endpoint (index 1) is on-curve
            pts.push({ segIdx: si, ptIdx: 1, x: seg.pts[1].x, y: seg.pts[1].y });
        } else if (cmd === 'T' && seg.pts.length === 1) {
            // Smooth quadratic: the single point is on-curve
            pts.push({ segIdx: si, ptIdx: 0, x: seg.pts[0].x, y: seg.pts[0].y });
        } else if (cmd === 'Z' || cmd === 'z') {
            // Close path: no points
        } else {
            // M, L, H, V, A — all points are on-curve
            for (let pi = 0; pi < seg.pts.length; pi++) {
                pts.push({ segIdx: si, ptIdx: pi, x: seg.pts[pi].x, y: seg.pts[pi].y });
            }
        }
    }
    return pts;
}

// =============================================
// NODE EDITING MODE
// =============================================
// Get world coordinates for curvepath nodes by sampling the rendered SVG element
function getCurvepathWorldPoints(obj) {
    const elem = obj.element;
    if (!elem || typeof elem.getTotalLength !== 'function') return null;
    try {
        const len = elem.getTotalLength();
        if (len < 0.01) return null;
        // Get the element's transform relative to the SVG viewport
        const ctm = elem.getCTM();
        const svgCTM = svg.getCTM();
        if (!ctm || !svgCTM) return null;
        const inv = svgCTM.inverse();
        const rel = inv.multiply(ctm);
        // Sample segment endpoints from the path
        const cmds = parseSVGPath(obj.d);
        const pathPts = extractPathPoints(cmds);
        const worldPts = [];
        for (let i = 0; i < pathPts.length; i++) {
            const pp = pathPts[i];
            // Apply the element's local-to-viewport transform
            const wx = rel.a * pp.x + rel.c * pp.y + rel.e;
            const wy = rel.b * pp.x + rel.d * pp.y + rel.f;
            worldPts.push({ x: wx, y: wy, idx: i, nodeType: 'pathpoint', segIdx: pp.segIdx, ptIdx: pp.ptIdx });
        }
        return worldPts;
    } catch(e) { return null; }
}

function getEditableNodes(obj) {
    const nodes = [];
    switch (obj.type) {
        case 'rect':
            nodes.push({ x: obj.x, y: obj.y, idx: 0, nodeType: 'corner' });                          // TL
            nodes.push({ x: obj.x + obj.width, y: obj.y, idx: 1, nodeType: 'corner' });               // TR
            nodes.push({ x: obj.x, y: obj.y + obj.height, idx: 2, nodeType: 'corner' });              // BL
            nodes.push({ x: obj.x + obj.width, y: obj.y + obj.height, idx: 3, nodeType: 'corner' }); // BR
            break;
        case 'ellipse':
            nodes.push({ x: obj.cx, y: obj.cy - obj.ry, idx: 0, nodeType: 'quadrant' }); // top
            nodes.push({ x: obj.cx + obj.rx, y: obj.cy, idx: 1, nodeType: 'quadrant' }); // right
            nodes.push({ x: obj.cx, y: obj.cy + obj.ry, idx: 2, nodeType: 'quadrant' }); // bottom
            nodes.push({ x: obj.cx - obj.rx, y: obj.cy, idx: 3, nodeType: 'quadrant' }); // left
            break;
        case 'line':
            nodes.push({ x: obj.x1, y: obj.y1, idx: 0, nodeType: 'endpoint' });
            nodes.push({ x: obj.x2, y: obj.y2, idx: 1, nodeType: 'endpoint' });
            break;
        case 'bspline':
            for (let i = 0; i < obj.points.length; i++) {
                nodes.push({ x: obj.points[i].x, y: obj.points[i].y, idx: i, nodeType: 'control' });
            }
            break;
        case 'curvepath': {
            const wpts = getCurvepathWorldPoints(obj);
            if (wpts) { nodes.push(...wpts); break; }
            // Fallback to stored bounds
            if (!obj.d) break;
            const cmds = parseSVGPath(obj.d);
            const pathPts = extractPathPoints(cmds);
            const orig = obj._origBounds;
            if (!orig || orig.w === 0 || orig.h === 0) break;
            const sx = obj.width / orig.w, sy = obj.height / orig.h;
            const ftx = obj.x - orig.x * sx, fty = obj.y - orig.y * sy;
            for (let i = 0; i < pathPts.length; i++) {
                const pp = pathPts[i];
                nodes.push({ x: pp.x * sx + ftx, y: pp.y * sy + fty, idx: i, nodeType: 'pathpoint', segIdx: pp.segIdx, ptIdx: pp.ptIdx });
            }
            break;
        }
        case 'powerclip':
            // Delegate to the container shape
            return getEditableNodes(obj.container);
    }
    return nodes;
}

function enterNodeEdit(objId) {
    state.nodeEditId = objId;
    state.selectedIds = [objId];
    drawSelection();
    updatePropsPanel();
}

function exitNodeEdit() {
    state.nodeEditId = null;
    state.nodeEditDragging = false;
    state.nodeEditIdx = -1;
    state.nodeEditStart = null;
    state.nodeEditOrigPts = null;
    drawSelection();
}

function drawNodeEdit() {
    const obj = findObject(state.nodeEditId);
    if (!obj) return;
    const ns = 'http://www.w3.org/2000/svg';
    const sw = state.viewBox.w * 0.0015;
    const hs = state.viewBox.w * 0.007;
    const nodeR = hs * 0.6;
    const nodes = getEditableNodes(obj);

    // For bspline: draw control polygon
    if (obj.type === 'bspline' && nodes.length > 1) {
        const tag = obj.closed ? 'polygon' : 'polyline';
        const pl = document.createElementNS(ns, tag);
        pl.setAttribute('points', nodes.map(n => `${n.x},${n.y}`).join(' '));
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', '#7c5cf0');
        pl.setAttribute('stroke-width', sw * 0.6);
        pl.setAttribute('stroke-dasharray', `${sw * 3} ${sw * 1.5}`);
        pl.setAttribute('pointer-events', 'none');
        selectionLayer.appendChild(pl);
    }

    // For curvepath: draw control lines for cubic bezier segments
    // (also handles PowerClip containers via delegation below)
    const cpObj = (obj.type === 'powerclip') ? obj.container : (obj.type === 'curvepath' ? obj : null);
    if (cpObj && cpObj.d) {
        const cmds = parseSVGPath(cpObj.d);
        // Get transform from element CTM
        let sx = 1, sy = 1, tx = 0, ty = 0;
        const cpElem = cpObj.element;
        if (cpElem) {
            try {
                const ctm = cpElem.getCTM();
                const svgCTM = svg.getCTM();
                if (ctm && svgCTM) {
                    const inv = svgCTM.inverse();
                    const rel = inv.multiply(ctm);
                    sx = rel.a; sy = rel.d; tx = rel.e; ty = rel.f;
                }
            } catch(e) {}
        }
        if (sx === 1 && sy === 1 && tx === 0 && ty === 0) {
            const orig = cpObj._origBounds;
            if (orig && orig.w > 0 && orig.h > 0) {
                sx = cpObj.width / orig.w; sy = cpObj.height / orig.h;
                tx = cpObj.x - orig.x * sx; ty = cpObj.y - orig.y * sy;
            }
        }
        {
            let lastX = 0, lastY = 0;
            for (const seg of cmds) {
                if (seg.cmd === 'M' && seg.pts.length > 0) {
                    lastX = seg.pts[0].x * sx + tx;
                    lastY = seg.pts[0].y * sy + ty;
                } else if (seg.cmd === 'C' && seg.pts.length === 3) {
                    // Draw lines from previous endpoint to cp1, and cp2 to endpoint
                    const cp1x = seg.pts[0].x * sx + tx, cp1y = seg.pts[0].y * sy + ty;
                    const cp2x = seg.pts[1].x * sx + tx, cp2y = seg.pts[1].y * sy + ty;
                    const epx = seg.pts[2].x * sx + tx, epy = seg.pts[2].y * sy + ty;
                    lastX = epx; lastY = epy;
                } else if (seg.cmd === 'Q' && seg.pts.length === 2) {
                    const epx = seg.pts[1].x * sx + tx, epy = seg.pts[1].y * sy + ty;
                    lastX = epx; lastY = epy;
                } else if (seg.cmd === 'L' && seg.pts.length > 0) {
                    lastX = seg.pts[seg.pts.length - 1].x * sx + tx;
                    lastY = seg.pts[seg.pts.length - 1].y * sy + ty;
                }
            }
        }
    }

    // Draw nodes
    for (const n of nodes) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', n.x);
        c.setAttribute('cy', n.y);
        c.setAttribute('r', nodeR);
        c.setAttribute('fill', '#fff');
        c.setAttribute('stroke', '#7c5cf0');
        c.setAttribute('stroke-width', sw);
        c.setAttribute('pointer-events', 'none');
        selectionLayer.appendChild(c);
    }
}

function nodeAtPoint(pt) {
    const obj = findObject(state.nodeEditId);
    if (!obj) return null;
    const nodes = getEditableNodes(obj);
    const screenScale = _cachedScreenScale;
    const threshold = 8 * screenScale;
    for (const n of nodes) {
        if (Math.hypot(pt.x - n.x, pt.y - n.y) <= threshold) {
            return { idx: n.idx, obj, node: n };
        }
    }
    return null;
}

function applyNodeDrag(obj, idx, wx, wy) {
    switch (obj.type) {
        case 'rect': {
            // idx: 0=TL, 1=TR, 2=BL, 3=BR
            // Opposite corner stays fixed
            const orig = state.nodeEditOrigPts;
            let ox, oy; // opposite corner
            if (idx === 0) { ox = orig.x + orig.width; oy = orig.y + orig.height; }
            else if (idx === 1) { ox = orig.x; oy = orig.y + orig.height; }
            else if (idx === 2) { ox = orig.x + orig.width; oy = orig.y; }
            else { ox = orig.x; oy = orig.y; }
            const newX = Math.min(wx, ox), newY = Math.min(wy, oy);
            const newW = Math.abs(wx - ox), newH = Math.abs(wy - oy);
            obj.x = newX; obj.y = newY;
            obj.width = Math.max(1, newW); obj.height = Math.max(1, newH);
            break;
        }
        case 'ellipse': {
            // idx: 0=top, 1=right, 2=bottom, 3=left
            const orig = state.nodeEditOrigPts;
            if (idx === 0) { // top
                const bottom = orig.cy + orig.ry;
                obj.ry = Math.max(1, Math.abs(bottom - wy) / 2);
                obj.cy = wy + obj.ry;
            } else if (idx === 2) { // bottom
                const top = orig.cy - orig.ry;
                obj.ry = Math.max(1, Math.abs(wy - top) / 2);
                obj.cy = top + obj.ry;
            } else if (idx === 3) { // left
                const right = orig.cx + orig.rx;
                obj.rx = Math.max(1, Math.abs(right - wx) / 2);
                obj.cx = wx + obj.rx;
            } else if (idx === 1) { // right
                const left = orig.cx - orig.rx;
                obj.rx = Math.max(1, Math.abs(wx - left) / 2);
                obj.cx = left + obj.rx;
            }
            break;
        }
        case 'line':
            if (idx === 0) { obj.x1 = wx; obj.y1 = wy; }
            else { obj.x2 = wx; obj.y2 = wy; }
            break;
        case 'bspline':
            if (idx >= 0 && idx < obj.points.length) {
                obj.points[idx] = { x: wx, y: wy };
            }
            break;
        case 'curvepath': {
            if (!obj.d || !obj._origBounds) break;
            const orig = obj._origBounds;
            if (orig.w === 0 || orig.h === 0) break;
            const sx = obj.width / orig.w, sy = obj.height / orig.h;
            const tx = obj.x - orig.x * sx, ty = obj.y - orig.y * sy;
            // Inverse transform: world -> path-local
            const localX = (sx !== 0) ? (wx - tx) / sx : 0;
            const localY = (sy !== 0) ? (wy - ty) / sy : 0;
            // Parse, update, rebuild
            const cmds = parseSVGPath(obj.d);
            const pathPts = extractPathPoints(cmds);
            if (idx >= 0 && idx < pathPts.length) {
                const pp = pathPts[idx];
                cmds[pp.segIdx].pts[pp.ptIdx].x = localX;
                cmds[pp.segIdx].pts[pp.ptIdx].y = localY;
                obj.d = buildSVGPathD(cmds);
                // Update the element's d attribute
                obj.element.setAttribute('d', obj.d);
                // Recalculate _origBounds from new d
                const ns = 'http://www.w3.org/2000/svg';
                const tempPath = document.createElementNS(ns, 'path');
                tempPath.setAttribute('d', obj.d);
                objectsLayer.appendChild(tempPath);
                const pathBBox = tempPath.getBBox();
                objectsLayer.removeChild(tempPath);
                obj._origBounds = { x: pathBBox.x, y: pathBBox.y, w: pathBBox.width || 1, h: pathBBox.height || 1 };
                // Keep width/height matching origBounds so sx=1, sy=1
                obj.x = obj._origBounds.x;
                obj.y = obj._origBounds.y;
                obj.width = obj._origBounds.w;
                obj.height = obj._origBounds.h;
            }
            break;
        }
        case 'powerclip':
            // Delegate to container
            applyNodeDrag(obj.container, idx, wx, wy);
            rebuildPowerClipElement(obj);
            drawSelection();
            updatePropsPanel();
            return; // skip the refreshElement below since we rebuilt
    }
    refreshElement(obj);
    drawSelection();
    updatePropsPanel();
}

// =============================================
// SNAP TO REFERENCE POINTS
// =============================================
function calcSnapAdjustment(selectedIds) {
    const screenScale = _cachedScreenScale;
    const threshold = SNAP_DIST * screenScale;

    // Collect snap points of selected objects
    const selPts = [];
    for (const id of selectedIds) {
        const obj = findObject(id);
        if (obj) selPts.push(...getSnapPoints(obj));
    }

    // Collect snap points of all OTHER objects + page points
    const targetPts = [];
    // Page edges and center
    targetPts.push(
        { x: 0, y: 0 }, { x: state.pageWidth, y: 0 },
        { x: 0, y: state.pageHeight }, { x: state.pageWidth, y: state.pageHeight },
        { x: state.pageWidth / 2, y: state.pageHeight / 2 },
        { x: state.pageWidth / 2, y: 0 }, { x: state.pageWidth / 2, y: state.pageHeight },
        { x: 0, y: state.pageHeight / 2 }, { x: state.pageWidth, y: state.pageHeight / 2 }
    );

    for (const obj of state.objects) {
        if (selectedIds.includes(obj.id)) continue;
        targetPts.push(...getSnapPoints(obj));
    }

    // Find closest snap in X and Y independently
    let bestDx = null, bestDy = null;
    let bestDistX = threshold, bestDistY = threshold;
    let snapLineX = null, snapLineY = null;

    for (const sp of selPts) {
        for (const tp of targetPts) {
            const distX = Math.abs(sp.x - tp.x);
            const distY = Math.abs(sp.y - tp.y);
            if (distX < bestDistX) {
                bestDistX = distX;
                bestDx = tp.x - sp.x;
                snapLineX = { x: tp.x, y1: Math.min(sp.y, tp.y) - 20 * screenScale, y2: Math.max(sp.y, tp.y) + 20 * screenScale };
            }
            if (distY < bestDistY) {
                bestDistY = distY;
                bestDy = tp.y - sp.y;
                snapLineY = { y: tp.y, x1: Math.min(sp.x, tp.x) - 20 * screenScale, x2: Math.max(sp.x, tp.x) + 20 * screenScale };
            }
        }
    }

    return { dx: bestDx || 0, dy: bestDy || 0, snapLineX, snapLineY };
}

function drawSnapGuideLines(snapResult) {
    // Remove previous snap guides
    const existing = snapLayer.querySelectorAll('.snap-guide');
    existing.forEach(el => el.remove());
    const ns = 'http://www.w3.org/2000/svg';
    const screenScale = _cachedScreenScale;
    const sw = 1 * screenScale;

    if (snapResult.snapLineX) {
        const sl = snapResult.snapLineX;
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', sl.x); line.setAttribute('y1', sl.y1);
        line.setAttribute('x2', sl.x); line.setAttribute('y2', sl.y2);
        line.setAttribute('stroke', '#00d4aa');
        line.setAttribute('stroke-width', sw);
        line.setAttribute('stroke-dasharray', `${sw * 4} ${sw * 2}`);
        line.setAttribute('pointer-events', 'none');
        line.classList.add('snap-guide');
        snapLayer.appendChild(line);
    }
    if (snapResult.snapLineY) {
        const sl = snapResult.snapLineY;
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', sl.x1); line.setAttribute('y1', sl.y);
        line.setAttribute('x2', sl.x2); line.setAttribute('y2', sl.y);
        line.setAttribute('stroke', '#00d4aa');
        line.setAttribute('stroke-width', sw);
        line.setAttribute('stroke-dasharray', `${sw * 4} ${sw * 2}`);
        line.setAttribute('pointer-events', 'none');
        line.classList.add('snap-guide');
        snapLayer.appendChild(line);
    }
}

function clearSnapGuideLines() {
    const existing = snapLayer.querySelectorAll('.snap-guide');
    existing.forEach(el => el.remove());
}

// Calc snap for a single point (used in node editing)
function calcSnapAdjustmentForPoint(px, py, excludeObjId) {
    const screenScale = _cachedScreenScale;
    const threshold = SNAP_DIST * screenScale;

    const targetPts = [];
    // Page edges and center
    targetPts.push(
        { x: 0, y: 0 }, { x: state.pageWidth, y: 0 },
        { x: 0, y: state.pageHeight }, { x: state.pageWidth, y: state.pageHeight },
        { x: state.pageWidth / 2, y: state.pageHeight / 2 },
        { x: state.pageWidth / 2, y: 0 }, { x: state.pageWidth / 2, y: state.pageHeight },
        { x: 0, y: state.pageHeight / 2 }, { x: state.pageWidth, y: state.pageHeight / 2 }
    );

    for (const obj of state.objects) {
        if (obj.id === excludeObjId) continue;
        targetPts.push(...getSnapPoints(obj));
    }

    // First pass: check for nearby discrete points (nodes, corners, centers, quadrants, endpoints)
    // These snap both X and Y together (euclidean proximity)
    let bestPointDist = threshold * 1.5;
    let pointSnap = null;
    for (const tp of targetPts) {
        if (tp.type === 'edge' || tp.type === 'edge-dynamic') continue;
        const dist = Math.hypot(px - tp.x, py - tp.y);
        if (dist < bestPointDist) {
            bestPointDist = dist;
            pointSnap = tp;
        }
    }
    if (pointSnap) {
        const off = 20 * screenScale;
        return {
            dx: pointSnap.x - px, dy: pointSnap.y - py,
            snapLineX: { x: pointSnap.x, y1: Math.min(py, pointSnap.y) - off, y2: Math.max(py, pointSnap.y) + off },
            snapLineY: { y: pointSnap.y, x1: Math.min(px, pointSnap.x) - off, x2: Math.max(px, pointSnap.x) + off }
        };
    }

    // Second pass: independent axis snap (for alignment guides)
    let bestDx = null, bestDy = null;
    let bestDistX = threshold, bestDistY = threshold;
    let snapLineX = null, snapLineY = null;

    for (const tp of targetPts) {
        const distX = Math.abs(px - tp.x);
        const distY = Math.abs(py - tp.y);
        if (distX < bestDistX) {
            bestDistX = distX;
            bestDx = tp.x - px;
            snapLineX = { x: tp.x, y1: Math.min(py, tp.y) - 20 * screenScale, y2: Math.max(py, tp.y) + 20 * screenScale };
        }
        if (distY < bestDistY) {
            bestDistY = distY;
            bestDy = tp.y - py;
            snapLineY = { y: tp.y, x1: Math.min(px, tp.x) - 20 * screenScale, x2: Math.max(px, tp.x) + 20 * screenScale };
        }
    }

    return { dx: bestDx || 0, dy: bestDy || 0, snapLineX, snapLineY };
}

// =============================================
// TOOL HANDLERS
// =============================================
function handleMouseDown(e) {
    // SVG placement mode: click to place imported SVG (with snap)
    if (state.pendingSVGImport && e.button === 0 && !state.spaceHeld) {
        e.preventDefault();
        e.stopPropagation();
        const cb = state.pendingSVGImport;
        state.pendingSVGImport = null;
        const raw = screenToSVG(e.clientX, e.clientY);
        const snap = calcSnapAdjustmentForPoint(raw.x, raw.y, -1);
        cb({ x: raw.x + (snap.dx || 0), y: raw.y + (snap.dy || 0) });
        return;
    }
    if (e.button === 1 || (e.button === 0 && state.spaceHeld)) {
        e.preventDefault();
        state.isPanning = true;
        state.panStart = {x:e.clientX,y:e.clientY};
        state.panViewBoxStart = {...state.viewBox};
        svg.style.cursor = 'grabbing';
        return;
    }
    // Right-click on empty space -> pan
    if (e.button === 2) {
        const pt = screenToSVG(e.clientX, e.clientY);
        const obj = objectAtPoint(pt);
        if (!obj) {
            e.preventDefault();
            state.isPanning = true;
            state.rightClickPanning = true;
            state.panStart = {x:e.clientX,y:e.clientY};
            state.panViewBoxStart = {...state.viewBox};
            svg.style.cursor = 'grabbing';
        }
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
        case 'vsdelete': handleVSDeleteDown(pt); break;
    }
}

let _moveRafId = null;
function handleMouseMove(e) {
    const pt = screenToSVG(e.clientX, e.clientY);
    if (!_statusCoordsEl) _statusCoordsEl = document.getElementById('status-coords');
    _statusCoordsEl.textContent = `X: ${Math.round(pt.x)}  Y: ${Math.round(pt.y)}`;
    // Critical interactive operations: run immediately (no throttle)
    if (state.isPanning) {
        const dx = e.clientX - state.panStart.x, dy = e.clientY - state.panStart.y;
        const scale = _cachedScreenScale;
        state.viewBox.x = state.panViewBoxStart.x - dx*scale;
        state.viewBox.y = state.panViewBoxStart.y - dy*scale;
        updateViewBox(); return;
    }
    if (state.nodeEditDragging) {
        const obj = findObject(state.nodeEditId);
        if (obj) {
            const snapAdj = calcSnapAdjustmentForPoint(pt.x, pt.y, state.nodeEditId);
            const snappedX = pt.x + snapAdj.dx;
            const snappedY = pt.y + snapAdj.dy;
            applyNodeDrag(obj, state.nodeEditIdx, snappedX, snappedY);
            drawSnapGuideLines(snapAdj);
        }
        return;
    }
    if (state.isMarquee) {
        const sx = state.marqueeStart.x, sy = state.marqueeStart.y;
        const mx = Math.min(sx, pt.x), my = Math.min(sy, pt.y);
        const mw = Math.abs(pt.x - sx), mh = Math.abs(pt.y - sy);
        state.marqueeEl.setAttribute('x', mx);
        state.marqueeEl.setAttribute('y', my);
        state.marqueeEl.setAttribute('width', mw);
        state.marqueeEl.setAttribute('height', mh);
        return;
    }
    if (_vsDeleteDragging) { handleVSDeleteMove(pt); return; }
    if (state.isResizing) { handleResizeMove(pt, e); return; }
    if (state.isDragging) { handleDragMove(pt); return; }
    if (state.isDrawing) { handleDrawMove(pt, e); return; }
    // Non-critical visual feedback: throttle to one per animation frame
    if (_moveRafId) return;
    _moveRafId = requestAnimationFrame(() => {
        _moveRafId = null;
        if (state.tool === 'vsdelete') {
            handleVSDeleteMove(pt);
            return;
        }
        if (state.tool === 'bspline' && state.bsplinePoints.length > 0) updateBSplinePreview(pt);
        drawSnapIndicators(pt);
        if (state.pendingSVGImport) {
            updatePlacementCursor(pt);
        } else if (state.tool === 'select' && !state.spaceHeld) {
            if (state.nodeEditId) {
                const hit = nodeAtPoint(pt);
                svg.style.cursor = hit ? 'crosshair' : 'default';
            } else {
                const handle = getHandleAtPoint(pt);
                if (handle) {
                    svg.style.cursor = HANDLE_CURSORS[handle.handle];
                } else {
                    svg.style.cursor = objectAtPoint(pt) ? 'move' : 'default';
                }
            }
        }
    });
}

function handleMouseUp() {
    if (state.isPanning) { state.isPanning = false; svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; return; }
    if (_vsDeleteDragging) {
        const pt = screenToSVG(event.clientX, event.clientY);
        handleVSDeleteUp(pt);
        return;
    }
    if (state.isMarquee) {
        state.isMarquee = false;
        // Get marquee bounds
        const sx = state.marqueeStart.x, sy = state.marqueeStart.y;
        const pt = screenToSVG(event.clientX, event.clientY);
        const mx = Math.min(sx, pt.x), my = Math.min(sy, pt.y);
        const mw = Math.abs(pt.x - sx), mh = Math.abs(pt.y - sy);
        // Remove marquee visual
        if (state.marqueeEl) { state.marqueeEl.remove(); state.marqueeEl = null; }
        // Only select if marquee has a meaningful size
        if (mw > 2 && mh > 2) {
            const newSel = [];
            // In PC edit mode, only content objects are selectable
            const editContentIds = pcEditingId ? (findObject(pcEditingId)?._editContentIds || []) : null;
            for (const obj of state.objects) {
                if (editContentIds && !editContentIds.includes(obj.id)) continue;
                const b = getObjBounds(obj);
                // Object must be COMPLETELY inside the marquee
                if (b.x >= mx && b.y >= my && b.x + b.w <= mx + mw && b.y + b.h <= my + mh) {
                    newSel.push(obj.id);
                }
            }
            state.selectedIds = newSel;
            drawSelection();
            updatePropsPanel();
        }
        return;
    }
    if (state.nodeEditDragging) {
        state.nodeEditDragging = false;
        state.nodeEditIdx = -1;
        state.nodeEditStart = null;
        state.nodeEditOrigPts = null;
        clearSnapGuideLines();
        drawSelection();
        updatePropsPanel();
        return;
    }
    if (state.isResizing) {
        state.isResizing = false;
        state.resizeHandle = null;
        // Re-fit texts in any resized ref areas
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (obj && obj.isRefArea) updateRefAreaTexts(obj);
        }
        drawSelection(); updatePropsPanel(); return;
    }
    if (state.isDragging) {
        state.isDragging = false;
        clearPCHighlight();
        clearSnapGuideLines();
        snapLayer.innerHTML = '';
        // W+drop: insert into ref area or powerclip
        if (!pcEditingId && state.wHeld && state.selectedIds.length === 1) {
            const draggedId = state.selectedIds[0];
            const dragged = findObject(draggedId);
            if (dragged && dragged.type !== 'powerclip') {
                const cursorPt = screenToSVG(event.clientX, event.clientY);
                const underObj = objectUnderCursor(cursorPt, draggedId);
                if (underObj) {
                    // If target is a ref area, add text to it instead of making powerclip
                    if (underObj.isRefArea && dragged.type === 'text') {
                        addTextToRefArea(draggedId, underObj.id);
                        state.wHeld = false;
                        return;
                    }
                    // Otherwise, make powerclip (skip ref areas and invalid types)
                    if (!underObj.isRefArea && underObj.type !== 'powerclip' && underObj.type !== 'line' && underObj.type !== 'bspline') {
                        const newPcId = makePowerClip(underObj.id);
                        if (newPcId) {
                            addToPowerClip(draggedId, newPcId);
                        }
                        state.wHeld = false;
                        return;
                    }
                }
            }
        }
        // Re-fit ALL ref area texts after drag to ensure correct positioning
        updateAllRefAreaTexts();
        drawSelection(); updatePropsPanel(); return;
    }
    if (state.isDrawing) handleDrawEnd();
}

// --- Resize handle detection ---
function getHandleAtPoint(pt) {
    if (state.nodeEditId) return null; // no resize handles in node edit mode
    if (state.selectedIds.length !== 1) return null;
    const obj = findObject(state.selectedIds[0]);
    if (!obj) return null;
    const b = getObjBounds(obj);
    const rot = obj.rotation || 0;
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const screenScale = _cachedScreenScale;
    const threshold = 8 * screenScale;
    const hs = state.viewBox.w * 0.007;
    const off = hs * 0.8; // same offset as drawSelection
    // Corner handles (offset outward)
    const corners = [
        { name: 'nw', x: b.x - off, y: b.y - off },
        { name: 'ne', x: b.x + b.w + off, y: b.y - off },
        { name: 'sw', x: b.x - off, y: b.y + b.h + off },
        { name: 'se', x: b.x + b.w + off, y: b.y + b.h + off },
    ];
    for (const c of corners) {
        const rp = rotatePoint(c.x, c.y, cx, cy, rot);
        if (Math.hypot(pt.x - rp.x, pt.y - rp.y) <= threshold) return { handle: c.name, obj };
    }
    // Midpoint handles (offset outward)
    const mids = [
        { name: 'n', x: b.x + b.w/2, y: b.y - off },
        { name: 's', x: b.x + b.w/2, y: b.y + b.h + off },
        { name: 'w', x: b.x - off, y: b.y + b.h/2 },
        { name: 'e', x: b.x + b.w + off, y: b.y + b.h/2 },
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
    // If in node edit mode, handle node interactions first
    if (state.nodeEditId) {
        const hit = nodeAtPoint(pt);
        if (hit) {
            // Start dragging this node
            saveUndoState();
            state.nodeEditDragging = true;
            state.nodeEditIdx = hit.idx;
            state.nodeEditStart = { x: pt.x, y: pt.y };
            // Snapshot the original object properties for the drag
            const obj = hit.obj;
            if (obj.type === 'rect') {
                state.nodeEditOrigPts = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
            } else if (obj.type === 'ellipse') {
                state.nodeEditOrigPts = { cx: obj.cx, cy: obj.cy, rx: obj.rx, ry: obj.ry };
            } else if (obj.type === 'line') {
                state.nodeEditOrigPts = { x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 };
            } else if (obj.type === 'bspline') {
                state.nodeEditOrigPts = { points: obj.points.map(p => ({ ...p })) };
            } else if (obj.type === 'curvepath') {
                state.nodeEditOrigPts = { d: obj.d, _origBounds: { ...obj._origBounds }, x: obj.x, y: obj.y, width: obj.width, height: obj.height };
            } else if (obj.type === 'powerclip') {
                const c = obj.container;
                if (c.type === 'rect') {
                    state.nodeEditOrigPts = { x: c.x, y: c.y, width: c.width, height: c.height };
                } else if (c.type === 'ellipse') {
                    state.nodeEditOrigPts = { cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry };
                }
            }
            return;
        }
        // Check if clicking on the object itself -> stay in node edit
        const nodeObj = findObject(state.nodeEditId);
        if (nodeObj && hitTest(nodeObj, pt)) {
            return; // stay in node edit mode, do nothing
        }
        // Clicking elsewhere -> exit node edit
        exitNodeEdit();
        // Fall through to normal selection logic
    }

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
        // If the object is already selected in a multi-selection, keep the selection intact for dragging
        if (!isSelected(obj.id) || e.shiftKey) {
            selectObject(obj.id, e.shiftKey);
        }
        // If selected a text linked to a ref area, select the ref area instead
        if (!e.shiftKey && state.selectedIds.length === 1) {
            const sel = findObject(state.selectedIds[0]);
            if (sel && sel.type === 'text') {
                const ra = findRefAreaForText(sel);
                if (ra) {
                    state.selectedIds = [ra.id];
                }
            }
        }
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
        // Click on empty space -> start marquee selection
        if (!e.shiftKey) selectObject(null);
        state.isMarquee = true;
        state.marqueeStart = { x: pt.x, y: pt.y };
        // Create marquee rect in selection layer
        const ns = 'http://www.w3.org/2000/svg';
        const screenScale = _cachedScreenScale;
        state.marqueeEl = document.createElementNS(ns, 'rect');
        state.marqueeEl.setAttribute('fill', 'rgba(124, 92, 240, 0.08)');
        state.marqueeEl.setAttribute('stroke', '#7c5cf0');
        state.marqueeEl.setAttribute('stroke-width', screenScale);
        state.marqueeEl.setAttribute('stroke-dasharray', `${4*screenScale} ${2*screenScale}`);
        state.marqueeEl.setAttribute('pointer-events', 'none');
        state.marqueeEl.setAttribute('x', pt.x);
        state.marqueeEl.setAttribute('y', pt.y);
        state.marqueeEl.setAttribute('width', 0);
        state.marqueeEl.setAttribute('height', 0);
        selectionLayer.appendChild(state.marqueeEl);
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
    const screenScale = _cachedScreenScale;
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
    previewLayer.appendChild(pcHighlightEl);
}

// Find any non-selected object under a point (for W+drag powerclip creation)
function objectUnderCursor(pt, excludeId) {
    for (let i = state.objects.length - 1; i >= 0; i--) {
        const obj = state.objects[i];
        if (obj.id === excludeId || state.selectedIds.includes(obj.id)) continue;
        if (hitTest(obj, pt)) return obj;
    }
    return null;
}

// Show lilac highlight on a regular object (not a powerclip container)
function showPCHighlightForObj(obj) {
    if (pcHighlightId === obj.id && pcHighlightEl) return;
    clearPCHighlight();
    pcHighlightId = obj.id;
    const ns = 'http://www.w3.org/2000/svg';
    const b = getObjBounds(obj);
    pcHighlightEl = document.createElementNS(ns, obj.type === 'ellipse' ? 'ellipse' : 'rect');
    pcHighlightEl.setAttribute('pointer-events', 'none');
    pcHighlightEl.setAttribute('fill', 'rgba(168, 130, 255, 0.30)');
    pcHighlightEl.setAttribute('stroke', '#9366f0');
    const screenScale = _cachedScreenScale;
    pcHighlightEl.setAttribute('stroke-width', 2 * screenScale);
    pcHighlightEl.setAttribute('stroke-dasharray', `${6*screenScale} ${3*screenScale}`);
    if (obj.type === 'ellipse') {
        pcHighlightEl.setAttribute('cx', obj.cx);
        pcHighlightEl.setAttribute('cy', obj.cy);
        pcHighlightEl.setAttribute('rx', obj.rx);
        pcHighlightEl.setAttribute('ry', obj.ry);
    } else {
        pcHighlightEl.setAttribute('x', b.x);
        pcHighlightEl.setAttribute('y', b.y);
        pcHighlightEl.setAttribute('width', b.w);
        pcHighlightEl.setAttribute('height', b.h);
        if (obj.rotation) {
            const cx = b.x + b.w/2, cy = b.y + b.h/2;
            pcHighlightEl.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
        }
    }
    previewLayer.appendChild(pcHighlightEl);
}

function handleDragMove(pt) {
    const dx = pt.x - state.dragStart.x, dy = pt.y - state.dragStart.y;
    // Apply initial moves
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj || !state.dragObjProps[id]) continue;
        applyMove(obj, state.dragObjProps[id], dx, dy);
        refreshElement(obj);
    }
    // Calculate snap adjustment
    const snapAdj = calcSnapAdjustment(state.selectedIds);
    if (snapAdj.dx !== 0 || snapAdj.dy !== 0) {
        // Re-apply moves with snap offset
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (!obj || !state.dragObjProps[id]) continue;
            applyMove(obj, state.dragObjProps[id], dx + snapAdj.dx, dy + snapAdj.dy);
            refreshElement(obj);
        }
    }
    // Move linked ref area texts along with the ref area
    const finalDx = dx + (snapAdj.dx || 0), finalDy = dy + (snapAdj.dy || 0);
    // Collect all ref areas to process (including those inside groups)
    const refAreasToProcess = [];
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;
        if (obj.isRefArea && obj.refTextIds) refAreasToProcess.push(obj);
        if (obj.type === 'group' && obj.children) {
            (function walkRA(list) {
                for (const c of list) {
                    if (c.isRefArea && c.refTextIds) refAreasToProcess.push(c);
                    if (c.type === 'group' && c.children) walkRA(c.children);
                    if (c.type === 'powerclip' && c.contents) walkRA(c.contents);
                }
            })(obj.children);
        }
    }
    for (const refObj of refAreasToProcess) {
        for (const tid of refObj.refTextIds) {
            if (state.selectedIds.includes(tid)) continue;
            const tObj = findObjectDeep(tid);
            if (!tObj) continue;
            // Only move this text if this ref area is its primary owner
            const primaryRA = findRefAreaForText(tObj);
            if (primaryRA && primaryRA.id !== refObj.id) continue;
            if (!state.dragObjProps[tid]) {
                state.dragObjProps[tid] = snapshotPos(tObj);
            }
            applyMove(tObj, state.dragObjProps[tid], finalDx, finalDy);
            refreshElement(tObj);
        }
    }
    drawSnapGuideLines(snapAdj);
    // Clear stale snap indicators from before the drag, then show fresh ones at snap targets
    snapLayer.innerHTML = '';
    if (snapAdj.dx !== 0 || snapAdj.dy !== 0) {
        // Show snap indicator at the point we're snapping TO on the target object
        // Find the actual target snap points that matched
        const selPts = [];
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (obj) selPts.push(...getSnapPoints(obj));
        }
        const screenScale = _cachedScreenScale;
        const threshold = SNAP_DIST * screenScale * 1.5;
        const targetPts = [];
        for (const obj of state.objects) {
            if (state.selectedIds.includes(obj.id)) continue;
            targetPts.push(...getSnapPoints(obj));
        }
        // Page snap points
        targetPts.push(
            {x:0,y:0,type:'corner'},{x:state.pageWidth,y:0,type:'corner'},
            {x:0,y:state.pageHeight,type:'corner'},{x:state.pageWidth,y:state.pageHeight,type:'corner'},
            {x:state.pageWidth/2,y:state.pageHeight/2,type:'center'},
            {x:state.pageWidth/2,y:0,type:'edge'},{x:state.pageWidth/2,y:state.pageHeight,type:'edge'},
            {x:0,y:state.pageHeight/2,type:'edge'},{x:state.pageWidth,y:state.pageHeight/2,type:'edge'}
        );
        const ns = 'http://www.w3.org/2000/svg';
        const r = 4.5 * screenScale;
        const sw = screenScale;
        const shown = new Set();
        for (const sp of selPts) {
            for (const tp of targetPts) {
                if (Math.abs(sp.x - tp.x) < threshold && Math.abs(sp.y - tp.y) < threshold) {
                    const key = `${tp.x.toFixed(1)},${tp.y.toFixed(1)}`;
                    if (!shown.has(key)) {
                        shown.add(key);
                        drawSnapMarker(ns, {x: tp.x, y: tp.y, type: tp.type || 'edge'}, r, sw);
                    }
                }
            }
        }
    }
    drawSelection();

    // Highlight powerclip drop target (cursor must be inside the powerclip, skip in edit mode)
    if (!pcEditingId && state.selectedIds.length === 1) {
        const draggedId = state.selectedIds[0];
        const dragged = findObject(draggedId);
        if (dragged && dragged.type !== 'powerclip') {
            // W held: highlight any object under cursor as potential container (ref area or powerclip)
            if (state.wHeld) {
                const underObj = objectUnderCursor(pt, draggedId);
                if (underObj && (underObj.isRefArea || (underObj.type !== 'powerclip' && underObj.type !== 'line' && underObj.type !== 'bspline' && !underObj.isRefArea))) {
                    showPCHighlightForObj(underObj);
                } else { clearPCHighlight(); }
            } else {
                const pcTarget = findPowerClipAtPoint(pt, draggedId);
                if (pcTarget) { showPCHighlight(pcTarget); } else { clearPCHighlight(); }
            }
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
    if (obj.isRefArea) updateRefAreaTexts(obj);
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
function snapPoint(pt) {
    const adj = calcSnapAdjustmentForPoint(pt.x, pt.y, null);
    return { x: pt.x + adj.dx, y: pt.y + adj.dy, _snap: adj };
}

function handleShapeDown(pt) {
    // Snap the start point to reference points
    const snapped = snapPoint(pt);
    pt = { x: snapped.x, y: snapped.y };
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

    // Snap the current point to reference points of other objects
    const adj = calcSnapAdjustmentForPoint(pt.x, pt.y, null);
    let ex = pt.x + adj.dx, ey = pt.y + adj.dy;
    drawSnapGuideLines(adj);
    // Also show snap indicator at snapped point
    if (adj.dx !== 0 || adj.dy !== 0) {
        drawSnapIndicators({x: ex, y: ey});
    }

    if (state.tool === 'rect') {
        let w = ex - sx, h = ey - sy;
        if (e && e.ctrlKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w)*s; h = Math.sign(h)*s; }
        const x = w < 0 ? sx + w : sx, y = h < 0 ? sy + h : sy;
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', Math.abs(w)); el.setAttribute('height', Math.abs(h));
    } else if (state.tool === 'ellipse') {
        let dx = ex - sx, dy = ey - sy;
        if (e && e.ctrlKey) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx)*s; dy = Math.sign(dy)*s; }
        el.setAttribute('cx', sx + dx/2); el.setAttribute('cy', sy + dy/2);
        el.setAttribute('rx', Math.abs(dx)/2); el.setAttribute('ry', Math.abs(dy)/2);
    } else if (state.tool === 'line') {
        if (e && e.shiftKey) {
            // Angle snap takes priority over object snap
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
    clearSnapGuideLines();
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
function handleBSplineClick(pt) {
    const snapped = snapPoint(pt);
    const screenScale = _cachedScreenScale;
    const threshold = SNAP_DIST * screenScale;

    // If no points yet, check if clicking near an open bspline's endpoint to continue it
    if (state.bsplinePoints.length === 0) {
        for (const obj of state.objects) {
            if (obj.type !== 'bspline' || obj.closed) continue;
            const pts = obj.points;
            if (pts.length < 2) continue;
            const last = pts[pts.length - 1];
            const first = pts[0];
            if (Math.hypot(snapped.x - last.x, snapped.y - last.y) <= threshold) {
                // Continue from the last point
                saveUndoState();
                state.bsplinePoints = pts.map(p => ({ ...p }));
                deleteObject(obj.id);
                updateBSplinePreview(snapped);
                return;
            }
            if (Math.hypot(snapped.x - first.x, snapped.y - first.y) <= threshold) {
                // Continue from the first point (reverse direction)
                saveUndoState();
                state.bsplinePoints = pts.map(p => ({ ...p })).reverse();
                deleteObject(obj.id);
                updateBSplinePreview(snapped);
                return;
            }
        }
    }

    // Check if closing the spline (clicking near the first point with >= 3 points)
    if (state.bsplinePoints.length >= 3) {
        const first = state.bsplinePoints[0];
        const screenScale = _cachedScreenScale;
        const threshold = SNAP_DIST * screenScale;
        if (Math.hypot(snapped.x - first.x, snapped.y - first.y) <= threshold) {
            const obj = createObject('bspline', {
                points: [...state.bsplinePoints],
                closed: true,
                fill: state.fillColor,
            });
            selectObject(obj.id);
            state.bsplinePoints = [];
            clearPreview();
            return;
        }
    }
    state.bsplinePoints.push({x:snapped.x, y:snapped.y});
    updateBSplinePreview(snapped);
}

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
    // Snap the preview point
    const adj = calcSnapAdjustmentForPoint(mousePt.x, mousePt.y, null);
    const snappedPt = { x: mousePt.x + adj.dx, y: mousePt.y + adj.dy };
    drawSnapGuideLines(adj);
    if (adj.dx !== 0 || adj.dy !== 0) drawSnapIndicators(snappedPt);
    const ns = 'http://www.w3.org/2000/svg';
    const last = state.bsplinePoints[state.bsplinePoints.length - 1];
    const isDuplicate = last && Math.abs(last.x - snappedPt.x) < 1e-6 && Math.abs(last.y - snappedPt.y) < 1e-6;
    // Detect if hovering near the first point (to close the spline)
    const first = state.bsplinePoints[0];
    const screenScale = _cachedScreenScale;
    const closeThreshold = SNAP_DIST * screenScale;
    const isClosing = state.bsplinePoints.length >= 3 && first &&
        Math.hypot(snappedPt.x - first.x, snappedPt.y - first.y) <= closeThreshold;
    const all = isDuplicate || isClosing ? [...state.bsplinePoints] : [...state.bsplinePoints, {x:snappedPt.x,y:snappedPt.y}];
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
    // Highlight first point when about to close
    if (isClosing) {
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('cx', first.x); ring.setAttribute('cy', first.y);
        ring.setAttribute('r', cs);
        ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#7c5cf0');
        ring.setAttribute('stroke-width', sw * 2);
        ring.setAttribute('pointer-events', 'none'); previewLayer.appendChild(ring);
    }
    if (all.length >= 2) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', bsplineToPath(all, isClosing));
        const previewFill = isClosing ? (state.fillColor !== 'none' ? state.fillColor : 'none') : 'none';
        path.setAttribute('fill', previewFill); path.setAttribute('stroke',state.strokeColor);
        if (previewFill !== 'none') path.setAttribute('fill-opacity', '0.3');
        path.setAttribute('stroke-width',state.strokeWidth); path.setAttribute('pointer-events','none');
        previewLayer.appendChild(path);
    }
}

function clearPreview() { previewLayer.innerHTML = ''; state.previewElement = null; }

// =============================================
// PLACEMENT CURSOR (SVG Import)
// =============================================
let _placementCursorGroup = null;

function showPlacementCursor() {
    hidePlacementCursor();
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('pointer-events', 'none');
    g.setAttribute('id', 'placement-cursor');

    // Scale factor so the cursor stays a fixed screen size regardless of zoom
    const s = _cachedScreenScale || 1;
    const r1 = 14 * s;  // inner gap radius
    const r2 = 22 * s;  // outer ring radius
    const lineLen = 34 * s;
    const bracketLen = 8 * s;
    const bracketOff = 26 * s;
    const dotR = 2.5 * s;
    const sw = 1.5 * s;
    const swThin = 1 * s;

    const accent = '#7c5cf0';
    const accentSoft = 'rgba(124,92,240,0.35)';

    // Glow circle
    const glow = document.createElementNS(ns, 'circle');
    glow.setAttribute('r', r2);
    glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke', accentSoft);
    glow.setAttribute('stroke-width', 6 * s);
    g.appendChild(glow);

    // Outer dashed ring with CSS animation
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('r', r2);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', accent);
    ring.setAttribute('stroke-width', sw);
    ring.setAttribute('stroke-dasharray', `${4 * s} ${4 * s}`);
    // Add rotation animation via style
    ring.setAttribute('style', `animation: placementSpin 4s linear infinite; transform-origin: 0 0;`);
    g.appendChild(ring);

    // Crosshair lines (4 lines with gap in center)
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of dirs) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', dx * r1);
        line.setAttribute('y1', dy * r1);
        line.setAttribute('x2', dx * lineLen);
        line.setAttribute('y2', dy * lineLen);
        line.setAttribute('stroke', accent);
        line.setAttribute('stroke-width', swThin);
        line.setAttribute('opacity', '0.7');
        g.appendChild(line);
    }

    // Corner brackets (4 L-shapes)
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [cx, cy] of corners) {
        const bracket = document.createElementNS(ns, 'path');
        const bx = cx * bracketOff, by = cy * bracketOff;
        bracket.setAttribute('d',
            `M${bx},${by + cy * bracketLen} L${bx},${by} L${bx + cx * bracketLen},${by}`);
        bracket.setAttribute('fill', 'none');
        bracket.setAttribute('stroke', accent);
        bracket.setAttribute('stroke-width', sw);
        bracket.setAttribute('stroke-linecap', 'round');
        g.appendChild(bracket);
    }

    // Center dot
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', dotR);
    dot.setAttribute('fill', accent);
    g.appendChild(dot);

    // Label
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('y', (r2 + 16 * s));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', accent);
    label.setAttribute('font-size', 10 * s);
    label.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    label.setAttribute('font-weight', '500');
    label.setAttribute('opacity', '0.8');
    label.textContent = 'IMPORTAR SVG';
    g.appendChild(label);

    previewLayer.appendChild(g);
    _placementCursorGroup = g;
    svg.style.cursor = 'none';

    // Inject keyframe animation if not already present
    if (!document.getElementById('placement-spin-style')) {
        const style = document.createElement('style');
        style.id = 'placement-spin-style';
        style.textContent = `@keyframes placementSpin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
    }
}

function updatePlacementCursor(pt) {
    if (_placementCursorGroup) {
        _placementCursorGroup.setAttribute('transform', `translate(${pt.x},${pt.y})`);
    }
}

function hidePlacementCursor() {
    if (_placementCursorGroup) {
        _placementCursorGroup.remove();
        _placementCursorGroup = null;
    }
    svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
}

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

        overlay.style.fontFamily = fontDef.css;
        overlay.style.fontSize = screenFontSize + 'px';
        overlay.style.lineHeight = '1.2';
        overlay.style.color = obj.fill === 'none' ? '#000' : obj.fill;
        overlay.style.textAlign = obj.textAlign || 'left';
        overlay.style.width = 'auto';

        // Check if this text is inside a ref area for positioning
        const refArea = findRefAreaForText(obj);
        if (refArea && obj.textAlign === 'center') {
            const rb = getObjBounds(refArea);
            const raScreenX = svgRect.left + (rb.x - state.viewBox.x) * scale;
            const raScreenW = rb.w * scale;
            overlay.style.left = raScreenX + 'px';
            overlay.style.top = screenY + 'px';
            overlay.style.width = raScreenW + 'px';
        } else {
            overlay.style.left = screenX + 'px';
            overlay.style.top = screenY + 'px';
        }
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
                fitTextToRefArea(obj).then(() => {
                    refreshElement(obj);
                    drawSelection();
                });
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
        overlay.style.textAlign = state.textAlign;
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
                    textAlign: state.textAlign,
                    fill: state.fillColor === 'none' ? '#000000' : state.fillColor,
                    stroke: 'none',
                    strokeWidth: 0,
                });
                fitTextToRefArea(obj);
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

    // Bake group rotation/flip into children so they keep their visual transform
    const groupRot = obj.rotation || 0;
    const groupFlipX = !!obj.flipX;
    const groupFlipY = !!obj.flipY;
    if (groupRot !== 0 || groupFlipX || groupFlipY) {
        const gb = getObjBounds(obj);
        const gcx = gb.x + gb.w / 2, gcy = gb.y + gb.h / 2;
        for (const c of children) {
            _bakeGroupTransform(c, gcx, gcy, groupRot, groupFlipX, groupFlipY);
        }
    }

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

// Bake a group's rotation/flip into a child object so it can live outside the group
function _bakeGroupTransform(child, gcx, gcy, angle, flipX, flipY) {
    // Helper: apply flip then rotation to a point
    function xform(px, py) {
        if (flipX) px = 2 * gcx - px;
        if (flipY) py = 2 * gcy - py;
        if (angle) return rotatePoint(px, py, gcx, gcy, angle);
        return { x: px, y: py };
    }

    // For coordinate-defined types, transform each point directly
    if (child.type === 'line') {
        const p1 = xform(child.x1, child.y1);
        const p2 = xform(child.x2, child.y2);
        child.x1 = p1.x; child.y1 = p1.y;
        child.x2 = p2.x; child.y2 = p2.y;
        return;
    }
    if (child.type === 'bspline') {
        for (const p of child.points) {
            const np = xform(p.x, p.y);
            p.x = np.x; p.y = np.y;
        }
        return;
    }

    // For center-based types: move center, accumulate rotation, toggle flips
    const cb = getObjBounds(child);
    const oldCx = cb.x + cb.w / 2, oldCy = cb.y + cb.h / 2;
    const newC = xform(oldCx, oldCy);
    const dx = newC.x - oldCx, dy = newC.y - oldCy;

    // Shift the child's position
    switch (child.type) {
        case 'rect': case 'image': case 'curvepath':
            child.x += dx; child.y += dy; break;
        case 'ellipse':
            child.cx += dx; child.cy += dy; break;
        case 'text':
            child.x += dx; child.y += dy; break;
        case 'group':
            for (const gc of child.children) _shiftObj(gc, dx, dy);
            break;
        case 'powerclip':
            _shiftObj(child.container, dx, dy);
            for (const ct of (child.contents || [])) _shiftObj(ct, dx, dy);
            break;
    }

    // When flipping, a rotation r becomes -r from the mirror's perspective
    let childRot = child.rotation || 0;
    if (flipX) childRot = -childRot;
    if (flipY) childRot = -childRot;
    child.rotation = (childRot + angle) % 360;

    if (flipX) child.flipX = !child.flipX;
    if (flipY) child.flipY = !child.flipY;
}

// Recursively shift an object's position by (dx, dy)
function _shiftObj(obj, dx, dy) {
    switch (obj.type) {
        case 'rect': case 'image': case 'curvepath':
            obj.x += dx; obj.y += dy; break;
        case 'ellipse':
            obj.cx += dx; obj.cy += dy; break;
        case 'text':
            obj.x += dx; obj.y += dy; break;
        case 'line':
            obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy; break;
        case 'bspline':
            for (const p of obj.points) { p.x += dx; p.y += dy; } break;
        case 'group':
            for (const c of obj.children) _shiftObj(c, dx, dy); break;
        case 'powerclip':
            _shiftObj(obj.container, dx, dy);
            for (const ct of (obj.contents || [])) _shiftObj(ct, dx, dy);
            break;
    }
}

// =============================================
// JOIN NODES
// =============================================
function joinNodes() {
    if (state.selectedIds.length < 2) return;
    const THRESHOLD = 3; // px tolerance for coincident endpoints

    // 1) Extract segments: each is { pts: [{x,y},...], objId }
    //    pts[0] = start, pts[last] = end
    const segments = [];
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;
        if (obj.type === 'line') {
            segments.push({ pts: [{x:obj.x1,y:obj.y1},{x:obj.x2,y:obj.y2}], objId: id, type: 'line' });
        } else if (obj.type === 'bspline' && obj.points.length >= 2) {
            // Sample the spline to get a smooth polyline
            const samples = sampleBSpline(obj.points, 60);
            segments.push({ pts: samples, objId: id, type: 'bspline' });
        } else if (obj.type === 'curvepath') {
            // Parse the path and extract points
            const cmds = parseSVGPath(obj.d);
            const orig = obj._origBounds;
            const sx = obj.width / orig.w, sy = obj.height / orig.h;
            const tx = obj.x - orig.x * sx, ty = obj.y - orig.y * sy;
            const pts = [];
            for (const c of cmds) {
                for (const p of c.pts) {
                    pts.push({ x: p.x * sx + tx, y: p.y * sy + ty });
                }
            }
            if (pts.length >= 2) segments.push({ pts, objId: id, type: 'curvepath' });
        }
    }
    if (segments.length < 2) return;

    // 2) Chain segments by matching endpoints
    const used = new Set();
    const chain = [];

    function endPt(seg, which) { return which === 'start' ? seg.pts[0] : seg.pts[seg.pts.length-1]; }
    function near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) <= THRESHOLD; }

    // Start with the first segment
    let current = segments[0];
    used.add(0);
    chain.push(...current.pts);

    let changed = true;
    while (changed) {
        changed = false;
        const chainEnd = chain[chain.length - 1];
        const chainStart = chain[0];
        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;
            const seg = segments[i];
            const sStart = endPt(seg, 'start');
            const sEnd = endPt(seg, 'end');
            if (near(chainEnd, sStart)) {
                // Append segment (skip first point, it's coincident)
                chain.push(...seg.pts.slice(1));
                used.add(i); changed = true; break;
            } else if (near(chainEnd, sEnd)) {
                // Append segment reversed
                const rev = [...seg.pts].reverse();
                chain.push(...rev.slice(1));
                used.add(i); changed = true; break;
            } else if (near(chainStart, sEnd)) {
                // Prepend segment (skip last point)
                chain.unshift(...seg.pts.slice(0, -1));
                used.add(i); changed = true; break;
            } else if (near(chainStart, sStart)) {
                // Prepend segment reversed
                const rev = [...seg.pts].reverse();
                chain.unshift(...rev.slice(0, -1));
                used.add(i); changed = true; break;
            }
        }
    }

    if (used.size < 2) return; // couldn't chain anything

    // 3) Check if closed (first and last point are coincident)
    const isClosed = near(chain[0], chain[chain.length - 1]);

    // 4) Build SVG path d string
    let d = `M ${chain[0].x} ${chain[0].y}`;
    for (let i = 1; i < chain.length; i++) {
        d += ` L ${chain[i].x} ${chain[i].y}`;
    }
    if (isClosed) d += ' Z';

    // 5) Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of chain) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const bw = maxX - minX || 1, bh = maxY - minY || 1;

    // 6) Create new curvepath object
    saveUndoState();
    const newObj = {
        id: state.nextId++,
        type: 'curvepath',
        d: d,
        x: minX,
        y: minY,
        width: bw,
        height: bh,
        _origBounds: { x: minX, y: minY, w: bw, h: bh },
        fill: isClosed ? state.fillColor : 'none',
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
        rotation: 0,
    };
    const elem = buildSVGElement(newObj);
    newObj.element = elem;
    elem.dataset.objectId = newObj.id;
    objectsLayer.appendChild(elem);
    state.objects.push(newObj);

    // 7) Delete original objects that were used
    for (const i of used) {
        deleteObject(segments[i].objId);
    }

    state.selectedIds = [newObj.id];
    drawSelection();
    updatePropsPanel();
}

// =============================================
// DUPLICATE
// =============================================
function duplicateSelected() {
    if (state.selectedIds.length === 0) return;
    saveUndoState();
    const offset = 30; // px offset for the duplicate
    const newIds = [];
    const idMap = {}; // old id → new id (for remapping refTextIds)
    for (const id of state.selectedIds) {
        const obj = findObject(id);
        if (!obj) continue;
        const clone = JSON.parse(JSON.stringify(obj, (k, v) => k === 'element' ? undefined : v));
        const oldId = clone.id;
        clone.id = state.nextId++;
        idMap[oldId] = clone.id;
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
    // Remap refTextIds: point cloned ref areas to cloned texts (not originals)
    for (const newId of newIds) {
        const clone = findObject(newId);
        if (!clone || !clone.isRefArea || !clone.refTextIds) continue;
        clone.refTextIds = clone.refTextIds
            .map(tid => idMap[tid] !== undefined ? idMap[tid] : null)
            .filter(tid => tid !== null);
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
// GRID FILL (Llenar cuadrícula)
// =============================================

// Collect all object IDs that form a "set" (selected objects + their linked ref texts)
function collectGridSet(selectedIds) {
    const allIds = new Set(selectedIds);
    function walkForTexts(o) {
        if (o.isRefArea && o.refTextIds) {
            for (const tid of o.refTextIds) if (findObject(tid)) allIds.add(tid);
        }
        if (o.type === 'group' && o.children) o.children.forEach(walkForTexts);
        if (o.type === 'powerclip') {
            if (o.container) walkForTexts(o.container);
            if (o.contents) o.contents.forEach(walkForTexts);
        }
    }
    for (const id of selectedIds) {
        const obj = findObject(id);
        if (obj) walkForTexts(obj);
    }
    return [...allIds];
}

// Get combined bounding box for a set of object IDs
function getCombinedBounds(ids) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
        const obj = findObject(id);
        if (!obj) continue;
        const b = getObjBounds(obj);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Assign new IDs recursively and build old→new map
function remapAllIds(obj, idMap) {
    const oldId = obj.id;
    obj.id = state.nextId++;
    idMap[oldId] = obj.id;
    if (obj.type === 'group' && obj.children) {
        for (const c of obj.children) remapAllIds(c, idMap);
    }
    if (obj.type === 'powerclip') {
        if (obj.container) remapAllIds(obj.container, idMap);
        if (obj.contents) for (const c of obj.contents) remapAllIds(c, idMap);
    }
}

// Remap refTextIds using an old→new ID map
function remapRefTextIds(obj, idMap) {
    if (obj.isRefArea && obj.refTextIds) {
        obj.refTextIds = obj.refTextIds
            .map(tid => idMap[tid] !== undefined ? idMap[tid] : null)
            .filter(tid => tid !== null);
    }
    if (obj.type === 'group' && obj.children) {
        for (const c of obj.children) remapRefTextIds(c, idMap);
    }
    if (obj.type === 'powerclip') {
        if (obj.container) remapRefTextIds(obj.container, idMap);
        if (obj.contents) for (const c of obj.contents) remapRefTextIds(c, idMap);
    }
}

function calcGridDimensions(selectedIds, gapPx) {
    const allIds = collectGridSet(selectedIds);
    const bounds = getCombinedBounds(allIds);
    if (bounds.w <= 0 || bounds.h <= 0) return { cols: 0, rows: 0, total: 0 };
    const cols = Math.max(2, Math.ceil((state.pageWidth + gapPx) / (bounds.w + gapPx)));
    const rows = Math.max(2, Math.ceil((state.pageHeight + gapPx) / (bounds.h + gapPx)));
    return { cols, rows, total: cols * rows };
}

function gridFillSelected(gapInUnits) {
    if (state.selectedIds.length === 0) return;

    const gap = fromUnit(gapInUnits);
    const allIds = collectGridSet(state.selectedIds);
    const bounds = getCombinedBounds(allIds);
    if (bounds.w <= 0 || bounds.h <= 0) return;

    const cols = Math.max(2, Math.ceil((state.pageWidth + gap) / (bounds.w + gap)));
    const rows = Math.max(2, Math.ceil((state.pageHeight + gap) / (bounds.h + gap)));

    saveUndoState();

    // Move originals to top-left (0,0)
    const dxOrig = -bounds.x;
    const dyOrig = -bounds.y;
    for (const id of allIds) {
        const obj = findObject(id);
        if (obj) { offsetObject(obj, dxOrig, dyOrig); refreshElement(obj); }
    }

    // Clone for each remaining grid cell
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (r === 0 && c === 0) continue; // Original is here
            const dx = c * (bounds.w + gap);
            const dy = r * (bounds.h + gap);

            const idMap = {};
            const clones = [];
            for (const id of allIds) {
                const obj = findObject(id);
                if (!obj) continue;
                const clone = JSON.parse(JSON.stringify(obj, (k, v) => k === 'element' ? undefined : v));
                remapAllIds(clone, idMap);
                offsetObject(clone, dx, dy);
                clones.push(clone);
            }
            // Remap refTextIds across all clones in this cell
            for (const clone of clones) remapRefTextIds(clone, idMap);
            // Add clones to canvas
            for (const clone of clones) {
                const elem = buildSVGElement(clone);
                clone.element = elem;
                elem.dataset.objectId = clone.id;
                objectsLayer.appendChild(elem);
                state.objects.push(clone);
                refreshElement(clone);
            }
        }
    }

    updateAllRefAreaTexts();
    selectObject(null);
    drawSelection();
    updatePropsPanel();
    showToast(`${cols} \u00d7 ${rows} = ${cols * rows} copias`);
}

// --- Grid Fill Modal ---
function showGridFillModal() {
    if (state.selectedIds.length === 0) { showToast('Selecciona un objeto primero'); return; }
    const modal = document.getElementById('grid-fill-modal');
    const gapInput = document.getElementById('grid-gap');
    document.getElementById('grid-gap-unit').textContent = state.unit;
    gapInput.value = 3;
    updateGridPreview();
    modal.classList.remove('hidden');
    gapInput.focus();
    gapInput.select();
}

function hideGridFillModal() {
    document.getElementById('grid-fill-modal').classList.add('hidden');
}

function updateGridPreview() {
    const gapVal = parseFloat(document.getElementById('grid-gap').value) || 0;
    const gap = fromUnit(gapVal);
    const dim = calcGridDimensions(state.selectedIds, gap);
    const preview = document.getElementById('grid-preview');
    preview.textContent = `${dim.cols} columnas \u00d7 ${dim.rows} filas = ${dim.total} copias`;
}

function setupGridFillModal() {
    const modal = document.getElementById('grid-fill-modal');
    if (!modal) return;
    const gapInput = document.getElementById('grid-gap');
    gapInput.addEventListener('input', updateGridPreview);
    modal.querySelector('[data-action="cancel"]').addEventListener('click', hideGridFillModal);
    modal.querySelector('.modal-close').addEventListener('click', hideGridFillModal);
    modal.querySelector('.modal-overlay').addEventListener('click', hideGridFillModal);
    modal.querySelector('[data-action="apply"]').addEventListener('click', () => {
        const gapVal = parseFloat(gapInput.value) || 0;
        hideGridFillModal();
        gridFillSelected(gapVal);
    });
}

// =============================================
// Z-ORDER (Bring to Front / Send to Back)
// =============================================
function bringToFront() {
    if (state.selectedIds.length === 0) return;
    saveUndoState();
    for (const id of state.selectedIds) {
        const idx = state.objects.findIndex(o => o.id === id);
        if (idx === -1) continue;
        const [obj] = state.objects.splice(idx, 1);
        state.objects.push(obj);
        if (obj.element) objectsLayer.appendChild(obj.element);
    }
    drawSelection();
}

function sendToBack() {
    if (state.selectedIds.length === 0) return;
    saveUndoState();
    const ids = [...state.selectedIds].reverse();
    for (const id of ids) {
        const idx = state.objects.findIndex(o => o.id === id);
        if (idx === -1) continue;
        const [obj] = state.objects.splice(idx, 1);
        state.objects.unshift(obj);
        if (obj.element) objectsLayer.insertBefore(obj.element, objectsLayer.firstChild);
    }
    drawSelection();
}

// =============================================
// POWERCLIP
// =============================================
// A PowerClip is a special object: { type:'powerclip', container: <shape obj>, contents: [<obj>...] }
// The container defines the clip shape, contents are clipped inside it.

function makePowerClip(objId) {
    const obj = findObject(objId);
    if (!obj || obj.type === 'powerclip' || obj.type === 'line' || (obj.type === 'bspline' && !obj.closed) || obj.type === 'image') return;
    saveUndoState();
    const idx = state.objects.findIndex(o => o.id === objId);
    if (idx === -1) return;
    // Remove from DOM
    obj.element.remove();
    // Create powerclip wrapper
    const pc = {
        id: state.nextId++,
        type: 'powerclip',
        container: { ...obj, element: null, _origBounds: obj._origBounds ? { ...obj._origBounds } : undefined },
        contents: [],
        rotation: 0,
    };
    const elem = buildSVGElement(pc);
    pc.element = elem;
    elem.dataset.objectId = pc.id;
    objectsLayer.appendChild(elem);
    state.objects.splice(idx, 1, pc);
    selectObject(pc.id);
    return pc.id; // return new powerclip ID
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
        // Finish editing — re-clip contents and restore normal view
        exitPowerClipEdit();
    } else {
        // Start editing
        enterPowerClipEdit(pcId);
    }
}

function enterPowerClipEdit(pcId) {
    const pc = findObject(pcId);
    if (!pc || pc.type !== 'powerclip') return;
    pcEditingId = pcId;
    document.getElementById('pc-edit-banner').classList.remove('hidden');

    // 1) Remove clip-path from the content group so contents are fully visible
    const contentGroup = pc.element.querySelector('g[clip-path]');
    if (contentGroup) {
        contentGroup._savedClipPath = contentGroup.getAttribute('clip-path');
        contentGroup.removeAttribute('clip-path');
    }

    // 2) Dim all other objects by adding an overlay
    const ns = 'http://www.w3.org/2000/svg';
    const overlay = document.createElementNS(ns, 'rect');
    overlay.setAttribute('x', state.viewBox.x - 10000);
    overlay.setAttribute('y', state.viewBox.y - 10000);
    overlay.setAttribute('width', 40000);
    overlay.setAttribute('height', 40000);
    overlay.setAttribute('fill', 'rgba(255,255,255,0.6)');
    overlay.setAttribute('pointer-events', 'none');
    overlay.id = 'pc-edit-overlay';
    // Insert overlay before the powerclip element so it dims everything behind
    objectsLayer.insertBefore(overlay, pc.element);

    // 3) Draw a dashed outline of the container to show the clip boundary
    const containerOutline = document.createElementNS(ns, 'g');
    containerOutline.id = 'pc-edit-outline';
    containerOutline.setAttribute('pointer-events', 'none');
    const c = pc.container;
    // Use buildClipShape to get the exact outline of the container
    const outlineEl = buildClipShape(c, ns);
    outlineEl.setAttribute('fill', 'none');
    outlineEl.setAttribute('stroke', 'rgba(124, 92, 240, 0.55)');
    const screenScale = _cachedScreenScale;
    outlineEl.setAttribute('stroke-width', 2.5 * screenScale);
    containerOutline.appendChild(outlineEl);
    // Outline will be appended AFTER content objects (see below)

    // 4) Make content objects individually selectable by temporarily adding them to state.objects
    pc._editContentIds = [];
    for (const content of pc.contents) {
        // Create standalone SVG elements for each content object
        const elem = buildSVGElement(content);
        content.element = elem;
        elem.dataset.objectId = content.id;
        objectsLayer.appendChild(elem);
        state.objects.push(content);
        pc._editContentIds.push(content.id);
        if (content.id >= state.nextId) state.nextId = content.id + 1;
    }

    // 5) Hide the powerclip's own clipped content group
    if (contentGroup) contentGroup.style.display = 'none';

    // 6) Add outline ON TOP of content so it always passes over
    objectsLayer.appendChild(containerOutline);

    // Don't auto-select content — let user click to select
    state.selectedIds = [];
    drawSelection();
    updatePropsPanel();
    updatePowerClipMenu();
}

function exitPowerClipEdit() {
    if (!pcEditingId) return;
    document.getElementById('pc-edit-banner').classList.add('hidden');
    const pc = findObject(pcEditingId);

    // 1) Remove standalone content elements from objects array and DOM
    if (pc && pc._editContentIds) {
        for (const cid of pc._editContentIds) {
            const obj = state.objects.find(o => o.id === cid);
            if (obj && obj.element) obj.element.remove();
            const idx = state.objects.findIndex(o => o.id === cid);
            if (idx !== -1) state.objects.splice(idx, 1);
        }
        delete pc._editContentIds;
    }

    // 2) Remove overlay and outline
    const overlay = document.getElementById('pc-edit-overlay');
    if (overlay) overlay.remove();
    const outline = document.getElementById('pc-edit-outline');
    if (outline) outline.remove();

    // 3) Rebuild the powerclip element to re-apply clip and show updated contents
    if (pc) rebuildPowerClipElement(pc);

    pcEditingId = null;
    if (pc) selectObject(pc.id);
    drawSelection();
    updatePropsPanel();
    updatePowerClipMenu();
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
    document.getElementById('pc-edit-finish').addEventListener('click', () => {
        exitPowerClipEdit();
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
    } else if (obj.type === 'line' || (obj.type === 'bspline' && !obj.closed) || obj.type === 'image') {
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

    // Background removal — only for image objects
    const bgOpt = contextMenu.querySelector('[data-ctx="bg-removal"]');
    if (bgOpt) {
        if (obj.type === 'image') {
            bgOpt.style.display = '';
        } else {
            bgOpt.style.display = 'none';
        }
    }

    // Convert to bitmap — only for image objects
    const bmpOpt = contextMenu.querySelector('[data-ctx="convert-to-bitmap"]');
    if (bmpOpt) {
        bmpOpt.style.display = obj.type === 'image' ? '' : 'none';
    }

    // Invert colors — only for image objects
    const invertOpt = contextMenu.querySelector('[data-ctx="invert-colors"]');
    if (invertOpt) {
        invertOpt.style.display = obj.type === 'image' ? '' : 'none';
    }

    // Reference area — only for closed shapes (rect, ellipse, closed bspline, curvepath)
    const refAreaOpt = contextMenu.querySelector('[data-ctx="toggle-ref-area"]');
    if (refAreaOpt) {
        const canBeRefArea = obj.type === 'rect' || obj.type === 'ellipse' ||
            (obj.type === 'bspline' && obj.closed) || obj.type === 'curvepath';
        refAreaOpt.style.display = canBeRefArea ? '' : 'none';
        if (canBeRefArea) {
            refAreaOpt.innerHTML = refAreaOpt.querySelector('svg').outerHTML + ' ' +
                (obj.isRefArea ? 'Quitar \u00e1rea de referencia' : '\u00c1rea de referencia');
        }
    }

    // Add to ref area — only for text objects when ref areas exist
    const addRefOpt = contextMenu.querySelector('[data-ctx="add-to-ref-area"]');
    if (addRefOpt) {
        const refAreas = state.objects.filter(o => o.isRefArea);
        addRefOpt.style.display = (obj.type === 'text' && refAreas.length > 0) ? '' : 'none';
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
                case 'bg-removal':
                    showBgRemovalModal(contextTarget);
                    break;
                case 'convert-to-bitmap':
                    showBmpConverterModal(contextTarget);
                    break;
                case 'invert-colors':
                    invertImageColors(contextTarget);
                    break;
                case 'toggle-ref-area':
                    toggleRefArea(contextTarget);
                    break;
                case 'add-to-ref-area': {
                    const refAreas = state.objects.filter(o => o.isRefArea);
                    if (refAreas.length === 1) {
                        addTextToRefArea(contextTarget.id, refAreas[0].id);
                    } else if (refAreas.length > 1) {
                        enterRefAreaPickMode(contextTarget.id);
                    }
                    break;
                }
                case 'bring-to-front':
                    bringToFront();
                    break;
                case 'send-to-back':
                    sendToBack();
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
                if (!obj) continue;
                if (obj.type === 'powerclip' && obj.container) {
                    obj.container.fill = color; refreshElement(obj);
                } else if (obj.type !== 'line' && !(obj.type === 'bspline' && !obj.closed)) {
                    obj.fill = color; refreshElement(obj);
                }
            }
        } else if (e.button === 2) {
            state.strokeColor = color;
            document.querySelector('#stroke-swatch .swatch-inner').style.background = color === 'none' ? noFillBg : color;
            for (const id of state.selectedIds) {
                const obj = findObject(id);
                if (!obj) continue;
                if (obj.type === 'powerclip' && obj.container) {
                    obj.container.stroke = color; refreshElement(obj);
                } else {
                    obj.stroke = color; refreshElement(obj);
                }
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
        case 'import-svg':  importSVG(); break;
        case 'export-svg':  exportSVG(); break;
        case 'save-file':   saveFile(); break;
        case 'save-file-as': saveFileAs(); break;
        case 'open-file':   showOpenFileModal(); break;
        case 'clear-all':   clearAll(); break;
        case 'page-size':   showPageSizeModal(); break;
        case 'fit-page':    resetView(); break;
        case 'group':       groupSelected(); break;
        case 'ungroup':     ungroupSelected(); break;
        case 'join-nodes':  joinNodes(); break;
        case 'import-names': showImportNamesModal(); break;
        case 'bmp-converter': showBmpConverterModal(); break;
        case 'bg-removal': showBgRemovalModal(); break;
        case 'ai-instructions': showAIInstructionsModal(); break;
        case 'ai-toggle-chat': toggleAIChat(); break;
        case 'grid-fill': showGridFillModal(); break;
    }
}

// =============================================
// FILE SAVE / OPEN (Firebase)
// =============================================

async function generateThumbnail() {
    try {
        // Clone the SVG canvas and render only the page area
        const clone = svg.cloneNode(true);
        // Remove selection/snap/preview layers from clone
        for (const id of ['selection-layer', 'snap-layer', 'preview-layer']) {
            const el = clone.querySelector('#' + id);
            if (el) el.innerHTML = '';
        }
        // Inline external image URLs as data URIs (SVG blobs can't load external resources)
        const images = clone.querySelectorAll('image');
        await Promise.all([...images].map(async (img) => {
            const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (!href || href.startsWith('data:')) return;
            try {
                const resp = await fetch(href);
                const blob = await resp.blob();
                const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
                img.removeAttribute('href');
                img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
            } catch(e) { /* skip images that can't be fetched */ }
        }));
        // Set viewBox to page area
        clone.setAttribute('viewBox', `0 0 ${state.pageWidth} ${state.pageHeight}`);
        clone.setAttribute('width', '160');
        clone.setAttribute('height', Math.round(160 * state.pageHeight / state.pageWidth));
        const svgStr = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        return await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = 160;
                c.height = Math.round(160 * state.pageHeight / state.pageWidth);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/png', 0.7));
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    } catch (e) { return null; }
}

function markDirty() {
    _isDirty = true;
    const tab = editorTabs.find(t => t.id === activeTabId);
    if (tab) { tab.isDirty = true; renderTabs(); }
    if (!currentFileId) return; // only auto-save if file already has a name
    updateSaveIndicator('dirty');
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(autoSave, 10000); // 10 seconds debounce
}

async function autoSave() {
    if (!_isDirty || !currentFileId || _isSaving) return;
    _isSaving = true;
    updateSaveIndicator('saving');
    try {
        await uploadImagesToStorage();
        const stateJson = getStateForSave();
        const thumbnail = await generateThumbnail();
        await window.fbUpdateFile(currentFileId, currentFileName, stateJson, state.pageWidth, state.pageHeight, thumbnail);
        _isDirty = false;
        updateSaveIndicator('saved');
        refreshSidebarFiles();
    } catch (err) {
        console.error('Auto-save error:', err);
        updateSaveIndicator('error');
    }
    _isSaving = false;
}

function updateSaveIndicator(status) {
    const el = document.getElementById('current-file-name');
    if (!el || !currentFileName) return;
    switch (status) {
        case 'dirty':
            el.textContent = currentFileName + ' \u2022';
            el.title = 'Cambios sin guardar';
            break;
        case 'saving':
            el.textContent = currentFileName + ' \u2013 Guardando...';
            el.title = 'Guardando...';
            break;
        case 'saved':
            el.textContent = currentFileName + ' \u2713';
            el.title = 'Guardado';
            setTimeout(() => {
                if (!_isDirty && el.textContent.includes('\u2713')) {
                    el.textContent = currentFileName;
                    el.title = '';
                }
            }, 2000);
            break;
        case 'error':
            el.textContent = currentFileName + ' \u2717';
            el.title = 'Error al guardar';
            break;
    }
}

async function uploadImagesToStorage() {
    if (!window.fbUploadImage) return;
    const promises = [];
    function processObj(obj) {
        if (obj.type === 'image' && obj.href && obj.href.startsWith('data:')) {
            const imgId = 'editor_images/' + (currentFileId || 'temp') + '_' + obj.id + '_' + Date.now();
            promises.push(
                window.fbUploadImage(obj.href, imgId).then(url => {
                    obj.href = url;
                    if (obj.element) {
                        obj.element.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
                        obj.element.setAttribute('href', url);
                    }
                }).catch(err => console.error('Error subiendo imagen:', err))
            );
        }
        if (obj.children) obj.children.forEach(processObj);
        if (obj.contents) obj.contents.forEach(processObj);
    }
    state.objects.forEach(processObj);
    if (promises.length > 0) await Promise.all(promises);
}

function getStateForSave() {
    return JSON.stringify({
        objects: state.objects.map(serializeObj),
        nextId: state.nextId,
    });
}

function updateFileNameDisplay() {
    const el = document.getElementById('current-file-name');
    if (currentFileName) {
        el.textContent = currentFileName;
        el.style.display = '';
        document.title = currentFileName + ' \u2014 Dekoor Editor';
    } else {
        el.style.display = 'none';
        document.title = 'Editor - Dekoor';
    }
}

function saveFile() {
    if (!window.firebaseReady) { alert('Firebase no est\u00e1 listo. Espera un momento.'); return; }
    if (currentFileId) {
        doSaveUpdate();
    } else {
        saveFileAs();
    }
}

function saveFileAs() {
    if (!window.firebaseReady) { alert('Firebase no est\u00e1 listo. Espera un momento.'); return; }
    const input = document.getElementById('save-file-name');
    input.value = currentFileName || '';
    document.getElementById('save-file-modal').classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 50);
}

async function doSaveNew(name) {
    try {
        await uploadImagesToStorage();
        const stateJson = getStateForSave();
        const thumbnail = await generateThumbnail();
        const docId = await window.fbSaveNewFile(name, stateJson, state.pageWidth, state.pageHeight, thumbnail);
        currentFileId = docId;
        currentFileName = name;
        _isDirty = false;
        if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
        const tab = editorTabs.find(t => t.id === activeTabId);
        if (tab) { tab.fileId = docId; tab.name = name; tab.isDirty = false; }
        updateFileNameDisplay();
        renderTabs();
        refreshSidebarFiles();
    } catch (err) {
        console.error('Error guardando archivo:', err);
        alert('Error al guardar: ' + err.message);
    }
}

async function doSaveUpdate() {
    try {
        await uploadImagesToStorage();
        const stateJson = getStateForSave();
        const thumbnail = await generateThumbnail();
        await window.fbUpdateFile(currentFileId, currentFileName, stateJson, state.pageWidth, state.pageHeight, thumbnail);
        _isDirty = false;
        if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
        updateSaveIndicator('saved');
        refreshSidebarFiles();
    } catch (err) {
        console.error('Error actualizando archivo:', err);
        alert('Error al guardar: ' + err.message);
    }
}

function showOpenFileModal() {
    if (!window.firebaseReady) { alert('Firebase no est\u00e1 listo. Espera un momento.'); return; }
    const modal = document.getElementById('open-file-modal');
    const list = document.getElementById('open-file-list');
    list.innerHTML = '<div class="file-list-loading">Cargando archivos...</div>';
    modal.classList.remove('hidden');
    loadFileList();
}

function hideOpenFileModal() {
    document.getElementById('open-file-modal').classList.add('hidden');
}

function hideSaveFileModal() {
    document.getElementById('save-file-modal').classList.add('hidden');
}

async function loadFileList() {
    const list = document.getElementById('open-file-list');
    try {
        const files = await window.fbListFiles();
        if (files.length === 0) {
            list.innerHTML = '<div class="file-list-empty">No hay archivos guardados.</div>';
            return;
        }
        list.innerHTML = '';
        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'file-item';

            const dateStr = file.updatedAt
                ? new Date(file.updatedAt.seconds * 1000).toLocaleString('es-MX', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })
                : '';

            const nameSpan = document.createElement('div');
            nameSpan.className = 'file-item-info';
            nameSpan.innerHTML =
                '<div class="file-item-name">' + escapeHtml(file.name) + '</div>' +
                '<div class="file-item-date">' + dateStr + '</div>';

            const delBtn = document.createElement('button');
            delBtn.className = 'file-item-delete';
            delBtn.title = 'Eliminar';
            delBtn.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">' +
                '<path d="M4 5h12M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1M9 8v6M11 8v6"/>' +
                '<path d="M5 5l1 11a1 1 0 001 1h6a1 1 0 001-1l1-11"/></svg>';

            nameSpan.addEventListener('click', () => {
                openFile(file);
                hideOpenFileModal();
            });

            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('\u00bfEliminar "' + file.name + '"?')) return;
                try {
                    await window.fbDeleteFile(file.id);
                    item.remove();
                    if (currentFileId === file.id) {
                        currentFileId = null;
                        currentFileName = null;
                        updateFileNameDisplay();
                    }
                    if (list.children.length === 0) {
                        list.innerHTML = '<div class="file-list-empty">No hay archivos guardados.</div>';
                    }
                } catch (err) {
                    alert('Error al eliminar: ' + err.message);
                }
            });

            item.appendChild(nameSpan);
            item.appendChild(delBtn);
            list.appendChild(item);
        }
    } catch (err) {
        console.error('Error cargando archivos:', err);
        list.innerHTML = '<div class="file-list-empty">Error al cargar archivos.</div>';
    }
}

function openFile(file) {
    // Check if this file is already open in a tab
    if (file.id) {
        const existingTab = editorTabs.find(t => t.fileId === file.id);
        if (existingTab) {
            switchToTab(existingTab.id);
            return;
        }
    }

    // Determine if we reuse current tab or create a new one
    const curTab = editorTabs.find(t => t.id === activeTabId);
    const reuseCurrentTab = curTab && !curTab.fileId && !curTab.isDirty && state.objects.length === 0;

    if (!reuseCurrentTab && curTab) {
        // Save current tab and create new one
        saveCurrentTabState();
        const tab = {
            id: _nextTabId++,
            name: file.name || 'Sin t\u00edtulo',
            fileId: file.id || null,
            stateSnapshot: null,
            undoStack: [],
            redoStack: [],
            pageWidth: file.pageWidth || state.pageWidth,
            pageHeight: file.pageHeight || state.pageHeight,
            isDirty: false,
        };
        editorTabs.push(tab);
        activeTabId = tab.id;
    } else if (curTab) {
        curTab.fileId = file.id || null;
        curTab.name = file.name || 'Sin t\u00edtulo';
        curTab.isDirty = false;
    }

    // Load the file content
    const snapshotData = JSON.parse(file.stateJson);
    snapshotData.selectedIds = [];
    restoreSnapshot(JSON.stringify(snapshotData));

    if (file.pageWidth) state.pageWidth = file.pageWidth;
    if (file.pageHeight) state.pageHeight = file.pageHeight;
    updatePage();
    resetView();

    currentFileId = file.id || null;
    currentFileName = file.name || null;
    _isDirty = false;
    updateFileNameDisplay();

    undoStack.length = 0;
    redoStack.length = 0;
    renderTabs();
}

function showToast(msg) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 1800);
}

function startInlineRename(nameEl, currentName, onSave) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'sidebar-rename-input';
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async () => {
        if (done) return;
        done = true;
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
            nameEl.textContent = newName;
            try { await onSave(newName); } catch (err) { alert('Error: ' + err.message); nameEl.textContent = currentName; }
        } else {
            nameEl.textContent = currentName;
        }
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { done = true; nameEl.textContent = currentName; }
        e.stopPropagation();
    });
    input.addEventListener('blur', finish);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function setupFileModals() {
    const saveModal = document.getElementById('save-file-modal');
    saveModal.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', hideSaveFileModal);
    });
    saveModal.querySelector('.modal-overlay').addEventListener('click', hideSaveFileModal);
    saveModal.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = document.getElementById('save-file-name').value.trim();
        if (!name) return;
        hideSaveFileModal();
        await doSaveNew(name);
    });
    document.getElementById('save-file-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveModal.querySelector('[data-action="save"]').click();
        }
    });

    const openModal = document.getElementById('open-file-modal');
    openModal.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', hideOpenFileModal);
    });
    openModal.querySelector('.modal-overlay').addEventListener('click', hideOpenFileModal);
}

// =============================================
// FILES SIDEBAR
// =============================================

function setupFilesSidebar() {
    const sidebar = document.getElementById('files-sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const openBtn = document.getElementById('sidebar-open-btn');
    const saveBtn = document.getElementById('sidebar-save-btn');
    const newBtn = document.getElementById('sidebar-new-btn');

    // Restore collapsed state from localStorage
    const collapsed = localStorage.getItem('dekoor-sidebar-collapsed') === 'true';
    if (collapsed) {
        sidebar.classList.add('collapsed');
        openBtn.classList.add('visible');
    }

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.add('collapsed');
        openBtn.classList.add('visible');
        localStorage.setItem('dekoor-sidebar-collapsed', 'true');
    });

    openBtn.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        openBtn.classList.remove('visible');
        localStorage.setItem('dekoor-sidebar-collapsed', 'false');
        refreshSidebarFiles();
    });

    saveBtn.addEventListener('click', () => saveFile());
    newBtn.addEventListener('click', () => {
        createTab();
    });

    // Tabs
    const tabs = sidebar.querySelectorAll('.sidebar-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('sidebar-tab-files').style.display = tabName === 'files' ? '' : 'none';
            document.getElementById('sidebar-tab-templates').style.display = tabName === 'templates' ? '' : 'none';
            if (tabName === 'templates') refreshSidebarTemplates();
        });
    });

    // Drag between tabs
    const filesTab = sidebar.querySelector('[data-tab="files"]');
    const templatesTab = sidebar.querySelector('[data-tab="templates"]');
    const filesPanel = document.getElementById('sidebar-tab-files');
    const templatesPanel = document.getElementById('sidebar-tab-templates');

    function setupDropZone(tabEl, panelEl, acceptType, onDrop) {
        for (const el of [tabEl, panelEl]) {
            el.addEventListener('dragover', (e) => {
                if (e.dataTransfer.types.includes(acceptType)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    tabEl.classList.add('drag-over');
                }
            });
            el.addEventListener('dragleave', (e) => {
                if (!el.contains(e.relatedTarget)) tabEl.classList.remove('drag-over');
            });
            el.addEventListener('drop', async (e) => {
                e.preventDefault();
                tabEl.classList.remove('drag-over');
                const data = e.dataTransfer.getData(acceptType);
                if (!data) return;
                await onDrop(JSON.parse(data));
            });
        }
    }

    // File → Templates
    setupDropZone(templatesTab, templatesPanel, 'application/x-editor-file', async (file) => {
        try {
            await window.fbSaveTemplate(file.name, file.stateJson, file.pageWidth, file.pageHeight);
            await window.fbDeleteFile(file.id);
            if (currentFileId === file.id) { currentFileId = null; currentFileName = null; updateFileNameDisplay(); }
            refreshSidebarFiles();
            tabs.forEach(t => t.classList.remove('active'));
            templatesTab.classList.add('active');
            filesPanel.style.display = 'none';
            templatesPanel.style.display = '';
            refreshSidebarTemplates();
            showToast('Movido a plantillas');
        } catch (err) { alert('Error: ' + err.message); }
    });

    // Template → Files
    setupDropZone(filesTab, filesPanel, 'application/x-editor-template', async (tpl) => {
        try {
            await window.fbSaveNewFile(tpl.name, tpl.stateJson, tpl.pageWidth, tpl.pageHeight);
            await window.fbDeleteTemplate(tpl.id);
            refreshSidebarTemplates();
            tabs.forEach(t => t.classList.remove('active'));
            filesTab.classList.add('active');
            templatesPanel.style.display = 'none';
            filesPanel.style.display = '';
            refreshSidebarFiles();
            showToast('Movido a archivos');
        } catch (err) { alert('Error: ' + err.message); }
    });

    // Save as template button
    document.getElementById('sidebar-save-template-btn').addEventListener('click', () => {
        if (!window.firebaseReady) { alert('Firebase no est\u00e1 listo.'); return; }
        if (state.objects.length === 0) { alert('No hay objetos para guardar.'); return; }
        const name = prompt('Nombre de la plantilla:');
        if (!name || !name.trim()) return;
        doSaveTemplate(name.trim());
    });

    // Load files when Firebase is ready
    waitForFirebase(() => { refreshSidebarFiles(); loadAIInstructions(); });
}

function waitForFirebase(cb) {
    if (window.firebaseReady) { cb(); return; }
    const interval = setInterval(() => {
        if (window.firebaseReady) { clearInterval(interval); cb(); }
    }, 200);
}

async function refreshSidebarFiles() {
    if (!window.firebaseReady) return;
    const list = document.getElementById('sidebar-file-list');
    try {
        const files = await window.fbListFiles();
        if (files.length === 0) {
            list.innerHTML = '<div class="sidebar-list-empty">Sin archivos guardados</div>';
            return;
        }
        list.innerHTML = '';
        for (const file of files) {
            list.appendChild(createSidebarFileItem(file));
        }
    } catch (err) {
        console.error('Error cargando sidebar:', err);
        list.innerHTML = '<div class="sidebar-list-empty">Error al cargar</div>';
    }
}

function createSidebarFileItem(file) {
    const item = document.createElement('div');
    item.className = 'sidebar-file-item' + (currentFileId === file.id ? ' active' : '');
    item.dataset.fileId = file.id;
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-editor-file', JSON.stringify({ id: file.id, name: file.name, stateJson: file.stateJson, pageWidth: file.pageWidth, pageHeight: file.pageHeight }));
        e.dataTransfer.effectAllowed = 'move';
    });

    const dateStr = file.updatedAt
        ? new Date(file.updatedAt.seconds * 1000).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
          })
        : '';

    const thumb = document.createElement('div');
    thumb.className = 'sidebar-file-thumb';
    if (file.thumbnail) {
        thumb.innerHTML = '<img src="' + file.thumbnail + '" alt="">';
    } else {
        thumb.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><path d="M4 3h8l4 4v10H4z"/><path d="M12 3v4h4"/></svg>';
    }

    const info = document.createElement('div');
    info.className = 'sidebar-file-info';
    info.innerHTML =
        '<div class="sidebar-file-name">' + escapeHtml(file.name) + '</div>' +
        '<div class="sidebar-file-date">' + dateStr + '</div>';

    // Double-click name to rename
    const nameEl = info.querySelector('.sidebar-file-name');
    nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineRename(nameEl, file.name, async (newName) => {
            file.name = newName;
            await window.fbUpdateFile(file.id, newName, file.stateJson, file.pageWidth, file.pageHeight, file.thumbnail);
            if (currentFileId === file.id) { currentFileName = newName; updateFileNameDisplay(); }
        });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'sidebar-file-del';
    delBtn.title = 'Eliminar';
    delBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5l.5-9"/></svg>';

    item.addEventListener('click', (e) => {
        if (e.target.closest('.sidebar-file-del')) return;
        if (e.target.closest('input')) return;
        openFile(file);
        document.querySelectorAll('.sidebar-file-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
    });

    delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('\u00bfEliminar "' + file.name + '"?')) return;
        try {
            await window.fbDeleteFile(file.id);
            item.remove();
            if (currentFileId === file.id) {
                currentFileId = null;
                currentFileName = null;
                updateFileNameDisplay();
            }
            const list = document.getElementById('sidebar-file-list');
            if (list.children.length === 0) {
                list.innerHTML = '<div class="sidebar-list-empty">Sin archivos guardados</div>';
            }
        } catch (err) {
            alert('Error al eliminar: ' + err.message);
        }
    });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(delBtn);
    return item;
}

// =============================================
// TEMPLATES SIDEBAR
// =============================================

async function doSaveTemplate(name) {
    try {
        await uploadImagesToStorage();
        const stateJson = getStateForSave();
        const thumbnail = await generateThumbnail();
        await window.fbSaveTemplate(name, stateJson, state.pageWidth, state.pageHeight, thumbnail);
        refreshSidebarTemplates();
    } catch (err) {
        console.error('Error guardando plantilla:', err);
        alert('Error al guardar plantilla: ' + err.message);
    }
}

async function refreshSidebarTemplates() {
    if (!window.firebaseReady) return;
    const list = document.getElementById('sidebar-template-list');
    try {
        const templates = await window.fbListTemplates();
        if (templates.length === 0) {
            list.innerHTML = '<div class="sidebar-list-empty">Sin plantillas</div>';
            return;
        }
        list.innerHTML = '';
        for (const tpl of templates) {
            list.appendChild(createSidebarTemplateItem(tpl));
        }
    } catch (err) {
        console.error('Error cargando plantillas:', err);
        list.innerHTML = '<div class="sidebar-list-empty">Error al cargar</div>';
    }
}

function createSidebarTemplateItem(tpl) {
    const item = document.createElement('div');
    item.className = 'sidebar-file-item';
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-editor-template', JSON.stringify({ id: tpl.id, name: tpl.name, stateJson: tpl.stateJson, pageWidth: tpl.pageWidth, pageHeight: tpl.pageHeight }));
        e.dataTransfer.effectAllowed = 'move';
    });

    const dateStr = tpl.updatedAt
        ? new Date(tpl.updatedAt.seconds * 1000).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
          })
        : '';

    const thumb = document.createElement('div');
    thumb.className = 'sidebar-file-thumb';
    if (tpl.thumbnail) {
        thumb.innerHTML = '<img src="' + tpl.thumbnail + '" alt="">';
    } else {
        thumb.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 7h14M7 3v14"/></svg>';
    }

    const info = document.createElement('div');
    info.className = 'sidebar-file-info';
    info.innerHTML =
        '<div class="sidebar-file-name">' + escapeHtml(tpl.name) + '</div>' +
        '<div class="sidebar-file-date">' + dateStr + '</div>';

    // Double-click name to rename
    const tplNameEl = info.querySelector('.sidebar-file-name');
    tplNameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineRename(tplNameEl, tpl.name, async (newName) => {
            tpl.name = newName;
            await window.fbUpdateTemplate(tpl.id, newName);
        });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'sidebar-file-del';
    delBtn.title = 'Eliminar';
    delBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5l.5-9"/></svg>';

    item.addEventListener('click', (e) => {
        if (e.target.closest('.sidebar-file-del')) return;
        if (e.target.closest('input')) return;
        openFile(tpl);
        currentFileId = null;
        currentFileName = null;
        updateFileNameDisplay();
    });

    delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('\u00bfEliminar plantilla "' + tpl.name + '"?')) return;
        try {
            await window.fbDeleteTemplate(tpl.id);
            item.remove();
            const list = document.getElementById('sidebar-template-list');
            if (list.children.length === 0) {
                list.innerHTML = '<div class="sidebar-list-empty">Sin plantillas</div>';
            }
        } catch (err) {
            alert('Error al eliminar: ' + err.message);
        }
    });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(delBtn);
    return item;
}

// =============================================
// AI CHAT
// =============================================

let _aiChatHistory = [];
let _aiInstructions = 'Eres un asistente de dise\u00f1o gr\u00e1fico integrado en un editor SVG. Ayuda al usuario con sus dise\u00f1os, da sugerencias creativas y responde preguntas sobre el editor.';
let _aiInstructionsLoaded = false;
let _aiRespondWithVoice = false;
let _aiCurrentAudio = null;

async function loadAIInstructions() {
    if (_aiInstructionsLoaded) return;
    try {
        if (window.fbGetAIInstructions) {
            const instr = await window.fbGetAIInstructions();
            if (instr) _aiInstructions = instr;
            _aiInstructionsLoaded = true;
        }
    } catch (e) { console.error('Error cargando instrucciones AI:', e); }
}

function showAIInstructionsModal() {
    const modal = document.getElementById('ai-instructions-modal');
    loadAIInstructions().then(() => {
        document.getElementById('ai-instructions-text').value = _aiInstructions;
    });
    document.getElementById('ai-instructions-text').value = _aiInstructions;
    modal.classList.remove('hidden');
}

function setupAIChat() {
    // Instructions modal
    const instrModal = document.getElementById('ai-instructions-modal');
    instrModal.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', () => instrModal.classList.add('hidden'));
    });
    instrModal.querySelector('.modal-overlay').addEventListener('click', () => instrModal.classList.add('hidden'));
    instrModal.querySelector('[data-action="save"]').addEventListener('click', async () => {
        _aiInstructions = document.getElementById('ai-instructions-text').value.trim();
        instrModal.classList.add('hidden');
        try {
            if (window.fbSaveAIInstructions) await window.fbSaveAIInstructions(_aiInstructions);
            showToast('Instrucciones guardadas');
        } catch (e) {
            alert('Error al guardar: ' + e.message);
        }
    });

    // Chat bubble
    document.getElementById('ai-chat-bubble').addEventListener('click', toggleAIChat);
    document.getElementById('ai-chat-close').addEventListener('click', () => {
        document.getElementById('ai-chat-panel').classList.add('hidden');
        document.getElementById('ai-chat-bubble').classList.remove('hidden');
    });

    // Chat input
    const chatInput = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-chat-send');
    sendBtn.addEventListener('click', sendAIMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
        e.stopPropagation(); // prevent editor shortcuts
    });
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });

    // Microphone button
    document.getElementById('ai-mic-btn').addEventListener('click', startVoiceInput);
}

function toggleAIChat() {
    const panel = document.getElementById('ai-chat-panel');
    const bubble = document.getElementById('ai-chat-bubble');
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    bubble.classList.toggle('hidden', !panel.classList.contains('hidden'));
    if (isHidden) {
        document.getElementById('ai-chat-input').focus();
        // Show welcome message if chat is empty
        const msgs = document.getElementById('ai-chat-messages');
        if (msgs.children.length === 0) {
            const welcome = document.createElement('div');
            welcome.className = 'ai-chat-welcome';
            welcome.innerHTML = `<div class="ai-chat-welcome-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5z"/></svg></div><h4>Hola, soy Andrea</h4><p>Tu asistente de dise\u00f1o. Puedo ayudarte con el editor, consultar pedidos o lo que necesites.</p>`;
            msgs.appendChild(welcome);
        }
    }
}

function addChatMessage(role, text) {
    if (!text) return;
    const container = document.getElementById('ai-chat-messages');
    const msg = document.createElement('div');
    msg.className = 'ai-chat-msg ' + (role === 'user' ? 'ai-chat-msg-user' : 'ai-chat-msg-ai');
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

// --- AI AGENTIC: Canvas context, parser, executor ---

function buildCanvasContext() {
    const ctx = {
        unit: state.unit,
        page: { width_u: toUnit(state.pageWidth), height_u: toUnit(state.pageHeight) },
        selectedIds: [...state.selectedIds],
        objects: []
    };
    const objs = state.objects.slice(-50);
    for (const obj of objs) {
        const o = { id: obj.id, type: obj.type };
        if (obj.type === 'ellipse') {
            o.cx_u = toUnit(obj.cx); o.cy_u = toUnit(obj.cy);
            o.rx_u = toUnit(obj.rx); o.ry_u = toUnit(obj.ry);
        } else if (obj.type === 'line') {
            o.x1_u = toUnit(obj.x1); o.y1_u = toUnit(obj.y1);
            o.x2_u = toUnit(obj.x2); o.y2_u = toUnit(obj.y2);
        } else {
            const b = getObjBounds(obj);
            o.x_u = toUnit(b.x); o.y_u = toUnit(b.y);
            o.width_u = toUnit(b.w); o.height_u = toUnit(b.h);
        }
        o.fill = obj.fill || 'none';
        o.stroke = obj.stroke || 'none';
        if (obj.strokeWidth) o.strokeWidth = obj.strokeWidth;
        if (obj.rotation) o.rotation = obj.rotation;
        if (obj.type === 'text') {
            o.text = (obj.text || '').slice(0, 50);
            o.fontFamily = obj.fontFamily;
            o.fontSize_u = toUnit(obj.fontSize);
        }
        if (obj.type === 'group') {
            o.childCount = (obj.children || []).length;
            o.children = (obj.children || []).map(ch => {
                const co = { id: ch.id, type: ch.type };
                if (ch.type === 'text') { co.text = (ch.text || '').slice(0, 50); co.fontFamily = ch.fontFamily; }
                if (ch.isRefArea) { co.isRefArea = true; co.refTextIds = ch.refTextIds || []; }
                return co;
            });
        }
        if (obj.type === 'powerclip') o.contentCount = (obj.contents || []).length;
        ctx.objects.push(o);
    }
    if (state.objects.length > 50) ctx.truncated = state.objects.length - 50;
    return ctx;
}

function parseAIResponse(responseText) {
    const parts = [];
    const regex = /```actions\s*\n([\s\S]*?)```/g;
    let lastIndex = 0, match;
    while ((match = regex.exec(responseText)) !== null) {
        if (match.index > lastIndex) {
            const txt = responseText.slice(lastIndex, match.index).trim();
            if (txt) parts.push({ type: 'text', content: txt });
        }
        try {
            const actions = JSON.parse(match[1]);
            parts.push({ type: 'actions', content: Array.isArray(actions) ? actions : [actions] });
        } catch (e) {
            parts.push({ type: 'text', content: '[Error al interpretar acción]' });
        }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < responseText.length) {
        const txt = responseText.slice(lastIndex).trim();
        if (txt) parts.push({ type: 'text', content: txt });
    }
    return parts;
}

function resolveTarget(target) {
    if (target === 'selected') {
        if (state.selectedIds.length === 0) throw new Error('No hay objeto seleccionado');
        return state.selectedIds.map(id => findObjectDeep(id) || findObject(id)).filter(Boolean);
    }
    const obj = findObjectDeep(target) || findObject(target);
    if (!obj) throw new Error(`Objeto ID ${target} no encontrado`);
    return [obj];
}

function executeSingleAction(action) {
    const a = action;
    if (!a || !a.action) return {};
    // Normalize action aliases the AI might use
    const ACTION_ALIASES = {
        create: 'create', add: 'create', add_shape: 'create', addObject: 'create', addShape: 'create',
        create_shape: 'create', insert: 'create', draw: 'create', createObject: 'create',
        modify: 'modify', change: 'modify', update: 'modify', set: 'modify', edit: 'modify',
        move: 'move', moveTo: 'moveTo', move_to: 'moveTo', position: 'moveTo',
        resize: 'resize', scale: 'resize',
        delete: 'delete', remove: 'delete', erase: 'delete', deleteObject: 'delete', removeObject: 'delete',
        duplicate: 'duplicate', copy: 'duplicate', clone: 'duplicate',
        order: 'order', reorder: 'order', z_order: 'order', zOrder: 'order',
        flip: 'flip', mirror: 'flip',
        select: 'select',
        get_orders: 'get_orders', getOrders: 'get_orders', query_orders: 'get_orders', list_orders: 'get_orders',
        update_order: 'update_order', updateOrder: 'update_order', modify_order: 'update_order'
    };
    const actionName = ACTION_ALIASES[a.action] || a.action;

    switch (actionName) {
        case 'create': {
            const p = a.props || {};
            const props = {};
            // Convert _u values to px
            for (const [k, v] of Object.entries(p)) {
                if (k.endsWith('_u')) {
                    props[k.slice(0, -2)] = fromUnit(v);
                } else {
                    props[k] = v;
                }
            }
            // Default position: center of page if not specified
            if (a.type === 'rect' || a.type === 'text' || a.type === 'image') {
                if (props.x == null) props.x = (state.pageWidth - (props.width || 0)) / 2;
                if (props.y == null) props.y = (state.pageHeight - (props.height || 0)) / 2;
            } else if (a.type === 'ellipse') {
                if (props.cx == null) props.cx = state.pageWidth / 2;
                if (props.cy == null) props.cy = state.pageHeight / 2;
            } else if (a.type === 'line') {
                if (props.x1 == null) props.x1 = state.pageWidth * 0.3;
                if (props.y1 == null) props.y1 = state.pageHeight / 2;
                if (props.x2 == null) props.x2 = state.pageWidth * 0.7;
                if (props.y2 == null) props.y2 = state.pageHeight / 2;
            }
            console.log('[AI Create]', a.type, props);
            const obj = createObject(a.type, props);
            return { id: obj.id };
        }
        case 'modify': {
            const targets = resolveTarget(a.target);
            const p = a.props || {};
            for (const obj of targets) {
                for (const [k, v] of Object.entries(p)) {
                    if (k.endsWith('_u')) {
                        obj[k.slice(0, -2)] = fromUnit(v);
                    } else {
                        obj[k] = v;
                    }
                }
                refreshElement(obj);
                // Re-fit text to reference area if text was changed
                if (obj.type === 'text' && p.text != null) {
                    fitTextToRefArea(obj).then(() => { refreshElement(obj); drawSelection(); });
                }
            }
            return { id: targets[0]?.id };
        }
        case 'move': {
            const targets = resolveTarget(a.target);
            const dx = a.dx_u != null ? fromUnit(a.dx_u) : 0;
            const dy = a.dy_u != null ? fromUnit(a.dy_u) : 0;
            for (const obj of targets) {
                offsetObject(obj, dx, dy);
                refreshElement(obj);
            }
            return { id: targets[0]?.id };
        }
        case 'moveTo': {
            const targets = resolveTarget(a.target);
            for (const obj of targets) {
                applyPropPosition(obj, a.x_u, a.y_u);
                refreshElement(obj);
            }
            return { id: targets[0]?.id };
        }
        case 'resize': {
            const targets = resolveTarget(a.target);
            const wPx = a.width_u != null ? fromUnit(a.width_u) : null;
            const hPx = a.height_u != null ? fromUnit(a.height_u) : null;
            for (const obj of targets) {
                if (wPx != null && hPx != null) applyPropSize(obj, wPx, hPx);
                refreshElement(obj);
            }
            return { id: targets[0]?.id };
        }
        case 'delete': {
            const targets = resolveTarget(a.target);
            for (const obj of targets) {
                const idx = state.objects.findIndex(o => o.id === obj.id);
                if (idx !== -1) { obj.element.remove(); state.objects.splice(idx, 1); }
            }
            state.selectedIds = state.selectedIds.filter(id => findObject(id));
            drawSelection();
            return {};
        }
        case 'duplicate': {
            const targets = resolveTarget(a.target);
            state.selectedIds = targets.map(o => o.id);
            drawSelection();
            duplicateSelected();
            return { id: state.selectedIds[0] };
        }
        case 'order': {
            const targets = resolveTarget(a.target);
            state.selectedIds = targets.map(o => o.id);
            if (a.position === 'front') bringToFront();
            else if (a.position === 'back') sendToBack();
            return { id: targets[0]?.id };
        }
        case 'flip': {
            const targets = resolveTarget(a.target);
            for (const obj of targets) {
                flipObject(obj, a.direction);
                refreshElement(obj);
            }
            return { id: targets[0]?.id };
        }
        case 'select': {
            const obj = findObject(a.target);
            if (obj) selectObject(obj.id);
            return { id: a.target };
        }
        case 'get_orders': {
            const dateParam = a.date || 'today';
            const url = dateParam === 'today' ? '/api/orders/today' : `/api/orders/history?date=${dateParam}`;
            fetch(url).then(r => r.json()).then(data => {
                if (data.success && data.orders) {
                    const lines = data.orders.map(o =>
                        `#${o.consecutiveOrderNumber || '?'} | ${o.clientName} | ${o.producto || 'N/A'} | $${o.total || 0} | ${o.estatus}`
                    );
                    const msg = lines.length > 0
                        ? `📋 **${lines.length} pedidos:**\n${lines.join('\n')}`
                        : 'No hay pedidos para esa fecha.';
                    addChatMessage('ai', msg);
                }
            }).catch(e => addChatMessage('ai', 'Error consultando pedidos: ' + e.message));
            return {};
        }
        case 'update_order': {
            if (!a.orderId) throw new Error('Se requiere orderId para actualizar pedido');
            const props = a.props || {};
            fetch(`/api/orders/${a.orderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(props)
            }).then(r => r.json()).then(data => {
                if (data.success) {
                    addChatMessage('ai', `✅ Pedido actualizado.`);
                } else {
                    addChatMessage('ai', `❌ Error: ${data.message}`);
                }
            }).catch(e => addChatMessage('ai', 'Error actualizando pedido: ' + e.message));
            return {};
        }
        default:
            throw new Error(`Acción desconocida: ${a.action} (normalizada: ${actionName})`);
    }
}

function executeAIActions(actions) {
    if (!actions || actions.length === 0) return;

    saveUndoState();
    const prevBatch = _batchImporting;
    _batchImporting = true; // Prevent individual saveUndoState calls inside createObject/etc

    const affectedIds = [];
    console.log('[AI Actions]', JSON.stringify(actions, null, 2));
    for (const action of actions) {
        try {
            const result = executeSingleAction(action);
            if (result && result.id) affectedIds.push(result.id);
        } catch (e) {
            console.error('AI action error:', e, action);
            showToast('Error: ' + e.message);
        }
    }

    _batchImporting = prevBatch;

    // Select affected objects so user sees what changed
    if (affectedIds.length > 0) {
        state.selectedIds = affectedIds.filter(id => findObject(id));
        drawSelection();
        updatePropsPanel();
    }
    markDirty();
}

// --- AI AGENTIC END ---

// --- AI VOICE (TTS) & MICROPHONE (STT) ---

async function speakAIResponse(text) {
    if (!text) return;
    if (_aiCurrentAudio) { _aiCurrentAudio.pause(); _aiCurrentAudio = null; }
    try {
        const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await res.json();
        if (data.success && data.audioContent) {
            const audio = new Audio('data:audio/mp3;base64,' + data.audioContent);
            _aiCurrentAudio = audio;
            audio.play();
        }
    } catch (e) {
        console.error('TTS error:', e);
    }
}

let _voiceAudioCtx = null, _voiceAnalyser = null, _voiceStream = null, _voiceAnimId = null;
let _pendingVoiceMedia = null; // { base64, mimeType }

function startVoiceInput() {
    const overlay = document.getElementById('ai-voice-overlay');
    const canvas = document.getElementById('ai-voice-canvas');
    const statusEl = document.getElementById('ai-voice-status');
    const ctx = canvas.getContext('2d');
    const micBtn = document.getElementById('ai-mic-btn');
    const stopBtn = document.getElementById('ai-voice-stop');

    overlay.classList.remove('hidden');
    micBtn.classList.add('ai-mic-active');
    statusEl.textContent = 'Grabando...';

    let recorder = null, chunks = [], silenceTimer = null, stopped = false;

    function cleanup() {
        stopped = true;
        cancelAnimationFrame(_voiceAnimId);
        clearTimeout(silenceTimer);
        overlay.classList.add('hidden');
        micBtn.classList.remove('ai-mic-active');
        if (_voiceStream) { _voiceStream.getTracks().forEach(t => t.stop()); _voiceStream = null; }
        if (_voiceAudioCtx && _voiceAudioCtx.state !== 'closed') { _voiceAudioCtx.close().catch(() => {}); }
        _voiceAudioCtx = null;
        _voiceAnalyser = null;
    }

    function stopAndSend() {
        if (stopped) return;
        stopped = true;
        statusEl.textContent = 'Enviando...';
        if (recorder && recorder.state === 'recording') recorder.stop();
    }

    // Stop/send button
    const onStop = () => { stopAndSend(); stopBtn.removeEventListener('click', onStop); };
    stopBtn.addEventListener('click', onStop);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        _voiceStream = stream;

        // MediaRecorder for audio capture
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
            : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result; // data:audio/...;base64,...
                _pendingVoiceMedia = { base64, mimeType: recorder.mimeType || 'audio/webm' };
                cleanup();
                // Open chat if not open
                const panel = document.getElementById('ai-chat-panel');
                if (panel.classList.contains('hidden')) toggleAIChat();
                // Send with a prompt that tells the AI to process the audio
                document.getElementById('ai-chat-input').value = '[Audio enviado por voz]';
                _aiRespondWithVoice = true;
                sendAIMessage();
            };
            reader.readAsDataURL(blob);
        };
        recorder.start(250); // collect in 250ms chunks

        // Web Audio API for visualization
        _voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = _voiceAudioCtx.createMediaStreamSource(stream);
        _voiceAnalyser = _voiceAudioCtx.createAnalyser();
        _voiceAnalyser.fftSize = 256;
        _voiceAnalyser.smoothingTimeConstant = 0.4;
        source.connect(_voiceAnalyser);

        const bufLen = _voiceAnalyser.fftSize;
        const dataArr = new Uint8Array(bufLen);
        const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
        let phase = 0;
        const smoothVol = { current: 0 };
        let silentSince = 0;

        function drawOrb() {
            if (stopped) return;
            _voiceAnimId = requestAnimationFrame(drawOrb);
            _voiceAnalyser.getByteTimeDomainData(dataArr);

            // Calculate RMS volume (0-1) from time domain data
            let sumSq = 0;
            for (let i = 0; i < bufLen; i++) {
                const v = (dataArr[i] - 128) / 128;
                sumSq += v * v;
            }
            const rms = Math.sqrt(sumSq / bufLen);
            const rawVol = Math.min(rms * 3, 1); // Amplify ×3
            smoothVol.current += (rawVol - smoothVol.current) * 0.25;
            const vol = smoothVol.current;

            // Auto-stop after 3s of silence
            if (vol < 0.03 && chunks.length > 0) {
                if (!silentSince) silentSince = Date.now();
                else if (Date.now() - silentSince > 3000) { stopAndSend(); return; }
            } else { silentSince = 0; }

            phase += 0.025;
            ctx.clearRect(0, 0, W, H);

            // Outer glow
            const glowR = 65 + vol * 45;
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR + 30);
            glow.addColorStop(0, `rgba(124, 92, 240, ${0.1 + vol * 0.2})`);
            glow.addColorStop(1, 'rgba(124, 92, 240, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, W, H);

            // Organic blob layers - amplified wobble
            const layers = [
                { r: 40 + vol * 35, alpha: 0.1, color: '167, 139, 250', speed: 1.3, points: 6 },
                { r: 33 + vol * 30, alpha: 0.18, color: '139, 112, 245', speed: 1, points: 5 },
                { r: 27 + vol * 22, alpha: 0.45, color: '124, 92, 240', speed: 0.7, points: 5 },
                { r: 20 + vol * 16, alpha: 0.8, color: '110, 80, 230', speed: 0.4, points: 4 },
            ];

            for (const layer of layers) {
                ctx.beginPath();
                const steps = 100;
                for (let i = 0; i <= steps; i++) {
                    const angle = (i / steps) * Math.PI * 2;
                    let wobble = 0;
                    for (let n = 1; n <= layer.points; n++) {
                        const amp = (vol * 24 + 3) / (n * 1.1);
                        wobble += Math.sin(angle * n + phase * layer.speed * (n % 2 === 0 ? 1 : -1)) * amp;
                    }
                    const r = layer.r + wobble;
                    const x = cx + Math.cos(angle) * r;
                    const y = cy + Math.sin(angle) * r;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.fillStyle = `rgba(${layer.color}, ${layer.alpha})`;
                ctx.fill();
            }

            // Center bright spot
            const bright = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16 + vol * 10);
            bright.addColorStop(0, `rgba(255, 255, 255, ${0.25 + vol * 0.4})`);
            bright.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = bright;
            ctx.beginPath();
            ctx.arc(cx, cy, 16 + vol * 10, 0, Math.PI * 2);
            ctx.fill();
        }
        drawOrb();
    }).catch(err => {
        console.error('Microphone error:', err);
        showToast('No se pudo acceder al micrófono');
        cleanup();
    });
}

// --- AI VOICE END ---

async function sendAIMessage() {
    const input = document.getElementById('ai-chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    addChatMessage('user', text);

    _aiChatHistory.push({ role: 'user', content: text });

    // Show typing indicator
    // Remove welcome message if present
    const welcome = document.querySelector('.ai-chat-welcome');
    if (welcome) welcome.remove();

    const typing = document.createElement('div');
    typing.className = 'ai-chat-msg ai-chat-msg-ai ai-chat-typing';
    typing.innerHTML = '<div class="ai-shimmer-bar"></div><div class="ai-shimmer-bar"></div>';
    document.getElementById('ai-chat-messages').appendChild(typing);
    document.getElementById('ai-chat-messages').scrollTop = document.getElementById('ai-chat-messages').scrollHeight;
    const statusEl = document.getElementById('ai-chat-status');
    statusEl.textContent = 'pensando...';
    statusEl.classList.add('thinking');
    document.querySelector('.ai-avatar').classList.add('thinking');

    try {
        const history = _aiChatHistory.slice(-20);
        const canvasContext = buildCanvasContext();

        const res = await fetch('/api/simulate-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text, history, source: 'editor', canvasContext,
                mediaBase64: _pendingVoiceMedia ? _pendingVoiceMedia.base64 : undefined,
                mediaMimeType: _pendingVoiceMedia ? _pendingVoiceMedia.mimeType : undefined
            })
        });
        const data = await res.json();
        typing.remove();
        _pendingVoiceMedia = null;
        const st = document.getElementById('ai-chat-status');
        st.textContent = 'en linea';
        st.classList.remove('thinking');
        document.querySelector('.ai-avatar').classList.remove('thinking');

        if (data.success && data.response) {
            const rawResponse = data.response;
            _aiChatHistory.push({ role: 'model', content: rawResponse });

            // Parse response for text and action blocks
            const parts = parseAIResponse(rawResponse);
            let hasActions = false;
            const textParts = [];
            for (const part of parts) {
                if (part.type === 'text') {
                    addChatMessage('ai', part.content);
                    textParts.push(part.content);
                } else if (part.type === 'actions') {
                    hasActions = true;
                    executeAIActions(part.content);
                }
            }
            if (hasActions) {
                addChatMessage('ai', '✅ Acciones ejecutadas.');
            }
            // Speak only if user sent via microphone
            if (_aiRespondWithVoice && textParts.length > 0) {
                speakAIResponse(textParts.join(' '));
            }
            _aiRespondWithVoice = false;
        } else {
            addChatMessage('ai', 'Error: No pude obtener respuesta.');
        }
    } catch (err) {
        typing.remove();
        const ste = document.getElementById('ai-chat-status');
        ste.textContent = 'en linea';
        ste.classList.remove('thinking');
        document.querySelector('.ai-avatar').classList.remove('thinking');
        addChatMessage('ai', 'Error de conexión: ' + err.message);
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
    // Use 100 user units per mm (CorelDRAW convention for mm-based documents)
    const S = 100;
    const vbW = state.pageWidth * S, vbH = state.pageHeight * S;

    const root = document.createElementNS(ns, 'svg');
    root.setAttribute('xmlns', ns);
    root.setAttribute('xmlns:xlink', xlink);
    root.setAttribute('xml:space', 'preserve');
    root.setAttribute('width', state.pageWidth + 'mm');
    root.setAttribute('height', state.pageHeight + 'mm');
    root.setAttribute('version', '1.1');
    root.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
    root.setAttribute('style', 'shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd');

    let clipCounter = 0;

    function exportObj(obj, parent) {
        if (obj.type === 'text') {
            const pathData = textToPath(obj);
            if (pathData) {
                const p = document.createElementNS(ns, 'path');
                p.setAttribute('d', scalePathD(pathData, S));
                p.setAttribute('fill', obj.fill);
                p.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
                p.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth * S);
                if (obj.rotation) {
                    const b = getObjBounds(obj);
                    const cx = (b.x + b.w/2) * S, cy = (b.y + b.h/2) * S;
                    p.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
                }
                parent.appendChild(p);
            } else {
                const fallback = textToFallbackSVG(obj, ns);
                parent.appendChild(fallback);
            }
            return;
        }
        if (obj.type === 'image') {
            const img = document.createElementNS(ns, 'image');
            img.setAttribute('x', obj.x * S); img.setAttribute('y', obj.y * S);
            img.setAttribute('width', obj.width * S); img.setAttribute('height', obj.height * S);
            img.setAttribute('preserveAspectRatio', 'none');
            img.setAttributeNS(xlink, 'xlink:href', obj.href);
            img.setAttribute('href', obj.href);
            if (obj.rotation) {
                const cx = (obj.x + obj.width/2) * S, cy = (obj.y + obj.height/2) * S;
                img.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
            }
            parent.appendChild(img);
        } else if (obj.type === 'powerclip') {
            const g = document.createElementNS(ns, 'g');
            const clipId = 'clip' + (clipCounter++);
            const defs = document.createElementNS(ns, 'defs');
            const cp = document.createElementNS(ns, 'clipPath');
            cp.setAttribute('id', clipId);
            // Build clip shape scaled to viewBox
            const clipShape = buildClipShape(obj.container, ns);
            scaleElement(clipShape, S);
            cp.appendChild(clipShape);
            defs.appendChild(cp);
            g.appendChild(defs);
            // Container shape (visible border)
            exportObj(obj.container, g);
            // Clipped contents — use style= for CorelDRAW compatibility
            const cg = document.createElementNS(ns, 'g');
            cg.setAttribute('style', `clip-path:url(#${clipId})`);
            for (const c of obj.contents) exportObj(c, cg);
            g.appendChild(cg);
            parent.appendChild(g);
        } else {
            // rect, ellipse, line, bspline, curvepath — clone and scale
            const clone = obj.element.cloneNode(true);
            clone.removeAttribute('data-object-id'); clone.removeAttribute('style');
            scaleElement(clone, S);
            parent.appendChild(clone);
        }
    }

    // Scale an SVG element's coordinates by factor S
    function scaleElement(el, s) {
        const tag = el.tagName;
        const attrs = { x: s, y: s, width: s, height: s, cx: s, cy: s, rx: s, ry: s,
                        x1: s, y1: s, x2: s, y2: s, 'stroke-width': s };
        for (const [attr, factor] of Object.entries(attrs)) {
            const v = el.getAttribute(attr);
            if (v !== null && !isNaN(parseFloat(v))) {
                el.setAttribute(attr, parseFloat(v) * factor);
            }
        }
        // Scale path d attribute
        if (el.hasAttribute('d')) {
            el.setAttribute('d', scalePathD(el.getAttribute('d'), s));
        }
        // Scale font-size
        if (el.hasAttribute('font-size')) {
            el.setAttribute('font-size', parseFloat(el.getAttribute('font-size')) * s);
        }
        // Scale transform if present
        const t = el.getAttribute('transform');
        if (t) {
            const rotMatch = t.match(/rotate\(\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\)/);
            if (rotMatch) {
                el.setAttribute('transform', `rotate(${rotMatch[1]} ${parseFloat(rotMatch[2]) * s} ${parseFloat(rotMatch[3]) * s})`);
            }
        }
    }

    // Scale all coordinates in a path d string by factor s
    function scalePathD(d, s) {
        return d.replace(/([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g, (m) => {
            return (parseFloat(m) * s).toFixed(2);
        });
    }

    // Layer group (CorelDRAW convention)
    const layerGroup = document.createElementNS(ns, 'g');
    layerGroup.setAttribute('id', 'Capa_x0020_1');
    const meta = document.createElementNS(ns, 'metadata');
    meta.setAttribute('id', 'CorelCorpID_0Corel-Layer');
    layerGroup.appendChild(meta);

    for (const obj of state.objects) exportObj(obj, layerGroup);
    root.appendChild(layerGroup);

    let str = '<?xml version="1.0" encoding="UTF-8"?>\n';
    str += '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';
    str += new XMLSerializer().serializeToString(root);
    // Fix namespace serialization
    str = str.replace(/ns\d+:href/g, 'xlink:href');
    // Add Inkscape metadata for K40 Whisperer compatibility
    str = str.replace('<svg ', '<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="0.92.4" ');
    const blob = new Blob([str], {type:'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dibujo.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =============================================
// CLIPBOARD COPY / PASTE (SVG interop with CorelDRAW)
// =============================================
async function copySelectedAsSVG() {
    if (state.selectedIds.length === 0) return;
    const objs = state.selectedIds.map(id => findObject(id)).filter(Boolean);
    if (objs.length === 0) return;

    // Ensure fonts loaded for text objects
    const usedFonts = new Set(objs.filter(o => o.type === 'text').map(o => o.fontFamily));
    for (const fn of usedFonts) {
        if (!loadedOTFonts[fn]) await loadOTFont(fn);
    }

    // Compute bounding box of selected objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objs) {
        const b = getObjBounds(obj);
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
        if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    const bw = maxX - minX, bh = maxY - minY;

    const ns = 'http://www.w3.org/2000/svg';
    const xlink = 'http://www.w3.org/1999/xlink';
    const S = 100; // 100 units per mm (CorelDRAW convention)

    const root = document.createElementNS(ns, 'svg');
    root.setAttribute('xmlns', ns);
    root.setAttribute('xmlns:xlink', xlink);
    root.setAttribute('xml:space', 'preserve');
    root.setAttribute('width', (bw * UNITS.mm.factor) + 'mm');
    root.setAttribute('height', (bh * UNITS.mm.factor) + 'mm');
    root.setAttribute('version', '1.1');
    root.setAttribute('viewBox', `${minX * S} ${minY * S} ${bw * S} ${bh * S}`);
    root.setAttribute('style', 'shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd');

    // Reuse exportObj from exportSVG — rebuild inline since it uses closure vars
    let clipCounter = 0;

    function scalePathD(d, s) {
        return d.replace(/([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g, (m) => {
            return (parseFloat(m) * s).toFixed(2);
        });
    }

    function scaleElement(el, s) {
        const tag = el.tagName;
        const attrs = { x: s, y: s, width: s, height: s, cx: s, cy: s, rx: s, ry: s,
                        x1: s, y1: s, x2: s, y2: s, 'stroke-width': s };
        for (const [attr, factor] of Object.entries(attrs)) {
            const v = el.getAttribute(attr);
            if (v !== null && !isNaN(parseFloat(v))) el.setAttribute(attr, parseFloat(v) * factor);
        }
        if (el.hasAttribute('d')) el.setAttribute('d', scalePathD(el.getAttribute('d'), s));
        if (el.hasAttribute('font-size')) el.setAttribute('font-size', parseFloat(el.getAttribute('font-size')) * s);
        const t = el.getAttribute('transform');
        if (t) {
            const rotMatch = t.match(/rotate\(\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\)/);
            if (rotMatch) el.setAttribute('transform', `rotate(${rotMatch[1]} ${parseFloat(rotMatch[2]) * s} ${parseFloat(rotMatch[3]) * s})`);
        }
    }

    function exportObj(obj, parent) {
        if (obj.type === 'text') {
            const pathData = textToPath(obj);
            if (pathData) {
                const p = document.createElementNS(ns, 'path');
                p.setAttribute('d', scalePathD(pathData, S));
                p.setAttribute('fill', obj.fill);
                p.setAttribute('stroke', obj.stroke === 'none' ? 'none' : obj.stroke);
                p.setAttribute('stroke-width', obj.stroke === 'none' ? 0 : obj.strokeWidth * S);
                if (obj.rotation) {
                    const b = getObjBounds(obj);
                    const cx = (b.x + b.w/2) * S, cy = (b.y + b.h/2) * S;
                    p.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
                }
                parent.appendChild(p);
            }
            return;
        }
        if (obj.type === 'image') {
            const img = document.createElementNS(ns, 'image');
            img.setAttribute('x', obj.x * S); img.setAttribute('y', obj.y * S);
            img.setAttribute('width', obj.width * S); img.setAttribute('height', obj.height * S);
            img.setAttribute('preserveAspectRatio', 'none');
            img.setAttributeNS(xlink, 'xlink:href', obj.href);
            img.setAttribute('href', obj.href);
            if (obj.rotation) {
                const cx = (obj.x + obj.width/2) * S, cy = (obj.y + obj.height/2) * S;
                img.setAttribute('transform', `rotate(${obj.rotation} ${cx} ${cy})`);
            }
            parent.appendChild(img);
        } else if (obj.type === 'powerclip') {
            const g = document.createElementNS(ns, 'g');
            const clipId = 'clip' + (clipCounter++);
            const defs = document.createElementNS(ns, 'defs');
            const cp = document.createElementNS(ns, 'clipPath');
            cp.setAttribute('id', clipId);
            const clipShape = buildClipShape(obj.container, ns);
            scaleElement(clipShape, S);
            cp.appendChild(clipShape);
            defs.appendChild(cp);
            g.appendChild(defs);
            exportObj(obj.container, g);
            const cg = document.createElementNS(ns, 'g');
            cg.setAttribute('style', `clip-path:url(#${clipId})`);
            for (const c of obj.contents) exportObj(c, cg);
            g.appendChild(cg);
            parent.appendChild(g);
        } else {
            const clone = obj.element.cloneNode(true);
            clone.removeAttribute('data-object-id'); clone.removeAttribute('style');
            scaleElement(clone, S);
            parent.appendChild(clone);
        }
    }

    for (const obj of objs) exportObj(obj, root);

    // Embed editor object data for lossless paste between editor instances
    const editorMeta = document.createElementNS(ns, 'metadata');
    editorMeta.setAttribute('id', 'editor-objects');
    const editorJson = objs.map(o => JSON.parse(JSON.stringify(o, (k, v) => k === 'element' ? undefined : v)));
    editorMeta.textContent = JSON.stringify(editorJson);
    root.appendChild(editorMeta);

    let svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n';
    svgStr += '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';
    svgStr += new XMLSerializer().serializeToString(root);
    svgStr = svgStr.replace(/ns\d+:href/g, 'xlink:href');
    svgStr = svgStr.replace('<svg ', '<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="0.92.4" ');

    // Store for the copy event handler
    window._pendingSVGCopy = svgStr;

    // Trigger a real copy event so we can set clipboardData properly
    // This is the only way to get CorelDRAW to recognize SVG from the clipboard
    const sel = window.getSelection();
    const range = document.createRange();
    const temp = document.createElement('span');
    temp.textContent = '\u200B'; // zero-width space
    document.body.appendChild(temp);
    range.selectNode(temp);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(temp);
}

// =============================================
// SVG IMPORT
// =============================================
function importSVG() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            importSVGText(ev.target.result);
        };
        reader.readAsText(file);
    });
    input.click();
}

function importSVGText(svgText, directPlacePt) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgRoot = doc.documentElement;
            if (svgRoot.tagName !== 'svg') return;

            // 1) Parse <style> blocks to resolve CSS classes (CorelDRAW uses these)
            const cssMap = {};
            for (const styleEl of svgRoot.querySelectorAll('style')) {
                const css = styleEl.textContent;
                const re = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
                let m;
                while ((m = re.exec(css)) !== null) {
                    const cls = m[1], props = {};
                    m[2].split(';').forEach(p => {
                        const [k, v] = p.split(':').map(s => s.trim());
                        if (k && v) props[k] = v;
                    });
                    cssMap[cls] = props;
                }
            }

            // 2) Determine viewBox dimensions and compute mapping to editor page
            const vb = svgRoot.getAttribute('viewBox');
            const svgW = svgRoot.getAttribute('width') || '';
            const svgH = svgRoot.getAttribute('height') || '';
            let contentW = state.pageWidth, contentH = state.pageHeight;
            let vbX = 0, vbY = 0;
            if (vb) {
                const parts = vb.split(/[\s,]+/).map(Number);
                vbX = parts[0]; vbY = parts[1];
                contentW = parts[2]; contentH = parts[3];
            }
            // Detect CorelDRAW mm-based SVGs: width="350mm" viewBox="0 0 35000 33000"
            // means 100 viewBox units per mm. Convert to editor's mm coordinate space.
            let mmW = 0, mmH = 0;
            const mmMatchW = svgW.match(/([\d.]+)\s*mm/i);
            const mmMatchH = svgH.match(/([\d.]+)\s*mm/i);
            if (mmMatchW) mmW = parseFloat(mmMatchW[1]);
            if (mmMatchH) mmH = parseFloat(mmMatchH[1]);
            // Detect CorelDRAW exports: check xmlns:xodm namespace attr or fil0/str0 CSS class pattern
            const isCorelDRAW =
                svgRoot.getAttribute('xmlns:xodm') !== null ||
                (Object.keys(cssMap).some(k => /^fil\d+$/.test(k)) && Object.keys(cssMap).some(k => /^str\d+$/.test(k)));

            // Compute scale factor (offset will be determined by click position)
            let fitScale;
            if (mmW > 0 && mmH > 0) {
                if (isCorelDRAW) {
                    // CorelDRAW selected-object exports keep full-page viewBox coordinates
                    // even when width/height reflect only the bounding box, so map viewBox
                    // directly to the editor page at 1:1 mm.
                    fitScale = Math.min(state.pageWidth / contentW, state.pageHeight / contentH);
                } else {
                    // Other mm-based SVGs (e.g. copied from this editor): the viewBox
                    // matches the declared mm dimensions, so use them to preserve the
                    // original size instead of stretching to fill the page.
                    fitScale = Math.min(mmW / contentW, mmH / contentH) / UNITS.mm.factor;
                }
            } else {
                fitScale = Math.min(state.pageWidth / contentW, state.pageHeight / contentH) * 0.9;
            }

            // Helper: resolve fill/stroke/stroke-width from attributes, CSS classes, and style attribute
            function resolveStyle(el) {
                let fill = null, stroke = null, sw = null, fillRule = null;
                // From CSS classes
                const cls = el.getAttribute('class');
                if (cls) {
                    for (const c of cls.split(/\s+/)) {
                        const p = cssMap[c];
                        if (p) {
                            if (p.fill !== undefined) fill = p.fill;
                            if (p.stroke !== undefined) stroke = p.stroke;
                            if (p['stroke-width'] !== undefined) sw = parseFloat(p['stroke-width']);
                            if (p['fill-rule'] !== undefined) fillRule = p['fill-rule'];
                        }
                    }
                }
                // From inline attributes (override classes)
                if (el.getAttribute('fill')) fill = el.getAttribute('fill');
                if (el.getAttribute('stroke')) stroke = el.getAttribute('stroke');
                if (el.getAttribute('stroke-width')) sw = parseFloat(el.getAttribute('stroke-width'));
                if (el.getAttribute('fill-rule')) fillRule = el.getAttribute('fill-rule');
                // From style attribute (highest priority)
                const style = el.getAttribute('style');
                if (style) {
                    const fm = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i);
                    const sm = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i);
                    const swm = style.match(/(?:^|;)\s*stroke-width\s*:\s*([^;]+)/i);
                    const frm = style.match(/(?:^|;)\s*fill-rule\s*:\s*([^;]+)/i);
                    if (fm) fill = fm[1].trim();
                    if (sm) stroke = sm[1].trim();
                    if (swm) sw = parseFloat(swm[1]);
                    if (frm) fillRule = frm[1].trim();
                }
                return { fill: fill || 'none', stroke: stroke || 'none', sw: sw || 0, fillRule };
            }

            // Helper: parse transform attribute into a combined affine matrix [a,b,c,d,e,f].
            // Correctly composes multiple transforms (e.g. rotate(a,cx,cy) scale translate)
            // using proper matrix multiplication, preserving SVG left-to-right application order.
            function parseTransform(el) {
                const t = el.getAttribute('transform');
                if (!t) return [1, 0, 0, 1, 0, 0];
                let result = [1, 0, 0, 1, 0, 0];
                const re = /(\w+)\s*\(([^)]*)\)/g;
                let m;
                while ((m = re.exec(t)) !== null) {
                    const fn = m[1];
                    const args = m[2].trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
                    let mat;
                    if (fn === 'matrix' && args.length >= 6) {
                        mat = args.slice(0, 6);
                    } else if (fn === 'translate') {
                        mat = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
                    } else if (fn === 'scale') {
                        const sx = args[0] || 1, sy = args.length > 1 ? args[1] : (args[0] || 1);
                        mat = [sx, 0, 0, sy, 0, 0];
                    } else if (fn === 'rotate') {
                        const ang = (args[0] || 0) * Math.PI / 180;
                        const cos = Math.cos(ang), sin = Math.sin(ang);
                        if (args.length >= 3) {
                            // rotate(angle, cx, cy) — rotation around an explicit center point
                            const cx = args[1], cy = args[2];
                            mat = [cos, sin, -sin, cos,
                                   cx * (1 - cos) + cy * sin,
                                   cy * (1 - cos) - cx * sin];
                        } else {
                            mat = [cos, sin, -sin, cos, 0, 0];
                        }
                    } else if (fn === 'skewX') {
                        mat = [1, 0, Math.tan((args[0] || 0) * Math.PI / 180), 1, 0, 0];
                    } else if (fn === 'skewY') {
                        mat = [1, Math.tan((args[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
                    } else { continue; }
                    result = mulMatrix(result, mat);
                }
                return result;
            }

            // Multiply two affine matrices [a,b,c,d,e,f]
            function mulMatrix(m1, m2) {
                return [
                    m1[0]*m2[0] + m1[2]*m2[1],       m1[1]*m2[0] + m1[3]*m2[1],
                    m1[0]*m2[2] + m1[2]*m2[3],       m1[1]*m2[2] + m1[3]*m2[3],
                    m1[0]*m2[4] + m1[2]*m2[5] + m1[4], m1[1]*m2[4] + m1[3]*m2[5] + m1[5],
                ];
            }

            // Apply matrix to a point
            function applyMatrix(m, x, y) {
                return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
            }

            // Import a path via browser sampling + manual CTM application
            // Apply a pure scale+translate transform directly to SVG path data,
            // preserving all sub-paths (M, L, C, Q, A, Z commands) without sampling.
            function applyScaleTranslateToPath(d, sx, sy, tx, ty) {
                // When the coordinate system is reflected (one axis negated), arc sweep direction reverses
                const flipSweep = sx * sy < 0;
                const re = /([MLCQAZTSHVmlcqatzshv])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)/g;
                const tokens = [];
                let m;
                while ((m = re.exec(d)) !== null) tokens.push(m[0]);
                const argCounts = { M:2,L:2,H:1,V:1,C:6,Q:4,S:4,T:2,A:7,Z:0, m:2,l:2,h:1,v:1,c:6,q:4,s:4,t:2,a:7,z:0 };
                let result = '';
                let i = 0;
                while (i < tokens.length) {
                    const cmd = tokens[i++];
                    if (!/^[MLCQAZTSHVmlcqatzshv]$/.test(cmd)) continue;
                    const cnt = argCounts[cmd] ?? 0;
                    result += cmd;
                    if (cnt === 0) { result += ' '; continue; }
                    while (i < tokens.length && /^-/.test(tokens[i][0]) || (i < tokens.length && /\d|\./.test(tokens[i][0]))) {
                        const nums = [];
                        for (let j = 0; j < cnt && i < tokens.length; j++) nums.push(parseFloat(tokens[i++]));
                        if (nums.length < cnt) break;
                        const f = (n) => +n.toFixed(4);
                        if (cmd === 'M' || cmd === 'L' || cmd === 'T')
                            result += ` ${f(nums[0]*sx+tx)},${f(nums[1]*sy+ty)}`;
                        else if (cmd === 'm' || cmd === 'l' || cmd === 't')
                            result += ` ${f(nums[0]*sx)},${f(nums[1]*sy)}`;
                        else if (cmd === 'H') result += ` ${f(nums[0]*sx+tx)}`;
                        else if (cmd === 'h') result += ` ${f(nums[0]*sx)}`;
                        else if (cmd === 'V') result += ` ${f(nums[0]*sy+ty)}`;
                        else if (cmd === 'v') result += ` ${f(nums[0]*sy)}`;
                        else if (cmd === 'C')
                            result += ` ${f(nums[0]*sx+tx)},${f(nums[1]*sy+ty)} ${f(nums[2]*sx+tx)},${f(nums[3]*sy+ty)} ${f(nums[4]*sx+tx)},${f(nums[5]*sy+ty)}`;
                        else if (cmd === 'c')
                            result += ` ${f(nums[0]*sx)},${f(nums[1]*sy)} ${f(nums[2]*sx)},${f(nums[3]*sy)} ${f(nums[4]*sx)},${f(nums[5]*sy)}`;
                        else if (cmd === 'Q')
                            result += ` ${f(nums[0]*sx+tx)},${f(nums[1]*sy+ty)} ${f(nums[2]*sx+tx)},${f(nums[3]*sy+ty)}`;
                        else if (cmd === 'q')
                            result += ` ${f(nums[0]*sx)},${f(nums[1]*sy)} ${f(nums[2]*sx)},${f(nums[3]*sy)}`;
                        else if (cmd === 'S')
                            result += ` ${f(nums[0]*sx+tx)},${f(nums[1]*sy+ty)} ${f(nums[2]*sx+tx)},${f(nums[3]*sy+ty)}`;
                        else if (cmd === 's')
                            result += ` ${f(nums[0]*sx)},${f(nums[1]*sy)} ${f(nums[2]*sx)},${f(nums[3]*sy)}`;
                        else if (cmd === 'A')
                            result += ` ${f(nums[0]*Math.abs(sx))},${f(nums[1]*Math.abs(sy))} ${nums[2]} ${nums[3]} ${flipSweep ? 1-nums[4] : nums[4]} ${f(nums[5]*sx+tx)},${f(nums[6]*sy+ty)}`;
                        else if (cmd === 'a')
                            result += ` ${f(nums[0]*Math.abs(sx))},${f(nums[1]*Math.abs(sy))} ${nums[2]} ${nums[3]} ${flipSweep ? 1-nums[4] : nums[4]} ${f(nums[5]*sx)},${f(nums[6]*sy)}`;
                    }
                }
                return result.trim();
            }

            // Transform all path coordinates through a full affine matrix, preserving curve commands
            function applyMatrixToPath(d, m) {
                const flipSweep = (m[0]*m[3] - m[1]*m[2]) < 0;
                const re = /([MLCQAZTSHVmlcqatzshv])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)/g;
                const tokens = [];
                let tok;
                while ((tok = re.exec(d)) !== null) tokens.push(tok[0]);
                const argCounts = { M:2,L:2,H:1,V:1,C:6,Q:4,S:4,T:2,A:7,Z:0, m:2,l:2,h:1,v:1,c:6,q:4,s:4,t:2,a:7,z:0 };
                let result = '', i = 0;
                // Track current point for H/V conversion
                let curX = 0, curY = 0, startX = 0, startY = 0;
                while (i < tokens.length) {
                    const cmd = tokens[i++];
                    if (!/^[MLCQAZTSHVmlcqatzshv]$/.test(cmd)) continue;
                    const cnt = argCounts[cmd] ?? 0;
                    if (cnt === 0) { result += cmd + ' '; if (cmd === 'Z' || cmd === 'z') { curX = startX; curY = startY; } continue; }
                    while (i < tokens.length && (/^-/.test(tokens[i][0]) || /\d|\./.test(tokens[i][0]))) {
                        const nums = [];
                        for (let j = 0; j < cnt && i < tokens.length; j++) nums.push(parseFloat(tokens[i++]));
                        if (nums.length < cnt) break;
                        const f = (n) => +n.toFixed(4);
                        const tp = (x, y) => ({ x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] });
                        const td = (x, y) => ({ x: m[0]*x + m[2]*y, y: m[1]*x + m[3]*y }); // delta (no translate)
                        if (cmd === 'M') { const p = tp(nums[0], nums[1]); result += `M${f(p.x)},${f(p.y)} `; curX = nums[0]; curY = nums[1]; startX = curX; startY = curY; }
                        else if (cmd === 'L') { const p = tp(nums[0], nums[1]); result += `L${f(p.x)},${f(p.y)} `; curX = nums[0]; curY = nums[1]; }
                        else if (cmd === 'm') { const p = td(nums[0], nums[1]); result += `m${f(p.x)},${f(p.y)} `; curX += nums[0]; curY += nums[1]; startX = curX; startY = curY; }
                        else if (cmd === 'l') { const p = td(nums[0], nums[1]); result += `l${f(p.x)},${f(p.y)} `; curX += nums[0]; curY += nums[1]; }
                        else if (cmd === 'H') { const p = tp(nums[0], curY); result += `L${f(p.x)},${f(p.y)} `; curX = nums[0]; }
                        else if (cmd === 'h') { const p = td(nums[0], 0); result += `l${f(p.x)},${f(p.y)} `; curX += nums[0]; }
                        else if (cmd === 'V') { const p = tp(curX, nums[0]); result += `L${f(p.x)},${f(p.y)} `; curY = nums[0]; }
                        else if (cmd === 'v') { const p = td(0, nums[0]); result += `l${f(p.x)},${f(p.y)} `; curY += nums[0]; }
                        else if (cmd === 'C') {
                            const p1 = tp(nums[0],nums[1]), p2 = tp(nums[2],nums[3]), p3 = tp(nums[4],nums[5]);
                            result += `C${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} ${f(p3.x)},${f(p3.y)} `;
                            curX = nums[4]; curY = nums[5];
                        } else if (cmd === 'c') {
                            const p1 = td(nums[0],nums[1]), p2 = td(nums[2],nums[3]), p3 = td(nums[4],nums[5]);
                            result += `c${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} ${f(p3.x)},${f(p3.y)} `;
                            curX += nums[4]; curY += nums[5];
                        } else if (cmd === 'Q') {
                            const p1 = tp(nums[0],nums[1]), p2 = tp(nums[2],nums[3]);
                            result += `Q${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} `;
                            curX = nums[2]; curY = nums[3];
                        } else if (cmd === 'q') {
                            const p1 = td(nums[0],nums[1]), p2 = td(nums[2],nums[3]);
                            result += `q${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} `;
                            curX += nums[2]; curY += nums[3];
                        } else if (cmd === 'S') {
                            const p1 = tp(nums[0],nums[1]), p2 = tp(nums[2],nums[3]);
                            result += `S${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} `;
                            curX = nums[2]; curY = nums[3];
                        } else if (cmd === 's') {
                            const p1 = td(nums[0],nums[1]), p2 = td(nums[2],nums[3]);
                            result += `s${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} `;
                            curX += nums[2]; curY += nums[3];
                        } else if (cmd === 'T') { const p = tp(nums[0],nums[1]); result += `T${f(p.x)},${f(p.y)} `; curX = nums[0]; curY = nums[1]; }
                        else if (cmd === 't') { const p = td(nums[0],nums[1]); result += `t${f(p.x)},${f(p.y)} `; curX += nums[0]; curY += nums[1]; }
                        else if (cmd === 'A') {
                            // Arc: transform radii by matrix scale, rotate x-axis-rotation, transform endpoint
                            const rx = nums[0], ry = nums[1], rot = nums[2], largeArc = nums[3], sweep = nums[4];
                            const ep = tp(nums[5], nums[6]);
                            const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
                            result += `A${f(rx*sx)},${f(ry*sy)} ${f(rot)} ${largeArc} ${flipSweep ? 1-sweep : sweep} ${f(ep.x)},${f(ep.y)} `;
                            curX = nums[5]; curY = nums[6];
                        } else if (cmd === 'a') {
                            const ep = td(nums[5], nums[6]);
                            const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
                            result += `a${f(nums[0]*sx)},${f(nums[1]*sy)} ${f(nums[2])} ${nums[3]} ${flipSweep ? 1-nums[4] : nums[4]} ${f(ep.x)},${f(ep.y)} `;
                            curX += nums[5]; curY += nums[6];
                        }
                    }
                }
                return result.trim();
            }

            function importPath(d, sty, ctm) {
                const ns = 'http://www.w3.org/2000/svg';
                let newD = null;
                let scale = Math.max(Math.abs(ctm[0]), Math.abs(ctm[1]), Math.abs(ctm[2]), Math.abs(ctm[3]));

                // Transform path coordinates through the full affine matrix, preserving all curve commands
                try { newD = applyMatrixToPath(d, ctm); } catch(e) { newD = null; }

                if (!newD) {
                    // Last resort: sampling (loses curve structure)
                    const tempSvg = document.createElementNS(ns, 'svg');
                    tempSvg.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
                    tempSvg.setAttribute('viewBox', '0 0 100000 100000');
                    document.body.appendChild(tempSvg);
                    const path = document.createElementNS(ns, 'path');
                    path.setAttribute('d', d);
                    tempSvg.appendChild(path);
                    let len;
                    try { len = path.getTotalLength(); } catch(e) { document.body.removeChild(tempSvg); return; }
                    if (len < 0.01) { document.body.removeChild(tempSvg); return; }
                    const numSamples = Math.min(500, Math.max(80, Math.ceil(len / 2)));
                    newD = '';
                    for (let i = 0; i <= numSamples; i++) {
                        const local = path.getPointAtLength(i * len / numSamples);
                        const pt = applyMatrix(ctm, local.x, local.y);
                        newD += (i === 0 ? 'M' : 'L') + ` ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
                    }
                    if (/[Zz]\s*$/.test(d.trim())) newD += 'Z';
                    document.body.removeChild(tempSvg);
                }

                // Get bounds of the transformed path
                const tempPath = document.createElementNS(ns, 'path');
                tempPath.setAttribute('d', newD);
                objectsLayer.appendChild(tempPath);
                const bb = tempPath.getBBox();
                objectsLayer.removeChild(tempPath);
                if (bb.width < 0.01 && bb.height < 0.01) return;
                createObject('curvepath', {
                    d: newD,
                    x: bb.x, y: bb.y, width: bb.width || 1, height: bb.height || 1,
                    _origBounds: { x: bb.x, y: bb.y, w: bb.width || 1, h: bb.height || 1 },
                    fill: sty.fill, stroke: sty.stroke, strokeWidth: sty.sw * scale,
                    fillRule: sty.fillRule,
                });
            }

            function importElement(el, ctm, insideClip) {
                const tag = el.tagName.toLowerCase();
                if (tag === 'defs' || tag === 'metadata' || tag === 'title' || tag === 'desc' || tag === 'style' || tag === 'clippath') return;

                const localMat = parseTransform(el);
                const m = mulMatrix(ctm, localMat);
                const sty = resolveStyle(el);

                // Skip CorelDRAW cosmetic background fills: white-filled, no stroke, outside any clip group
                // These are the background paths CorelDRAW places before each clip group for rendering purposes
                if (isCorelDRAW && !insideClip && sty.fill === 'white' && sty.stroke === 'none') return;
                // Skip completely invisible elements (no fill, no stroke) — but never skip images
                if (sty.fill === 'none' && sty.stroke === 'none' && tag !== 'g' && tag !== 'image') return;

                if (tag === 'rect') {
                    const x = parseFloat(el.getAttribute('x')) || 0;
                    const y = parseFloat(el.getAttribute('y')) || 0;
                    const w = parseFloat(el.getAttribute('width')) || 0;
                    const h = parseFloat(el.getAttribute('height')) || 0;
                    if (w > 0.01 && h > 0.01) {
                        const p = applyMatrix(m, x, y);
                        const pw = w * Math.abs(m[0]), ph = h * Math.abs(m[3]);
                        createObject('rect', { x: p.x, y: p.y, width: pw, height: ph, fill: sty.fill, stroke: sty.stroke, strokeWidth: sty.sw * Math.abs(m[0]) });
                    }
                } else if (tag === 'ellipse') {
                    const cx = parseFloat(el.getAttribute('cx')) || 0;
                    const cy = parseFloat(el.getAttribute('cy')) || 0;
                    const rx = parseFloat(el.getAttribute('rx')) || 0;
                    const ry = parseFloat(el.getAttribute('ry')) || 0;
                    if (rx > 0.01 && ry > 0.01) {
                        const p = applyMatrix(m, cx, cy);
                        createObject('ellipse', { cx: p.x, cy: p.y, rx: rx * Math.abs(m[0]), ry: ry * Math.abs(m[3]), fill: sty.fill, stroke: sty.stroke, strokeWidth: sty.sw * Math.abs(m[0]) });
                    }
                } else if (tag === 'circle') {
                    const cx = parseFloat(el.getAttribute('cx')) || 0;
                    const cy = parseFloat(el.getAttribute('cy')) || 0;
                    const r = parseFloat(el.getAttribute('r')) || 0;
                    if (r > 0.01) {
                        const p = applyMatrix(m, cx, cy);
                        createObject('ellipse', { cx: p.x, cy: p.y, rx: r * Math.abs(m[0]), ry: r * Math.abs(m[3]), fill: sty.fill, stroke: sty.stroke, strokeWidth: sty.sw * Math.abs(m[0]) });
                    }
                } else if (tag === 'line') {
                    const p1 = applyMatrix(m, parseFloat(el.getAttribute('x1')) || 0, parseFloat(el.getAttribute('y1')) || 0);
                    const p2 = applyMatrix(m, parseFloat(el.getAttribute('x2')) || 0, parseFloat(el.getAttribute('y2')) || 0);
                    createObject('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: sty.stroke, strokeWidth: sty.sw * Math.abs(m[0]) });
                } else if (tag === 'path') {
                    const d = el.getAttribute('d');
                    if (d) importPath(d, sty, m);
                } else if (tag === 'polygon' || tag === 'polyline') {
                    const pts = el.getAttribute('points');
                    if (pts) {
                        const coords = pts.trim().split(/[\s,]+/).map(Number);
                        let d = '';
                        for (let i = 0; i < coords.length - 1; i += 2) {
                            d += (i === 0 ? 'M' : 'L') + ` ${coords[i]} ${coords[i+1]} `;
                        }
                        if (tag === 'polygon') d += 'Z';
                        importPath(d, sty, m);
                    }
                } else if (tag === 'text') {
                    const x = parseFloat(el.getAttribute('x')) || 0;
                    const y = parseFloat(el.getAttribute('y')) || 0;
                    const p = applyMatrix(m, x, y);
                    const fontSize = parseFloat(el.getAttribute('font-size')) || 32;
                    const text = el.textContent.trim();
                    if (text) {
                        createObject('text', {
                            x: p.x, y: p.y, text, fontSize: fontSize * Math.abs(m[0]),
                            fontFamily: 'Inter',
                            fill: sty.fill === 'none' ? '#000000' : sty.fill,
                            stroke: 'none', strokeWidth: 0,
                        });
                    }
                } else if (tag === 'image') {
                    const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                    if (!href) return;
                    const ix = parseFloat(el.getAttribute('x')) || 0;
                    const iy = parseFloat(el.getAttribute('y')) || 0;
                    const iw = parseFloat(el.getAttribute('width')) || 0;
                    const ih = parseFloat(el.getAttribute('height')) || 0;
                    // Decompose the combined matrix into position, size, rotation, and flip
                    const p0 = applyMatrix(m, ix, iy);
                    const p1 = applyMatrix(m, ix + iw, iy);
                    const p2 = applyMatrix(m, ix, iy + ih);
                    const p3 = applyMatrix(m, ix + iw, iy + ih);
                    // Width/height from edge lengths of the transformed quad
                    const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                    const h = Math.hypot(p2.x - p0.x, p2.y - p0.y);
                    // Rotation from the top edge direction
                    const det = m[0]*m[3] - m[1]*m[2];
                    const rotation = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
                    // Negative determinant = reflection; apply vertical flip
                    const flipY = det < 0;
                    // Center of the transformed image
                    const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
                    const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
                    if (w > 0.1 && h > 0.1) {
                        createObject('image', { x: cx - w/2, y: cy - h/2, width: w, height: h, rotation, flipY, href });
                    }
                } else if (tag === 'g') {
                    // Check for clip-path (CorelDRAW uses style="clip-path:url(#id)")
                    const clipRef = (el.getAttribute('clip-path') || '').match(/url\(\s*#([^)]+)\)/) ||
                                    ((el.getAttribute('style') || '').match(/clip-path\s*:\s*url\(\s*#([^)]+)\)/));
                    if (clipRef) {
                        // Clip group → create PowerClip (works for nested clips too)
                        const clipEl = svgRoot.querySelector('#' + clipRef[1]);
                        if (clipEl) {
                            const clipChild = clipEl.querySelector('path,rect,ellipse,circle,polygon');
                            if (clipChild) {
                                const clipD = clipChild.getAttribute('d') || pointsToD(clipChild);
                                if (clipD) {
                                    // Import clip shape as container (compose clipPath + child transforms)
                                    const clipElMat = parseTransform(clipEl);
                                    const clipChildMat = parseTransform(clipChild);
                                    const clipMat = mulMatrix(m, mulMatrix(clipElMat, clipChildMat));
                                    importPath(clipD, { fill: 'none', stroke: 'none', sw: 0 }, clipMat);
                                    const containerObj = state.objects[state.objects.length - 1];
                                    // Import all children (nested clips just pass through)
                                    const contentsBefore = state.objects.length;
                                    for (const child of el.children) importElement(child, m, true);
                                    const contents = state.objects.splice(contentsBefore);
                                    if (containerObj && contents.length > 0) {
                                        try {
                                            makePowerClipFromImport(containerObj, contents);
                                        } catch(e) {
                                            state.objects.push(...contents);
                                        }
                                    }
                                    return;
                                }
                            }
                        }
                        // Fallback: skip clipped content to avoid overlap
                        return;
                    }
                    // Inside a clip or no clip: just import children normally
                    for (const child of el.children) importElement(child, m, insideClip);
                }
            }

            // Convert polygon/polyline points attribute to path d
            function pointsToD(el) {
                const pts = el.getAttribute('points');
                if (!pts) return null;
                const coords = pts.trim().split(/[\s,]+/).map(Number);
                let d = '';
                for (let i = 0; i < coords.length - 1; i += 2) {
                    d += (i === 0 ? 'M' : 'L') + ` ${coords[i]} ${coords[i+1]} `;
                }
                if (el.tagName.toLowerCase() === 'polygon') d += 'Z';
                return d;
            }

            // Create PowerClip from imported container shape + content objects
            function makePowerClipFromImport(containerObj, contentObjs) {
                // Remove container from objects array and DOM
                const cidx = state.objects.indexOf(containerObj);
                if (cidx >= 0) state.objects.splice(cidx, 1);
                containerObj.element.remove();
                // Strip element references — buildSVGElement will create fresh ones
                const containerData = { ...containerObj };
                delete containerData.element;
                // Remove old content elements from DOM before building PowerClip
                for (const c of contentObjs) {
                    if (c.element) c.element.remove();
                    const idx = state.objects.indexOf(c);
                    if (idx >= 0) state.objects.splice(idx, 1);
                }
                // Build the PowerClip (buildSVGElement creates new elements inside the clip group)
                const pcObj = {
                    id: state.nextId++,
                    type: 'powerclip',
                    container: containerData,
                    contents: contentObjs,
                    fill: 'none', stroke: 'none', strokeWidth: 0, rotation: 0,
                };
                const elem = buildSVGElement(pcObj);
                pcObj.element = elem;
                elem.dataset.objectId = pcObj.id;
                objectsLayer.appendChild(elem);
                state.objects.push(pcObj);
            }

            function doPlace(pt) {
                saveUndoState();
                _batchImporting = true;
                // First pass: import at origin to measure content bounds
                const offsetX0 = -vbX * fitScale;
                const offsetY0 = -vbY * fitScale;
                const beforeCount = state.objects.length;
                const measureMat = [fitScale, 0, 0, fitScale, offsetX0, offsetY0];
                for (const child of svgRoot.children) {
                    importElement(child, measureMat);
                }
                const tempObjs = state.objects.slice(beforeCount);
                let minX = 0, minY = 0;
                if (tempObjs.length > 0) {
                    minX = Infinity; minY = Infinity;
                    for (const obj of tempObjs) {
                        const b = getObjBounds(obj);
                        if (b.x < minX) minX = b.x;
                        if (b.y < minY) minY = b.y;
                    }
                }
                // Clean up measurement objects
                for (const obj of tempObjs) obj.element.remove();
                state.objects.length = beforeCount;
                state.nextId -= tempObjs.length + tempObjs.filter(o => o.type === 'powerclip').reduce((n, o) => n + (o.contents ? o.contents.length : 0) + 1, 0);

                // Second pass: import with click offset baked into the matrix
                const dx = pt.x - minX, dy = pt.y - minY;
                const baseMat = [fitScale, 0, 0, fitScale, offsetX0 + dx, offsetY0 + dy];
                for (const child of svgRoot.children) {
                    importElement(child, baseMat);
                }
                _batchImporting = false;
                drawSelection();
                setTool('select');
            }

            if (directPlacePt) {
                // Direct placement (e.g. drag-and-drop)
                doPlace(directPlacePt);
            } else {
                // Interactive placement mode: click to place
                showPlacementCursor();
                state.pendingSVGImport = (pt) => {
                    hidePlacementCursor();
                    doPlace(pt);
                };
            }
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

// =============================================
// REFERENCE AREAS
// =============================================

function toggleRefArea(obj) {
    if (!obj) return;
    saveUndoState();
    obj.isRefArea = !obj.isRefArea;
    if (obj.isRefArea && !obj.refTextIds) obj.refTextIds = [];
    applyRefAreaStyle(obj);
    drawSelection();
}

function applyRefAreaStyle(obj) {
    const elem = obj.element;
    if (!elem) return;
    if (obj.isRefArea) {
        elem.setAttribute('stroke', '#4da6ff');
        elem.setAttribute('stroke-dasharray', '8 4');
        elem.setAttribute('stroke-width', Math.max(obj.strokeWidth || 1, 1));
        elem.setAttribute('fill', 'rgba(77, 166, 255, 0.06)');
        elem.setAttribute('opacity', '0.7');
    } else {
        elem.setAttribute('stroke', obj.stroke || 'none');
        elem.setAttribute('stroke-dasharray', '');
        elem.setAttribute('stroke-width', obj.strokeWidth || 0);
        elem.setAttribute('fill', obj.fill || 'none');
        elem.removeAttribute('opacity');
    }
}

function findRefAreaForText(textObj) {
    // Search explicitly linked ref areas (via refTextIds), including inside groups
    function search(list) {
        for (const obj of list) {
            if (obj.isRefArea && obj.refTextIds && obj.refTextIds.includes(textObj.id)) return obj;
            if (obj.type === 'group' && obj.children) { const f = search(obj.children); if (f) return f; }
            if (obj.type === 'powerclip') {
                if (obj.container && obj.container.isRefArea && obj.container.refTextIds && obj.container.refTextIds.includes(textObj.id)) return obj.container;
                if (obj.contents) { const f = search(obj.contents); if (f) return f; }
            }
        }
        return null;
    }
    return search(state.objects);
}

function addTextToRefArea(textId, refAreaId) {
    const textObj = findObject(textId);
    const refArea = findObject(refAreaId);
    if (!textObj || !refArea || !refArea.isRefArea) return;
    if (textObj.type !== 'text') return;
    saveUndoState();

    // Remove from any other ref area
    for (const obj of state.objects) {
        if (obj.isRefArea && obj.refTextIds) {
            obj.refTextIds = obj.refTextIds.filter(id => id !== textId);
        }
    }

    if (!refArea.refTextIds) refArea.refTextIds = [];
    if (!refArea.refTextIds.includes(textId)) refArea.refTextIds.push(textId);

    // Center text and fit
    if (textObj.textAlign !== 'center') textObj.textAlign = 'center';
    refreshElement(textObj);
    fitTextToRefArea(textObj);
    drawSelection();
}

function removeTextFromRefArea(textId) {
    for (const obj of state.objects) {
        if (obj.isRefArea && obj.refTextIds) {
            obj.refTextIds = obj.refTextIds.filter(id => id !== textId);
        }
    }
}

async function fitTextToRefArea(textObj) {
    const refArea = findRefAreaForText(textObj);
    if (!refArea) return;
    const rb = getObjBounds(refArea);
    const targetW = rb.w;
    const targetH = rb.h;
    if (targetW <= 0 || targetH <= 0) return;

    const fontName = textObj.fontFamily || 'Inter';
    const fontDef = FONTS.find(f => f.name === fontName) || FONTS[0];
    const text = textObj.text || '';
    if (!text) return;

    // Ensure opentype font is loaded for tight measurement
    if (!loadedOTFonts[fontName]) await loadOTFont(fontName);

    const refSize = 100;
    let relW, relH, relX, relY;
    const otFont = loadedOTFonts[fontName];

    if (otFont) {
        // Use opentype.js for tight glyph bounding box (no ascender/descender padding)
        const path = otFont.getPath(text, 0, 0, refSize);
        const bb = path.getBoundingBox();
        relW = bb.x2 - bb.x1;
        relH = bb.y2 - bb.y1;
        relX = bb.x1;
        relY = bb.y1;
    } else {
        // Fallback: SVG measurement
        const ns = 'http://www.w3.org/2000/svg';
        const tmpText = document.createElementNS(ns, 'text');
        tmpText.setAttribute('font-family', fontDef.css);
        tmpText.setAttribute('font-size', refSize);
        tmpText.setAttribute('x', 0);
        tmpText.setAttribute('y', 0);
        tmpText.textContent = text;
        objectsLayer.appendChild(tmpText);
        const refBBox = tmpText.getBBox();
        objectsLayer.removeChild(tmpText);
        relW = refBBox.width;
        relH = refBBox.height;
        relX = refBBox.x;
        relY = refBBox.y;
    }

    if (relW < 0.1 || relH < 0.1) return;

    // Scale to fill the area
    const scale = Math.min(targetW / relW, targetH / relH);
    const finalFontSize = Math.max(4, refSize * scale);

    // At final size, the bbox and offsets scale linearly
    const fW = relW * scale;
    const fH = relH * scale;
    const fOffX = relX * scale;
    const fOffY = relY * scale;

    // Center the tight glyph bbox in the ref area
    textObj.fontSize = finalFontSize;
    textObj.x = rb.x + (targetW - fW) / 2 - fOffX;
    textObj.y = rb.y + (targetH - fH) / 2 - fOffY;
    textObj.textAlign = 'left'; // use left align for precise positioning
    refreshElement(textObj);
}

let _refAreaPickTextId = null;

function enterRefAreaPickMode(textId) {
    _refAreaPickTextId = textId;
    svg.style.cursor = 'crosshair';
    showToast('Haz click en un \u00e1rea de referencia');

    // Highlight all ref areas
    const highlights = [];
    for (const obj of state.objects) {
        if (!obj.isRefArea) continue;
        const b = getObjBounds(obj);
        const ns = 'http://www.w3.org/2000/svg';
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', b.x); r.setAttribute('y', b.y);
        r.setAttribute('width', b.w); r.setAttribute('height', b.h);
        r.setAttribute('fill', 'rgba(77, 166, 255, 0.15)');
        r.setAttribute('stroke', '#4da6ff');
        r.setAttribute('stroke-width', state.viewBox.w * 0.003);
        r.setAttribute('stroke-dasharray', 'none');
        r.setAttribute('pointer-events', 'none');
        r.setAttribute('rx', '4');
        selectionLayer.appendChild(r);
        highlights.push(r);
    }

    function onPickClick(e) {
        const pt = screenToSVG(e.clientX, e.clientY);
        // Find which ref area was clicked
        for (const obj of state.objects) {
            if (!obj.isRefArea) continue;
            const b = getObjBounds(obj);
            if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
                addTextToRefArea(_refAreaPickTextId, obj.id);
                cleanup();
                return;
            }
        }
    }

    function onEscape(e) {
        if (e.key === 'Escape') cleanup();
    }

    function cleanup() {
        _refAreaPickTextId = null;
        svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
        for (const h of highlights) h.remove();
        svg.removeEventListener('click', onPickClick);
        document.removeEventListener('keydown', onEscape);
        drawSelection();
    }

    svg.addEventListener('click', onPickClick, { once: true });
    document.addEventListener('keydown', onEscape);
}

function updateRefAreaTexts(refArea) {
    if (!refArea || !refArea.isRefArea || !refArea.refTextIds) return;
    for (const textId of refArea.refTextIds) {
        const textObj = findObjectDeep(textId);
        if (textObj) fitTextToRefArea(textObj);
    }
}

function updateAllRefAreaTexts() {
    function walk(list) {
        for (const obj of list) {
            if (obj.isRefArea) updateRefAreaTexts(obj);
            if (obj.type === 'group' && obj.children) walk(obj.children);
            if (obj.type === 'powerclip' && obj.contents) walk(obj.contents);
        }
    }
    walk(state.objects);
}

function invertImageColors(obj) {
    if (!obj || obj.type !== 'image') return;
    saveUndoState();
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
            d[i] = 255 - d[i];       // R
            d[i + 1] = 255 - d[i + 1]; // G
            d[i + 2] = 255 - d[i + 2]; // B
            // Alpha unchanged
        }
        ctx.putImageData(imageData, 0, 0);
        obj.href = canvas.toDataURL('image/png');
        obj.element.setAttributeNS('http://www.w3.org/1999/xlink', 'href', obj.href);
    };
    img.src = obj.href;
}

// Mirror a child object around a given center point (used by group/powerclip flip)
function mirrorChildAroundCenter(obj, direction, gcx, gcy) {
    const isH = direction === 'horizontal';
    switch (obj.type) {
        case 'rect':
            if (isH) obj.x = 2 * gcx - obj.x - obj.width;
            else obj.y = 2 * gcy - obj.y - obj.height;
            if (obj.rotation) obj.rotation = -obj.rotation;
            break;
        case 'image':
        case 'text':
        case 'curvepath':
            if (isH) { obj.x = 2 * gcx - obj.x - obj.width; obj.flipX = !obj.flipX; }
            else { obj.y = 2 * gcy - obj.y - obj.height; obj.flipY = !obj.flipY; }
            break;
        case 'ellipse':
            if (isH) obj.cx = 2 * gcx - obj.cx;
            else obj.cy = 2 * gcy - obj.cy;
            if (obj.rotation) obj.rotation = -obj.rotation;
            break;
        case 'line':
            if (isH) { obj.x1 = 2 * gcx - obj.x1; obj.x2 = 2 * gcx - obj.x2; }
            else { obj.y1 = 2 * gcy - obj.y1; obj.y2 = 2 * gcy - obj.y2; }
            break;
        case 'bspline':
            obj.points = obj.points.map(p => isH
                ? { x: 2 * gcx - p.x, y: p.y }
                : { x: p.x, y: 2 * gcy - p.y });
            break;
        case 'group':
            for (const c of obj.children) mirrorChildAroundCenter(c, direction, gcx, gcy);
            break;
        case 'powerclip':
            mirrorChildAroundCenter(obj.container, direction, gcx, gcy);
            for (const c of obj.contents) mirrorChildAroundCenter(c, direction, gcx, gcy);
            break;
    }
}

function flipObject(obj, direction) {
    const b = getObjBounds(obj);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    switch (obj.type) {
        case 'image':
        case 'text':
            if (direction === 'horizontal') obj.flipX = !obj.flipX;
            else obj.flipY = !obj.flipY;
            break;
        case 'rect':
            if (obj.rotation) obj.rotation = -obj.rotation;
            break;
        case 'curvepath':
            if (direction === 'horizontal') obj.flipX = !obj.flipX;
            else obj.flipY = !obj.flipY;
            break;
        case 'ellipse':
            if (obj.rotation) obj.rotation = -obj.rotation;
            break;
        case 'line':
            if (direction === 'horizontal') {
                obj.x1 = 2 * cx - obj.x1; obj.x2 = 2 * cx - obj.x2;
            } else {
                obj.y1 = 2 * cy - obj.y1; obj.y2 = 2 * cy - obj.y2;
            }
            break;
        case 'bspline':
            obj.points = obj.points.map(p => direction === 'horizontal'
                ? { x: 2 * cx - p.x, y: p.y }
                : { x: p.x, y: 2 * cy - p.y });
            break;
        case 'powerclip': {
            const pb = getObjBounds(obj);
            const pcx = pb.x + pb.w / 2, pcy = pb.y + pb.h / 2;
            mirrorChildAroundCenter(obj.container, direction, pcx, pcy);
            for (const c of obj.contents) mirrorChildAroundCenter(c, direction, pcx, pcy);
            rebuildPowerClipElement(obj);
            break;
        }
        case 'group': {
            const gb = getObjBounds(obj);
            const gcx = gb.x + gb.w / 2, gcy = gb.y + gb.h / 2;
            for (const c of obj.children) mirrorChildAroundCenter(c, direction, gcx, gcy);
            break;
        }
    }
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
}

// =============================================
// ZOOM
// =============================================
let _wheelRafId = null;
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
    // Defer expensive redraws to animation frame (coalesce rapid wheel events)
    if (!_wheelRafId) {
        _wheelRafId = requestAnimationFrame(() => {
            _wheelRafId = null;
            snapLayer.innerHTML = '';
            if (state.selectedIds.length) { drawSelection(); updatePowerClipMenu(); }
        });
    }
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
    // Update text alignment buttons
    if (obj.type === 'text') {
        const align = obj.textAlign || 'left';
        state.textAlign = align;
        document.querySelectorAll('.align-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.align === align);
        });
    }
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

    document.getElementById('flip-h-btn').addEventListener('click', () => {
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (!obj) continue;
            saveUndoState();
            flipObject(obj, 'horizontal');
            refreshElement(obj);
            if (obj.type !== 'curvepath') applyRotation(obj);
        }
        drawSelection();
    });

    document.getElementById('flip-v-btn').addEventListener('click', () => {
        for (const id of state.selectedIds) {
            const obj = findObject(id);
            if (!obj) continue;
            saveUndoState();
            flipObject(obj, 'vertical');
            refreshElement(obj);
            if (obj.type !== 'curvepath') applyRotation(obj);
        }
        drawSelection();
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
    window.addEventListener('mouseup', (e) => {
        // Catch mouseup outside the SVG canvas (e.g. marquee dragged off-screen)
        if (e.target === svg || svg.contains(e.target)) return; // handled by svg listener
        if (state.isMarquee || state.isDragging || state.isResizing || state.isPanning) {
            handleMouseUp(e);
        }
    });
    svg.addEventListener('wheel', handleWheel, {passive:false});
    svg.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // If we were right-click panning, don't show context menu
        if (state.rightClickPanning) {
            state.rightClickPanning = false;
            return;
        }
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
        const pt = screenToSVG(e.clientX, e.clientY);
        const obj = objectAtPoint(pt);
        // Check if dblclick landed on a ref area (or a ref area inside a group)
        let refAreaTarget = null;
        if (obj && obj.isRefArea) {
            refAreaTarget = obj;
        } else if (obj && obj.type === 'group') {
            for (const child of obj.children) {
                if (child.isRefArea && hitTest(child, pt)) { refAreaTarget = child; break; }
            }
        }
        if (obj && obj.type === 'text') {
            editTextObject(obj, e);
        } else if (refAreaTarget && refAreaTarget.refTextIds && refAreaTarget.refTextIds.length > 0) {
            const textObj = findObjectDeep(refAreaTarget.refTextIds[0]);
            if (textObj) editTextObject(textObj, e);
        } else if (obj && obj.type === 'powerclip' && obj.id !== pcEditingId) {
            // Skip if already editing this powerclip
            const screenScale = _cachedScreenScale;
            const borderThreshold = 8 * screenScale;
            const ne = nearestEdgePoint(obj.container, pt);
            if (ne && ne.dist <= borderThreshold) {
                enterNodeEdit(obj.id);
            } else {
                enterPowerClipEdit(obj.id);
            }
        } else if (obj && ['rect', 'ellipse', 'line', 'bspline', 'curvepath'].includes(obj.type)) {
            if (state.nodeEditId === obj.id) return;
            enterNodeEdit(obj.id);
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

    document.querySelectorAll('.align-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const align = btn.dataset.align;
            state.textAlign = align;
            document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            for (const id of state.selectedIds) {
                const obj = findObject(id);
                if (obj && obj.type === 'text') {
                    saveUndoState();
                    // Adjust x position to keep text visually in place
                    const bbox = obj.element.getBBox();
                    const oldAnchor = obj.textAlign || 'left';
                    let anchorX;
                    if (oldAnchor === 'left') anchorX = obj.x;
                    else if (oldAnchor === 'center') anchorX = obj.x - bbox.width / 2;
                    else anchorX = obj.x - bbox.width;
                    if (align === 'left') obj.x = anchorX;
                    else if (align === 'center') obj.x = anchorX + bbox.width / 2;
                    else obj.x = anchorX + bbox.width;
                    obj.textAlign = align;
                    refreshElement(obj);
                    drawSelection();
                    updatePropsPanel();
                }
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        // Undo/Redo
        if (e.key.toLowerCase() === 'z' && e.ctrlKey && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.key.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); redo(); return; }
        if (e.key.toLowerCase() === 'z' && e.ctrlKey && e.shiftKey) { e.preventDefault(); redo(); return; }
        // Group/Ungroup shortcuts
        if (e.key.toLowerCase() === 'a' && e.ctrlKey) { e.preventDefault(); state.selectedIds = state.objects.map(o => o.id); drawSelection(); updatePropsPanel(); return; }
        if (e.key.toLowerCase() === 'u' && e.ctrlKey) { e.preventDefault(); ungroupSelected(); return; }
        if (e.key.toLowerCase() === 'g' && e.ctrlKey) { e.preventDefault(); groupSelected(); return; }
        if (e.key.toLowerCase() === 'c' && e.ctrlKey) { e.preventDefault(); copySelectedAsSVG(); return; }
        if (e.key.toLowerCase() === 'd' && e.ctrlKey) { e.preventDefault(); duplicateSelected(); return; }
        if (e.key.toLowerCase() === 'j' && e.ctrlKey) { e.preventDefault(); joinNodes(); return; }
        if (e.key.toLowerCase() === 'i' && e.ctrlKey) { e.preventDefault(); importSVG(); return; }
        if (e.key.toLowerCase() === 'e' && e.ctrlKey) { e.preventDefault(); exportSVG(); return; }
        if (e.key === 'T' && e.shiftKey && !e.ctrlKey) { e.preventDefault(); for (const id of state.selectedIds) { const obj = findObject(id); if (obj && obj.type === 'image') invertImageColors(obj); } return; }
        if (e.key.toLowerCase() === 's' && e.ctrlKey) { e.preventDefault(); saveFile(); return; }
        if (e.key.toLowerCase() === 'o' && e.ctrlKey) { e.preventDefault(); showOpenFileModal(); return; }
        if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); bringToFront(); return; }
        if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); sendToBack(); return; }
        switch (e.key.toLowerCase()) {
            case 'v': setTool('select'); break;
            case 'r': setTool('rect'); break;
            case 'e': setTool('ellipse'); break;
            case 'l': setTool('line'); break;
            case 'b': setTool('bspline'); break;
            case 't': setTool('text'); break;
            case 'x': setTool('vsdelete'); break;
            case 'enter':
                if (state.tool === 'bspline' && state.bsplinePoints.length >= 2) {
                    const obj = createObject('bspline', { points: [...state.bsplinePoints] });
                    selectObject(obj.id);
                    state.bsplinePoints = [];
                    clearPreview();
                }
                break;
            case 'delete': case 'backspace':
                if (e.key.toLowerCase() === 'backspace' && state.tool === 'bspline' && state.bsplinePoints.length > 0) {
                    state.bsplinePoints.pop();
                    if (state.bsplinePoints.length === 0) clearPreview();
                    else updateBSplinePreview(state.bsplinePoints[state.bsplinePoints.length - 1]);
                    break;
                }
                for (const id of [...state.selectedIds]) deleteObject(id);
                updatePropsPanel(); break;
            case 'escape':
                if (state.pendingSVGImport) { state.pendingSVGImport = null; hidePlacementCursor(); }
                else if (pcEditingId) { exitPowerClipEdit(); }
                else if (state.nodeEditId) { exitNodeEdit(); }
                else if (state.tool === 'bspline' && state.bsplinePoints.length > 0) { state.bsplinePoints=[]; clearPreview(); }
                else if (state.tool !== 'select') setTool('select');
                else selectObject(null);
                break;
            case ' ':
                e.preventDefault(); state.spaceHeld = true; svg.style.cursor = 'grab'; break;
        }
    });

    document.addEventListener('keyup', (e) => {
        if (!e.key) return;
        if (e.key === ' ') { state.spaceHeld = false; svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; }
        if (e.key.toLowerCase() === 'w') { state.wHeld = false; clearPCHighlight(); }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key && e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            state.wHeld = true;
        }
    }, true);

    // Copy event: intercept to put SVG on clipboard in a format CorelDRAW understands
    document.addEventListener('copy', (e) => {
        if (window._pendingSVGCopy) {
            e.preventDefault();
            const svgStr = window._pendingSVGCopy;
            window._pendingSVGCopy = null;
            e.clipboardData.setData('text/plain', svgStr);
            e.clipboardData.setData('text/html', svgStr);
            showToast('Copiado');
        }
    });

    // Lossless paste: create editor objects directly from JSON data
    function pasteEditorObjects(objects, placePt) {
        saveUndoState();
        // Compute combined bounding box of source objects
        let minX = Infinity, minY = Infinity;
        for (const obj of objects) {
            const b = getObjBounds(obj);
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
        }
        const dx = placePt.x - minX, dy = placePt.y - minY;
        const idMap = {};
        const newIds = [];
        for (const obj of objects) {
            const oldId = obj.id;
            obj.id = state.nextId++;
            idMap[oldId] = obj.id;
            // Assign new IDs to children and track in idMap
            (function assignIds(o) {
                if (o.type === 'group' && o.children) {
                    for (const c of o.children) { idMap[c.id] = state.nextId; c.id = state.nextId++; assignIds(c); }
                }
                if (o.type === 'powerclip') {
                    if (o.container) { idMap[o.container.id] = state.nextId; o.container.id = state.nextId++; assignIds(o.container); }
                    if (o.contents) { for (const c of o.contents) { idMap[c.id] = state.nextId; c.id = state.nextId++; assignIds(c); } }
                }
            })(obj);
            offsetObject(obj, dx, dy);
            const elem = buildSVGElement(obj);
            obj.element = elem;
            elem.dataset.objectId = obj.id;
            objectsLayer.appendChild(elem);
            state.objects.push(obj);
            newIds.push(obj.id);
        }
        // Remap refTextIds to new IDs
        (function remapRefs(list) {
            for (const obj of list) {
                if (obj.isRefArea && obj.refTextIds) {
                    obj.refTextIds = obj.refTextIds.map(tid => idMap[tid] ?? null).filter(Boolean);
                }
                if (obj.type === 'group' && obj.children) remapRefs(obj.children);
                if (obj.type === 'powerclip' && obj.contents) remapRefs(obj.contents);
            }
        })(objects);
        state.selectedIds = newIds;
        drawSelection();
        updatePropsPanel();
        setTool('select');
    }

    // Paste from clipboard: SVG text (from CorelDRAW or this editor) or images
    document.addEventListener('paste', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const cbd = e.clipboardData;
        if (!cbd) return;

        // Check for SVG in text/html and text/plain synchronously
        // CorelDRAW puts SVG inside text/html (sometimes wrapped in HTML fragments)
        let svgText = null;
        for (const type of ['text/html', 'text/plain']) {
            const data = cbd.getData(type);
            if (data && data.includes('<svg') && data.includes('</svg>')) {
                // Extract SVG from possible HTML wrapper (CorelDRAW: <!--StartFragment--><svg...>...)
                const svgMatch = data.match(/<svg[\s\S]*<\/svg>/i);
                if (svgMatch) { svgText = svgMatch[0]; break; }
            }
        }
        if (svgText) {
            e.preventDefault();
            const vb = state.viewBox;
            const center = { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
            // Check for embedded editor object data (lossless paste)
            const metaMatch = svgText.match(/<metadata\s+id="editor-objects">([\s\S]*?)<\/metadata>/);
            if (metaMatch) {
                try {
                    const editorData = JSON.parse(metaMatch[1]);
                    pasteEditorObjects(editorData, center);
                    showToast('Pegado');
                    return;
                } catch(err) { /* fall through to SVG import */ }
            }
            importSVGText(svgText, center);
            showToast('Pegado');
            return;
        }

        // Fallback: paste images
        const items = cbd.items;
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
                        const vb = state.viewBox;
                        const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
                        let w = img.naturalWidth, h = img.naturalHeight;
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

    // Drag and drop SVG / image files onto the canvas
    const workspace = document.getElementById('workspace');
    workspace.addEventListener('dragover', (e) => {
        const types = e.dataTransfer && e.dataTransfer.types;
        if (types && types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });
    workspace.addEventListener('drop', (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        const dropPt = screenToSVG(e.clientX, e.clientY);
        for (const file of files) {
            if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) continue;
            const isSVG = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
            if (isSVG) {
                // Import SVG as vector objects (same as File > Import SVG)
                const reader = new FileReader();
                reader.onload = (ev) => {
                    importSVGText(ev.target.result, dropPt);
                };
                reader.readAsText(file);
            } else {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target.result;
                    const img = new Image();
                    img.onload = () => {
                        let w = img.naturalWidth, h = img.naturalHeight;
                        const maxW = state.pageWidth * 0.8, maxH = state.pageHeight * 0.8;
                        if (w > maxW || h > maxH) {
                            const scale = Math.min(maxW / w, maxH / h);
                            w *= scale; h *= scale;
                        }
                        const obj = createObject('image', {
                            x: dropPt.x - w / 2, y: dropPt.y - h / 2,
                            width: w, height: h,
                            href: dataUrl,
                        });
                        selectObject(obj.id);
                        setTool('select');
                    };
                    img.src = dataUrl;
                };
                reader.readAsDataURL(file);
            }
        }
    });

    window.addEventListener('resize', () => { invalidateLayoutCache(); resetView(); });
    window.addEventListener('beforeunload', (e) => {
        if (_isDirty && currentFileId) { e.preventDefault(); e.returnValue = ''; }
    });
    setupMenus();
    setupPageSizeModal();
    setupPropsPanel();
    setupContextMenu();
    setupPowerClipMenu();
    setupImportNamesModal();
    setupBmpConverterModal();
    setupBgRemovalModal();
    setupGridFillModal();
    setupFileModals();
    setupFilesSidebar();
    setupAIChat();
    setupMobile();
}

// =============================================
// MOBILE TOUCH & UI
// =============================================

let _pinchStartDist = 0, _pinchStartVB = null, _pinchCenter = null;
let _longPressTimer = null, _touchMoved = false;

function getTouchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
function getTouchCenter(t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
}

function handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
        // Pinch zoom start
        clearTimeout(_longPressTimer);
        _pinchStartDist = getTouchDist(e.touches);
        _pinchStartVB = { ...state.viewBox };
        _pinchCenter = getTouchCenter(e.touches);
        // Cancel any in-progress single-finger operation
        if (state.isDragging || state.isDrawing || state.isMarquee) handleMouseUp();
        return;
    }
    if (e.touches.length === 1) {
        const t = e.touches[0];
        _touchMoved = false;
        // Long press → context menu
        _longPressTimer = setTimeout(() => {
            if (!_touchMoved) {
                const pt = screenToSVG(t.clientX, t.clientY);
                const obj = objectAtPoint(pt);
                if (obj) {
                    selectObject(obj.id);
                    showContextMenu({ clientX: t.clientX, clientY: t.clientY, preventDefault() {} }, obj);
                }
            }
        }, 450);
        svg.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY, button: 0, bubbles: true }));
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && _pinchStartDist > 0) {
        const dist = getTouchDist(e.touches);
        const factor = _pinchStartDist / dist;
        const center = screenToSVG(_pinchCenter.x, _pinchCenter.y);
        const newW = _pinchStartVB.w * factor, newH = _pinchStartVB.h * factor;
        if (newW < 10 || newW > 50000) return;
        state.viewBox.x = center.x - (center.x - _pinchStartVB.x) * factor;
        state.viewBox.y = center.y - (center.y - _pinchStartVB.y) * factor;
        state.viewBox.w = newW;
        state.viewBox.h = newH;
        updateViewBox();
        if (state.selectedIds.length) drawSelection();
        return;
    }
    if (e.touches.length === 1) {
        _touchMoved = true;
        clearTimeout(_longPressTimer);
        const t = e.touches[0];
        svg.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY, button: 0, bubbles: true }));
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    clearTimeout(_longPressTimer);
    if (_pinchStartDist > 0 && e.touches.length < 2) {
        _pinchStartDist = 0;
        _pinchStartVB = null;
        return;
    }
    const ct = e.changedTouches[0];
    if (ct) {
        svg.dispatchEvent(new MouseEvent('mouseup', { clientX: ct.clientX, clientY: ct.clientY, button: 0, bubbles: true }));
    }
}

function setupMobile() {
    // Touch events on canvas
    svg.addEventListener('touchstart', handleTouchStart, { passive: false });
    svg.addEventListener('touchmove', handleTouchMove, { passive: false });
    svg.addEventListener('touchend', handleTouchEnd, { passive: false });

    const isMobile = () => window.innerWidth <= 768;

    // Auto-collapse sidebar on mobile
    if (isMobile()) {
        const sidebar = document.getElementById('files-sidebar');
        sidebar.classList.add('collapsed');
        sidebar.classList.remove('mobile-open');
    }

    // Hamburger menu → toggle sidebar overlay
    const menuBtn = document.getElementById('mobile-menu-btn');
    const scrim = document.getElementById('sidebar-scrim');
    const sidebar = document.getElementById('files-sidebar');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            const isOpen = sidebar.classList.contains('mobile-open');
            sidebar.classList.toggle('mobile-open', !isOpen);
            sidebar.classList.toggle('collapsed', isOpen);
            scrim.classList.toggle('visible', !isOpen);
        });
    }
    if (scrim) {
        scrim.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            sidebar.classList.add('collapsed');
            scrim.classList.remove('visible');
        });
    }

    // Palette toggle
    const paletteBtn = document.getElementById('mobile-palette-toggle');
    if (paletteBtn) {
        paletteBtn.addEventListener('click', () => {
            document.getElementById('color-palette').classList.toggle('mobile-visible');
        });
    }
}

// =============================================
// VIRTUAL SEGMENT DELETE TOOL
// =============================================

// Sample a path-like object into world-coordinate polyline
// Returns [{x, y, len}] where len is the local path length parameter
function vsDeleteSamplePath(obj) {
    if (obj.type === 'curvepath') {
        const elem = obj.element;
        if (!elem || typeof elem.getTotalLength !== 'function') return null;
        try {
            const totalLen = elem.getTotalLength();
            if (totalLen < 0.01) return null;
            const ctm = elem.getCTM();
            const svgCTM = svg.getCTM();
            if (!ctm || !svgCTM) return null;
            const rel = svgCTM.inverse().multiply(ctm);
            const steps = Math.min(300, Math.max(80, Math.ceil(totalLen / 2)));
            const samples = [];
            for (let i = 0; i <= steps; i++) {
                const l = (i / steps) * totalLen;
                const p = elem.getPointAtLength(l);
                samples.push({
                    x: rel.a * p.x + rel.c * p.y + rel.e,
                    y: rel.b * p.x + rel.d * p.y + rel.f,
                    len: l
                });
            }
            return { objId: obj.id, samples, totalLen };
        } catch(e) { return null; }
    } else if (obj.type === 'line') {
        return {
            objId: obj.id,
            samples: [
                { x: obj.x1, y: obj.y1, len: 0 },
                { x: obj.x2, y: obj.y2, len: Math.hypot(obj.x2-obj.x1, obj.y2-obj.y1) }
            ],
            totalLen: Math.hypot(obj.x2-obj.x1, obj.y2-obj.y1)
        };
    }
    return null;
}

// Line segment intersection: returns {x,y,t1,t2} or null
function vsSegSegIntersect(a1, a2, b1, b2) {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return null;
    const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / cross;
    const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / cross;
    if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
        return { x: a1.x + t * d1x, y: a1.y + t * d1y, t1: t, t2: u };
    }
    return null;
}

// Find all intersections between all path objects
function vsDeleteFindAllIntersections() {
    const pathObjs = state.objects.filter(o => o.type === 'curvepath' || o.type === 'line');
    const sampled = [];
    for (const obj of pathObjs) {
        const s = vsDeleteSamplePath(obj);
        if (s) sampled.push(s);
    }
    const intersections = []; // [{x,y, objId1, len1, objId2, len2}]
    for (let a = 0; a < sampled.length; a++) {
        for (let b = a; b < sampled.length; b++) {
            const sa = sampled[a], sb = sampled[b];
            const isSelf = (a === b);
            for (let i = 0; i < sa.samples.length - 1; i++) {
                const jStart = isSelf ? i + 2 : 0; // skip adjacent for self-intersection
                for (let j = jStart; j < sb.samples.length - 1; j++) {
                    const hit = vsSegSegIntersect(sa.samples[i], sa.samples[i+1], sb.samples[j], sb.samples[j+1]);
                    if (hit) {
                        const len1 = sa.samples[i].len + hit.t1 * (sa.samples[i+1].len - sa.samples[i].len);
                        const len2 = sb.samples[j].len + hit.t2 * (sb.samples[j+1].len - sb.samples[j].len);
                        // Avoid duplicate intersections (very close points)
                        const isDup = intersections.some(ix =>
                            Math.hypot(ix.x - hit.x, ix.y - hit.y) < 0.5
                        );
                        if (!isDup) {
                            intersections.push({ x: hit.x, y: hit.y, objId1: sa.objId, len1, objId2: sb.objId, len2 });
                        }
                    }
                }
            }
        }
    }
    return { intersections, sampled };
}

// For a given object and a click length-parameter, find the virtual segment bounds
// Returns { startLen, endLen } — the intersection/endpoint lengths that bracket the click
function vsDeleteFindSegmentBounds(objId, clickLen, totalLen, intersections) {
    // Gather all intersection lengths for this object
    const cuts = [0, totalLen]; // endpoints
    for (const ix of intersections) {
        if (ix.objId1 === objId) cuts.push(ix.len1);
        if (ix.objId2 === objId) cuts.push(ix.len2);
    }
    cuts.sort((a, b) => a - b);
    // Find which segment contains the click
    for (let i = 0; i < cuts.length - 1; i++) {
        if (clickLen >= cuts[i] && clickLen <= cuts[i + 1]) {
            return { startLen: cuts[i], endLen: cuts[i + 1] };
        }
    }
    return null;
}

// Get world-space polyline for a virtual segment (for highlighting)
function vsDeleteGetSegmentPolyline(sampledPath, startLen, endLen) {
    const samples = sampledPath.samples;
    if (samples.length < 2) return null;
    const pts = [];
    // Interpolate start point
    for (let i = 0; i < samples.length - 1; i++) {
        if (samples[i].len <= startLen && samples[i + 1].len >= startLen) {
            const segLen = samples[i + 1].len - samples[i].len;
            const t = segLen > 0 ? (startLen - samples[i].len) / segLen : 0;
            pts.push({
                x: samples[i].x + t * (samples[i + 1].x - samples[i].x),
                y: samples[i].y + t * (samples[i + 1].y - samples[i].y)
            });
            break;
        }
    }
    // Add all samples strictly between start and end
    for (const s of samples) {
        if (s.len > startLen && s.len < endLen) {
            pts.push({ x: s.x, y: s.y });
        }
    }
    // Interpolate end point
    for (let i = 0; i < samples.length - 1; i++) {
        if (samples[i].len <= endLen && samples[i + 1].len >= endLen) {
            const segLen = samples[i + 1].len - samples[i].len;
            const t = segLen > 0 ? (endLen - samples[i].len) / segLen : 0;
            pts.push({
                x: samples[i].x + t * (samples[i + 1].x - samples[i].x),
                y: samples[i].y + t * (samples[i + 1].y - samples[i].y)
            });
            break;
        }
    }
    return pts.length >= 2 ? pts : null;
}

// Find closest path and length parameter for a world point
function vsDeleteClosestPath(pt, sampled) {
    let bestDist = Infinity, bestObjId = null, bestLen = 0, bestSampled = null;
    const screenScale = _cachedScreenScale;
    const threshold = 25 * screenScale;
    for (const sp of sampled) {
        for (let i = 0; i < sp.samples.length - 1; i++) {
            const a = sp.samples[i], b = sp.samples[i + 1];
            const d = distToSeg(pt, a, b);
            if (d < bestDist && d < threshold) {
                bestDist = d;
                bestObjId = sp.objId;
                bestSampled = sp;
                // Project pt onto segment to get length param
                const dx = b.x - a.x, dy = b.y - a.y, len2 = dx*dx + dy*dy;
                let t = len2 > 0 ? Math.max(0, Math.min(1, ((pt.x-a.x)*dx + (pt.y-a.y)*dy) / len2)) : 0;
                bestLen = a.len + t * (b.len - a.len);
            }
        }
    }
    return bestObjId ? { objId: bestObjId, len: bestLen, dist: bestDist, sampled: bestSampled } : null;
}

// --- De Casteljau cubic bezier split ---
function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

function splitCubicAt(p0, p1, p2, p3, t) {
    const a = lerpPt(p0, p1, t), b = lerpPt(p1, p2, t), c = lerpPt(p2, p3, t);
    const d = lerpPt(a, b, t), e = lerpPt(b, c, t);
    const f = lerpPt(d, e, t);
    return {
        left:  { p0, p1: a, p2: d, p3: f },
        right: { p0: f, p1: e, p2: c, p3 }
    };
}

// Build a cumulative length table for parsed path commands using the SVG element
function vsDeleteBuildLenTable(obj) {
    const elem = obj.element;
    if (!elem || typeof elem.getTotalLength !== 'function') return null;
    const totalLen = elem.getTotalLength();
    const cmds = parseSVGPath(obj.d);
    if (cmds.length === 0) return null;

    // Walk through commands, tracking current point to compute segment lengths
    // We use getPointAtLength to find where each segment boundary falls
    const table = []; // [{segIdx, startLen, endLen}]
    let curX = 0, curY = 0;
    const ctm = elem.getCTM();
    const svgCTM = svg.getCTM();
    if (!ctm || !svgCTM) return null;
    const rel = svgCTM.inverse().multiply(ctm);
    // Inverse transform: world -> local
    const det = rel.a * rel.d - rel.b * rel.c;
    if (Math.abs(det) < 1e-10) return null;

    // Walk segments by checking which length corresponds to each endpoint
    let accLen = 0;
    for (let si = 0; si < cmds.length; si++) {
        const seg = cmds[si];
        if (seg.cmd === 'M') {
            curX = seg.pts[0].x; curY = seg.pts[0].y;
            table.push({ segIdx: si, startLen: accLen, endLen: accLen });
            continue;
        }
        if (seg.cmd === 'Z') {
            table.push({ segIdx: si, startLen: accLen, endLen: accLen });
            continue;
        }
        // Find the endpoint of this segment in world coords
        const endPt = seg.pts[seg.pts.length - 1];
        const wx = rel.a * endPt.x + rel.c * endPt.y + rel.e;
        const wy = rel.b * endPt.x + rel.d * endPt.y + rel.f;
        // Binary search for the length that reaches this world point
        let lo = accLen, hi = totalLen, bestL = accLen;
        for (let iter = 0; iter < 40; iter++) {
            const mid = (lo + hi) / 2;
            const mp = elem.getPointAtLength(mid);
            const mwx = rel.a * mp.x + rel.c * mp.y + rel.e;
            const mwy = rel.b * mp.x + rel.d * mp.y + rel.f;
            const dist = Math.hypot(mwx - wx, mwy - wy);
            if (dist < 0.3) { bestL = mid; break; }
            // Check if we overshot by comparing with a slightly further point
            const mp2 = elem.getPointAtLength(Math.min(mid + 0.5, totalLen));
            const mwx2 = rel.a * mp2.x + rel.c * mp2.y + rel.e;
            const mwy2 = rel.b * mp2.x + rel.d * mp2.y + rel.f;
            if (Math.hypot(mwx2 - wx, mwy2 - wy) < dist) {
                lo = mid;
            } else {
                hi = mid;
            }
            bestL = mid;
        }
        const segStartLen = accLen;
        accLen = bestL;
        table.push({ segIdx: si, startLen: segStartLen, endLen: accLen });
        curX = endPt.x; curY = endPt.y;
    }
    return { cmds, table, totalLen };
}

// Delete a virtual segment from a curvepath, splitting at startLen and endLen
function vsDeleteExecute(obj, startLen, endLen, allIntersections) {
    if (obj.type === 'line') {
        saveUndoState();
        const lineLen = Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1);
        if (lineLen < 0.01) return;
        // Gather intersection lengths on this line
        const cuts = [0, lineLen];
        for (const ix of allIntersections) {
            if (ix.objId1 === obj.id) cuts.push(ix.len1);
            if (ix.objId2 === obj.id) cuts.push(ix.len2);
        }
        cuts.sort((a, b) => a - b);
        // Build kept ranges (segments NOT in [startLen, endLen])
        const keptRanges = [];
        for (let i = 0; i < cuts.length - 1; i++) {
            const s = cuts[i], e = cuts[i + 1];
            const mid = (s + e) / 2;
            if (mid < startLen || mid > endLen) keptRanges.push({ s, e });
        }
        // Remove original line
        state.objects = state.objects.filter(o => o.id !== obj.id);
        if (obj.element) obj.element.remove();
        // Create new line objects for kept segments
        const dx = (obj.x2 - obj.x1) / lineLen, dy = (obj.y2 - obj.y1) / lineLen;
        for (const range of keptRanges) {
            if (range.e - range.s < 0.5) continue;
            const nx1 = obj.x1 + dx * range.s, ny1 = obj.y1 + dy * range.s;
            const nx2 = obj.x1 + dx * range.e, ny2 = obj.y1 + dy * range.e;
            const newLine = createObject('line', {
                x1: nx1, y1: ny1, x2: nx2, y2: ny2,
                stroke: obj.stroke, strokeWidth: obj.strokeWidth
            });
            selectObject(newLine.id);
        }
        state.selectedIds = []; drawSelection(); updatePropsPanel();
        return;
    }
    if (obj.type !== 'curvepath') return;

    saveUndoState();
    const elem = obj.element;
    if (!elem || typeof elem.getTotalLength !== 'function') return;
    const totalLen = elem.getTotalLength();
    const ctm = elem.getCTM();
    const svgCTM = svg.getCTM();
    if (!ctm || !svgCTM) return;
    const rel = svgCTM.inverse().multiply(ctm);

    // Gather all cut points (intersection lengths) on this object, sorted
    const cuts = [];
    for (const ix of allIntersections) {
        if (ix.objId1 === obj.id) cuts.push(ix.len1);
        if (ix.objId2 === obj.id) cuts.push(ix.len2);
    }
    cuts.push(0, totalLen);
    cuts.sort((a, b) => a - b);

    // Build sub-paths: each contiguous range NOT in [startLen, endLen]
    // A segment [cuts[i], cuts[i+1]] is kept if it doesn't overlap with [startLen, endLen]
    const keptRanges = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        const s = cuts[i], e = cuts[i + 1];
        const mid = (s + e) / 2;
        if (mid < startLen || mid > endLen) {
            keptRanges.push({ s, e });
        }
    }

    // Merge adjacent kept ranges
    const merged = [];
    for (const r of keptRanges) {
        if (merged.length > 0 && Math.abs(merged[merged.length-1].e - r.s) < 0.5) {
            merged[merged.length-1].e = r.e;
        } else {
            merged.push({ ...r });
        }
    }

    if (merged.length === 0) {
        // Delete entire object
        state.objects = state.objects.filter(o => o.id !== obj.id);
        if (obj.element) obj.element.remove();
        state.selectedIds = []; drawSelection(); updatePropsPanel();
        return;
    }

    // Sample each kept range and create new curvepath objects
    const ns = 'http://www.w3.org/2000/svg';
    const newObjects = [];
    for (const range of merged) {
        const rangeLen = range.e - range.s;
        if (rangeLen < 0.5) continue;
        const steps = Math.max(20, Math.ceil(rangeLen / 2));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const l = range.s + (i / steps) * rangeLen;
            const p = elem.getPointAtLength(l);
            const wx = rel.a * p.x + rel.c * p.y + rel.e;
            const wy = rel.b * p.x + rel.d * p.y + rel.f;
            pts.push({ x: wx, y: wy });
        }
        if (pts.length < 2) continue;

        // Build a polyline path d-string from world points
        let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
        for (let i = 1; i < pts.length; i++) {
            d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
        }

        // Compute bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        }
        const bw = maxX - minX || 1, bh = maxY - minY || 1;

        const newObj = {
            id: state.nextId++,
            type: 'curvepath',
            d: d,
            x: minX, y: minY,
            width: bw, height: bh,
            _origBounds: { x: minX, y: minY, w: bw, h: bh },
            fill: obj.fill,
            stroke: obj.stroke,
            strokeWidth: obj.strokeWidth,
            rotation: 0,
        };
        newObjects.push(newObj);
    }

    // Remove original object
    state.objects = state.objects.filter(o => o.id !== obj.id);
    if (obj.element) obj.element.remove();

    // Add new objects
    for (const newObj of newObjects) {
        const el = buildSVGElement(newObj);
        newObj.element = el;
        el.dataset.objectId = newObj.id;
        objectsLayer.appendChild(el);
        state.objects.push(newObj);
    }

    deselectAll();
}

// --- VS Delete preview/highlight ---
let _vsDeletePreviewEl = null;

function clearVSDeletePreview() {
    if (_vsDeletePreviewEl) { _vsDeletePreviewEl.remove(); _vsDeletePreviewEl = null; }
}

function drawVSDeletePreview(pts) {
    clearVSDeletePreview();
    if (!pts || pts.length < 2) return;
    const ns = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(ns, 'polyline');
    const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');
    path.setAttribute('points', pointsStr);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#ff3333');
    path.setAttribute('stroke-width', 3 * _cachedScreenScale);
    path.setAttribute('stroke-dasharray', `${6 * _cachedScreenScale} ${4 * _cachedScreenScale}`);
    path.setAttribute('pointer-events', 'none');
    // Add to snap layer (above objects and selection)
    snapLayer.appendChild(path);
    _vsDeletePreviewEl = path;
}

// Cached intersection data (recomputed on mouse idle)
let _vsDeleteCache = null;
let _vsDeleteCacheDirty = true;

function vsDeleteInvalidateCache() { _vsDeleteCacheDirty = true; _vsDeleteCache = null; }

// --- VS Delete marquee state ---
let _vsDeleteDragging = false;
let _vsDeleteStart = null;
let _vsDeleteMarqueeEl = null;

function handleVSDeleteDown(pt) {
    _vsDeleteDragging = true;
    _vsDeleteStart = { x: pt.x, y: pt.y };
    // Create marquee rect
    const ns = 'http://www.w3.org/2000/svg';
    const screenScale = _cachedScreenScale;
    _vsDeleteMarqueeEl = document.createElementNS(ns, 'rect');
    _vsDeleteMarqueeEl.setAttribute('fill', 'rgba(255, 51, 51, 0.08)');
    _vsDeleteMarqueeEl.setAttribute('stroke', '#ff3333');
    _vsDeleteMarqueeEl.setAttribute('stroke-width', screenScale);
    _vsDeleteMarqueeEl.setAttribute('stroke-dasharray', `${4*screenScale} ${2*screenScale}`);
    _vsDeleteMarqueeEl.setAttribute('pointer-events', 'none');
    _vsDeleteMarqueeEl.setAttribute('x', pt.x);
    _vsDeleteMarqueeEl.setAttribute('y', pt.y);
    _vsDeleteMarqueeEl.setAttribute('width', 0);
    _vsDeleteMarqueeEl.setAttribute('height', 0);
    selectionLayer.appendChild(_vsDeleteMarqueeEl);
}

function handleVSDeleteMove(pt) {
    // Update marquee if dragging
    if (_vsDeleteDragging && _vsDeleteStart && _vsDeleteMarqueeEl) {
        const sx = _vsDeleteStart.x, sy = _vsDeleteStart.y;
        _vsDeleteMarqueeEl.setAttribute('x', Math.min(sx, pt.x));
        _vsDeleteMarqueeEl.setAttribute('y', Math.min(sy, pt.y));
        _vsDeleteMarqueeEl.setAttribute('width', Math.abs(pt.x - sx));
        _vsDeleteMarqueeEl.setAttribute('height', Math.abs(pt.y - sy));
        return; // skip hover preview during drag
    }

    // Hover preview
    if (_vsDeleteCacheDirty || !_vsDeleteCache) {
        _vsDeleteCache = vsDeleteFindAllIntersections();
        _vsDeleteCacheDirty = false;
    }
    const { intersections, sampled } = _vsDeleteCache;
    const hit = vsDeleteClosestPath(pt, sampled);
    if (!hit) { clearVSDeletePreview(); svg.style.cursor = 'crosshair'; return; }

    const sp = sampled.find(s => s.objId === hit.objId);
    if (!sp) { clearVSDeletePreview(); return; }

    const bounds = vsDeleteFindSegmentBounds(hit.objId, hit.len, sp.totalLen, intersections);
    if (!bounds) { clearVSDeletePreview(); return; }

    const polyline = vsDeleteGetSegmentPolyline(sp, bounds.startLen, bounds.endLen);
    if (polyline && polyline.length >= 2) {
        drawVSDeletePreview(polyline);
        svg.style.cursor = 'pointer';
    } else {
        clearVSDeletePreview();
        svg.style.cursor = 'crosshair';
    }
}

function handleVSDeleteUp(pt) {
    if (!_vsDeleteDragging) return;
    _vsDeleteDragging = false;

    // Remove marquee visual
    if (_vsDeleteMarqueeEl) { _vsDeleteMarqueeEl.remove(); _vsDeleteMarqueeEl = null; }

    if (_vsDeleteCacheDirty || !_vsDeleteCache) {
        _vsDeleteCache = vsDeleteFindAllIntersections();
        _vsDeleteCacheDirty = false;
    }
    const { intersections, sampled } = _vsDeleteCache;

    const sx = _vsDeleteStart.x, sy = _vsDeleteStart.y;
    const mw = Math.abs(pt.x - sx), mh = Math.abs(pt.y - sy);

    if (mw < 3 && mh < 3) {
        // Small drag = click → delete single closest segment
        const hit = vsDeleteClosestPath(pt, sampled);
        if (!hit) return;
        const sp = sampled.find(s => s.objId === hit.objId);
        if (!sp) return;
        const bounds = vsDeleteFindSegmentBounds(hit.objId, hit.len, sp.totalLen, intersections);
        if (!bounds) return;
        const obj = findObject(hit.objId);
        if (!obj) return;
        clearVSDeletePreview();
        vsDeleteExecute(obj, bounds.startLen, bounds.endLen, intersections);
        vsDeleteInvalidateCache();
    } else {
        // Marquee drag → delete all segments fully inside the rectangle
        const mx = Math.min(sx, pt.x), my = Math.min(sy, pt.y);
        const mx2 = mx + mw, my2 = my + mh;
        // Find all virtual segments, check which are fully inside the marquee
        const toDelete = []; // [{objId, startLen, endLen}]
        for (const sp of sampled) {
            const cuts = [0, sp.totalLen];
            for (const ix of intersections) {
                if (ix.objId1 === sp.objId) cuts.push(ix.len1);
                if (ix.objId2 === sp.objId) cuts.push(ix.len2);
            }
            cuts.sort((a, b) => a - b);
            for (let i = 0; i < cuts.length - 1; i++) {
                const sLen = cuts[i], eLen = cuts[i + 1];
                if (eLen - sLen < 0.5) continue;
                // Check if ANY sample point in this range is inside the marquee
                const segPts = vsDeleteGetSegmentPolyline(sp, sLen, eLen);
                if (!segPts || segPts.length < 2) continue;
                const anyInside = segPts.some(p => p.x >= mx && p.x <= mx2 && p.y >= my && p.y <= my2);
                if (anyInside) {
                    toDelete.push({ objId: sp.objId, startLen: sLen, endLen: eLen });
                }
            }
        }
        if (toDelete.length === 0) return;
        clearVSDeletePreview();
        // Delete segments (process each object, may need multiple passes as objects change)
        // Group by object and delete from last to first to avoid index shifting
        const byObj = {};
        for (const td of toDelete) {
            if (!byObj[td.objId]) byObj[td.objId] = [];
            byObj[td.objId].push(td);
        }
        for (const objId of Object.keys(byObj)) {
            const obj = findObject(+objId);
            if (!obj) continue;
            // For multiple segments on same object, delete them all at once
            // by marking all their ranges as deleted
            const segments = byObj[objId];
            // Execute deletion for the first segment, then re-process
            // (simplified: delete one by one, recaching each time)
            for (const seg of segments) {
                const currentObj = findObject(+objId);
                if (!currentObj) break;
                vsDeleteExecute(currentObj, seg.startLen, seg.endLen, intersections);
            }
        }
        vsDeleteInvalidateCache();
    }
    _vsDeleteStart = null;
}

function setTool(tool) {
    if (state.nodeEditId) exitNodeEdit();
    if (state.tool === 'bspline' && tool !== 'bspline') {
        if (state.bsplinePoints.length >= 2) { const obj = createObject('bspline',{points:[...state.bsplinePoints]}); selectObject(obj.id); }
        state.bsplinePoints=[]; clearPreview();
    }
    state.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    document.getElementById('status-tool').textContent = TOOL_NAMES[tool];
    svg.style.cursor = tool === 'select' ? 'default' : tool === 'vsdelete' ? 'crosshair' : 'crosshair';
    if (tool !== 'vsdelete') {
        clearVSDeletePreview();
        _vsDeleteDragging = false;
        if (_vsDeleteMarqueeEl) { _vsDeleteMarqueeEl.remove(); _vsDeleteMarqueeEl = null; }
    }
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
        let x = obj.x;
        // Adjust x for text alignment (opentype always draws from the left)
        if (obj.textAlign === 'center' || obj.textAlign === 'right') {
            const adv = font.getAdvanceWidth(obj.text, obj.fontSize);
            if (obj.textAlign === 'center') x -= adv / 2;
            else x -= adv;
        }
        const path = font.getPath(obj.text, x, obj.y, obj.fontSize);
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
    let bx = obj.x - 2;
    if (obj.textAlign === 'center') bx -= w / 2;
    else if (obj.textAlign === 'right') bx -= w;
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
    const s1 = document.getElementById('page-shadow-1');
    const s2 = document.getElementById('page-shadow-2');
    if (s1) { s1.setAttribute('fill', isDark ? '#000' : '#3d2e5c'); s1.setAttribute('opacity', isDark ? '0.15' : '0.06'); }
    if (s2) { s2.setAttribute('fill', isDark ? '#000' : '#3d2e5c'); s2.setAttribute('opacity', isDark ? '0.10' : '0.04'); }
}

// =============================================
// BMP LASER CONVERTER
// =============================================
const bmpState = {
    sourceImage: null, // HTMLImageElement
    sourceCanvas: null,
    originalImageData: null,
    processedImageData: null,
    debounceTimer: null,
    zoom: 0, // 0 = fit, >0 = percentage (e.g. 100 = 100%)
    editorTarget: null, // image object from editor to replace after processing
};

function showBmpConverterModal(imageObj) {
    const modal = document.getElementById('bmp-converter-modal');
    modal.classList.remove('hidden');
    // Reset controls
    document.getElementById('bmp-brightness').value = 0;
    document.getElementById('bmp-brightness-val').textContent = '0';
    document.getElementById('bmp-contrast').value = 0;
    document.getElementById('bmp-contrast-val').textContent = '0';
    document.getElementById('bmp-gamma').value = 1.0;
    document.getElementById('bmp-gamma-val').textContent = '1.0';
    document.getElementById('bmp-threshold').value = 128;
    document.getElementById('bmp-threshold-val').textContent = '128';
    document.getElementById('bmp-algorithm').value = 'floyd-steinberg';
    document.getElementById('bmp-invert').checked = false;
    document.getElementById('bmp-dpi').value = 300;
    document.getElementById('bmp-download-btn').disabled = true;
    bmpState.sourceImage = null;
    bmpState.originalImageData = null;
    bmpState.processedImageData = null;
    bmpState.zoom = 0;
    bmpState.editorTarget = null;
    bmpApplyZoom();
    // Reset view to Procesado
    document.getElementById('bmp-orig-container').style.display = 'none';
    document.getElementById('bmp-proc-container').style.display = '';
    document.getElementById('bmp-view-processed').classList.add('active');
    document.getElementById('bmp-view-original').classList.remove('active');
    // Clear preview canvases
    const origCanvas = document.getElementById('bmp-preview-original');
    const procCanvas = document.getElementById('bmp-preview-processed');
    origCanvas.width = 0; origCanvas.height = 0;
    procCanvas.width = 0; procCanvas.height = 0;
    // Update threshold visibility
    bmpUpdateThresholdVisibility();

    const applyEditorBtn = document.getElementById('bmp-apply-editor-btn');

    // If called from context menu with an image object, auto-load it
    if (imageObj && imageObj.type === 'image' && imageObj.href) {
        bmpState.editorTarget = imageObj;
        applyEditorBtn.style.display = '';
        applyEditorBtn.disabled = true;
        // Hide source row (no need to upload/select)
        document.querySelector('.bmp-source-row').style.display = 'none';
        // Auto-load the image
        bmpLoadImageFromObject(imageObj);
    } else {
        applyEditorBtn.style.display = 'none';
        document.querySelector('.bmp-source-row').style.display = '';
        // Check if a selected canvas object is an image
        bmpUpdateUseSelectedBtn();
    }
}

function hideBmpConverterModal() {
    document.getElementById('bmp-converter-modal').classList.add('hidden');
    bmpState.editorTarget = null;
    // Restore source row visibility for next time
    const srcRow = document.querySelector('.bmp-source-row');
    if (srcRow) srcRow.style.display = '';
}

function bmpUpdateUseSelectedBtn() {
    const btn = document.getElementById('bmp-use-selected');
    const sel = state.selectedIds.length === 1 ? findObject(state.selectedIds[0]) : null;
    btn.disabled = !(sel && sel.type === 'image' && sel.href);
}

function bmpUpdateThresholdVisibility() {
    const algo = document.getElementById('bmp-algorithm').value;
    const group = document.getElementById('bmp-threshold-group');
    if (algo === 'threshold') {
        group.classList.remove('hidden-slider');
    } else {
        group.classList.add('hidden-slider');
    }
}

function bmpLoadImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            bmpState.sourceImage = img;
            bmpDrawOriginalPreview();
            bmpProcessAndPreview();
            document.getElementById('bmp-download-btn').disabled = false;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function bmpLoadImageFromSelected() {
    const sel = state.selectedIds.length === 1 ? findObject(state.selectedIds[0]) : null;
    if (!sel || sel.type !== 'image' || !sel.href) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
        bmpState.sourceImage = img;
        bmpDrawOriginalPreview();
        bmpProcessAndPreview();
        document.getElementById('bmp-download-btn').disabled = false;
    };
    img.onerror = function() {
        // Try without crossOrigin for data URLs
        const img2 = new Image();
        img2.onload = function() {
            bmpState.sourceImage = img2;
            bmpDrawOriginalPreview();
            bmpProcessAndPreview();
            document.getElementById('bmp-download-btn').disabled = false;
        };
        img2.src = sel.href;
    };
    img.src = sel.href;
}

function bmpLoadImageFromObject(obj) {
    if (!obj || obj.type !== 'image' || !obj.href) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const onLoaded = function(loadedImg) {
        bmpState.sourceImage = loadedImg;
        bmpRasterizeAtDpi();
        document.getElementById('bmp-download-btn').disabled = false;
        if (bmpState.editorTarget) {
            document.getElementById('bmp-apply-editor-btn').disabled = false;
        }
    };
    img.onload = function() { onLoaded(img); };
    img.onerror = function() {
        const img2 = new Image();
        img2.onload = function() { onLoaded(img2); };
        img2.src = obj.href;
    };
    img.src = obj.href;
}

// Re-rasterize the source image at the current DPI based on the editor object's size
function bmpRasterizeAtDpi() {
    const img = bmpState.sourceImage;
    if (!img || !bmpState.editorTarget) return;
    const obj = bmpState.editorTarget;
    const dpi = parseInt(document.getElementById('bmp-dpi').value, 10) || 300;
    const widthIn = obj.width / 96;
    const heightIn = obj.height / 96;
    const pxW = Math.round(widthIn * dpi);
    const pxH = Math.round(heightIn * dpi);

    // Rasterize at DPI-based resolution
    const canvas = document.getElementById('bmp-preview-original');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, pxW, pxH);
    bmpState.originalImageData = ctx.getImageData(0, 0, pxW, pxH);
    bmpApplyZoom();

    // Update info
    bmpUpdateDpiInfo(pxW, pxH);

    // Re-process with dithering
    bmpProcessAndPreview();
}

function bmpUpdateDpiInfo(pxW, pxH) {
    let info = document.getElementById('bmp-dpi-info');
    if (!info) {
        info = document.createElement('span');
        info.id = 'bmp-dpi-info';
        info.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-left:4px;';
        const dpiInput = document.getElementById('bmp-dpi');
        dpiInput.parentNode.appendChild(info);
    }
    info.textContent = `${pxW} × ${pxH} px`;
}

function bmpApplyToEditor() {
    if (!bmpState.editorTarget || !bmpState.processedImageData) return;
    const obj = bmpState.editorTarget;
    const procData = bmpState.processedImageData;

    // Render processed image data to a canvas and get PNG data URL
    const canvas = document.createElement('canvas');
    canvas.width = procData.width;
    canvas.height = procData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(procData, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    // Replace the original image in the editor
    saveUndoState();
    obj.href = dataUrl;
    obj.element.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
    obj.element.setAttribute('href', dataUrl);
    refreshElement(obj);

    hideBmpConverterModal();
}

function bmpDrawOriginalPreview() {
    const img = bmpState.sourceImage;
    if (!img) return;
    const canvas = document.getElementById('bmp-preview-original');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    bmpState.originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bmpApplyZoom();
}

function bmpProcessAndPreview() {
    if (!bmpState.originalImageData) return;
    const options = {
        brightness: parseInt(document.getElementById('bmp-brightness').value, 10),
        contrast: parseInt(document.getElementById('bmp-contrast').value, 10),
        gamma: parseFloat(document.getElementById('bmp-gamma').value),
        threshold: parseInt(document.getElementById('bmp-threshold').value, 10),
        algorithm: document.getElementById('bmp-algorithm').value,
        invert: document.getElementById('bmp-invert').checked,
    };
    const srcData = bmpState.originalImageData;
    const processed = processImageForLaser(srcData, options);
    bmpState.processedImageData = processed;
    const canvas = document.getElementById('bmp-preview-processed');
    canvas.width = processed.width;
    canvas.height = processed.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(processed, 0, 0);
    bmpApplyZoom();
}

function bmpScheduleUpdate() {
    if (bmpState.debounceTimer) cancelAnimationFrame(bmpState.debounceTimer);
    bmpState.debounceTimer = requestAnimationFrame(() => {
        bmpProcessAndPreview();
    });
}

// --- Zoom controls ---
// Redraw canvases at target resolution for perfect pixel-sharp rendering
function bmpRedrawAtZoom(canvas, sourceImageData, scale) {
    if (!sourceImageData) return;
    const sw = sourceImageData.width, sh = sourceImageData.height;
    const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    // Draw pixel-by-pixel for perfect 1-bit rendering
    const src = sourceImageData.data;
    const dst = ctx.createImageData(dw, dh);
    const dstData = dst.data;
    const s = Math.max(1, Math.round(scale));
    if (scale >= 1) {
        // Upscale: each source pixel becomes an s×s block
        for (let sy = 0; sy < sh; sy++) {
            for (let sx = 0; sx < sw; sx++) {
                const si = (sy * sw + sx) * 4;
                const r = src[si], g = src[si+1], b = src[si+2], a = src[si+3];
                for (let dy = 0; dy < s && sy*s+dy < dh; dy++) {
                    for (let dx = 0; dx < s && sx*s+dx < dw; dx++) {
                        const di = ((sy*s+dy) * dw + (sx*s+dx)) * 4;
                        dstData[di] = r; dstData[di+1] = g; dstData[di+2] = b; dstData[di+3] = a;
                    }
                }
            }
        }
    } else {
        // Downscale: nearest-neighbor sampling
        for (let y = 0; y < dh; y++) {
            const srcY = Math.floor(y / scale);
            for (let x = 0; x < dw; x++) {
                const srcX = Math.floor(x / scale);
                const si = (srcY * sw + srcX) * 4;
                const di = (y * dw + x) * 4;
                dstData[di] = src[si]; dstData[di+1] = src[si+1];
                dstData[di+2] = src[si+2]; dstData[di+3] = src[si+3];
            }
        }
    }
    ctx.putImageData(dst, 0, 0);
    canvas.style.width = '';
    canvas.style.height = '';
}

function bmpApplyZoom() {
    const origContainer = document.getElementById('bmp-orig-container');
    const procContainer = document.getElementById('bmp-proc-container');
    const origCanvas = document.getElementById('bmp-preview-original');
    const procCanvas = document.getElementById('bmp-preview-processed');
    const valEl = document.getElementById('bmp-zoom-val');

    if (bmpState.zoom === 0) {
        // Fit mode — use CSS scaling
        valEl.textContent = 'Ajustar';
        origContainer.classList.remove('zoomed');
        procContainer.classList.remove('zoomed');
        // Restore original resolution canvases
        if (bmpState.originalImageData) {
            origCanvas.width = bmpState.originalImageData.width;
            origCanvas.height = bmpState.originalImageData.height;
            origCanvas.getContext('2d').putImageData(bmpState.originalImageData, 0, 0);
            origCanvas.style.width = '';
            origCanvas.style.height = '';
        }
        if (bmpState.processedImageData) {
            procCanvas.width = bmpState.processedImageData.width;
            procCanvas.height = bmpState.processedImageData.height;
            procCanvas.getContext('2d').putImageData(bmpState.processedImageData, 0, 0);
            procCanvas.style.width = '';
            procCanvas.style.height = '';
        }
    } else {
        // Pixel-perfect zoom: redraw at target resolution
        valEl.textContent = bmpState.zoom + '%';
        origContainer.classList.add('zoomed');
        procContainer.classList.add('zoomed');
        const scale = bmpState.zoom / 100;
        bmpRedrawAtZoom(origCanvas, bmpState.originalImageData, scale);
        bmpRedrawAtZoom(procCanvas, bmpState.processedImageData, scale);
    }
}

// Clean zoom levels that avoid aliasing artifacts on 1-bit images
const BMP_ZOOM_LEVELS = [25, 50, 100, 200, 400, 800];

function bmpZoomIn() {
    if (bmpState.zoom === 0) {
        bmpState.zoom = 50;
    } else {
        const idx = BMP_ZOOM_LEVELS.indexOf(bmpState.zoom);
        if (idx >= 0 && idx < BMP_ZOOM_LEVELS.length - 1) {
            bmpState.zoom = BMP_ZOOM_LEVELS[idx + 1];
        } else if (idx === -1) {
            // Find next level up
            bmpState.zoom = BMP_ZOOM_LEVELS.find(z => z > bmpState.zoom) || BMP_ZOOM_LEVELS[BMP_ZOOM_LEVELS.length - 1];
        }
    }
    bmpApplyZoom();
}

function bmpZoomOut() {
    if (bmpState.zoom === 0) return;
    const idx = BMP_ZOOM_LEVELS.indexOf(bmpState.zoom);
    if (idx <= 0) {
        bmpState.zoom = 0; // go to fit
    } else {
        bmpState.zoom = BMP_ZOOM_LEVELS[idx - 1];
    }
    bmpApplyZoom();
}

function bmpZoomFit() {
    bmpState.zoom = 0;
    bmpApplyZoom();
}

// --- Image processing pipeline ---

function processImageForLaser(imageData, options) {
    const w = imageData.width, h = imageData.height;
    const src = imageData.data;

    // 1. Convert to grayscale float buffer
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // 2. Apply brightness
    if (options.brightness !== 0) {
        for (let i = 0; i < gray.length; i++) {
            gray[i] = gray[i] + options.brightness;
        }
    }

    // 3. Apply contrast
    if (options.contrast !== 0) {
        const c = options.contrast;
        const factor = (259 * (c + 255)) / (255 * (259 - c));
        for (let i = 0; i < gray.length; i++) {
            gray[i] = ((gray[i] - 128) * factor) + 128;
        }
    }

    // 4. Apply gamma
    if (options.gamma !== 1.0) {
        const invGamma = 1.0 / options.gamma;
        for (let i = 0; i < gray.length; i++) {
            const clamped = Math.max(0, Math.min(255, gray[i]));
            gray[i] = 255 * Math.pow(clamped / 255, invGamma);
        }
    }

    // Clamp values
    for (let i = 0; i < gray.length; i++) {
        gray[i] = Math.max(0, Math.min(255, gray[i]));
    }

    // 5. Apply dithering algorithm
    const output = new Uint8ClampedArray(w * h);
    switch (options.algorithm) {
        case 'threshold':
            bmpDitherThreshold(gray, output, w, h, options.threshold);
            break;
        case 'floyd-steinberg':
            bmpDitherFloydSteinberg(gray, output, w, h);
            break;
        case 'atkinson':
            bmpDitherAtkinson(gray, output, w, h);
            break;
        case 'stucki':
            bmpDitherStucki(gray, output, w, h);
            break;
        case 'jarvis':
            bmpDitherJarvis(gray, output, w, h);
            break;
        case 'bayer4':
            bmpDitherBayer4(gray, output, w, h);
            break;
        case 'bayer8':
            bmpDitherBayer8(gray, output, w, h);
            break;
        default:
            bmpDitherFloydSteinberg(gray, output, w, h);
    }

    // 6. Apply invert if checked
    if (options.invert) {
        for (let i = 0; i < output.length; i++) {
            output[i] = output[i] === 255 ? 0 : 255;
        }
    }

    // Convert to RGBA ImageData for preview
    const result = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const v = output[i];
        result.data[i * 4] = v;
        result.data[i * 4 + 1] = v;
        result.data[i * 4 + 2] = v;
        result.data[i * 4 + 3] = 255;
    }
    return result;
}

// --- Dithering algorithms ---

function bmpDitherThreshold(gray, output, w, h, threshold) {
    for (let i = 0; i < w * h; i++) {
        output[i] = gray[i] > threshold ? 255 : 0;
    }
}

function bmpDitherFloydSteinberg(gray, output, w, h) {
    const buf = new Float32Array(gray);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const old = buf[idx];
            const val = old > 128 ? 255 : 0;
            output[idx] = val;
            const err = old - val;
            if (x + 1 < w)               buf[idx + 1]     += err * 7 / 16;
            if (x - 1 >= 0 && y + 1 < h) buf[idx - 1 + w] += err * 3 / 16;
            if (y + 1 < h)               buf[idx + w]      += err * 5 / 16;
            if (x + 1 < w && y + 1 < h)  buf[idx + 1 + w]  += err * 1 / 16;
        }
    }
}

function bmpDitherAtkinson(gray, output, w, h) {
    const buf = new Float32Array(gray);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const old = buf[idx];
            const val = old > 128 ? 255 : 0;
            output[idx] = val;
            const err = old - val;
            const d = err / 8;
            if (x + 1 < w)               buf[idx + 1]       += d;
            if (x + 2 < w)               buf[idx + 2]       += d;
            if (x - 1 >= 0 && y + 1 < h) buf[idx - 1 + w]   += d;
            if (y + 1 < h)               buf[idx + w]        += d;
            if (x + 1 < w && y + 1 < h)  buf[idx + 1 + w]    += d;
            if (y + 2 < h)               buf[idx + 2 * w]     += d;
        }
    }
}

function bmpDitherStucki(gray, output, w, h) {
    const buf = new Float32Array(gray);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const old = buf[idx];
            const val = old > 128 ? 255 : 0;
            output[idx] = val;
            const err = old - val;
            // Row 0:          *  8/42  4/42
            if (x + 1 < w)                              buf[idx + 1]         += err * 8 / 42;
            if (x + 2 < w)                              buf[idx + 2]         += err * 4 / 42;
            // Row 1: 2/42  4/42  8/42  4/42  2/42
            if (y + 1 < h) {
                if (x - 2 >= 0) buf[idx - 2 + w] += err * 2 / 42;
                if (x - 1 >= 0) buf[idx - 1 + w] += err * 4 / 42;
                                buf[idx + w]      += err * 8 / 42;
                if (x + 1 < w)  buf[idx + 1 + w]  += err * 4 / 42;
                if (x + 2 < w)  buf[idx + 2 + w]  += err * 2 / 42;
            }
            // Row 2: 1/42  2/42  4/42  2/42  1/42
            if (y + 2 < h) {
                const w2 = 2 * w;
                if (x - 2 >= 0) buf[idx - 2 + w2] += err * 1 / 42;
                if (x - 1 >= 0) buf[idx - 1 + w2] += err * 2 / 42;
                                buf[idx + w2]      += err * 4 / 42;
                if (x + 1 < w)  buf[idx + 1 + w2]  += err * 2 / 42;
                if (x + 2 < w)  buf[idx + 2 + w2]  += err * 1 / 42;
            }
        }
    }
}

function bmpDitherJarvis(gray, output, w, h) {
    const buf = new Float32Array(gray);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const old = buf[idx];
            const val = old > 128 ? 255 : 0;
            output[idx] = val;
            const err = old - val;
            // Row 0:          *  7/48  5/48
            if (x + 1 < w)                              buf[idx + 1]         += err * 7 / 48;
            if (x + 2 < w)                              buf[idx + 2]         += err * 5 / 48;
            // Row 1: 3/48  5/48  7/48  5/48  3/48
            if (y + 1 < h) {
                if (x - 2 >= 0) buf[idx - 2 + w] += err * 3 / 48;
                if (x - 1 >= 0) buf[idx - 1 + w] += err * 5 / 48;
                                buf[idx + w]      += err * 7 / 48;
                if (x + 1 < w)  buf[idx + 1 + w]  += err * 5 / 48;
                if (x + 2 < w)  buf[idx + 2 + w]  += err * 3 / 48;
            }
            // Row 2: 1/48  3/48  5/48  3/48  1/48
            if (y + 2 < h) {
                const w2 = 2 * w;
                if (x - 2 >= 0) buf[idx - 2 + w2] += err * 1 / 48;
                if (x - 1 >= 0) buf[idx - 1 + w2] += err * 3 / 48;
                                buf[idx + w2]      += err * 5 / 48;
                if (x + 1 < w)  buf[idx + 1 + w2]  += err * 3 / 48;
                if (x + 2 < w)  buf[idx + 2 + w2]  += err * 1 / 48;
            }
        }
    }
}

function bmpDitherBayer4(gray, output, w, h) {
    const matrix = [
        [ 0,  8,  2, 10],
        [12,  4, 14,  6],
        [ 3, 11,  1,  9],
        [15,  7, 13,  5]
    ];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const threshold = ((matrix[y % 4][x % 4] + 0.5) / 16) * 255;
            output[idx] = gray[idx] > threshold ? 255 : 0;
        }
    }
}

function bmpDitherBayer8(gray, output, w, h) {
    const matrix = [
        [ 0, 32,  8, 40,  2, 34, 10, 42],
        [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44,  4, 36, 14, 46,  6, 38],
        [60, 28, 52, 20, 62, 30, 54, 22],
        [ 3, 35, 11, 43,  1, 33,  9, 41],
        [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47,  7, 39, 13, 45,  5, 37],
        [63, 31, 55, 23, 61, 29, 53, 21]
    ];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const threshold = ((matrix[y % 8][x % 8] + 0.5) / 64) * 255;
            output[idx] = gray[idx] > threshold ? 255 : 0;
        }
    }
}

// --- BMP 1-bit Export ---

function generateBMP1bit(imageData, width, height, dpi) {
    const rowSize = Math.ceil(width / 32) * 4; // pad each row to 4-byte boundary
    const pixelDataSize = rowSize * height;
    const fileSize = 14 + 40 + 8 + pixelDataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // BMP File Header (14 bytes)
    view.setUint8(0, 0x42); view.setUint8(1, 0x4D); // 'BM'
    view.setUint32(2, fileSize, true);    // file size
    view.setUint16(6, 0, true);           // reserved
    view.setUint16(8, 0, true);           // reserved
    view.setUint32(10, 14 + 40 + 8, true); // pixel data offset

    // BITMAPINFOHEADER (40 bytes)
    view.setUint32(14, 40, true);         // header size
    view.setInt32(18, width, true);       // width
    view.setInt32(22, height, true);      // height (positive = bottom-up)
    view.setUint16(26, 1, true);          // planes
    view.setUint16(28, 1, true);          // 1 bit per pixel
    view.setUint32(30, 0, true);          // no compression
    view.setUint32(34, pixelDataSize, true); // image size
    const ppm = Math.round(dpi * 39.3701);
    view.setInt32(38, ppm, true);         // horizontal resolution (px/m)
    view.setInt32(42, ppm, true);         // vertical resolution (px/m)
    view.setUint32(46, 2, true);          // colors used
    view.setUint32(50, 2, true);          // important colors

    // Color table (2 entries: black, white) - BGRA format
    // Entry 0: Black (0, 0, 0, 0)
    view.setUint8(54, 0); view.setUint8(55, 0); view.setUint8(56, 0); view.setUint8(57, 0);
    // Entry 1: White (255, 255, 255, 0)
    view.setUint8(58, 255); view.setUint8(59, 255); view.setUint8(60, 255); view.setUint8(61, 0);

    // Pixel data (bottom-to-top, 1 bit per pixel)
    const dataOffset = 62;
    for (let y = height - 1; y >= 0; y--) {
        const rowStart = dataOffset + (height - 1 - y) * rowSize;
        for (let x = 0; x < width; x++) {
            const srcIdx = (y * width + x) * 4;
            const isWhite = imageData.data[srcIdx] > 128;
            if (isWhite) {
                const byteIdx = rowStart + Math.floor(x / 8);
                const bitIdx = 7 - (x % 8);
                view.setUint8(byteIdx, view.getUint8(byteIdx) | (1 << bitIdx));
            }
        }
    }

    return buffer;
}

function bmpDownload() {
    if (!bmpState.processedImageData) return;
    const imgData = bmpState.processedImageData;
    const dpi = parseInt(document.getElementById('bmp-dpi').value, 10) || 300;
    const buffer = generateBMP1bit(imgData, imgData.width, imgData.height, dpi);
    const blob = new Blob([buffer], { type: 'image/bmp' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'laser_engraving.bmp';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =============================================
// BACKGROUND REMOVAL (AI)
// =============================================
const bgRemovalState = {
    sourceImage: null,
    resultBlob: null,
    resultUrl: null,
    sourceUrl: null,
    isProcessing: false,
};

function showBgRemovalModal(imageObj) {
    const modal = document.getElementById('bg-removal-modal');
    modal.classList.remove('hidden');

    // Reset state
    bgRemovalCleanup();
    document.getElementById('bg-apply-btn').disabled = true;
    document.getElementById('bg-download-btn').disabled = true;
    document.getElementById('bg-progress-section').style.display = 'none';
    document.getElementById('bg-progress-bar').style.width = '0%';
    document.getElementById('bg-progress-bar').classList.remove('pulsing');
    document.getElementById('bg-status').textContent = '';
    document.getElementById('bg-preview-result').style.display = 'none';
    document.getElementById('bg-preview-original').style.display = 'none';
    document.getElementById('bg-placeholder').style.display = '';

    // Reset view to result
    document.getElementById('bg-result-container').style.display = '';
    document.getElementById('bg-orig-container').style.display = 'none';
    document.getElementById('bg-view-result').classList.add('active');
    document.getElementById('bg-view-original').classList.remove('active');

    // Check if an image object was provided (from context menu) or selected
    const sel = imageObj || (state.selectedIds.length === 1 ? findObject(state.selectedIds[0]) : null);
    const btn = document.getElementById('bg-use-selected');

    if (sel && sel.type === 'image' && sel.href) {
        btn.disabled = false;
        // Auto-load from the selected image
        bgLoadImageFromObj(sel);
    } else {
        btn.disabled = !(state.selectedIds.length === 1 && findObject(state.selectedIds[0]) && findObject(state.selectedIds[0]).type === 'image');
    }
}

function hideBgRemovalModal() {
    document.getElementById('bg-removal-modal').classList.add('hidden');
    bgRemovalCleanup();
}

function bgRemovalCleanup() {
    if (bgRemovalState.resultUrl) {
        URL.revokeObjectURL(bgRemovalState.resultUrl);
    }
    if (bgRemovalState.sourceUrl) {
        URL.revokeObjectURL(bgRemovalState.sourceUrl);
    }
    bgRemovalState.sourceImage = null;
    bgRemovalState.resultBlob = null;
    bgRemovalState.resultUrl = null;
    bgRemovalState.sourceUrl = null;
    bgRemovalState.isProcessing = false;
}

function bgLoadImageFromObj(obj) {
    if (!obj || obj.type !== 'image' || !obj.href) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
        bgRemovalState.sourceImage = img;
        bgShowOriginal();
        bgRemoveBackground(img.src);
    };
    img.onerror = function () {
        // Retry without crossOrigin for data URLs
        const img2 = new Image();
        img2.onload = function () {
            bgRemovalState.sourceImage = img2;
            bgShowOriginal();
            bgRemoveBackground(img2.src);
        };
        img2.onerror = function () {
            document.getElementById('bg-status').textContent = 'Error al cargar la imagen.';
            document.getElementById('bg-progress-section').style.display = '';
        };
        img2.src = obj.href;
    };
    img.src = obj.href;
}

function bgLoadImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            bgRemovalState.sourceImage = img;
            bgShowOriginal();
            bgRemoveBackground(img.src);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function bgShowOriginal() {
    const img = bgRemovalState.sourceImage;
    if (!img) return;
    document.getElementById('bg-placeholder').style.display = 'none';
    const origEl = document.getElementById('bg-preview-original');
    origEl.src = img.src;
    origEl.style.display = '';
    // Also show in result area initially (will be replaced once processed)
    const resultEl = document.getElementById('bg-preview-result');
    resultEl.src = img.src;
    resultEl.style.display = '';
}

async function bgRemoveBackground(imageSource) {
    if (bgRemovalState.isProcessing) return;
    bgRemovalState.isProcessing = true;

    const statusEl = document.getElementById('bg-status');
    const progressEl = document.getElementById('bg-progress-bar');
    const progressSection = document.getElementById('bg-progress-section');

    progressSection.style.display = '';
    progressEl.style.width = '10%';
    progressEl.classList.add('pulsing');
    statusEl.textContent = 'Enviando imagen al servidor...';

    // Disable buttons during processing
    document.getElementById('bg-apply-btn').disabled = true;
    document.getElementById('bg-download-btn').disabled = true;

    try {
        // Convert image source to base64 data URL if needed
        let base64Image = imageSource;
        if (!imageSource.startsWith('data:')) {
            const resp = await fetch(imageSource);
            const imgBlob = await resp.blob();
            base64Image = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(imgBlob);
            });
        }

        progressEl.style.width = '30%';
        statusEl.textContent = 'Procesando imagen con IA (puede tardar la primera vez)...';

        const response = await fetch('/api/remove-background', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Image }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Error del servidor');
        }

        progressEl.style.width = '90%';
        statusEl.textContent = 'Recibiendo resultado...';

        const data = await response.json();

        // Convert base64 result to blob
        const base64 = data.image.split(',')[1];
        const byteChars = atob(base64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: 'image/png' });

        progressEl.style.width = '100%';
        progressEl.classList.remove('pulsing');
        statusEl.textContent = '\u00a1Listo! Fondo eliminado.';

        bgRemovalState.resultBlob = blob;
        if (bgRemovalState.resultUrl) URL.revokeObjectURL(bgRemovalState.resultUrl);
        bgRemovalState.resultUrl = URL.createObjectURL(blob);

        // Show result in preview
        bgShowResult();

        // Enable action buttons
        document.getElementById('bg-apply-btn').disabled = false;
        document.getElementById('bg-download-btn').disabled = false;

    } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        progressEl.style.width = '0%';
        progressEl.classList.remove('pulsing');
        console.error('Background removal failed:', err);
    } finally {
        bgRemovalState.isProcessing = false;
    }
}

function bgShowResult() {
    if (!bgRemovalState.resultUrl) return;
    const resultEl = document.getElementById('bg-preview-result');
    resultEl.src = bgRemovalState.resultUrl;
    resultEl.style.display = '';
    document.getElementById('bg-placeholder').style.display = 'none';

    // Switch to result view
    document.getElementById('bg-result-container').style.display = '';
    document.getElementById('bg-orig-container').style.display = 'none';
    document.getElementById('bg-view-result').classList.add('active');
    document.getElementById('bg-view-original').classList.remove('active');
}

function bgApplyToCanvas() {
    const sel = state.selectedIds.length === 1 ? findObject(state.selectedIds[0]) : null;
    if (!sel || sel.type !== 'image' || !bgRemovalState.resultBlob) return;

    const reader = new FileReader();
    reader.onload = () => {
        saveUndoState();
        sel.href = reader.result;
        refreshElement(sel);
        hideBgRemovalModal();
    };
    reader.readAsDataURL(bgRemovalState.resultBlob);
}

function bgDownloadPNG() {
    if (!bgRemovalState.resultBlob) return;
    const url = URL.createObjectURL(bgRemovalState.resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sin_fondo.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setupBgRemovalModal() {
    const modal = document.getElementById('bg-removal-modal');
    if (!modal) return;

    // Close buttons
    modal.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', hideBgRemovalModal);
    });
    modal.querySelector('.modal-overlay').addEventListener('click', hideBgRemovalModal);
    modal.querySelector('.modal-close').addEventListener('click', hideBgRemovalModal);

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            hideBgRemovalModal();
        }
    });

    // File upload
    document.getElementById('bg-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) bgLoadImageFromFile(file);
        e.target.value = '';
    });

    // Use selected image button
    document.getElementById('bg-use-selected').addEventListener('click', () => {
        const sel = state.selectedIds.length === 1 ? findObject(state.selectedIds[0]) : null;
        if (sel && sel.type === 'image' && sel.href) {
            bgLoadImageFromObj(sel);
        }
    });

    // Apply to canvas
    document.getElementById('bg-apply-btn').addEventListener('click', bgApplyToCanvas);

    // Download PNG
    document.getElementById('bg-download-btn').addEventListener('click', bgDownloadPNG);

    // View toggle (Original / Sin fondo)
    document.getElementById('bg-view-original').addEventListener('click', () => {
        document.getElementById('bg-orig-container').style.display = '';
        document.getElementById('bg-result-container').style.display = 'none';
        document.getElementById('bg-view-original').classList.add('active');
        document.getElementById('bg-view-result').classList.remove('active');
    });
    document.getElementById('bg-view-result').addEventListener('click', () => {
        document.getElementById('bg-orig-container').style.display = 'none';
        document.getElementById('bg-result-container').style.display = '';
        document.getElementById('bg-view-result').classList.add('active');
        document.getElementById('bg-view-original').classList.remove('active');
    });
}

// --- Modal setup ---

function setupBmpConverterModal() {
    const modal = document.getElementById('bmp-converter-modal');
    if (!modal) return;

    // Close buttons
    modal.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', hideBmpConverterModal);
    });
    modal.querySelector('.modal-overlay').addEventListener('click', hideBmpConverterModal);
    modal.querySelector('.modal-close').addEventListener('click', hideBmpConverterModal);

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            hideBmpConverterModal();
        }
    });

    // File upload
    document.getElementById('bmp-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) bmpLoadImageFromFile(file);
        e.target.value = ''; // reset so same file can be re-selected
    });

    // Use selected image
    document.getElementById('bmp-use-selected').addEventListener('click', () => {
        bmpLoadImageFromSelected();
    });

    // Algorithm change
    document.getElementById('bmp-algorithm').addEventListener('change', () => {
        bmpUpdateThresholdVisibility();
        bmpScheduleUpdate();
    });

    // Sliders with value display
    const sliderConfigs = [
        { id: 'bmp-brightness', valId: 'bmp-brightness-val', format: v => v },
        { id: 'bmp-contrast', valId: 'bmp-contrast-val', format: v => v },
        { id: 'bmp-gamma', valId: 'bmp-gamma-val', format: v => parseFloat(v).toFixed(1) },
        { id: 'bmp-threshold', valId: 'bmp-threshold-val', format: v => v },
    ];
    for (const cfg of sliderConfigs) {
        const slider = document.getElementById(cfg.id);
        const valDisplay = document.getElementById(cfg.valId);
        slider.addEventListener('input', () => {
            valDisplay.textContent = cfg.format(slider.value);
            bmpScheduleUpdate();
        });
    }

    // Invert checkbox
    document.getElementById('bmp-invert').addEventListener('change', () => {
        bmpScheduleUpdate();
    });

    // DPI change — re-rasterize at new resolution when editing from context menu
    document.getElementById('bmp-dpi').addEventListener('change', () => {
        if (bmpState.editorTarget && bmpState.sourceImage) {
            bmpRasterizeAtDpi();
        }
    });
    document.getElementById('bmp-dpi').addEventListener('input', () => {
        if (bmpState.editorTarget && bmpState.sourceImage) {
            if (bmpState.debounceTimer) cancelAnimationFrame(bmpState.debounceTimer);
            bmpState.debounceTimer = requestAnimationFrame(() => {
                bmpRasterizeAtDpi();
            });
        }
    });

    // Download button
    document.getElementById('bmp-download-btn').addEventListener('click', () => {
        bmpDownload();
    });

    // Apply to editor button (replaces original image with processed bitmap)
    document.getElementById('bmp-apply-editor-btn').addEventListener('click', () => {
        bmpApplyToEditor();
    });

    // Zoom buttons
    document.getElementById('bmp-zoom-in').addEventListener('click', bmpZoomIn);
    document.getElementById('bmp-zoom-out').addEventListener('click', bmpZoomOut);
    document.getElementById('bmp-zoom-fit').addEventListener('click', bmpZoomFit);

    // Mouse wheel zoom on preview containers
    for (const cid of ['bmp-orig-container', 'bmp-proc-container']) {
        document.getElementById(cid).addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) bmpZoomIn(); else bmpZoomOut();
        }, { passive: false });
    }

    // View toggle (Original / Procesado)
    document.getElementById('bmp-view-original').addEventListener('click', () => {
        document.getElementById('bmp-orig-container').style.display = '';
        document.getElementById('bmp-proc-container').style.display = 'none';
        document.getElementById('bmp-view-original').classList.add('active');
        document.getElementById('bmp-view-processed').classList.remove('active');
    });
    document.getElementById('bmp-view-processed').addEventListener('click', () => {
        document.getElementById('bmp-orig-container').style.display = 'none';
        document.getElementById('bmp-proc-container').style.display = '';
        document.getElementById('bmp-view-processed').classList.add('active');
        document.getElementById('bmp-view-original').classList.remove('active');
    });
}

// =============================================
// START
// =============================================
document.addEventListener('DOMContentLoaded', () => { initTheme(); });
// init() and preloadFonts() are called from auth listener after login (see index.html)
