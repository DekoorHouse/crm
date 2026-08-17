/**
 * Qué código HTTP recibe Meta cuando el webhook truena — o sea, si el mensaje del cliente se
 * recupera solo o se pierde para siempre.
 *
 * 200 = "recibido, no me lo mandes de nuevo". Si se contesta 200 sobre una falla transitoria, el
 * mensaje se perdió. Es lo que pasó el 16-ago-2026: ~7 horas de mensajes de clientes.
 * 500 = Meta reintenta con backoff. Reintentar es seguro porque el guardado es idempotente
 * (wamid como ID del documento + create()).
 *
 * Es lógica que solo se ejercita el día de la caída, así que sin estas pruebas se puede romper
 * y nadie se entera hasta que vuelve a costar horas de mensajes.
 *
 * Se monta el router REAL con un Firestore simulado y se verifica el status que vería Meta.
 */

// Las fábricas de jest.mock se izan arriba de todo: solo pueden tocar variables cuyo nombre
// empiece con "mock".
const mockEstado = { fallas: [] };

/** Una falla programada: qué operación revienta y con qué error. */
function programarFalla({ tipo = 'any', path = /.*/, error }) {
    mockEstado.fallas.push({ tipo, path, error });
}

function errorFirestore(code, message) {
    const e = new Error(message);
    if (code !== undefined) e.code = code;
    return e;
}

jest.mock('../server/config', () => {
    const snapshotVacio = () => ({
        exists: false,
        data: () => ({}),
        empty: true,
        docs: [],
        size: 0
    });

    // Toda operación pasa por aquí: es el único punto donde se decide si truena.
    const operar = (tipo, path) => {
        const falla = mockEstado.fallas.find(f => (f.tipo === 'any' || f.tipo === tipo) && f.path.test(path));
        if (falla) return Promise.reject(falla.error);
        return Promise.resolve(snapshotVacio());
    };

    const hacerDoc = (path) => ({
        id: path.split('/').pop(),
        path,
        collection: (name) => hacerColeccion(`${path}/${name}`),
        get: () => operar('read', path),
        set: () => operar('write', path),
        update: () => operar('write', path),
        create: () => operar('write', path),
        delete: () => operar('write', path)
    });

    const hacerColeccion = (path) => {
        const consulta = {
            doc: (id = 'auto') => hacerDoc(`${path}/${id}`),
            add: () => operar('write', path).then(() => hacerDoc(`${path}/auto`)),
            where: () => consulta,
            orderBy: () => consulta,
            limit: () => consulta,
            select: () => consulta,
            get: () => operar('read', path)
        };
        return consulta;
    };

    const FieldValue = {
        increment: (n) => ({ __increment: n }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
        delete: () => ({ __delete: true }),
        arrayUnion: (...v) => ({ __arrayUnion: v })
    };
    const Timestamp = {
        fromMillis: (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
        fromDate: (d) => ({ toMillis: () => d.getTime(), toDate: () => d }),
        now: () => Timestamp.fromMillis(Date.now())
    };

    return {
        db: {
            collection: hacerColeccion,
            collectionGroup: hacerColeccion,
            batch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: () => Promise.resolve() })
        },
        admin: { firestore: Object.assign({}, { FieldValue, Timestamp }) },
        bucket: { file: () => ({ download: () => Promise.resolve([Buffer.from('')]) }) },
        app: {}
    };
});

