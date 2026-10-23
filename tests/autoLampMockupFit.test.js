// Diseño IA (Beta), diseños que salen de un MOCKUP: el aro del acrílico se quita, pero el contorno de un dibujo
// redondo (un balón) no; y el diseño se acomoda del tamaño en que se ve en el mockup (DH18309).
jest.mock('../server/config', () => ({ db: {}, bucket: {}, admin: { firestore: { FieldValue: {} } } }));
jest.mock('../server/imagenes/imageStudioService', () => ({}));

jest.setTimeout(300000);   // acomodar en el lienzo de 2000 px tarda varios segundos

const sharp = require('sharp');
const { removeRing, fitToLampCircle } = require('../server/design/autoLamp/autoLampService');

const SIZE = 1000;
// Lienzo blanco con tinta (negro = se graba) donde `ink(x, y)` diga.
const draw = ink => {
    const px = Buffer.alloc(SIZE * SIZE, 255);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (ink(x, y)) px[y * SIZE + x] = 0;
    return sharp(px, { raw: { width: SIZE, height: SIZE, channels: 1 } }).png().toBuffer();
};
const ring = (x, y, cx, cy, r, width) => { const d = Math.hypot(x - cx, y - cy); return d <= r && d >= r - width; };
// Un "balón": su contorno, costuras que llegan al contorno y un pentágono (aquí un disco) relleno.
const ball = (x, y, cx, cy, r) => ring(x, y, cx, cy, r, 6)
    || (Math.hypot(x - cx, y - cy) < r && (Math.abs(x - cx) < 3 || Math.abs(y - cy) < 3))
    || Math.hypot(x - cx, y - cy) < r * .3;
const inkBox = async buffer => {
    const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, x1 = -1, y0 = info.height, y1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

test('el contorno de un balón con el nombre colgando abajo NO se borra', async () => {
    const input = await draw((x, y) => ball(x, y, 500, 430, 380) || (x > 330 && x < 670 && y > 760 && y < 880));
    expect(await removeRing(input)).toBe(input);
});

test('el aro delgado del acrílico, con el dibujo adentro y nada afuera, SÍ se borra', async () => {
    const input = await draw((x, y) => ring(x, y, 500, 500, 460, 5) || Math.hypot(x - 500, y - 480) < 220);
    const out = await removeRing(input);
    expect(out).not.toBe(input);
    const box = await inkBox(out);
    expect(box.w).toBeLessThan(460);   // solo queda el disco de adentro (440 px)
});

test('un balón que llena el círculo no se borra si en el mockup el diseño ocupaba menos', async () => {
    const input = await draw((x, y) => ball(x, y, 500, 500, 460) || (Math.hypot(x - 500, y - 500) < 450 && Math.abs(x - 500) < 40));
    expect(await removeRing(input, { designShare: .7 })).toBe(input);
});

test('con las medidas del mockup el diseño va de ese tamaño, no lo más grande posible', async () => {
    const input = await draw((x, y) => Math.hypot(x - 500, y - 500) < 200);
    const side = 2000, R = .481 * side;
    const sized = await inkBox(await fitToLampCircle(input, side, { mockup: { w: .5, h: .5, cx: 0, cy: 0 } }));
    expect(Math.abs(sized.w - .5 * 2 * R)).toBeLessThan(20);
    const biggest = await inkBox(await fitToLampCircle(input, side));
    expect(biggest.w).toBeGreaterThan(sized.w * 1.5);
});

test('si del tamaño del mockup no cabe entero, se achica (nunca se corta)', async () => {
    const input = await draw((x, y) => x > 100 && x < 900 && y > 300 && y < 700);
    const side = 2000;
    const box = await inkBox(await fitToLampCircle(input, side, { mockup: { w: 1, h: .5, cx: 0, cy: 0 } }));
    const R = .481 * side, cx = side / 2, cy = .481 * side;
    // Las cuatro esquinas del rectángulo quedan dentro del círculo de corte.
    for (const [x, y] of [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]]) expect(Math.hypot(x - cx, y - cy)).toBeLessThan(R);
});

test('el nombre va en los mismos renglones que en el mockup (DH18387)', () => {
    const { linesFromMockup } = require('../server/design/autoLamp/autoLampService');
    const layouts = [['Sofía'], ['José', 'Andrés']];
    expect(linesFromMockup(layouts, 'Jose  andres')).toEqual(['José', 'Andrés']);
    expect(linesFromMockup(layouts, 'José Luis')).toBeNull();          // otro nombre: no se toca
    expect(linesFromMockup([['José Andrés']], 'José Andrés')).toBeNull();   // en el mockup iba en un renglón
});
