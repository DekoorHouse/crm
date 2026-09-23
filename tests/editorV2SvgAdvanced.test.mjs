import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransform, importSvgElement, invert, multiply, dropImages } from '../public/editor-v2/svgImport.mjs';
import { blankDocument, validateDocument, exportSvg, clone, setPaint } from '../public/editor-v2/model.mjs';
import { pathNodes, movePathNodes, movePathHandle, closestOnPath, insertPathNode, removePathNodes } from '../public/editor-v2/pathEdit.mjs';
import { pathContains } from '../public/editor-v2/path.mjs';
import { powerClipDropTarget } from '../public/editor-v2/geometry.mjs';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const el = (tag, attributes = {}, kids = [], text = '') => ({
    localName: tag, children: kids, getAttribute: name => attributes[name] ?? null,
    get textContent() { return text + kids.map(kid => kid.textContent).join(''); },
});
const svg = (kids, attributes = {}) => el('svg', { width: '100mm', height: '100mm', viewBox: '0 0 100 100', ...attributes }, kids);

test('gradients keep their geometry, follow href chains and turn with the object', () => {
    const result = importSvgElement(svg([
        el('defs', {}, [
            el('linearGradient', { id: 'colours' }, [el('stop', { offset: '10%', 'stop-color': 'red', 'stop-opacity': '.5' }), el('stop', { offset: '1', style: 'stop-color: blue' })]),
            el('radialGradient', { id: 'glow', href: '#colours', gradientUnits: 'userSpaceOnUse', cx: '30', cy: '30', r: '10', gradientTransform: 'scale(1 2)' }),
        ]),
        el('rect', { x: '20', y: '20', width: '20', height: '20', fill: 'url(#glow)', transform: 'rotate(30 30 30)' }),
        el('path', { d: 'M0 80 L50 80 L50 90 Z', fill: 'none', stroke: 'url(#colours)' }),
    ]));
    const [box, line] = result.objects, g = box.fillGradient;
    assert.equal(box.type, 'rect'); assert.equal(box.fill, '#ff0000');
    assert.deepEqual([g.type, g.cx, g.cy, g.r, g.fx, g.fy], ['radial', 30, 30, 10, 30, 30]);
    assert.deepEqual(g.stops, [{ offset: .1, color: '#ff0000', opacity: .5 }, { offset: 1, color: '#0000ff', opacity: 1 }]);
    // Box units → page through the turned box must equal the source's user space → page mapping.
    const rad = -box.rotation * Math.PI / 180, cx = box.x + box.width / 2, cy = box.y + box.height / 2, cos = Math.cos(rad), sin = Math.sin(rad);
    const turn = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    const viaEditor = multiply(multiply(turn, [box.width, 0, 0, box.height, box.x, box.y]), g.transform);
    const viaSource = multiply(parseTransform('rotate(30 30 30)'), parseTransform('scale(1 2)'));
    viaEditor.forEach((value, i) => close(value, viaSource[i]));
    assert.equal(line.fill, 'none'); assert.equal(line.strokeGradient.type, 'linear');
    const d = blankDocument(); d.objects.push(box, line);
    const markup = exportSvg(validateDocument(d));
    assert.match(markup, /<radialGradient id="gr-f-[^"]+" gradientUnits="objectBoundingBox" gradientTransform="matrix\([^)]+\)" cx="30" cy="30" r="10" fx="30" fy="30"><stop offset="0.1" stop-color="#ff0000" stop-opacity="0.5"\/>/);
    assert.match(markup, /stroke="url\(#gr-s-/);
    invert([2, 0, 0, 4, 1, 1]).forEach((value, i) => close(value, [.5, 0, 0, .25, -.5, -.25][i]));
    // A plain colour replaces the gradient; broken gradients are rejected.
    const plain = clone(box); setPaint(plain, 'fill', '#00ff00');
    assert.equal(plain.fillGradient, undefined);
    assert.throws(() => validateDocument({ ...d, objects: [{ ...box, fillGradient: { ...g, stops: [] } }] }), /degradado/);
});

