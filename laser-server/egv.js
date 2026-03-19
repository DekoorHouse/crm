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

    // Return to starting position (laser off)
    if (curX !== 0 || curY !== 0) {
        cmd += encodeMoveXY(-curX, -curY, false);
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
 * @returns {{ egv: string, endX: number, endY: number }} comando EGV y desplazamiento final en mm
 */
function generateRasterEGV(bitmap, width, height, speedMmS, rasterStep = 1, offsetX = 0, offsetY = 0) {
    const rowBytes = Math.ceil(width / 8);

    function getBit(row, px) {
        const byteIdx = row * rowBytes + (px >> 3);
        return !!(bitmap[byteIdx] & (1 << (7 - (px & 7))));
    }

    // Sin overscan — el firmware M2 Nano maneja aceleración/desaceleración
    // internamente via gears (3.25-11.4mm según velocidad).
    // El jog posiciona el cabezal ANTES del EGV a velocidad segura.
    // K40 Whisperer tampoco usa overscan.
    const overscan = 0;

    // ── Scan bitmap for global content bounds ──
    let gMinX = width, gMaxX = -1, firstRow = -1, lastRow = -1;
    for (let row = 0; row < height; row++) {
        for (let x = 0; x < width; x++) {
            if (getBit(row, x)) {
                if (firstRow < 0) firstRow = row;
                lastRow = row;
                if (x < gMinX) gMinX = x;
                if (x > gMaxX) gMaxX = x;
            }
        }
    }

    if (firstRow < 0) {
        console.log('  EGV raster: bitmap vacío, nada que grabar.');
        return { egv: 'IFNSE', endX: 0, endY: 0 };
    }

    const scanW = gMaxX - gMinX + 1;
    const scanH = lastRow - firstRow + 1;
    const scanWOS = scanW + 2 * overscan; // scan width including overscan on both sides

    // ── Pre-compute per-row content bounds (absolute pixel positions) ──
    const rowFO = new Int32Array(scanH).fill(-1);
    const rowLO = new Int32Array(scanH).fill(-1);
    for (let i = 0; i < scanH; i++) {
        for (let x = gMinX; x <= gMaxX; x++) {
            if (getBit(firstRow + i, x)) {
                if (rowFO[i] < 0) rowFO[i] = x;
                rowLO[i] = x;
            }
        }
    }

    console.log(`  EGV raster: content X[${gMinX}..${gMaxX}] Y[${firstRow}..${lastRow}] → ${scanW}×${scanH}px, overscan=${(overscan/STEPS_PER_MM).toFixed(1)}mm (${overscan}steps)`);

    // ── Helper: encode active pixel runs for one row ──
    function encodeRuns(fo, lo, row, ltr) {
        const activeLen = lo - fo + 1;
        const dir = ltr ? 'B' : 'T';
        let runOn = false, runLen = 0;
        for (let i = 0; i < activeLen; i++) {
            const px = ltr ? (fo + i) : (lo - i);
            const isOn = getBit(row, px);
            if (runLen === 0) { runOn = isOn; runLen = 1; }
            else if (isOn === runOn) { runLen++; }
            else { parts.push(runOn ? 'D' : 'U', dir, encodeDistance(runLen)); runOn = isOn; runLen = 1; }
        }
        if (runLen > 0) parts.push(runOn ? 'D' : 'U', dir, encodeDistance(runLen));
    }

    // Jog offset: posición a la que el servidor debe hacer jog ANTES del EGV
    const jogX = (Math.round(offsetX * STEPS_PER_MM) + gMinX - overscan) / STEPS_PER_MM;
    const jogY = (Math.round(offsetY * STEPS_PER_MM) + firstRow * rasterStep) / STEPS_PER_MM;

    const speed = encodeSpeed(speedMmS, rasterStep);
    const parts = ['I', speed, 'NRBS1E'];

    let posX = gMinX - overscan;
    let leftToRight = true;

    for (let i = 0; i < scanH; i++) {
        const fo = rowFO[i], lo = rowLO[i];
        const dir = leftToRight ? 'B' : 'T';

        if (fo < 0) {
            // Empty row — traverse scanW + 2*overscan for safe position reset
            parts.push('U', dir, encodeDistance(scanWOS));
            posX += leftToRight ? scanWOS : -scanWOS;
            leftToRight = !leftToRight;
            continue;
        }

        // Check next row's content for trailing extension
        const nextIsEmpty = (i + 1 >= scanH || rowFO[i + 1] < 0);
        const nextFo = (!nextIsEmpty) ? rowFO[i + 1] : -1;
        const nextLo = (!nextIsEmpty) ? rowLO[i + 1] : -1;

        if (leftToRight) {
            // ── L→R row ──
            // Leading: skip from posX to firstOn (posX should be <= fo - overscan)
            const leading = fo - posX;
            if (leading > 0) parts.push('U', 'B', encodeDistance(leading));

            // Content: encode active runs
            encodeRuns(fo, lo, firstRow + i, true);
            posX = lo + 1;

            // Trailing: extend for overscan + next row needs
            let targetRight;
            if (nextIsEmpty) {
                targetRight = gMaxX + 1 + overscan;
            } else {
                // Next R→L row needs posX >= nextLo + 1 + overscan (overscan room before content)
                targetRight = Math.max(posX, nextLo + 1 + overscan);
            }
            if (posX < targetRight) {
                parts.push('U', 'B', encodeDistance(targetRight - posX));
                posX = targetRight;
            }
        } else {
            // ── R→L row ──
            // Leading: skip from posX down to lastOn + 1 (posX should be >= lo + 1 + overscan)
            const leading = posX - (lo + 1);
            if (leading > 0) parts.push('U', 'T', encodeDistance(leading));

            // Content: encode active runs (right to left)
            encodeRuns(fo, lo, firstRow + i, false);
            posX = fo;

            // Trailing: extend for overscan + next row needs
            let targetLeft;
            if (nextIsEmpty) {
                targetLeft = gMinX - overscan;
            } else {
                // Next L→R row needs posX <= nextFo - overscan (overscan room before content)
                targetLeft = Math.min(posX, nextFo - overscan);
            }
            if (posX > targetLeft) {
                parts.push('U', 'T', encodeDistance(posX - targetLeft));
                posX = targetLeft;
            }
        }

        leftToRight = !leftToRight;

        if (i % 500 === 0 && i > 0) {
            process.stdout.write(`  EGV raster: ${i}/${scanH} filas...\r`);
        }
    }

    // ── Return: calcular desplazamiento para volver al inicio ──
    // No embebemos jogs después de FNSE — el board no los procesa de
    // forma confiable desde el buffer. El server hará jogs explícitos.
    const retX = -(posX - gMinX);
    const retY = -((scanH > 1 ? (scanH - 1) * rasterStep : 0));
    parts.push('FNSE');

    const result = parts.join('');
    const endXmm = retX / STEPS_PER_MM;
    const endYmm = retY / STEPS_PER_MM;
    console.log(`  EGV raster: ${scanH} filas. Total: ${result.length} chars, jog=(${jogX.toFixed(1)},${jogY.toFixed(1)})mm, ret=(${endXmm.toFixed(1)},${endYmm.toFixed(1)})mm`);
    return { egv: result, endX: endXmm, endY: endYmm, jogX, jogY };
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
