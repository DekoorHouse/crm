// Local SVG icons share one grid, stroke weight and optical size.
const paths = {
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    spline: '<path d="M4 18C4 2 20 22 20 6"/><rect x="2" y="16" width="4" height="4"/><rect x="18" y="4" width="4" height="4"/>',
    select: '<path d="m5 3 14 9-7 1-3 7Z"/>',
    hand: '<path d="M8 13V7a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-2 6-6 6h-1c-2 0-3-1-4-2l-5-6a2 2 0 0 1 3-3l1 2Z"/>',
    rect: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
    ellipse: '<circle cx="12" cy="12" r="8"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M8 20h8"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2M12 17h.01"/>',
    new: '<path d="M14 3H5v18h14V8ZM14 3v5h5M8 14h8M12 10v8"/>',
    open: '<path d="M3 8V5h6l2 3h10l-3 12H3V8h18"/>',
    save: '<path d="M4 3h13l3 3v15H4ZM8 3v6h8V3M8 21v-7h8v7"/>',
    export: '<path d="M12 15V3m-4 4 4-4 4 4M4 14v7h16v-7"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
    redo: '<path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12"/>',
    duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
    delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    'zoom-in': '<path d="M5 12h14M12 5v14"/>',
    'zoom-out': '<path d="M5 12h14"/>',
    fit: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="7" width="8" height="10" rx="1"/>',
    'rotate-left': '<path d="M3 4v5h5"/><path d="M3.6 9A8.5 8.5 0 1 1 6 18"/>',
    'rotate-right': '<path d="M21 4v5h-5"/><path d="M20.4 9A8.5 8.5 0 1 0 18 18"/>',
    backward: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    forward: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    visible: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="m3 3 18 18M10 5c7-1 12 7 12 7a22 22 0 0 1-4 4M6 6a22 22 0 0 0-4 6s4 7 10 7a11 11 0 0 0 4-1M10 10a3 3 0 0 0 4 4"/>',
    locked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    unlocked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7-2M12 14v3"/>',
};

export function icon(name) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.setAttribute('viewBox', '0 0 24 24');
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '1.7');
    element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('stroke-linejoin', 'round');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('focusable', 'false');
    element.classList.add('icon');
    element.innerHTML = paths[name] || paths.rect;
    return element;
}

export function decorateControls() {
    const labels = { new: 'Nuevo', open: 'Abrir', save: 'Guardar proyecto', export: 'Exportar', duplicate: 'Duplicar', delete: 'Eliminar', fit: 'Ajustar página', backward: 'Bajar', forward: 'Subir', 'rotate-left': '90°', 'rotate-right': '90°' };
    document.querySelectorAll('[data-tool], [data-action]').forEach(button => {
        const name = button.dataset.tool || button.dataset.action;
        if (!paths[name]) return;
        button.replaceChildren(icon(name));
        if (labels[name]) {
            const label = document.createElement('span'); label.textContent = labels[name]; button.append(label);
        }
    });
    document.querySelector('.empty-icon').replaceChildren(icon('select'));
}