test('clip paths become PowerClips: rectangles stay rectangles, other shapes become curve containers', () => {
    const result = importSvgElement(svg([
        el('defs', {}, [
            el('clipPath', { id: 'window' }, [el('rect', { x: '10', y: '10', width: '30', height: '20' })]),
            el('clipPath', { id: 'star' }, [el('polygon', { points: '60,10 70,40 50,20 70,20 50,40' })]),
        ]),
        el('g', { 'clip-path': 'url(#window)' }, [el('rect', { x: '0', y: '0', width: '50', height: '50', fill: 'red' }), el('circle', { cx: '20', cy: '20', r: '5' })]),
        el('rect', { x: '45', y: '5', width: '40', height: '40', fill: 'blue', 'clip-path': 'url(#star)' }),
        el('g', { 'clip-path': 'url(#window)' }, [el('g', { 'clip-path': 'url(#star)' }, [el('rect', { width: '5', height: '5' })])]),
        el('rect', { width: '5', height: '5', mask: 'url(#m)' }),
    ]));
    const [windowClip, starClip, nested] = result.objects;
    assert.deepEqual([windowClip.type, windowClip.x, windowClip.y, windowClip.width, windowClip.height, windowClip.fill, windowClip.stroke], ['rect', 10, 10, 30, 20, 'none', 'none']);
    assert.deepEqual(windowClip.powerClip.objects.map(o => o.type), ['rect', 'ellipse']);
    assert.equal(starClip.type, 'path');
    assert.equal(starClip.powerClip.objects[0].fill, '#0000ff');
    // A clip inside clipped content cannot be another PowerClip, so it is counted and left out.
    assert.equal(nested.powerClip.objects.length, 1);
    assert.equal(result.clipped, 1); assert.equal(result.masked, 1);
    const d = blankDocument(); d.objects.push(...result.objects);
    const valid = validateDocument(JSON.parse(JSON.stringify(d)));
    assert.match(exportSvg(valid), /<clipPath id="pc-[^"]+" clipPathUnits="userSpaceOnUse"><path d="M 60 10 /);
    // Dropping onto a curve container only counts inside its shape.
    const sources = [{ id: 'x', type: 'rect', x: 0, y: 0, width: 1, height: 1, hidden: false, locked: false }];
    assert.equal(powerClipDropTarget([...valid.objects, ...sources], new Set(['x']), { x: 60, y: 25 })?.id, starClip.id);
    assert.equal(powerClipDropTarget([...valid.objects, ...sources], new Set(['x']), { x: 52, y: 12 }), null);
});

test('images that cannot be loaded are removed, also from PowerClips', () => {
    const result = importSvgElement(svg([
        el('defs', {}, [el('clipPath', { id: 'c' }, [el('rect', { width: '50', height: '50' })])]),
        el('image', { width: '10', height: '10', href: 'https://example.com/a.gif' }),
        el('g', { 'clip-path': 'url(#c)' }, [el('image', { width: '10', height: '10', href: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }), el('rect', { width: '5', height: '5' })]),
    ]));
    assert.equal(result.pending.length, 2);
    dropImages(result, new Set(result.pending));
    assert.equal(result.objects.length, 1);
    assert.deepEqual(result.objects[0].powerClip.objects.map(o => o.type), ['rect']);
    assert.equal(result.skipped, 2); assert.equal(result.pending.length, 0);
});

test('curve nodes: move, smooth handles, split without changing the shape, remove', () => {
    const [wave] = importSvgElement(svg([el('path', { d: 'M10 50 C10 30 30 30 30 50 S50 70 50 50' })])).objects;
    const nodes = pathNodes(wave);
    assert.equal(nodes.length, 3);
    close(nodes[1].x, 30); close(nodes[1].in.y, 30); close(nodes[1].out.y, 70);
    const after = pathNodes({ ...wave, ...movePathNodes(wave, [1], 5, 0) });
    close(after[1].x, 35); close(after[1].out.x, 35); close(after[0].x, 10); close(after[2].x, 50);
    // The middle node is smooth, so dragging one handle turns the other one with it.
    const turned = pathNodes({ ...wave, ...movePathHandle(wave, 1, 'out', { x: 40, y: 50 }) })[1];
    close(turned.out.x, 40); close(turned.out.y, 50); close(turned.in.x, 10); close(turned.in.y, 50);
    const hit = closestOnPath(wave, { x: 20, y: 30 });
    assert.equal(hit.index, 0);
    const { geometry, node } = insertPathNode(wave, hit), split = { ...wave, ...geometry };
    assert.equal(node, 1); assert.equal(pathNodes(split).length, 4);
    close(pathNodes(split)[1].y, hit.y, 1e-9);
    for (const x of [14, 30, 46]) close(closestOnPath(split, closestOnPath(wave, { x, y: 40 })).distance, 0, 1e-3);
    assert.equal(pathNodes({ ...wave, ...removePathNodes(wave, [1]) }).length, 2);
    assert.throws(() => removePathNodes(wave, [0, 1]), /dos nodos/);
    // A turned curve is edited where it is seen: unedited nodes stay in place on the page.
    const tilted = { ...wave, rotation: 30 }, before = pathNodes(tilted), shifted = pathNodes({ ...tilted, ...movePathNodes(tilted, [2], 0, 10) });
    close(shifted[0].x, before[0].x, 1e-9); close(shifted[0].y, before[0].y, 1e-9); close(shifted[2].y, before[2].y + 10, 1e-9);
    const [ring] = importSvgElement(svg([el('path', { d: 'M0 0H40V40H0Z M10 10H30V30H10Z', 'fill-rule': 'evenodd' })])).objects;
    assert.equal(pathNodes(ring).length, 8);
    assert.equal(pathContains(ring, { x: 5, y: 5 }), true); assert.equal(pathContains(ring, { x: 20, y: 20 }), false);
});
