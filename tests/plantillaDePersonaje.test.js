'use strict';
const { plantillaDePersonaje } = require('../server/design/svgAuto');

describe('plantillaDePersonaje', () => {
    test('el T-Rex de cuerpo completo usa la plantilla rex', () => {
        for (const p of ['T-Rex', 'dinosaurio', 'Dinosaurio T-Rex', 'Tiranosaurio']) {
            expect(plantillaDePersonaje(p)).toBe('rex');
        }
    });

    test('los dinos con otro diseño no se cortan con la plantilla del T-Rex', () => {
        for (const p of ['Dino premium', 'T-Rex rompiendo pared', 'Dino cuello largo', 'dinosaurio bebé']) {
            expect(plantillaDePersonaje(p)).toBeNull();
        }
    });

    test('Spiderman sigue con su plantilla', () => {
        expect(plantillaDePersonaje('Spiderman')).toBe('spiderman');
    });
});

describe('plantillaDePersonaje mira también el producto (DH18052)', () => {
    test('Dino premium con "Personaje: Dinosaurio T-Rex" no usa la plantilla del T-Rex normal', () => {
        expect(plantillaDePersonaje('Dinosaurio T-Rex', 'Lámpara infantil Dino premium')).toBeNull();
        expect(plantillaDePersonaje('T-Rex', 'Lámpara infantil T-Rex rompiendo pared')).toBeNull();
    });
    test('el T-Rex normal sigue cortándose', () => {
        expect(plantillaDePersonaje('T-Rex', 'Lámpara infantil T-Rex')).toBe('rex');
        expect(plantillaDePersonaje('dinosaurio', 'Lámpara infantil dinosaurio')).toBe('rex');
    });
});

describe('reenvío solo de accesorios no invalida el corte (DH17957)', () => {
    const { invalidaMarcasAnteriores } = require('../server/design/svgAuto');
    const ts = ms => ({ toMillis: () => ms });
    test('reenvío normal invalida, reenvío solo de accesorios no', () => {
        expect(invalidaMarcasAnteriores({ reenvioAt: ts(1000) })).toBe(1000);
        expect(invalidaMarcasAnteriores({ reenvioAt: ts(1000), reenvioSoloAccesorios: true })).toBe(0);
        expect(invalidaMarcasAnteriores({ reenvioAt: ts(1000), reenvioSoloAccesorios: true, datoCorregidoAt: ts(500) })).toBe(500);
    });
});

describe('"Diferentes dinosaurios" va a diseño manual (DH18284)', () => {
    const { personajeEligibility } = require('../server/design/svgAuto');
    test('Especial con modelos diferentes no se corta con la plantilla', () => {
        const r = personajeEligibility({ items: [{ producto: 'Lámpara infantil dinosaurio', cantidad: 1, datosProducto: 'Nombre: DOMINICK | Personaje: Dinosaurio | Especial: Diferentes dinosaurios' }] }, []);
        expect(r.eligible).toBe(false);
        expect(r.manuales[0].motivo).toBe('especial');
    });
});
