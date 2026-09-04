// --- Regla de renglones para nombres en lámparas -----------------------------------------------
// UNA sola fuente de verdad para "¿este nombre va en 1 o 2 renglones?", usada por:
//   - la generación de mockups (el prompt le ORDENA a la IA de imagen el salto de línea), y
//   - el diseño de corte en Corel (svg-corte-worker), que reproduce el MISMO layout.
// Así el cliente recibe el producto exactamente como lo vio en su mockup.
//
// Regla: nombres COMPUESTOS (2+ palabras) y largos (> MAX_SINGLE caracteres) se parten en 2
// renglones en el espacio que deje los renglones más parejos ("Maria Del Carmen" -> "Maria Del"
// / "Carmen", igual que en producción). Una sola palabra nunca se parte (el auto-ajuste de
// tamaño la encoge). Un nombre que YA trae '\n' se respeta tal cual (decisión manual).
'use strict';

const MAX_SINGLE = 9; // caracteres; "Rosa María" (10) se parte, "Ana Luz" (7) no

// Normaliza un nombre para grabar/mostrar: inicial mayúscula en CADA palabra (aunque el cliente lo
// escriba en minúscula) e inserta un espacio tras un punto pegado a una letra ("L.Angel" -> "L. Angel").
// Preserva los saltos de renglón '\n' de los nombres a 2 líneas. Regla de negocio (Chris, 2026-07-24):
// en las lámparas los nombres SIEMPRE llevan inicial mayúscula y el texto tras un punto va separado.
// Compartida por el MOCKUP y el CORTE para que la pieza salga igual que lo que el cliente vio.
function titleCaseName(s) {
    let t = String(s == null ? '' : s);
    if (!t.trim()) return t;
    t = t.replace(/\.(?=\p{L})/gu, '. ');                            // espacio tras punto pegado a letra
    t = t.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim(); // colapsa espacios, respeta '\n'
    // Inicial mayúscula tras inicio, espacio, '\n', apóstrofe, guión o punto; el resto en minúscula
    // ("jesús" -> "Jesús", "MARIA" -> "Maria"). \p{L} + flag u para manejar acentos.
    return bajaParticulas(t.toLowerCase().replace(/(^|[\s'.\-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase()));
}

// Las partículas del español ("de", "del", "la", "y"…) van en MINÚSCULA cuando no abren el nombre ni
// el renglón: "Jose de Jesús Jr", no "Jose De Jesús Jr". Caso DH15254 (2026-09-04): la cliente
// escribió "Jose de Jesús Jr", el mockup salió así y la hoja de corte salió "Jose De". EL MOCKUP
// MANDA. Misma lista que BajaParticulas en los .vbs de la skill svg-corte.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'do', 'dos', 'das', 'van', 'von']);
function bajaParticulas(t) {
    return String(t).split('\n').map(linea => {
        let primera = true;
        return linea.split(' ').map(w => {
            if (!w) return w;
            const lw = w.toLowerCase();
            const out = (!primera && PARTICULAS.has(lw)) ? lw : w;
            primera = false;
            return out;
        }).join(' ');
    }).join('\n');
}

// Devuelve los renglones decididos para un nombre: ["Rosa", "María"] o ["Héctor"].
function decideNameLines(nombre) {
    const raw = String(nombre || '');
    if (raw.includes('\n')) return raw.split('\n').map(s => s.trim()).filter(Boolean); // ya decidido
    const clean = raw.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const words = clean.split(' ');
    if (words.length < 2 || clean.length <= MAX_SINGLE) return [clean];
    let best = null;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' ');
        const b = words.slice(i).join(' ');
        const w = Math.max(a.length, b.length);
        if (!best || w < best.w) best = { w, lines: [a, b] };
    }
    return best.lines;
}

// Aplica la regla a los campos del mockup: nombre1/nombre2 quedan con '\n' si van en 2 renglones.
// (buildPromptFromTemplate ya sabe instruir a la IA los renglones apilados cuando hay '\n'.)
function applyNameLayout(fields) {
    const out = { ...(fields || {}) };
    for (const k of ['nombre1', 'nombre2']) {
        if (!out[k]) continue;
        const lines = decideNameLines(out[k]);
        if (lines.length > 1) out[k] = lines.join('\n');
        else if (lines.length === 1) out[k] = lines[0];
    }
    return out;
}

// Normaliza para comparar lo que la visión leyó vs lo pedido (sin acentos ni mayúsculas;
// la ortografía exacta la juzga el operador con la imagen a la vista).
function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Compara renglones pedidos vs detectados: ok = mismo número de renglones y texto equivalente.
function sameLines(expected, detected) {
    const e = (expected || []).map(norm).filter(Boolean);
    const d = (detected || []).map(norm).filter(Boolean);
    if (e.length !== d.length) return false;
    return e.every((line, i) => line === d[i]);
}

module.exports = { decideNameLines, applyNameLayout, sameLines, titleCaseName, MAX_SINGLE };
