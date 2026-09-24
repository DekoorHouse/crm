/**
 * Cobertura por C.P. (server/envios/coberturaCheck.js): detección del C.P. en el lote de mensajes,
 * regla DHL <= umbral, veredicto guardado + override humano, candados de /ttt y /registrar, y cruce
 * del C.P. del formulario con SEPOMEX. Casos tomados de la auditoría del 22-sep-2026.
 */
const cob = require('../server/envios/coberturaCheck');

const t1Result = (servicios) => ({ result: servicios.map(([clave, svc]) => ({ clave, cotizacion: { servicios: svc } })) });
const ZONA_NORMAL = t1Result([
    ['DHL', { 'EXPRESS DOMESTIC': { servicio: 'EXPRESS DOMESTIC', costo_total: 119.68, dias_entrega: 1 }, 'ECONOMY SELECT DOMESTIC': { servicio: 'ECONOMY SELECT DOMESTIC', costo_total: 119.68 } }],
    ['FEDEX', { STANDARD_OVERNIGHT: { servicio: 'STANDARD_OVERNIGHT', costo_total: 151.35 } }],
    ['EXPRESS', { 'STD-T': { servicio: 'STD-T', costo_total: 188.19 } }],
]);
const ZONA_EXTENDIDA = t1Result([
    ['DHL', { 'EXPRESS DOMESTIC': { servicio: 'EXPRESS DOMESTIC', costo_total: 414.67 } }],
    ['FEDEX', { FEDEX_EXPRESS_SAVER: { servicio: 'FEDEX_EXPRESS_SAVER', costo_total: 177.28 } }],
]);

describe('extraerCps', () => {
    test('encuentra códigos de 5 dígitos sueltos y no montos ni teléfonos', () => {
        expect(cob.extraerCps('El codigo es 48150')).toEqual(['48150']);
        expect(cob.extraerCps('Codigo postal 39200')).toEqual(['39200']);
        expect(cob.extraerCps('son $12000 y mi tel 6181234567')).toEqual([]);
        expect(cob.extraerCps('79032 o 79932')).toEqual(['79032', '79932']);
    });
});

describe('ultimoCpDelLote', () => {
    const msg = (from, text, t, extra = {}) => ({ from, text, timestamp: t, status: from === 'c1' ? 'received' : 'sent', ...extra });
    test('caso DH16016: el C.P. y la ciudad llegan en DOS mensajes; el turno arranca con la ciudad', () => {
        const desc = [msg('c1', 'Puerto peñasco sonora', 3), msg('c1', '83554', 2), msg('biz', '¿Cuál es tu código postal?', 1)];
        expect(cob.ultimoCpDelLote(desc, 'c1')).toMatchObject({ cp: '83554' });
    });
    test('no cruza nuestra última respuesta (el C.P. viejo ya fue atendido)', () => {
        const desc = [msg('c1', 'Es Emiliano Zapata Tabasco', 4), msg('biz', 'Lamento informarte que no tenemos cobertura...', 3), msg('c1', '86985', 2)];
        expect(cob.ultimoCpDelLote(desc, 'c1')).toBeNull();
    });
    test('con varios C.P. en el lote gana el más reciente; con "cp" explícito gana ese', () => {
        expect(cob.ultimoCpDelLote([msg('c1', '79932', 2), msg('c1', '79032', 1)], 'c1')).toMatchObject({ cp: '79932' });
        expect(cob.ultimoCpDelLote([msg('c1', 'pedido 16121, mi cp es 34000', 1)], 'c1')).toMatchObject({ cp: '34000' });
    });
    test('ignora mensajes programados', () => {
        expect(cob.ultimoCpDelLote([msg('biz', 'recordatorio', 5, { status: 'scheduled' }), msg('c1', '34000', 4)], 'c1')).toMatchObject({ cp: '34000' });
    });
});

describe('evaluarCotizacionT1 (solo DHL decide, umbral $200)', () => {
    test('zona normal: DHL $119.68 -> servible', () => {
        const r = cob.evaluarCotizacionT1(ZONA_NORMAL, 200);
        expect(r.verdict).toBe('servible');
        expect(r.dhl).toBe(119.68);
        expect(r.fedex).toBe(151.35);
    });
    test('zona extendida: DHL $414 aunque FedEx sea $177 -> reexpedicion', () => {
        const r = cob.evaluarCotizacionT1(ZONA_EXTENDIDA, 200);
        expect(r.verdict).toBe('reexpedicion');
        expect(r.fedex).toBe(177.28);
    });
    test('sin tarifas', () => {
        expect(cob.evaluarCotizacionT1({ result: [] }).verdict).toBe('sin_tarifas');
        expect(cob.evaluarCotizacionT1(null).verdict).toBe('sin_tarifas');
    });
    test('"domestic" no cuenta como DHL si la clave es otra', () => {
        const q = t1Result([['ESTAFETA', { X: { servicio: 'DOMESTIC ECO', costo_total: 90 } }]]);
        expect(cob.evaluarCotizacionT1(q, 200).verdict).toBe('reexpedicion');
    });
});

