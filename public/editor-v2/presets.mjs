// Ready-made shapes from the workshop, inserted at their real cutting size from the tools bar.
// Each keeps the path data exactly as exported from CorelDRAW, in its SVG user units, with the
// millimetres per unit of that file.
import { createObject, HAIRLINE_WIDTH } from './model.mjs';
import { normalizePath } from './path.mjs';
import { parsePathData } from './svgImport.mjs';

export const PRESETS = {
    'lamp-frame': {
        name: 'Marco de lámpara',
        strokeWidth: .3,
        // coso.svg (CorelDRAW 2021): viewBox 35000 × 33000 for 350 × 330 mm.
        unit: .01,
        d: 'M21124.11 23320.18l-124.71 1496.35 -6999.99 0 -124.71 -1496.35c-2596.65,-1322 -4375.3,-4020.1 -4375.3,-7133.64 0,-4418.28 3581.72,-8000 8000,-8000 4418.29,0 7999.99,3581.72 7999.99,8000 0,3113.53 -1778.64,5811.63 -4375.28,7133.64z',
    },
};

// A cutting line: no fill and the preset's outline width (a hairline by default), centred on the given point.
export function presetObject(key, centre, stroke) {
    const preset = PRESETS[key];
    if (!preset) throw new Error('Forma no encontrada.');
    const subpaths = parsePathData(preset.d).map(({ closed, points }) => ({ closed, points: points.map(value => value * preset.unit) }));
    const geometry = normalizePath(subpaths);
    return {
        ...createObject('path', 0, 0), name: preset.name, ...geometry,
        x: centre.x - geometry.width / 2, y: centre.y - geometry.height / 2,
        fill: 'none', stroke: stroke === 'none' ? '#000000' : stroke, strokeWidth: preset.strokeWidth ?? HAIRLINE_WIDTH,
    };
}
