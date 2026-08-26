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
 *   --base F     tamano de arranque del nombre respecto al de la plantilla (default 1). Se sube
 *                cuando la plantilla graba el nombre mas chico de lo que el cliente vio en su mockup.
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
// Tamano de arranque por plantilla, respecto al placeholder. El de spiderman graba el nombre mas
// chico de lo que sale en los mockups que aprueba el cliente (comparados los de TALI y Jose Miguel,
// 2026-08-07), y el corte tiene que quedar como se le mostro.
// Medido contra los mockups que aprueba el cliente (TALI y Jose Miguel, 2026-08-07): la plantilla de
// spiderman graba el nombre mas chico. 1.15 es el TECHO: lo que choca es la ALTURA de la letra contra
// la mano de Spiderman, y esa altura no depende de que tan largo sea el nombre, asi que el tope es el
// mismo para "Tali" que para "Jose Miguel". A 1.3 ya no libra el corredor por mas que se mueva.
const BASE_INICIAL = { spiderman: 1.15, rex: 1 };
const PASO = 0.94;      // cuanto se encoge en cada reintento (paso fino: encoger es el ultimo recurso)
const INTENTOS = 7;
const MAX_CORRIDAS = 26;   // tope duro de corridas de Corel, para no colgarse en un caso imposible
// Corrimientos a probar ANTES de encoger, en mm. Alejan el nombre de la figura sin tocarle el tamano.
// El 0 va primero: si la posicion original ya libra, no se mueve nada.
// En spiderman el nombre se aleja de la mano moviendose hacia el NEGATIVO; en rex, un nombre de dos
// renglones necesita irse al POSITIVO para librar la figura. Con solo negativos, un caso de rex no
// encontraba salida aunque existiera (DH14573). Se prueban los dos lados, del corrimiento mas chico
// al mas grande, para tocar la posicion original lo menos posible.
const SEPARACIONES = [0, -2, 2, -4, 4];
// En los pasos de encogido se prueban solo los 3 primeros: gastar 9 corrimientos por escalon agotaba
// el presupuesto ANTES de llegar a un tamano que si cabia. Caso medido: "Rodrigo" (la "g" baja y pega
// con el brazo) cabe a escala ~1.0 pero el ciclo moria en 0.96 tras 18 corridas sin haber bajado mas.
const SEPARACIONES_ENCOGIDO = [0, -2, 2];

// Banderas que llevan un valor detras. Toda bandera nueva con valor TIENE que anadirse aqui.
const BANDERAS_CON_VALOR = new Set(['--tpl', '--file', '--label', '--holgura', '--max', '--separa', '--base']);

