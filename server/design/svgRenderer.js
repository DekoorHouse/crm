'use strict';
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { titleCaseName } = require('../mockups/nameLayout');
const { distanceMap } = require('./svgDistance');
const manifest = require('./templates/manifest.json');
const coverage = new Set(require('./templates/font-coverage.json'));
const FONT = path.join(__dirname,'../../public/editor/fonts/RowsOfSunflowers.ttf');
const FONT_OPTIONS={fontFiles:[FONT],loadSystemFonts:false,defaultFontFamily:'Rows of Sunflowers'};
const PX_MM=8;
const cache=new Map();
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const inner=s=>s.slice(s.indexOf('>',s.indexOf('<svg'))+1,s.lastIndexOf('</svg>'));
function documentSvg(body,viewBox='0 0 350 330',width=350,height=330){
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}mm" height="${height}mm" viewBox="${viewBox}">${body}</svg>`;
}
function templateBody(svg){
    const vb=svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    return `<g transform="scale(${350/vb[2]} ${330/vb[3]})">${inner(svg)}</g>`;
}
function invalid(message,indices=[]){return Object.assign(new Error(message),{code:'DESIGN_LAYOUT',lampIndices:indices});}
function cleanText(value,isName){
    let s=String(value==null?'':value).replace(/\\n/g,'\n').replace(/\r\n?/g,'\n').normalize('NFC');
    s=s.split('\n').map(x=>x.trim()).filter(Boolean).join('\n');
    if(s.length>160||s.split('\n').length>2)throw invalid('El texto excede dos renglones o 160 caracteres.');
    if(isName)s=titleCaseName(s);
    for(const ch of s)if(ch!=='\n'&&ch!==' '&&!coverage.has(ch.codePointAt(0)))throw invalid(`La tipografía no incluye el carácter ${ch}.`);
    return s;
}
function getTemplate(model,count){
    const key=`${model}-${count}`;
    if(cache.has(key))return cache.get(key);
    const meta=manifest.variants[key];if(!meta)throw invalid('Plantilla o cantidad de lámparas no admitida.');
    const read=side=>templateBody(fs.readFileSync(path.join(__dirname,'templates',`${key}-${side}.svg`),'utf8'));
    const natural=read('natural'),cut=read('cut');
    const img=new Resvg(documentSvg(natural),{fitTo:{mode:'width',value:350*PX_MM},background:'white'}).render();
    const entry={meta,natural,cut,distances:distanceMap(img)};
    // One distance field is about 30 MB. Bound memory on the web service's render worker.
    cache.clear();cache.set(key,entry);return entry;
}
function textOutline(text,fontPt,maxWidthMm,cx,cy,lineAdvancePerEm){
    if(!text)return {text:'',body:'',cxMm:cx,cyMm:cy,widthMm:0,heightMm:0,fontPt};
    const size=fontPt*25.4/72;
    const lines=text.split('\n');
    const raw=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">${lines.map((s,i)=>`<text x="100" y="${100+i*size*lineAdvancePerEm}" text-anchor="middle" font-family="Rows of Sunflowers" font-size="${size}" fill="black">${esc(s)}</text>`).join('')}</svg>`;
    const r=new Resvg(raw,{font:FONT_OPTIONS}),b=r.getBBox();
    if(!b||b.width<=0||b.height<=0)throw invalid('No se pudo convertir el texto a curvas.');
    const scale=Math.min(1,maxWidthMm/b.width);
    return {text,cxMm:cx,cyMm:cy,widthMm:b.width*scale,heightMm:b.height*scale,fontPt:fontPt*scale,
        body:`<g data-text="${esc(text)}" transform="translate(${cx} ${cy}) scale(${scale}) translate(${-b.x-b.width/2} ${-b.y-b.height/2})">${inner(r.toString())}</g>`};
}
function clearance(outline,field){
    if(!outline.body)return Infinity;
    const x0=Math.floor((outline.cxMm-outline.widthMm/2-1)*PX_MM),y0=Math.floor((outline.cyMm-outline.heightMm/2-1)*PX_MM);
    const w=Math.ceil(outline.widthMm*PX_MM)+18,h=Math.ceil(outline.heightMm*PX_MM)+18;
    const svg=documentSvg(outline.body,`${x0/PX_MM} ${y0/PX_MM} ${w/PX_MM} ${h/PX_MM}`,w/PX_MM,h/PX_MM);
    const image=new Resvg(svg,{fitTo:{mode:'width',value:w},background:'white'}).render(),pixels=image.pixels;
    let min=Infinity;
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
        const p=(y*image.width+x)*4;if(Math.max(pixels[p],pixels[p+1],pixels[p+2])>=160)continue;
        const xx=x+x0,yy=y+y0;
        if(xx<0||xx>=field.width||yy<0||yy>=field.height)return 0;
        min=Math.min(min,field.data[yy*field.width+xx]);
    }
    return Math.sqrt(min)/PX_MM;
}
function generateSheet({model,lamps}){
    if(!Array.isArray(lamps)||lamps.length<1||lamps.length>2)throw invalid('Se requieren una o dos lámparas del mismo modelo.');
    if(model==='corazones')model='infinito';
    const tpl=getTemplate(model,lamps.length),{meta}=tpl;
    const input=lamps.map((l,i)=>{
        try{
            const v=model==='infinito'?{nombre1:cleanText(l.nombre1,true),nombre2:cleanText(l.nombre2,true),fecha:cleanText(l.fecha,false)}:{nombre:cleanText(l.nombre,true)};
            if(!v.nombre&&!v.nombre1||model==='infinito'&&!v.nombre2)throw invalid('Falta un nombre.');return v;
        }catch(e){e.lampIndices=[i];throw e;}
    });
    let outlines=[],attempts=0,adjustment=null;
    if(model==='infinito'){
        outlines=meta.slots.map(slot=>{
            const text=input[slot.slot][slot.field],date=slot.field==='fecha';
            const size=date?25.3:text.includes('\n')?44.8:65.2;
            let result;
            for(let step=0;step<=7;step++){
                result=textOutline(text,size*0.94**step,(date?50:52)*0.94**step,slot.cxMm,slot.cyMm+(date?5:0),meta.lineAdvancePerEm);
                result.clearanceMm=clearance(result,tpl.distances);
                // Keep the approved layout; reduce size only if the contour has virtually no gap.
                if(result.clearanceMm>=0.375)return {...result,slot:slot.slot,field:slot.field};
            }
            throw invalid('El texto de corazones toca las líneas de la plantilla.',[slot.slot]);
        });
    }else{
        const base=model==='spiderman'?1.15:1,maxInitial=(model==='spiderman'?62:72)*base;
        let valid=false,lastBad=[];
        search:for(let step=0;step<=7;step++){
            const scale=Number((base*0.94**step).toFixed(3)),maxWidth=Number((maxInitial*0.94**step).toFixed(1));
            for(const separation of step?[0,-2,2]:[0,-2,2,-4,4]){
                outlines=meta.slots.map(slot=>{
                    const text=input[slot.slot].nombre,size=slot.fontPt*(text.includes('\n')?0.687:1);
                    const result=textOutline(text,size*scale,maxWidth*scale,slot.cxMm,slot.cyMm-separation,meta.lineAdvancePerEm);
                    result.clearanceMm=clearance(result,tpl.distances);return {...result,slot:slot.slot,field:'nombre'};
                });
                attempts++;lastBad=outlines.filter(t=>t.clearanceMm<1.75).map(t=>t.slot);
                if(!lastBad.length){valid=true;adjustment={step,scale,separation};break search;}
                if(attempts>=26)break search;
            }
        }
        if(!valid)throw invalid('No se encontró un tamaño legible que libre las líneas del personaje.',lastBad);
    }
    const text=outlines.map(o=>o.body).join(''),naturalSvg=documentSvg(tpl.natural+text);
    const svg=documentSvg(tpl.cut+`<g transform="matrix(${meta.matrix.join(' ')})">${text}</g>`);
    if(/<(?:text|image)\b|\b(?:NaN|Infinity)\b/.test(svg))throw invalid('El SVG contiene elementos no válidos para corte.');
    const preview=new Resvg(naturalSvg,{fitTo:{mode:'width',value:1400},background:'white'}).render().asPng();
    return {svg,naturalSvg,preview,meta:{engine:manifest.version,model,count:lamps.length,pageMm:manifest.pageMm,matrix:meta.matrix,attempts,adjustment,
        texts:outlines.map(({body,...o})=>({...o,clearanceMm:Number.isFinite(o.clearanceMm)?o.clearanceMm:null}))}};
}
module.exports={generateSheet,textOutline,cleanText,manifest};