describe('cotizarCp', () => {
    test('T1 caído -> verdict error (la IA no confirma cobertura)', async () => {
        const r = await cob.cotizarCp('34000', { t1: { cotizar: async () => { throw new Error('timeout'); } } });
        expect(r.verdict).toBe('error');
        expect(r.error).toMatch(/timeout/);
    });
    test('Flor Monsivais 98095: C.P. que no existe -> se le pide revisarlo, no se escala al equipo', async () => {
        const noExiste = { getByCp: () => null };
        const r = await cob.cotizarCp('98095', { t1: { cotizar: async () => { throw new Error('400'); } }, sepomex: noExiste });
        expect(r.verdict).toBe('cp_inexistente');
        const nota = cob.notaCobertura(r);
        expect(nota).toMatch(/NO EXISTE/);
        expect(nota).toMatch(/NO escribas \/equipo/);
        expect(cob.decidirGuardTtt(r)).toMatchObject({ ok: false, escalar: false, motivo: 'cp_inexistente' });
        expect(cob.bloqueaRegistro(r)).toBe(true);
        const sinTarifas = await cob.cotizarCp('98095', { t1: { cotizar: async () => ({ result: [] }) }, sepomex: noExiste });
        expect(sinTarifas.verdict).toBe('cp_inexistente');
    });
    test('SEPOMEX no pisa a T1: un C.P. fuera del catálogo que T1 sí cotiza sigue normal, y una caída con C.P. real sigue siendo error', async () => {
        const t1 = { cotizar: async () => ({ result: [{ clave: 'DHL', cotizacion: { servicios: { x: { servicio: 'DHL', costo_total: 120 } } } }] }) };
        expect((await cob.cotizarCp('98095', { t1, sepomex: { getByCp: () => null } })).verdict).toBe('servible');
        expect((await cob.cotizarCp('34000', { t1: { cotizar: async () => { throw new Error('timeout'); } }, sepomex: { getByCp: () => ({}) } })).verdict).toBe('error');
    });
    test('C.P. inválido no llama a T1', async () => {
        const r = await cob.cotizarCp('abc', { t1: { cotizar: async () => { throw new Error('no debía llamar'); } } });
        expect(r.verdict).toBe('error');
        expect(r.error).toBe('cp_invalido');
    });
});

describe('veredictoVigente y candados', () => {
    const now = Date.parse('2026-09-22T12:00:00Z');
    const cov = (extra) => ({ coverage: { cp: '86270', verdict: 'reexpedicion', dhl: 414.67, at: now - 3600e3, source: 'ia', ...extra } });
    test('sin veredicto guardado -> null -> /ttt pide el C.P.', () => {
        expect(cob.veredictoVigente({}, [], 'c1', now)).toBeNull();
        const d = cob.decidirGuardTtt(null);
        expect(d.ok).toBe(false);
        expect(d.motivo).toBe('sin_cp');
        expect(d.texto).toMatch(/código postal/);
    });
    test('negativo guardado -> /ttt se sustituye y escala; /registrar se bloquea', () => {
        const v = cob.veredictoVigente(cov(), [], 'c1', now);
        expect(v.verdict).toBe('reexpedicion');
        const d = cob.decidirGuardTtt(v);
        expect(d.ok).toBe(false);
        expect(d.escalar).toBe(true);
        expect(cob.bloqueaRegistro(v)).toBe(true);
    });
    test('un humano mandó el atajo /ttt después del veredicto -> override servible, nada se bloquea', () => {
        const desc = [{ from: 'biz', isAutoReply: false, text: '¡Excelente! 🎉 ✅ *¡Ya hemos enviado varias veces a tu zona!*', timestamp: now - 600e3 }];
        const v = cob.veredictoVigente(cov(), desc, 'c1', now);
        expect(v).toMatchObject({ verdict: 'servible', source: 'humano' });
        expect(cob.decidirGuardTtt(v).ok).toBe(true);
        expect(cob.bloqueaRegistro(v)).toBe(false);
    });
    test('el mismo texto mandado por la IA (isAutoReply) NO es override', () => {
        const desc = [{ from: 'biz', isAutoReply: true, text: '¡Ya hemos enviado varias veces a tu zona!', timestamp: now - 600e3 }];
        expect(cob.veredictoVigente(cov(), desc, 'c1', now).verdict).toBe('reexpedicion');
    });
    test('servible pero caduco (>45 días) -> /ttt vuelve a pedir el C.P.; no bloquea registro', () => {
        const v = cob.veredictoVigente(cov({ verdict: 'servible', dhl: 120, at: now - 50 * 864e5 }), [], 'c1', now);
        expect(v.stale).toBe(true);
        expect(cob.decidirGuardTtt(v).motivo).toBe('cp_viejo');
        expect(cob.bloqueaRegistro(v)).toBe(false);
    });
    test('servible vigente -> /ttt pasa', () => {
        const v = cob.veredictoVigente(cov({ verdict: 'servible', dhl: 120 }), [], 'c1', now);
        expect(cob.decidirGuardTtt(v).ok).toBe(true);
    });
});

