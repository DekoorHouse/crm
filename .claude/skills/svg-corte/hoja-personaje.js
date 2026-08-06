/**
 * hoja-personaje.js — Genera una hoja de lamparas de PERSONAJE (Spiderman / T-Rex) GARANTIZANDO
 * que el nombre no toque ni se arrime a la figura azul ni al corte rojo.
 *
 * Uso:
 *   node hoja-personaje.js --tpl spiderman|rex --file BASE [--holgura 3] [--label DH...] "Nombre1" ["Nombre2"]
 *
 *   --holgura N  milimetros minimos entre el texto y cualquier linea (default 3)
 *   --max N      largo maximo inicial del nombre en mm (default: el de la plantilla)
 *
 * QUE HACE: llama a gen-personaje.vbs, exporta el PNG de revision, lo pasa por verifica-toques.js y,
 * si el nombre toca o se arrima a una linea, VUELVE A GENERAR con el nombre mas chico. Repite hasta
 * que pasa o hasta agotar los intentos.
 *
 * POR QUE: el largo maximo calibrado a ojo no alcanza. Los nombres largos ("Luis Roberto",
 * "Dylan Javier") entraban en el aro pero la "J" cruzaba la cola del dinosaurio y la "o" final tocaba
 * el lomo — a 0.09 mm de la linea (reportado por Chris, 2026-08-06). Medirlo sobre el render y
 * reintentar es lo unico que lo garantiza, porque el hueco libre no es un rectangulo: depende de la
 * silueta del personaje, de donde cae el nombre y de cuantos renglones lleva.
 *
 * OJO: esto NO decide el acomodo (1 renglon vs 2). Eso lo manda el MOCKUP que aprobo el cliente
 * (ver mockup-de-pedido.js y la regla en SKILL.md). Aqui solo se ajusta el TAMANO para que quepa.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const SKILL_DIR = __dirname;
const VBS = path.join(SKILL_DIR, 'gen-personaje.vbs');
const OUT_DIR = path.join(os.homedir(), 'Documents', 'SVG-Corte');

// Largo inicial por plantilla (mm). Son los mismos topes que trae el VBS; el ciclo los baja si hace falta.
const MAX_INICIAL = { spiderman: 62, rex: 72 };
const PASO = 0.92;      // cuanto se encoge en cada reintento
const INTENTOS = 6;

function arg(nombre, def) {
    const i = process.argv.indexOf('--' + nombre);
    return i >= 0 ? process.argv[i + 1] : def;
}

function generar(tpl, fileBase, nombres, maxMm, escala, label) {
    const args = ['//nologo', VBS, `/tpl:${tpl}`, `/file:${fileBase}`, '/preview',
        `/max:${maxMm.toFixed(1)}`, `/escala:${escala.toFixed(3)}`];
    if (label) args.push(`/label:${label}`);
    args.push(...nombres);
    const r = spawnSync('cscript', args, { encoding: 'utf8', windowsHide: true });
    const salida = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 || /ERROR/.test(salida)) throw new Error('gen-personaje.vbs fallo: ' + salida.trim());
    return salida;
}

function verificar(pngPath, holgura) {
    const r = spawnSync(process.execPath, [path.join(SKILL_DIR, 'verifica-toques.js'), pngPath, '--holgura', String(holgura), '--json'],
        { encoding: 'utf8', windowsHide: true });
    const txt = (r.stdout || '').trim();
    if (!txt) throw new Error('verifica-toques.js no regreso nada: ' + (r.stderr || '').trim());
    return JSON.parse(txt);
}

(async () => {
    const tpl = String(arg('tpl', 'spiderman')).toLowerCase();
    if (!MAX_INICIAL[tpl]) { console.error('ERROR: --tpl debe ser spiderman o rex'); process.exit(1); }
    const fileBase = arg('file');
    if (!fileBase) { console.error('ERROR: falta --file BASE'); process.exit(1); }
    const label = arg('label', '');
    const holgura = parseFloat(arg('holgura', '3')) || 3;
    let max = parseFloat(arg('max', '')) || MAX_INICIAL[tpl];

    const nombres = process.argv.slice(2).filter((a, i, all) => {
        if (a.startsWith('--')) return false;
        const prev = all[i - 1];
        return !(prev && prev.startsWith('--'));   // descartar los valores de las banderas
    });
    if (!nombres.length || nombres.length > 2) {
        console.error('ERROR: hay que dar 1 o 2 nombres. Llegaron: ' + JSON.stringify(nombres));
        process.exit(1);
    }

    const pngPath = path.join(OUT_DIR, fileBase + '.png');
    let res = null, escala = 1;
    for (let intento = 1; intento <= INTENTOS; intento++) {
        generar(tpl, fileBase, nombres, max, escala, label);
        res = verificar(pngPath, holgura);
        const dz = res.distanciaAzulMm === null ? 'libre' : res.distanciaAzulMm + 'mm';
        const dr = res.distanciaRojoMm === null ? 'libre' : res.distanciaRojoMm + 'mm';
        console.log(`intento ${intento}: escala=${escala.toFixed(2)} max=${max.toFixed(1)}mm  ->  azul ${dz}, rojo ${dr}  ${res.ok ? 'OK' : 'se arrima (' + res.lamparasConToque.join(',') + ')'}`);
        if (res.ok) break;
        if (intento === INTENTOS) break;
        // Se baja la escala (afecta a TODOS los nombres, incluidos los de 2 renglones cortos que el
        // tope de largo no alcanza) y de paso el tope, por si el que estorba es un nombre de 1 renglon.
        escala *= PASO;
        max *= PASO;
    }

    if (!res || !res.ok) {
        console.error(`\nNO LOGRE que el nombre librara las lineas con ${holgura} mm en ${INTENTOS} intentos.`);
        console.error('Revisalo a mano: puede que el nombre sea larguisimo o que el acomodo del mockup no quepa.');
        process.exit(1);
    }

    console.log(`\nOK  ${path.join(OUT_DIR, fileBase + '.svg')}`);
    console.log(`PNG ${pngPath}`);
    console.log(`CDR ${path.join(OUT_DIR, fileBase + '.cdr')}`);
    console.log(`holgura final: azul ${res.distanciaAzulMm ?? 'libre'} mm, rojo ${res.distanciaRojoMm ?? 'libre'} mm`);
    if (!fs.existsSync(path.join(OUT_DIR, fileBase + '.svg'))) { console.error('ERROR: no se genero el SVG'); process.exit(1); }
})().catch(e => { console.error('ERROR:', e && e.message || e); process.exit(1); });
