/**
 * EGV Protocol Encoder para M2 Nano / K40.
 * Genera comandos EGV para corte vectorial y grabado raster.
 * Basado en K40-Whisperer egv.py.
 */

const STEPS_PER_MM = 39.37; // 1000 DPI

// ───────── Distance encoding (K40-Whisperer make_distance) ─────────

function encodeDistance(steps) {
    if (steps <= 0) return '';
    let result = '';
    const fullRanges = Math.floor(steps / 255);
    result += 'z'.repeat(fullRanges);
    const remainder = steps % 255;
    if (remainder === 0) return result;
    if (remainder < 26) {
        result += String.fromCharCode(96 + remainder);
    } else if (remainder < 52) {
        result += '|' + String.fromCharCode(96 + remainder - 25);
    } else {
        result += remainder.toString().padStart(3, '0');
    }
    return result;
}

// ───────── Speed encoding (K40-Whisperer _make_speed) ─────────

function encodeSpeed(feedRate, rasterStep = 0) {
    // feedRate en mm/s → convertir a la escala interna de K40-Whisperer
    // K40-Whisperer usa feed_rate en "unidades internas" que equivalen a mm/s
    let B, M;
    if (feedRate < 7) {
        B = 255.97;
        M = 100.21;
    } else {
        B = 236.0;
        M = 1202.5;
    }

    const V = B - M / feedRate;
    const C1 = Math.floor(V);
    const C2 = Math.floor((V - C1) * 255);

    const c1s = C1.toString().padStart(3, '0');
    const c2s = C2.toString().padStart(3, '0');

    if (rasterStep === 0) {
        // Vector: CV[C1][C2]1000000000
        let speed = `CV${c1s}${c2s}1000000000`;
        if (feedRate < 7) speed += 'C';
        return speed;
    } else {
        // Raster: V[C1][C2]1G[step]
        const gs = rasterStep.toString().padStart(3, '0');
        let speed = `V${c1s}${c2s}1G${gs}`;
        if (feedRate < 7) speed += 'C';
        return speed;
    }
}

// ───────── Direction helpers ─────────
// B=right(+X), T=left(-X), L=up(-Y), R=down(+Y)

function encodeMoveXY(dx, dy, laserOn) {
    let cmd = '';
    const prefix = laserOn ? 'D' : 'U';
    let needPrefix = true;

    // Y primero, luego X (como K40-Whisperer make_dir_dist)
    if (dy !== 0) {
        if (needPrefix) { cmd += prefix; needPrefix = false; }
        const dir = dy < 0 ? 'L' : 'R';
        cmd += dir + encodeDistance(Math.abs(dy));
    }
    if (dx !== 0) {
        if (needPrefix) { cmd += prefix; needPrefix = false; }
        const dir = dx > 0 ? 'B' : 'T';
        cmd += dir + encodeDistance(Math.abs(dx));
    }
    return cmd;
}

// Bresenham para movimiento diagonal paso a paso
function encodeLineSteps(dx, dy, laserOn) {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Si es puramente horizontal o vertical, usar encoding compacto
    if (absDx === 0 || absDy === 0) {
        return encodeMoveXY(dx, dy, laserOn);
    }

    // Diagonal: Bresenham paso a paso
    const prefix = laserOn ? 'D' : 'U';
    let cmd = prefix;
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const dirX = dx > 0 ? 'B' : 'T';
    const dirY = dy > 0 ? 'R' : 'L';

    let x = 0, y = 0;
    if (absDx >= absDy) {
        let err = absDx / 2;
        for (let i = 0; i < absDx; i++) {
            cmd += dirX + 'a'; // 1 step X
            err -= absDy;
            if (err < 0) {
                cmd += dirY + 'a'; // 1 step Y
                err += absDx;
            }
        }
    } else {
        let err = absDy / 2;
        for (let i = 0; i < absDy; i++) {
            cmd += dirY + 'a'; // 1 step Y
            err -= absDx;
            if (err < 0) {
                cmd += dirX + 'a'; // 1 step X
                err += absDy;
            }
        }
    }
    return cmd;
}

// ───────── Vector cutting EGV ─────────

/**
 * Genera EGV para corte vectorial.
 * @param {Array} segments  [{points:[{x,y},...], closed:bool}, ...]  coordenadas en mm
 * @param {number} speedMmS  velocidad en mm/s
 * @param {number} offsetX  offset X en mm (posición actual del cabezal)
 * @param {number} offsetY  offset Y en mm (posición actual del cabezal)
 * @returns {string} comando EGV completo
 */
