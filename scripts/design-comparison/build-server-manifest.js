'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { paths, point } = require('./cut-svg');
const dir = path.resolve(__dirname, '../../server/design/templates');
const tsv = name => { const [keys,...rows] = fs.readFileSync(path.join(dir,name),'utf8').trim().split(/\r?\n/).map(l=>l.split('\t')); return rows.map(row=>Object.fromEntries(keys.map((k,i)=>[k,row[i]]))); };
const rows=tsv('layout.tsv'), spacing=tsv('line-spacing.tsv');
const manifest={version:'server-svg-v1',pageMm:[350,330],fontSha256:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(dir,'../../../public/editor/fonts/RowsOfSunflowers.ttf'))).digest('hex'),variants:{}};
for(const model of ['infinito','spiderman','rex'])for(const count of [1,2]){
  const key=`${model}-${count}`, natural=fs.readFileSync(path.join(dir,`${key}-natural.svg`),'utf8'), cut=fs.readFileSync(path.join(dir,`${key}-cut.svg`),'utf8');
  const n=paths(natural).find(p=>p.stroke==='#ff0000'), c=paths(cut).find(p=>p.stroke==='#ff0000');
  assert.deepEqual(n.commands,c.commands);
  const matrix=[0,-1,-1,0,c.points[0][0]+n.points[0][1],c.points[0][1]+n.points[0][0]];
  n.points.forEach(([x,y],i)=>{const p=point(matrix,x,y);assert(Math.hypot(p[0]-c.points[i][0],p[1]-c.points[i][1])<.005);});
  manifest.variants[key]={model,count,matrix,lineAdvancePerEm:Number(spacing.find(r=>r.model===model).advancePerEm),slots:rows.filter(r=>r.variantKey===key).map(r=>({slot:Number(r.slot),field:r.field,cxMm:Number(r.cxMm),cyMm:Number(r.cyMm),fontPt:Number(r.fontPt)}))};
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(Object.keys(manifest.variants));
