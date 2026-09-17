'use strict';
// Portable SVG-only orientation. Corel is used once to export blank migration assets.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { Resvg } = require('@resvg/resvg-js');
const OUT = path.resolve(__dirname, '../../output/svg-server-comparison');
const DIR = path.join(OUT, 'orientation');
const ID = [1, 0, 0, 1, 0, 0];
const mmPage = svg => ({
  width: +svg.match(/\bwidth="([\d.]+)mm"/)[1], height: +svg.match(/\bheight="([\d.]+)mm"/)[1],
  vb: svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number),
});
const inner = svg => svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
function svgOf(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="350mm" height="330mm" viewBox="0 0 350 330">${body}</svg>`;
}
function normalize(svg) {
  const p = mmPage(svg);
  assert.deepEqual(p.vb.slice(0, 2), [0, 0]);
  return `<g transform="scale(${p.width / p.vb[2]} ${p.height / p.vb[3]})">${inner(svg)}</g>`;
}
function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
const point = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
function paths(svg) {
  const p = mmPage(svg), normalized = new Resvg(svg).toString();
  const stack = [[p.width/p.vb[2], 0, 0, p.height/p.vb[3], 0, 0]], records = [];
  for (const match of normalized.matchAll(/<\/?(?:g|path)\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith('</g')) { stack.pop(); continue; }
    const trans = tag.match(/\btransform="matrix\(([^)]+)\)"/);
    const m = multiply(stack.at(-1), trans ? trans[1].split(/[ ,]+/).map(Number) : ID);
    if (tag.startsWith('<g')) { if (!tag.endsWith('/>')) stack.push(m); continue; }
    const data = tag.match(/\bd="([^"]*)"/)[1];
    const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
    const commands = [], pts = [];
    for (let i = 0; i < tokens.length;) {
      const cmd = tokens[i++], count = { M:2, L:2, Q:4, C:6, Z:0 }[cmd];
      assert(count !== undefined, `Unexpected normalized path command ${cmd}`);
      commands.push(cmd);
      for (let j = 0; j < count; j += 2) pts.push(point(m, +tokens[i++], +tokens[i++]));
    }
    records.push({ stroke: tag.match(/\bstroke="([^"]*)"/)?.[1] || 'none', fill: tag.match(/\bfill="([^"]*)"/)?.[1] || 'black', commands, points: pts });
  }
  return records;
}
function textGroupList(svg) {
  const groups = [];
  for (const start of svg.matchAll(/<g\b[^>]*\bdata-text="[^"]*"[^>]*>/g)) {
    let depth = 0;
    for (const match of svg.slice(start.index).matchAll(/<\/?g\b[^>]*>/g)) {
      depth += match[0].startsWith('</') ? -1 : match[0].endsWith('/>') ? 0 : 1;
      if (!depth) { groups.push(svg.slice(start.index, start.index + match.index + match[0].length)); break; }
    }
  }
  assert(groups.length > 0, 'No generated text groups found');
  return groups;
}
function buildModel(model) {
  const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
  const naturalBlank = read(`${model}-blank-natural.svg`), cutBlank = read(`${model}-blank-cut.svg`);
  const [head, ...lines] = read('template-transforms.tsv').trim().split(/\r?\n/).map(l => l.split('\t'));
  const raw = Object.fromEntries(head.map((h, i) => [h, lines.find(l => l[0] === model)[i]]));
  const corelMatrix = ['a','b','c','d','txMm','tyMm'].map(k => +raw[k]);
  const naturalContour = paths(naturalBlank).find(p => p.stroke === '#ff0000');
  const cutContour = paths(cutBlank).find(p => p.stroke === '#ff0000');
  assert.deepEqual(naturalContour.commands, cutContour.commands, 'Blank contour correspondence must be verified');
  // Corel SVG export adds a small coordinate offset (~0.0093 mm). Calibrate from
  // BLANK templates only, then check every control point; no personalized reference is read here.
  const n = naturalContour.points[0], p = cutContour.points[0];
  const matrix = [0, -1, -1, 0, p[0]+n[1], p[1]+n[0]];
  const correction = [matrix[4]-corelMatrix[4], matrix[5]-corelMatrix[5]];
  assert(correction.every(v => Math.abs(v) < 0.02), 'Unexpected export coordinate offset');
  let maxControlPointError = 0;
  naturalContour.points.forEach(([x,y], i) => {
    const [xx,yy] = point(matrix,x,y), [ex,ey] = cutContour.points[i];
    maxControlPointError = Math.max(maxControlPointError, Math.hypot(xx-ex,yy-ey));
  });
  assert(maxControlPointError < 0.003, 'Blank contours disagree with the intended rotation and reflection');
  const natural = fs.readFileSync(path.join(OUT, `${model}-server-natural.svg`), 'utf8');
  const groups = textGroupList(natural), text = groups.join(''), staticBody = normalize(cutBlank);
  const cutSvg = svgOf(staticBody + `<g transform="matrix(${matrix.join(' ')})">${text}</g>`);
  return { model, matrix, corelMatrix, exportCorrectionMm: correction, maxBlankContourControlPointErrorMm: maxControlPointError, cutSvg, staticBody, text, groups };
}
module.exports = { OUT, DIR, inner, svgOf, normalize, paths, point, mmPage, buildModel };
