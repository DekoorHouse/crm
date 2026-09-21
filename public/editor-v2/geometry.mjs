export const RESIZE_HANDLES = [
    { name: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
    { name: 'n', x: .5, y: 0, cursor: 'ns-resize' },
    { name: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
    { name: 'e', x: 1, y: .5, cursor: 'ew-resize' },
    { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
    { name: 's', x: .5, y: 1, cursor: 'ns-resize' },
    { name: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
    { name: 'w', x: 0, y: .5, cursor: 'ew-resize' },
];

// Corners scale uniformly about the opposite corner. Edge handles affect one axis.
// Crossing the fixed anchor stops at the minimum size instead of flipping the object.
export function resizeBounds(original, handle, dx, dy) {
    if (!RESIZE_HANDLES.some(item => item.name === handle)) throw new Error('Control de tamaño desconocido.');
    const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
    const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
    const { x, y, width: w, height: h } = original;
    let width = w, height = h;
    if (sx && sy) {
        // Project the pointer onto the original diagonal for smooth proportional resizing.
        const factor = Math.max(Math.max(.1 / w, .1 / h), Math.min(Math.min(10000 / w, 10000 / h),
            1 + (sx * dx * w + sy * dy * h) / (w * w + h * h)));
        width = w * factor; height = h * factor;
    } else {
        if (sx) width = Math.max(.1, Math.min(10000, w + sx * dx));
        if (sy) height = Math.max(.1, Math.min(10000, h + sy * dy));
    }
    return { x: sx < 0 ? x + w - width : x, y: sy < 0 ? y + h - height : y, width, height };
}
