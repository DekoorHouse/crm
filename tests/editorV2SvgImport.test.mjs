import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePathData, parseTransform, parseColor, arcToCubics, apply, importSvgElement } from '../public/editor-v2/svgImport.mjs';
import { blankDocument, validateDocument, exportSvg, clone } from '../public/editor-v2/model.mjs';
import { pathSegments, pathData } from '../public/editor-v2/path.mjs';
import { curvePoint } from '../public/editor-v2/spline.mjs';
import { objectReference } from '../public/editor-v2/geometry.mjs';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
// A minimal element tree with the DOM methods the importer reads.
const el = (tag, attributes = {}, kids = [], text = '') => ({
    localName: tag, children: kids, getAttribute: name => attributes[name] ?? null,
    get textContent() { return text + kids.map(kid => kid.textContent).join(''); },
});
const svg = (attributes, kids) => el('svg', { width: '100mm', height: '100mm', viewBox: '0 0 100 100', ...attributes }, kids);
const importOne = (kids, attributes) => importSvgElement(svg(attributes, kids)).objects;
const end = subpath => subpath.points.slice(-2);

test('path data: every command, relative forms, implicit lines and packed arc flags', () => {
    const [a] = parsePathData('M10 10 L20 10 H30 V20 l-10 0 h-5 v-5 Z');
    assert.equal(a.closed, true);
    assert.deepEqual(end(a), [10, 10]);
    assert.equal((a.points.length - 2) / 6, 7);
    // After M, further pairs are lines; a second subpath starts at the next M.
    const two = parsePathData('M0 0 10 0 10 10 m5 5 l1 1');
    assert.equal(two.length, 2);
    assert.deepEqual(two[1].points.slice(0, 2), [15, 15]);
    const [curve] = parsePathData('M0 0C0 10 10 10 10 0S20-10 20 0Q25 5 30 0T40 0');
    // S reflects the previous control point (10, 10) around (10, 0); T reflects Q's control (25, 5) around (30, 0).
    assert.deepEqual(curve.points.slice(8, 14), [10, -10, 20, -10, 20, 0]);
    curve.points.slice(20, 24).forEach((value, i) => close(value, [30 + 10 / 3, -10 / 3, 40 - 10 / 3, -10 / 3][i]));
    assert.deepEqual(end(curve), [40, 0]);
    // "a5 5 0 00 10 0": the two flags are packed together.
    const [arc] = parsePathData('M0 0a5 5 0 00 10 0');
    assert.deepEqual(end(arc), [10, 0]);
    const lowest = Math.max(...arc.points.filter((_, i) => i % 2));
    assert.ok(lowest > 4 && lowest < 7, `the half circle bulges down: ${lowest}`);
    assert.deepEqual(parsePathData('M0 0 L10 10 L 5 oops 7'), parsePathData('M0 0 L10 10'));
});
test('arcs become quarter-circle cubics that stay on the circle', () => {
    const cubic = arcToCubics(10, 0, 10, 10, 0, false, true, -10, 0);
    assert.equal(cubic.length, 12);
    const segment = { p0: { x: 10, y: 0 }, c1: { x: cubic[0], y: cubic[1] }, c2: { x: cubic[2], y: cubic[3] }, p3: { x: cubic[4], y: cubic[5] } };
    const middle = curvePoint(segment, .5);
    close(Math.hypot(middle.x, middle.y), 10, 1e-3);
});
test('transforms, colours and lengths', () => {
    const m = parseTransform('translate(10 20) rotate(90) scale(2)');
    const [x, y] = apply(m, 1, 0);
    close(x, 10); close(y, 22);
    const [rx, ry] = apply(parseTransform('rotate(90 5 5)'), 10, 5);
    close(rx, 5); close(ry, 10);
    assert.equal(parseColor('#ABC'), '#aabbcc');
    assert.equal(parseColor('rgb(255, 0, 128)'), '#ff0080');
    assert.equal(parseColor('Red'), '#ff0000');
    assert.equal(parseColor('none'), 'none');
    assert.equal(parseColor('rebeccapurple'), null);
    assert.equal(parseColor('rebeccapurple', () => '#663399'), '#663399');
});
test('a CorelDRAW export: mm page, viewBox, CSS classes, even-odd fill and a gradient', () => {
    const style = el('style', {}, [], '<![CDATA[ .str0 {stroke:#373435;stroke-width:7.62} .fil0 {fill:#FEFEFE} .fil1 {fill:url(#id0)} ]]>');
    const gradient = el('linearGradient', { id: 'id0' }, [el('stop', { offset: '0', style: 'stop-opacity:1; stop-color:#E42618' }), el('stop', { offset: '1', 'stop-color': '#000' })]);
    const root = el('svg', { width: '210mm', height: '297mm', viewBox: '0 0 21000 29700', style: 'fill-rule:evenodd; clip-rule:evenodd' }, [
        el('defs', {}, [style, gradient]),
        el('g', { id: 'Capa_x0020_1' }, [
            el('metadata', { id: 'CorelCorpID_0Corel-Layer' }),
            el('path', { class: 'fil0 str0', d: 'M1000 1000 L5000 1000 L5000 3000 L1000 3000 Z M2000 1500 L4000 1500 L4000 2500 L2000 2500 Z' }),
            el('rect', { class: 'fil1', x: '6000', y: '1000', width: '2000', height: '1000' }),
        ]),
    ]);
    const result = importSvgElement(root);
    assert.equal(result.width, 210); assert.equal(result.height, 297);
    const [frame, box] = result.objects;
    assert.equal(frame.type, 'path'); assert.equal(frame.fillRule, 'evenodd');
    assert.equal(frame.fill, '#fefefe'); assert.equal(frame.stroke, '#373435');
    close(frame.strokeWidth, .0762);
    close(frame.x, 10); close(frame.y, 10); close(frame.width, 40); close(frame.height, 20);
    assert.equal(frame.subpaths.length, 2);
    assert.deepEqual([box.type, box.fill, box.x, box.y, box.width, box.height], ['rect', '#e42618', 60, 10, 20, 10]);
    const d = blankDocument(); d.objects.push(...result.objects);
    const valid = validateDocument(JSON.parse(JSON.stringify(d)));
    assert.deepEqual(valid, d);
    assert.match(exportSvg(valid), /<path d="M 10 10 C [^"]* Z M 20 15 [^"]* Z" fill-rule="evenodd" clip-rule="evenodd" fill="#fefefe"/);
    assert.deepEqual(box.fillGradient, { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, transform: [1, 0, 0, 1, 0, 0],
        stops: [{ offset: 0, color: '#e42618', opacity: 1 }, { offset: 1, color: '#000000', opacity: 1 }] });
});
test('shapes: rectangles and ellipses stay editable, also turned; rounded or skewed ones become curves', () => {
    const objects = importOne([
        el('g', { transform: 'translate(10 10) scale(2)' }, [el('rect', { width: '5', height: '5', fill: 'blue' }), el('circle', { cx: '10', cy: '10', r: '2' })]),
        el('rect', { x: '0', y: '0', width: '10', height: '10', transform: 'rotate(45)' }),
        el('rect', { x: '50', y: '50', width: '20', height: '10', rx: '2' }),
        el('line', { x1: '0', y1: '90', x2: '50', y2: '90', stroke: '#00ff00', 'stroke-width': '2' }),
        el('polygon', { points: '60,60 70,60 65,70' }),
    ]);
    assert.deepEqual(objects.map(o => o.type), ['rect', 'ellipse', 'rect', 'path', 'path', 'path']);
    assert.deepEqual([objects[0].x, objects[0].y, objects[0].width, objects[0].fill], [10, 10, 10, '#0000ff']);
    assert.deepEqual([objects[1].x, objects[1].y, objects[1].width], [26, 26, 8]);
    // SVG turns clockwise on screen; the editor, like CorelDRAW, counts degrees anticlockwise.
    close(objects[2].width, 10); close(objects[2].rotation, -45);
    close(objects[2].x + 5, 0); close(objects[2].y + 5, Math.SQRT2 * 5);
    const [skewed] = importOne([el('rect', { width: '10', height: '10', transform: 'skewX(20)' })]);
    assert.equal(skewed.type, 'path');
    assert.equal(objects[4].fill, 'none'); assert.equal(objects[4].stroke, '#00ff00'); close(objects[4].strokeWidth, 2);
    assert.equal(objects[5].subpaths[0].closed, true);
});
test('use, symbols, hidden elements, text and embedded images', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mO88h8AAq0B1Rl1jWUAAAAASUVORK5CYII=';
    const result = importSvgElement(svg({}, [
        el('defs', {}, [el('symbol', { id: 'dot' }, [el('rect', { width: '4', height: '4' })])]),
        el('use', { href: '#dot', x: '20', y: '30' }),
        el('rect', { width: '5', height: '5', style: 'display:none' }),
        el('g', { visibility: 'hidden' }, [el('rect', { width: '5', height: '5' }), el('rect', { width: '6', height: '6', visibility: 'visible' })]),
        el('text', { x: '10', y: '50', 'font-size': '8', fill: '#333333' }, [], 'Hola   mundo'),
        el('image', { x: '0', y: '0', width: '30', height: '20', 'xlink:href': png, transform: 'rotate(90 15 10)' }),
        el('image', { width: '10', height: '10', href: 'https://example.com/a.png' }),
        el('foreignObject'),
    ]));
    const [dot, visible, text, image] = result.objects;
    assert.deepEqual([dot.type, dot.x, dot.y], ['rect', 20, 30]);
    assert.deepEqual([visible.type, visible.width], ['rect', 6]);
    assert.deepEqual([text.type, text.text, text.fontSize, text.x, text.y, text.fill], ['text', 'Hola mundo', 8, 10, 42, '#333333']);
    assert.deepEqual([image.type, image.width, image.height, image.rotation], ['image', 30, 20, -90]);
    close(image.x, 0); close(image.y, 0);
    // The linked image is fetched by the editor; foreignObject cannot be imported.
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.pending.map(o => o.src), ['https://example.com/a.png']);
    const d = blankDocument(); d.objects.push(...result.objects.filter(object => !result.pending.includes(object)));
    assert.doesNotThrow(() => validateDocument(d));
});
test('curves: bounds, references, validation limits and shared point lists', () => {
    const [curve] = importOne([el('path', { d: 'M10 50 C10 10 90 10 90 50' })]);
    close(curve.y, 20, 1e-9); close(curve.x, 10); close(curve.width, 80);
    const segments = pathSegments(curve);
    close(curvePoint(segments[0], .5).y, 20);
    assert.equal(objectReference(curve, { x: 10.2, y: 49.9 }, 1)?.label, 'Nodo');
    assert.equal(objectReference(curve, { x: 50, y: 20.3 }, 1)?.label, 'Punto medio');
    assert.match(pathData(curve), /^M 10 50 C /);
    const d = blankDocument(); d.objects.push(curve);
    const valid = validateDocument(d);
    assert.ok(Object.isFrozen(valid.objects[0].subpaths[0].points));
    assert.equal(clone(valid).objects[0].subpaths[0].points, valid.objects[0].subpaths[0].points);
    for (const bad of [[], [{ closed: false, points: [0, 0, 1] }], [{ closed: 'no', points: [0, 0, 1, 1, 2, 2, 3, 3] }], [{ closed: false, points: [0, 0, 1, 1, 2, 2, NaN, 3] }]]) {
        assert.throws(() => validateDocument({ ...d, objects: [{ ...curve, subpaths: bad }] }));
    }
    assert.throws(() => validateDocument({ ...d, objects: [{ ...curve, fillRule: 'odd' }] }));
});