describe('notaCobertura', () => {
    test('servible de este turno manda /ttt + /qqq; recordatorio no repite el flujo', () => {
        const check = { cp: '34000', verdict: 'servible', dhl: 119.68, ops: [{ paq: 'DHL', serv: 'EXPRESS DOMESTIC', costo: 119.68 }], umbral: 200 };
        expect(cob.notaCobertura(check)).toMatch(/\/ttt/);
        expect(cob.notaCobertura({ ...check, at: Date.now() - 60e3 }, { recordatorio: true })).toMatch(/último C\.P\. verificado/i);
    });
    test('reexpedición: /lamento y regla de insistencia; recordatorio prohíbe /ttt y registrar', () => {
        const check = { cp: '86270', verdict: 'reexpedicion', dhl: 414.67, ops: [], umbral: 200 };
        const n = cob.notaCobertura(check);
        expect(n).toMatch(/\/lamento/);
        expect(n).toMatch(/no existe/i);          // "ocurre" no existe
        expect(cob.notaCobertura({ ...check, at: Date.now() - 3600e3 }, { recordatorio: true })).toMatch(/no registres el pedido/i);
    });
    test('error de T1: no confirmar, /equipo', () => {
        expect(cob.notaCobertura({ cp: '34000', verdict: 'error', error: 'timeout' })).toMatch(/\/equipo/);
    });
});

describe('validarCpSepomex + flags del formulario', () => {
    const svc = { getByCp: (cp) => ({ '47980': { estado: 'Jalisco', municipio: 'Degollado', ciudad: '' }, '48980': { estado: 'Jalisco', municipio: 'Cihuatlán', ciudad: 'Cihuatlán' }, '09208': { estado: 'Ciudad de México', municipio: 'Iztapalapa', ciudad: 'Ciudad de México' }, '56644': { estado: 'México', municipio: 'Chalco', ciudad: 'Chalco de Díaz Covarrubias' }, '87033': { estado: 'Tamaulipas', municipio: 'Victoria', ciudad: 'Ciudad Victoria' } }[cp] || null) };
    test('DH16320: 47980 no corresponde a "Cihuatlan, Jalisco" (error de dedo)', () => {
        const r = cob.validarCpSepomex('47980', 'Cihuatlan', 'Jalisco', svc);
        expect(r).toMatchObject({ existe: true, coincideEstado: true, coincideCiudad: false });
        expect(cob.flagsFormulario({ sepomex: r, cotizacion: { verdict: 'reexpedicion' }, cpChat: '48980', cp: '47980' })).toEqual(['cp_no_coincide_ciudad', 'reexpedicion', 'distinto_al_chat']);
    });
    test('el C.P. correcto coincide', () => {
        expect(cob.validarCpSepomex('48980', 'Cihuatlán', 'Jalisco', svc)).toMatchObject({ coincideEstado: true, coincideCiudad: true });
    });
    test('Ciudad de Mexico sin acento y Estado de México vs México', () => {
        expect(cob.validarCpSepomex('09208', 'Ciudad de Mexico', 'Ciudad de Mexico', svc)).toMatchObject({ coincideEstado: true, coincideCiudad: true });
        expect(cob.validarCpSepomex('56644', 'Chalco.mex', 'Estado de México', svc)).toMatchObject({ coincideEstado: true, coincideCiudad: true });
        expect(cob.validarCpSepomex('56644', 'Chalco', 'Ciudad de Mexico', svc).coincideEstado).toBe(false);
    });
    test('"Cd. Victoria" coincide con Victoria; C.P. inexistente se marca', () => {
        expect(cob.validarCpSepomex('87033', 'Cd. Victoria', 'Tamaulipas', svc).coincideCiudad).toBe(true);
        expect(cob.validarCpSepomex('83033', 'Victoria', 'Tamaulipas', svc).existe).toBe(false);
        expect(cob.flagsFormulario({ sepomex: cob.validarCpSepomex('83033', 'Victoria', 'Tamaulipas', svc), cotizacion: { verdict: 'sin_tarifas' }, cpChat: '87033', cp: '83033' })).toEqual(['cp_inexistente', 'sin_tarifas', 'distinto_al_chat']);
    });
    test('formulario distinto pero servible: solo bandera informativa', () => {
        const r = cob.validarCpSepomex('09208', 'Iztapalapa', 'CDMX', svc);
        expect(cob.flagsFormulario({ sepomex: r, cotizacion: { verdict: 'servible' }, cpChat: '09240', cp: '09208' })).toEqual(['distinto_al_chat']);
    });
});
