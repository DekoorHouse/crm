/**
 * verifica-toques.js — Revisa que el TEXTO grabado (negro) no toque ni se acerque a las lineas de
 * la figura (azul) ni al corte (rojo) en una hoja ya generada.
 *
 * Uso:  node verifica-toques.js "<ruta.png>" [--holgura 3] [--json]
 *
 *   --holgura N   milimetros minimos que debe haber entre el texto y cualquier linea (default 3)
 *   --json        imprime el resultado como JSON (para encadenarlo desde otro script)
 *
 * Sale con codigo 0 si pasa y 1 si hay toque/acercamiento, asi que se puede usar como puerta.
 *
 * POR QUE EXISTE: calibrar "cuanto le cabe al nombre" a ojo NO funciona — un nombre largo se veia
 * bien en la miniatura y en realidad la "J" cruzaba la cola del dinosaurio y la "o" final tocaba el
 * lomo (reportado por Chris, 2026-08-06). Aqui se mide de verdad, sobre los pixeles del render.
 *
 * COMO: clasifica cada pixel por color (negro = grabado, azul = figura, rojo = corte), dilata la
 * mascara del texto la holgura pedida y ve si toca alguna de las otras dos. La escala se saca del
 * ancho conocido de la hoja, que se asume el del bounding box exportado por Corel.
 */
'use strict';

const path = require('path');
const sharp = require('sharp');

// Ancho real del contenido de una hoja de personaje, en mm: la lampara mide 166.3 y la marca azul
// de referencia queda dentro de ese ancho, asi que el bbox exportado equivale a 166.3 mm.
const ANCHO_CONTENIDO_MM = 166.3;

// OJO (bug encontrado el 2026-08-06): clasificar como TEXTO todo lo poco saturado marcaba tambien el
// ANTIALIASING de las lineas de color. Un pixel como (210,210,250) es azul palido del borde de la
// figura, pero tiene max-min = 40, asi que entraba como "texto" y el verificador reportaba 0.09 mm de
// distancia SIEMPRE, sin importar el tamano del nombre. Por eso ahora el texto tiene que ser ademas
// OSCURO (max < 160), y los colores se evaluan ANTES que el gris.
function clasifica(r, g, b) {
    if (r > 225 && g > 225 && b > 225) return 0;  // fondo blanco / casi blanco
    if (b > r + 30 && b > g + 20) return 2;       // AZUL -> figura
    if (r > b + 30 && r > g + 30) return 3;       // ROJO -> corte
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 160 && max - min < 40) return 1;    // negro/gris oscuro -> TEXTO (grabado)
    return 0;                                     // antialias palido: no cuenta
}

async function verifica(pngPath, holguraMm) {
    const img = sharp(pngPath).ensureAlpha();
    const { width, height } = await img.metadata();
    const { data } = await img.raw().toBuffer({ resolveWithObject: true });

    const px = width * height;
    const clase = new Uint8Array(px);
    for (let i = 0; i < px; i++) {
        const o = i * 4;
        // Un pixel transparente es fondo.
        clase[i] = data[o + 3] < 40 ? 0 : clasifica(data[o], data[o + 1], data[o + 2]);
    }

    // La hoja puede traer 2 lamparas apiladas (alto = 2x) o media hoja. La escala se saca del ANCHO,
    // que siempre es el de una lampara.
    const pxPorMm = (width > height ? width / 2 : width) / ANCHO_CONTENIDO_MM;
    const r = Math.max(1, Math.round(holguraMm * pxPorMm));

    // Distancia minima del texto a cada linea, buscando en un anillo creciente alrededor de cada
    // pixel de texto. Se corta en cuanto se encuentra algo dentro del radio de holgura.
    let minAzul = Infinity, minRojo = Infinity;
    const toques = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (clase[y * width + x] !== 1) continue;
            for (let dy = -r; dy <= r; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                for (let dx = -r; dx <= r; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= width) continue;
                    const c = clase[yy * width + xx];
                    if (c !== 2 && c !== 3) continue;
                    const d = Math.hypot(dx, dy) / pxPorMm;
                    if (c === 2 && d < minAzul) { minAzul = d; if (d < holguraMm) toques.push({ x, y, tipo: 'azul', d }); }
                    if (c === 3 && d < minRojo) { minRojo = d; if (d < holguraMm) toques.push({ x, y, tipo: 'rojo', d }); }
                }
            }
        }
    }

    const mm = v => (v === Infinity ? null : Math.round(v * 100) / 100);
    const ok = minAzul >= holguraMm && minRojo >= holguraMm;
    return {
        ok,
        holguraMm,
        distanciaAzulMm: mm(minAzul),
        distanciaRojoMm: mm(minRojo),
        // Que lampara falla. Las dos van apiladas sobre el lado LARGO de la hoja, que segun la
        // orientacion del render es el alto (SVG de produccion) o el ancho (PNG de revision).
        lamparasConToque: [...new Set(toques.map(t =>
            height >= width ? (t.y < height / 2 ? '1a' : '2a') : (t.x < width / 2 ? '1a' : '2a')))],
        pxPorMm: Math.round(pxPorMm * 100) / 100,
    };
}

(async () => {
    const args = process.argv.slice(2);
    const pngPath = args.find(a => !a.startsWith('--'));
    if (!pngPath) { console.log('Uso: node verifica-toques.js "<ruta.png>" [--holgura 3] [--json]'); process.exit(2); }
    const i = args.indexOf('--holgura');
    const holgura = i >= 0 ? parseFloat(args[i + 1]) || 3 : 3;
    const json = args.includes('--json');

    const res = await verifica(pngPath, holgura);
    if (json) { console.log(JSON.stringify(res)); process.exit(res.ok ? 0 : 1); }

    console.log(`\n${path.basename(pngPath)}   (holgura pedida: ${holgura} mm)`);
    console.log(`  texto <-> figura azul:  ${res.distanciaAzulMm === null ? 'no se acerca' : res.distanciaAzulMm + ' mm'}`);
    console.log(`  texto <-> corte rojo:   ${res.distanciaRojoMm === null ? 'no se acerca' : res.distanciaRojoMm + ' mm'}`);
    if (res.ok) console.log('  OK — el texto no toca ni se arrima a ninguna linea.\n');
    else console.log(`  FALLA — hay texto a menos de ${holgura} mm (lamparas: ${res.lamparasConToque.join(', ') || '?'})\n`);
    process.exit(res.ok ? 0 : 1);
})().catch(e => { console.error('ERROR:', e && e.message || e); process.exit(2); });