function generateVectorEGV(segments, speedMmS, offsetX = 0, offsetY = 0) {
    const speed = encodeSpeed(speedMmS, 0);
    let cmd = 'I' + speed + 'NRBS1E';

    // curX/curY = 0 porque el EGV es relativo a la posición actual del cabezal.
    // Las coordenadas del diseño (en mm) se suman al offset para posicionar correctamente.
    let curX = 0, curY = 0; // posición en steps, relativo al punto de inicio

    for (const seg of segments) {
        if (seg.points.length < 2) continue;

        // Mover al inicio del segmento (sin láser)
        const startX = Math.round(seg.points[0].x * STEPS_PER_MM);
        const startY = Math.round(seg.points[0].y * STEPS_PER_MM);
        const moveDx = startX - curX;
        const moveDy = startY - curY;
        if (moveDx !== 0 || moveDy !== 0) {
            cmd += encodeMoveXY(moveDx, moveDy, false);
        }
        curX = startX;
        curY = startY;

        // Cortar siguiendo los puntos (con láser)
        for (let i = 1; i < seg.points.length; i++) {
            const px = Math.round(seg.points[i].x * STEPS_PER_MM);
            const py = Math.round(seg.points[i].y * STEPS_PER_MM);
            const dx = px - curX;
            const dy = py - curY;
            if (dx !== 0 || dy !== 0) {
                cmd += encodeLineSteps(dx, dy, true);
            }
            curX = px;
            curY = py;
        }

        // Cerrar el path si es necesario
        if (seg.closed && seg.points.length > 2) {
            const dx = startX - curX;
            const dy = startY - curY;
            if (dx !== 0 || dy !== 0) {
                cmd += encodeLineSteps(dx, dy, true);
            }
            curX = startX;
            curY = startY;
        }
    }

    cmd += 'FNSE';
    return cmd;
}

// ───────── Raster engraving EGV ─────────

/**
 * Genera EGV para grabado raster.
 * @param {Buffer|Uint8Array} bitmap  1 bit por pixel, 8 px por byte, MSB first
 * @param {number} width   ancho en pixels
 * @param {number} height  alto en pixels
 * @param {number} speedMmS  velocidad en mm/s
 * @param {number} rasterStep  paso entre líneas en device units (1-3)
 * @param {number} offsetX  offset X en mm desde el origen
 * @param {number} offsetY  offset Y en mm desde el origen
 * @returns {string} comando EGV completo
 */
function generateRasterEGV(bitmap, width, height, speedMmS, rasterStep = 1, offsetX = 0, offsetY = 0) {
    const speed = encodeSpeed(speedMmS, rasterStep);
    const parts = ['I', speed, 'NRBS1E'];

    // Mover al inicio del raster (sin láser)
    const startX = Math.round(offsetX * STEPS_PER_MM);
    const startY = Math.round(offsetY * STEPS_PER_MM);
    if (startX !== 0 || startY !== 0) {
        parts.push(encodeMoveXY(startX, startY, false));
    }

    const rowBytes = Math.ceil(width / 8);
    let leftToRight = true;

    for (let row = 0; row < height; row++) {
        // NO enviar movimiento Y explícito — el M2 Nano en modo raster
        // avanza Y automáticamente (G parameter) al cambiar dirección B↔T.

        // Leer pixels de esta fila directamente
        const rowOffset = row * rowBytes;
        const dir = leftToRight ? 'B' : 'T';
        let runOn = false;
        let runLen = 0;

        for (let i = 0; i < width; i++) {
            const px = leftToRight ? i : (width - 1 - i);
            const byteIdx = rowOffset + (px >> 3);
            const bitIdx = 7 - (px & 7);
            const isOn = !!(bitmap[byteIdx] & (1 << bitIdx));

            if (runLen === 0) {
                runOn = isOn;
                runLen = 1;
            } else if (isOn === runOn) {
                runLen++;
            } else {
                parts.push(runOn ? 'D' : 'U', dir, encodeDistance(runLen));
                runOn = isOn;
                runLen = 1;
            }
        }
        if (runLen > 0) {
            parts.push(runOn ? 'D' : 'U', dir, encodeDistance(runLen));
        }

        leftToRight = !leftToRight;

        // Log progreso cada 500 filas
        if (row % 500 === 0 && row > 0) {
            process.stdout.write(`  EGV raster: ${row}/${height} filas...\r`);
        }
    }

    parts.push('FNSE');
    console.log(`  EGV raster: ${height} filas completas.`);
    return parts.join('');
}

module.exports = {
    STEPS_PER_MM,
    encodeDistance,
    encodeSpeed,
    encodeMoveXY,
    encodeLineSteps,
    generateVectorEGV,
    generateRasterEGV,
};