// Pausa sincrona sin dependencias (el ciclo es sincrono de arriba a abajo).
const dormir = msEspera => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, msEspera); } catch (_) {} };

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
    const base = parseFloat(arg('base', '')) || BASE_INICIAL[tpl];
    max *= base;   // el tope de largo acompana al tamano de arranque

    // OJO: los nombres NO se pueden separar con la regla "el argumento anterior empieza con --".
    // Con esa regla, una bandera SIN valor pegada a los nombres (--close) se comia el PRIMER nombre y
    // la hoja salia con una sola lampara — pero los dos pedidos igual se marcaban como diseñados.
    // Por eso las banderas con valor son una lista explicita.
    // Ya paso DOS veces que una bandera nueva no se registre aqui y se coma un nombre (--close se
    // llevaba el primero; --base metia "1.15" como si fuera un nombre). Por eso la lista sale de UN
    // solo lugar: BANDERAS_CON_VALOR, arriba, junto a donde se leen.
    const CON_VALOR = BANDERAS_CON_VALOR;
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

    // Corel exporta el PNG de forma ASINCRONA: cscript puede regresar antes de que el archivo este
    // escrito del todo. Sin esperar, verifica-toques.js medía el PNG del intento ANTERIOR y el ciclo
    // tomaba decisiones con datos viejos — sintoma: la misma combinacion daba 0.09 mm en el ciclo y
    // "no se acerca" al volver a medirla a mano (caso DH14573 "Emma/Samadhi", 14 intentos fallidos
    // sobre una hoja que en realidad estaba bien). Se borra el PNG antes y se espera a que reaparezca
    // y deje de crecer.
    const esperarPng = () => {
        const hasta = Date.now() + 30000;
        let prev = -1, estable = 0;
        while (Date.now() < hasta) {
            let size = -1;
            try { size = fs.statSync(pngPath).size; } catch (_) { size = -1; }
            if (size > 0 && size === prev) { if (++estable >= 3) return true; } else estable = 0;
            prev = size;
            dormir(120);
        }
        throw new Error('el PNG de revision no se termino de escribir: ' + pngPath);
    };

    let res = null, escala = base, separa = 0, n = 0;
    const probar = (esc, sep) => {
        try { fs.unlinkSync(pngPath); } catch (_) {}
        generar(tpl, fileBase, nombres, max, esc, sep, label, cerrar);
        esperarPng();
        const r = verificar(pngPath, holgura);
        const f = v => (v === null ? 'libre' : v + 'mm');
        console.log(`intento ${++n}: escala=${esc.toFixed(2)} separa=${sep}mm  ->  azul ${f(r.distanciaAzulMm)}, rojo ${f(r.distanciaRojoMm)}  ${r.ok ? 'OK' : 'se arrima (' + r.lamparasConToque.join(',') + ')'}`);
        return r;
    };

    // PASO 1: mover, no encoger. En el spiderman el nombre va por un CORREDOR estrecho entre la mano
    // (arriba) y el brazo (abajo): medido, la holgura máxima a tamaño completo es ~2.1 mm y se logra
    // corriéndolo 2 mm. Encoger ahí destroza el tamaño para ganar décimas, así que primero se busca la
    // mejor posición SIN tocar la letra.
    // PASO 2: si moverlo no alcanzó, se encoge — y en cada paso se vuelven a probar los corrimientos.
    // Re-probarlos importa: el que mejor funciona a tamaño grande NO es el mismo que funciona ya
    // encogido, y fijando el primero se perdían combinaciones que sí libraban.
    let mejor = null;
    let paso = 0;
    busqueda:
    while (true) {
        const sweeps = paso === 0 ? SEPARACIONES : SEPARACIONES_ENCOGIDO;
        for (const sep of sweeps) {
            const r = probar(escala, sep);
            if (r.ok) { res = r; separa = sep; break busqueda; }
            if (!mejor || holguraDe(r) > holguraDe(mejor.r)) mejor = { r, sep, escala };
            if (n >= MAX_CORRIDAS) break busqueda;
        }
        if (++paso > INTENTOS) break;
        escala *= PASO;
        max *= PASO;
    }
    if (!res) { res = mejor.r; separa = mejor.sep; escala = mejor.escala; }

    if (!res || !res.ok) {
        console.error(`\nNO LOGRE que el nombre librara las lineas con ${holgura} mm en ${INTENTOS} intentos.`);
        console.error('Revisalo a mano: puede que el nombre sea larguisimo o que el acomodo del mockup no quepa.');
        // QUIEN tiene la culpa. Sin esto el worker solo sabe "la hoja fallo" y le suma el fallo a los
        // DOS pedidos: el 2026-08-24 la hoja spiderman DH15426-DH15257 murio por el "Adolfo⏎Ángel" de
        // DH15257 (dos renglones no libran el corredor de la mano) y se llevo entre las patas a
        // DH15426 ("Adán", que cabe de sobra) hasta mandarlo a manual con 3 fallos.
        // El verificador etiqueta por GEOMETRIA sobre el PNG de revision, que sale apaisado: '1a' es
        // la mitad IZQUIERDA y '2a' la DERECHA. En esa vista el nombre de la izquierda es el SEGUNDO
        // argumento (las plantillas ya vienen giradas -90 para produccion), asi que el orden se
        // invierte respecto a como se pasaron los nombres. Verificado sobre las hojas
        // DH15343-DH15257-rex y DH15426-DH15257-spiderman del 2026-08-26.
        const culpables = (res.lamparasConToque || [])
            .map(l => (l === '1a' ? nombres[nombres.length - 1] : nombres[0]))
            .filter(Boolean);
        if (culpables.length) console.error('CULPABLES: ' + [...new Set(culpables)].join(' || '));
        process.exit(1);
    }

    console.log(`\nOK  ${path.join(OUT_DIR, fileBase + '.svg')}`);
    console.log(`PNG ${pngPath}`);
    console.log(`CDR ${path.join(OUT_DIR, fileBase + '.cdr')}`);
    console.log(`holgura final: azul ${res.distanciaAzulMm ?? 'libre'} mm, rojo ${res.distanciaRojoMm ?? 'libre'} mm`);
    if (!fs.existsSync(path.join(OUT_DIR, fileBase + '.svg'))) { console.error('ERROR: no se genero el SVG'); process.exit(1); }
})().catch(e => { console.error('ERROR:', e && e.message || e); process.exit(1); });
