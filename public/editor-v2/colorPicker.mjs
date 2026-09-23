// A small in-page colour picker (saturation/brightness square, hue bar and hex field), so a custom
// colour behaves the same in every browser instead of depending on the native picker.
export function hsvToHex({ h, s, v }) {
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}
export function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export const normalizeHex = value => {
    const hex = value.trim().replace(/^#?/, '#').toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(hex)) return '#' + [...hex.slice(1)].map(c => c + c).join('');
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
};

// onInput runs while the colour changes, onCommit when it is applied and onCancel on Escape.
export function createColorPicker(root, { onInput, onCommit, onCancel }) {
    const square = root.querySelector('.cp-sv'), cursor = root.querySelector('.cp-sv-cursor'), hue = root.querySelector('.cp-hue');
    const hex = root.querySelector('.cp-hex'), before = root.querySelector('.cp-old'), after = root.querySelector('.cp-new');
    let hsv = { h: 0, s: 0, v: 0 }, color = '#000000', anchor = null;
    const paint = (fromField = false) => {
        color = hsvToHex(hsv);
        square.style.backgroundColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
        cursor.style.left = `${hsv.s * 100}%`; cursor.style.top = `${(1 - hsv.v) * 100}%`;
        hue.value = String(Math.round(hsv.h));
        if (!fromField) hex.value = color;
        after.style.backgroundColor = color;
    };
    const change = (fromField = false) => { paint(fromField); onInput(color); };
    const pick = event => {
        const box = square.getBoundingClientRect();
        hsv = { ...hsv, s: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), v: 1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
        change();
    };
    square.addEventListener('pointerdown', event => { event.preventDefault(); square.setPointerCapture(event.pointerId); pick(event); });
    square.addEventListener('pointermove', event => { if (square.hasPointerCapture(event.pointerId)) pick(event); });
    hue.addEventListener('input', () => { hsv = { ...hsv, h: Number(hue.value) }; change(); });
    hex.addEventListener('input', () => { const value = normalizeHex(hex.value); if (value) { hsv = hexToHsv(value); change(true); } });
    const close = () => { root.hidden = true; anchor = null; };
    const commit = () => { if (root.hidden) return; close(); onCommit(color); };
    const cancel = () => { if (root.hidden) return; close(); onCancel(); };
    root.querySelector('.cp-ok').addEventListener('click', commit);
    // Keys stay inside the picker so the editor's shortcuts (Escape deselects, Delete removes) do not fire.
    root.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
    });
    // A click anywhere else applies the colour, like closing the native picker.
    document.addEventListener('pointerdown', event => {
        if (!root.hidden && !root.contains(event.target) && !anchor?.contains(event.target)) commit();
    }, true);
    return {
        get open() { return !root.hidden; },
        show(target, value) {
            anchor = target; hsv = hexToHsv(normalizeHex(value) || '#000000');
            before.style.backgroundColor = normalizeHex(value) || 'transparent';
            root.hidden = false; paint();
            const box = target.getBoundingClientRect(), width = root.offsetWidth, height = root.offsetHeight;
            root.style.left = `${Math.max(8, Math.min(box.right - width, innerWidth - width - 8))}px`;
            root.style.top = `${Math.max(8, box.top - height - 10)}px`;
            hex.focus(); hex.select();
        },
        commit, cancel,
    };
}