// Nada de red ni de IA: aquí solo importa el status que recibe Meta.
jest.mock('../server/services', () => ({
    handleWholesaleMessage: jest.fn().mockResolvedValue(false),
    checkCoverage: jest.fn().mockResolvedValue(null),
    triggerAutoReplyAI: jest.fn().mockResolvedValue(undefined),
    sendAdvancedWhatsAppMessage: jest.fn().mockResolvedValue({ id: 'wamid.SALIDA', textForDb: 'ok' }),
    sendMessengerMessage: jest.fn().mockResolvedValue({}),
    sendConversionEvent: jest.fn().mockResolvedValue(undefined),
    transcribeIncomingAudioMessage: jest.fn().mockResolvedValue(undefined),
    markOrderCorregirForContact: jest.fn().mockResolvedValue(undefined),
    markOrderFabricarForContact: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../server/leads/leadReactivationScheduler', () => ({ armLeadFollowup: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../server/leads/orderFollowupScheduler', () => ({ armOrderFollowup: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../server/leads/orderFollowupMetrics', () => ({ markOrderFollowupReplied: jest.fn().mockResolvedValue(undefined) }));

const { router, debeReintentar } = require('../server/whatsappHandler');

// --- Arneses ---

/** El handler POST real del router, sin levantar un servidor ni añadir dependencias. */
function handlerDelWebhook() {
    const capa = router.stack.find(l => l.route && l.route.path === '/' && l.route.methods.post);
    if (!capa) throw new Error('No se encontró el POST / del webhook de WhatsApp');
    return capa.route.stack[0].handle;
}

function resFalso() {
    const res = {
        headersSent: false,
        codigo: null,
        sendStatus(c) { res.headersSent = true; res.codigo = c; return res; },
        status(c) { res.codigo = c; return res; },
        json(b) { res.headersSent = true; res.body = b; return res; },
        send(b) { res.headersSent = true; res.body = b; return res; }
    };
    return res;
}

const RUTA_MENSAJES = /^contacts_whatsapp\/[^/]+\/messages/;
const RUTA_CONTACTO = /^contacts_whatsapp\/[^/]+$/;

function payloadTexto(wamid = 'wamid.PRUEBA1') {
    return {
        object: 'whatsapp_business_account',
        entry: [{
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: { phone_number_id: '111' },
                    contacts: [{ profile: { name: 'Cliente Prueba' }, wa_id: '5216181234567' }],
                    messages: [{
                        from: '5216181234567',
                        id: wamid,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: 'text',
                        text: { body: 'hola, quiero una lámpara' }
                    }]
                }
            }]
        }]
    };
}

/** Corre el webhook con las fallas ya programadas y devuelve el status que recibiría Meta. */
async function statusQueRecibeMeta(payload = payloadTexto()) {
    const res = resFalso();
    await handlerDelWebhook()({ body: payload }, res);
    return res.codigo;
}

beforeEach(() => {
    mockEstado.fallas = [];
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// =====================================================================
// 1. Clasificación: qué error merece reintento
// =====================================================================
describe('debeReintentar — el default es NO perder el mensaje', () => {
    const reintentables = [
        ['8 RESOURCE_EXHAUSTED (sin cuota — la caída del 16-ago)', errorFirestore(8, 'Quota exceeded')],
        ['14 UNAVAILABLE (Firestore caído)', errorFirestore(14, 'The service is currently unavailable')],
        ['4 DEADLINE_EXCEEDED', errorFirestore(4, 'Deadline exceeded')],
        ['13 INTERNAL', errorFirestore(13, 'Internal error')],
        ['10 ABORTED', errorFirestore(10, 'Aborted due to contention')],
        ['7 PERMISSION_DENIED (proyecto suspendido por facturación)', errorFirestore(7, 'The caller does not have permission')],
        ['9 FAILED_PRECONDITION (falta el índice: se crea y entran solos)', errorFirestore(9, 'The query requires an index')],
        ['ECONNRESET sin código', errorFirestore(undefined, 'read ECONNRESET')],
        ['EAI_AGAIN sin código', errorFirestore(undefined, 'getaddrinfo EAI_AGAIN firestore.googleapis.com')],
        ['error de código nuestro (TypeError)', new TypeError("Cannot read properties of undefined (reading 'body')")],
        ['axios 503 hacia otro servicio', errorFirestore(undefined, 'Request failed with status code 503')]
    ];
    test.each(reintentables)('reintenta: %s', (_, err) => {
        expect(debeReintentar(err)).toBe(true);
    });

    const permanentes = [
        ['3 INVALID_ARGUMENT (el dato nunca va a servir)', errorFirestore(3, 'Invalid argument')],
        ['5 NOT_FOUND (el documento destino no existe)', errorFirestore(5, 'No document to update')],
        ['6 ALREADY_EXISTS (ya se procesó)', errorFirestore(6, 'Document already exists')],
        ['texto INVALID_ARGUMENT sin código', errorFirestore(undefined, 'INVALID_ARGUMENT: nombre de campo inválido')]
    ];
    test.each(permanentes)('NO reintenta: %s', (_, err) => {
        expect(debeReintentar(err)).toBe(false);
    });

    test('sin error no hay nada que reintentar', () => {
        expect(debeReintentar(null)).toBe(false);
        expect(debeReintentar(undefined)).toBe(false);
    });

    test('la lista de permanentes es corta a propósito: lo desconocido se reintenta', () => {
        // Un código gRPC que nadie contempló (16 UNAUTHENTICATED: token vencido, se renueva solo)
        // tiene que caer del lado seguro. Si algún día se invierte esto, aquí truena.
        expect(debeReintentar(errorFirestore(16, 'Request had invalid authentication credentials'))).toBe(true);
    });
});

// =====================================================================
// 2. De punta a punta: el status que Meta realmente recibe
// =====================================================================
describe('webhook de WhatsApp — status hacia Meta', () => {
    test('sin cuota de lecturas → 500 (Meta reintenta)', async () => {
        programarFalla({ tipo: 'read', path: RUTA_MENSAJES, error: errorFirestore(8, 'Quota exceeded') });
        expect(await statusQueRecibeMeta()).toBe(500);
    });

    test('proyecto suspendido por facturación (PERMISSION_DENIED) → 500', async () => {
        // La regresión que motivó invertir el clasificador: con la lista blanca anterior el
        // código 7 caía en "lógica" y se contestaba 200, o sea se perdía el mensaje.
        programarFalla({ tipo: 'read', path: RUTA_MENSAJES, error: errorFirestore(7, 'The caller does not have permission') });
        expect(await statusQueRecibeMeta()).toBe(500);
    });

    test('Firestore caído (UNAVAILABLE) → 500', async () => {
        programarFalla({ tipo: 'read', path: RUTA_MENSAJES, error: errorFirestore(14, 'The service is currently unavailable') });
        expect(await statusQueRecibeMeta()).toBe(500);
    });

    test('error de red sin código → 500', async () => {
        programarFalla({ tipo: 'read', path: RUTA_MENSAJES, error: errorFirestore(undefined, 'read ECONNRESET') });
        expect(await statusQueRecibeMeta()).toBe(500);
    });

    test('falla al ESCRIBIR (cuota de escrituras agotada) → 500', async () => {
        programarFalla({ tipo: 'write', path: RUTA_MENSAJES, error: errorFirestore(8, 'Quota exceeded') });
        expect(await statusQueRecibeMeta()).toBe(500);
    });

    test('error permanente de payload (INVALID_ARGUMENT) → 200 (reintentar no sirve)', async () => {
        programarFalla({ tipo: 'write', path: RUTA_MENSAJES, error: errorFirestore(3, 'Invalid argument: campo inválido') });
        expect(await statusQueRecibeMeta()).toBe(200);
    });

    test('reintento de Meta sobre un mensaje ya guardado (ALREADY_EXISTS) → 200, sin duplicar', async () => {
        programarFalla({ tipo: 'write', path: RUTA_MENSAJES, error: errorFirestore(6, 'Document already exists') });
        expect(await statusQueRecibeMeta()).toBe(200);
    });

    test('caso feliz → 200', async () => {
        expect(await statusQueRecibeMeta()).toBe(200);
        // Que dé 200 no basta: el `finally` también responde 200 cuando algo se rompió y se
        // clasificó mal. Esto confirma que de verdad recorrió el flujo (contacto nuevo →
        // bienvenida) en vez de haber tronado calladito a la mitad.
        expect(require('../server/services').sendAdvancedWhatsAppMessage).toHaveBeenCalled();
    });

    test('payload irreconocible → 200 (no tiene caso reintentarlo)', async () => {
        expect(await statusQueRecibeMeta({ entry: [{ changes: [{ value: {} }] }] })).toBe(200);
    });

    // Hueco conocido y documentado a propósito: si el mensaje YA se guardó y truena algo de
    // después, se pide reintento, pero ese reintento choca con el chequeo de duplicados y
    // contesta 200 sin reprocesar. El mensaje queda en el chat SIN respuesta de la IA.
    // Quien lo atrapa es el barrido de server/monitoring/mensajesSinAtender.js.
    test('falla DESPUÉS de guardar → 500 (y el barrido de sin-atender cubre el resto)', async () => {
        programarFalla({ tipo: 'read', path: RUTA_CONTACTO, error: errorFirestore(14, 'The service is currently unavailable') });
        expect(await statusQueRecibeMeta()).toBe(500);
    });
});
