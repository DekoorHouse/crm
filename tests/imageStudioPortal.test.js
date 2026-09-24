const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../public/imagenes/portal.js'), 'utf8');

function setup({ reduced = false, contextAvailable = true } = {}) {
    const frames = new Map(), events = {}, mediaEvents = {}, windowEvents = {};
    let sequence = 0, intersection;
    const context = Object.fromEntries(['fillRect', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'setTransform'].map(name => [name, jest.fn()]));
    context.createRadialGradient = () => ({ addColorStop() {} });
    const canvas = { getContext: () => contextAvailable ? context : null, isConnected: true };
    const field = { getBoundingClientRect: () => ({ width: 700, height: 390 }) };
    const pauseButton = { textContent: '', addEventListener: (type, callback) => { events[type] = callback; } };
    const pauseStatus = { hidden: true };
    const document = { hidden: false, addEventListener: (type, callback) => { events[type] = callback; } };
    const window = {
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: reduced, addEventListener: (type, callback) => { mediaEvents[type] = callback; } }),
        addEventListener: (type, callback) => { windowEvents[type] = callback; },
    };
    vm.runInNewContext(source, {
        window, document,
        requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        IntersectionObserver: class { constructor(callback) { intersection = callback; } observe() {} },
        ResizeObserver: class { observe() {} },
    });
    const portal = window.createImageStudioPortal({ canvas, field, pauseButton, pauseStatus });
    const advance = now => {
        const pending = [...frames.values()]; frames.clear();
        pending.forEach(callback => callback(now));
    };
    return { portal, frames, context, canvas, document, pauseButton, pauseStatus, advance,
        click: () => events.click(),
        reducedMotion: () => mediaEvents.change({ matches: true }),
        visibility: hidden => { document.hidden = hidden; events.visibilitychange(); },
        intersection: visible => intersection([{ isIntersecting: visible }]),
        page: type => windowEvents[type](),
    };
}

test('el portal comienza con la generación y se mueve sin eventos del puntero', () => {
    const env = setup();
    expect(env.frames.size).toBe(0);
    env.portal.setActive(true);
    env.advance(1000);
    const initial = env.context.moveTo.mock.calls.at(-1);
    env.advance(1100);
    expect(env.context.moveTo.mock.calls.at(-1)).not.toEqual(initial);
    expect(env.frames.size).toBe(1);
    env.portal.setActive(true);
    expect(env.frames.size).toBe(1);
});

test('pausa y reanuda la animación sin terminar el trabajo', () => {
    const env = setup(); env.portal.setActive(true); env.advance(1000);
    env.click();
    expect(env.frames.size).toBe(0);
    expect(env.pauseStatus.hidden).toBe(false);
    expect(env.pauseButton.textContent).toBe('Reanudar animación');
    env.click();
    expect(env.frames.size).toBe(1);
    expect(env.pauseStatus.hidden).toBe(true);
});

test('terminar o fallar cancela el cuadro pendiente y no revive al volver a la pestaña', () => {
    const env = setup(); env.portal.setActive(true);
    env.portal.setActive(false);
    const draws = env.context.fillRect.mock.calls.length;
    env.visibility(true); env.visibility(false); env.intersection(true); env.advance(2000);
    expect(env.frames.size).toBe(0);
    expect(env.context.fillRect).toHaveBeenCalledTimes(draws);
});

test('no dibuja al ocultar la sección, la pestaña o el portal fuera de pantalla', () => {
    const env = setup(); env.portal.setActive(true);
    for (const toggle of [value => env.portal.setVisible(value), value => env.visibility(!value), env.intersection]) {
        toggle(false); expect(env.frames.size).toBe(0);
        toggle(true); expect(env.frames.size).toBe(1);
    }
    env.page('pagehide'); expect(env.frames.size).toBe(0);
    env.page('pageshow'); expect(env.frames.size).toBe(1);
});

test('respeta movimiento reducido y mantiene la pausa al cambiar de sección o trabajo', () => {
    const env = setup({ reduced: true }); env.portal.setActive(true);
    expect(env.frames.size).toBe(0);
    expect(env.pauseStatus.hidden).toBe(false);
    env.click(); expect(env.frames.size).toBe(1);
    env.reducedMotion(); expect(env.frames.size).toBe(0);
    env.portal.setVisible(false); env.portal.setVisible(true);
    env.portal.setActive(false); env.portal.setActive(true);
    expect(env.frames.size).toBe(0);
});

test('sin canvas disponible conserva los estados de generación sin romper la página', () => {
    const env = setup({ contextAvailable: false });
    expect(() => { env.portal.setActive(true); env.portal.setVisible(false); env.portal.setActive(false); }).not.toThrow();
    expect(env.pauseButton.hidden).toBe(true);
    expect(env.frames.size).toBe(0);
});

test('la animación es ligera: 30 cuadros por segundo y sin desenfoque de sombra', () => {
    const env = setup();
    env.portal.setActive(true);
    env.advance(1000);
    const draws = env.context.fillRect.mock.calls.length;
    env.advance(1010);
    expect(env.context.fillRect).toHaveBeenCalledTimes(draws);
    expect(env.frames.size).toBe(1);
    env.advance(1040);
    expect(env.context.fillRect.mock.calls.length).toBeGreaterThan(draws);
    expect(env.context.shadowBlur).toBeUndefined();
});
