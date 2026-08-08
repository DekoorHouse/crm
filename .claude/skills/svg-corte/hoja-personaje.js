/**
 * hoja-personaje.js — Genera una hoja de lamparas de PERSONAJE (Spiderman / T-Rex) GARANTIZANDO
 * que el nombre no toque ni se arrime a la figura azul ni al corte rojo.
 *
 * Uso:
 *   node hoja-personaje.js --tpl spiderman|rex --file BASE [--holgura 3] [--label DH...] "Nombre1" ["Nombre2"]
 *
 *   --holgura N  milimetros minimos entre el texto y cualquier linea (default 1.5; en el
 *                spiderman el corredor libre entre la mano y el brazo NO da para mas de ~2.1 mm)
 *   --max N      largo maximo inicial del nombre en mm (default: el de la plantilla)
 *   --close      cierra el documento en Corel al terminar (lo usa el worker; a mano conviene dejarlo
 *                abierto para revisarlo)
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
const PASO = 0.94;      // cuanto se encoge en cada reintento (paso fino: encoger es el ultimo recurso)
const INTENTOS = 5;
// Corrimientos a probar ANTES de encoger, en mm. Alejan el nombre de la figura sin tocarle el tamano.
// El 0 va primero: si la posicion original ya libra, no se mueve nada.
const SEPARACIONES = [0, -2, -3, -1, -4];

function arg(nombre, def) {
    const i = process.argv.indexOf('--' + nombre);
    return i >= 0 ? process.argv[i + 1] : def;
}

function generar(tpl, fileBase, nombres, maxMm, escala, separa, label, cerrar) {
    const args = ['//nologo', VBS, `/tpl:${tpl}`, `/file:${fileBase}`, '/preview',
        `/max:${maxMm.toFixed(1)}`, `/escala:${escala.toFixed(3)}`, `/separa:${separa}`];
    if (label) args.push(`/label:${label}`);
    // El worker corre desatendido cada 15 min: si los documentos se quedan abiertos, Corel se llena
    // y termina tumbandose. A mano conviene dejarlos abiertos para revisarlos.
    if (cerrar) args.push('/close');
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
    const holgura = parseFloat(arg('holgura', '1.5')) || 1.5;
    let max = parseFloat(arg('max', '')) || MAX_INICIAL[tpl];

    // OJO: los nombres NO se pueden separar con la regla "el argumento anterior empieza con --".
    // Con esa regla, una bandera SIN valor pegada a los nombres (--close) se comia el PRIMER nombre y
    // la hoja salia con una sola lampara — pero los dos pedidos igual se marcaban como diseñados.
    // Por eso las banderas con valor son una lista explicita.
    const CON_VALOR = new Set(['--tpl', '--file', '--label', '--holgura', '--max', '--separa']);
    const argv = process.argv.slice(2);
    const nombres = [];
    for (let i = 0; i < argv.length; i++) {
        if (CON_VALOR.has(argv[i])) { i++; continue; }      // salta la bandera y su valor
        if (argv[i].startsWith('--')) continue;             // bandera sin valor (--close)
        nombres.push(argv[i]);
    }
    if (!nombres.length || nombres.length > 2) {
        console.error('ERROR: hay que dar 1 o 2 nombres. Llegaron: ' + JSON.stringify(nombres));
        process.exit(1);
    }

    const cerrar = process.argv.includes('--close');
    const pngPath = path.join(OUT_DIR, fileBase + '.png');
    const holguraDe = r => Math.min(
        r.distanciaAzulMm === null ? Infinity : r.distanciaAzulMm,
        r.distanciaRojoMm === null ? Infinity : r.distanciaRojoMm);

    let res = null, escala = 1, separa = 0, n = 0;
    const probar = (esc, sep) => {
        generar(tpl, fileBase, nombres, max, esc, sep, label, cerrar);
        const r = verificar(pngPath, holgura);
        const f = v => (v === null ? 'libre' : v + 'mm');
        console.log(`intento ${++n}: escala=${esc.toFixed(2)} separa=${sep}mm  ->  azul ${f(r.distanciaAzulMm)}, rojo ${f(r.distanciaRojoMm)}  ${r.ok ? 'OK' : 'se arrima (' + r.lamparasConToque.join(',') + ')'}`);
        return r;
    };

    // PASO 1: mover, no encoger. En el spiderman el nombre va por un CORREDOR estrecho entre la mano
    // (arriba) y el brazo (abajo): medido, la holgura máxima a tamaño completo es ~2.1 mm y se logra
    // corriéndolo 2 mm. Encoger ahí destroza el tamaño para ganar décimas, así que primero se busca la
    // mejor posición SIN tocar la letra.
    let mejor = null;
    for (const sep of SEPARACIONES) {
        const r = probar(1, sep);
        if (r.ok) { res = r; separa = sep; break; }
        if (!mejor || holguraDe(r) > holguraDe(mejor.r)) mejor = { r, sep };
    }
    // PASO 2: solo si moverlo no alcanzó, se encoge desde la mejor posición encontrada.
    if (!res) {
        separa = mejor.sep;
        res = mejor.r;
        for (let i = 0; i < INTENTOS && !res.ok; i++) {
            escala *= PASO;
            max *= PASO;
            res = probar(escala, separa);
        }
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
