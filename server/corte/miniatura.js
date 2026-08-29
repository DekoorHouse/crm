'use strict';
/**
 * Miniatura PNG de un archivo de corte.
 * -------------------------------------------------------------------
 * Se genera UNA vez, al subir, y se guarda junto al SVG. Es la diferencia entre una
 * lista que abre en un parpadeo y una que baja 40 SVG completos (los de grabado traen
 * la foto embebida y pesan MB) cada vez que alguien entra.
 *
 * Dos cosas que los archivos de corte tienen y que hay que atender:
 *
 *  1. LÍNEAS HAIRLINE. El trazo de corte se dibuja con grosores de 0.02-0.1 mm. Al
 *     escalar una hoja de 350 mm a 480 px, esa línea mide 0.1 px y resvg la dibuja tan
 *     tenue que el PNG sale en blanco. Por eso se rasteriza GRANDE y se reduce con
 *     sharp: al promediar, la línea sobrevive como un gris visible.
 *
 *  2. FUENTES. Render no tiene fuentes del sistema, así que un <text> con "Georgia" no
 *     se dibujaría. Se carga la fuente que ya vive en el repo y se declara como
 *     familia por defecto: los nombres salen con otra tipografía, pero SALEN — que es
 *     lo que importa para reconocer el archivo de un vistazo. (Los SVG que exporta
 *     CorelDRAW para corte normalmente traen el texto ya convertido a curvas.)
 */
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');

const FUENTE = path.join(__dirname, '..', '..', 'public', 'editor', 'fonts', 'RowsOfSunflowers.ttf');
const ANCHO_FINAL = 480;          // suficiente para la tabla (42 px) y la vista previa grande
const ANCHO_RASTER = 1280;        // se rasteriza a este ancho y se reduce: rescata las hairlines
const ANCHO_RASTER_PESADO = 640;  // archivos enormes (grabado con foto embebida): menos trabajo
const PESADO_BYTES = 6 * 1024 * 1024;

function rasterizar(svg, ancho) {
    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: ancho },
        background: 'white',
        font: { fontFiles: [FUENTE], defaultFontFamily: 'Rows of Sunflowers', loadSystemFonts: true },
    });
    return resvg.render().asPng();
}

/** ¿Salió todo blanco? Entonces la miniatura no sirve de nada y es mejor no guardarla. */
async function estaEnBlanco(png) {
    try {
        const { channels } = await sharp(png).stats();
        return channels.every(c => c.min >= 250);
    } catch {
        return false;   // ante la duda, quedarse con la miniatura
    }
}

/**
 * Devuelve el PNG de la miniatura, o null si el SVG no se pudo rasterizar
 * (archivo corrupto, filtros que resvg no soporta, o un lienzo vacío).
 * Nunca lanza: subir el archivo no debe fallar porque su miniatura falle.
 */
async function generar(svgBuffer) {
    const svg = svgBuffer.toString('utf8');
    const ancho = svgBuffer.length > PESADO_BYTES ? ANCHO_RASTER_PESADO : ANCHO_RASTER;
    try {
        const grande = rasterizar(svg, ancho);
        const reducida = await sharp(grande)
            .resize({ width: ANCHO_FINAL, withoutEnlargement: true, kernel: 'lanczos3' })
            .png({ compressionLevel: 9 })
            .toBuffer();

        // El blanco se juzga ANTES de estirar el contraste: si no, normalise convierte
        // el ruido de una miniatura vacía en "líneas" y guardaríamos basura.
        if (await estaEnBlanco(reducida)) return null;

        // Al reducir, una hairline queda gris clarito y a 42 px desaparece. normalise
        // estira el histograma: el gris más oscuro se vuelve negro. En un archivo con
        // trazo normal (ya negro) no cambia nada.
        return await sharp(reducida).normalise().png({ compressionLevel: 9 }).toBuffer();
    } catch (e) {
        console.warn('[corte] no se pudo generar la miniatura:', e.message);
        return null;
    }
}

module.exports = { generar };
