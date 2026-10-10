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
