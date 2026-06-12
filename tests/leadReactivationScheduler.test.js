/**
 * Pruebas de integración del scheduler de reactivación de leads con
 * Firestore y WhatsApp simulados (no toca servicios reales).
 */

process.env.WHATSAPP_TOKEN = 'test-token';
process.env.PHONE_NUMBER_ID = '111222333';

// ---------- Firestore fake en memoria ----------
const store = new Map(); // colección -> Map(id -> data); subcolecciones como `${col}/${id}/${sub}` -> []

function colMap(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
}

function applyOps(target, patch) {
    const out = { ...target };
    for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && v.__inc !== undefined) out[k] = (out[k] || 0) + v.__inc;
        else if (v && typeof v === 'object' && v.__union !== undefined) out[k] = [...(out[k] || []), ...v.__union];
        else out[k] = v;
    }
    return out;
}

function docRef(col, id) {
    return {
        id,
        async get() {
            const data = colMap(col).get(id);
            return { exists: data !== undefined, id, data: () => data };
        },
        async set(data, opts) {
            const prev = colMap(col).get(id) || {};
            colMap(col).set(id, (opts && opts.merge) ? applyOps(prev, data) : applyOps({}, data));
        },
        async update(patch) {
            if (!colMap(col).has(id)) throw new Error('not-found');
            colMap(col).set(id, applyOps(colMap(col).get(id), patch));
        },
        collection(sub) {
            const key = `${col}/${id}/${sub}`;
            if (!store.has(key)) store.set(key, []);
            return {
                async add(doc) {
                    store.get(key).push(doc);
                    return { id: `m${store.get(key).length}` };
                }
            };
        }
    };
}

function query(col, filters) {
    let lim = Infinity;
    const q = {
        where(f, op, v) { filters.push([f, v]); return q; },
        limit(n) { lim = n; return q; },
        async get() {
            const docs = [];
            for (const [id, data] of colMap(col)) {
                if (docs.length >= lim) break;
                if (filters.every(([f, v]) => data[f] === v)) {
                    docs.push({ id, data: () => data, ref: docRef(col, id) });
                }
            }
            return { empty: docs.length === 0, size: docs.length, docs };
        }
    };
    return q;
}

const mockDb = {
    collection(name) {
        return {
            doc: (id) => docRef(name, id),
            where: (f, op, v) => query(name, [[f, v]])
        };
    }
};

const mockAdmin = {
    firestore: {
        Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
        FieldValue: {
            increment: (n) => ({ __inc: n }),
            arrayUnion: (...items) => ({ __union: items }),
            serverTimestamp: () => new Date()
        }
    }
};

jest.mock('../server/config.js', () => ({ db: mockDb, admin: mockAdmin, app: null, bucket: null }));

const mockSend = jest.fn(async (to, { text }) => ({
    id: `wamid.${to}`, textForDb: text, fileUrlForDb: null, fileTypeForDb: null, isFinalCommand: false
}));
jest.mock('../server/services.js', () => ({ sendAdvancedWhatsAppMessage: (...a) => mockSend(...a) }));

const { armLeadFollowup, runLeadReactivationSweep } = require('../server/leads/leadReactivationScheduler');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const WA = '5215512345678';

const followups = () => colMap('lead_followups');
const mensajesEnChat = () => store.get(`contacts_whatsapp/${WA}/messages`) || [];

beforeEach(() => {
    store.clear();
    mockSend.mockClear();
    // Contacto existente en el CRM
    colMap('contacts_whatsapp').set(WA, { wa_id: WA, name: 'Karla López' });
});

test('armLeadFollowup crea el seguimiento pendiente en stage 0', async () => {
    await armLeadFollowup(WA, 'Karla López');
    const doc = followups().get(WA);
    expect(doc.status).toBe('pending');
    expect(doc.stage).toBe(0);
    expect(doc.lastInboundAt.toMillis()).toBeGreaterThan(Date.now() - 5000);
});

test('el sweep espera si aún no pasan los 15 minutos', async () => {
    await armLeadFollowup(WA, 'Karla López');
    const summary = await runLeadReactivationSweep();
    expect(summary.waiting).toBe(1);
    expect(summary.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
});

test('envía el primer seguimiento cuando vence el delay y lo refleja en el chat', async () => {
    followups().set(WA, { waId: WA, status: 'pending', stage: 0, lastInboundAt: Date.now() - 20 * MIN, attempts: 0 });
    const summary = await runLeadReactivationSweep();

    expect(summary.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toBe(WA);
    expect(mockSend.mock.calls[0][1].text).toContain('Karla');

    const doc = followups().get(WA);
    expect(doc.stage).toBe(1);
    expect(doc.status).toBe('pending'); // aún falta el segundo mensaje
    expect(doc.totalSent).toBe(1);

    // El mensaje queda guardado en el chat del CRM
    expect(mensajesEnChat()).toHaveLength(1);
    expect(mensajesEnChat()[0].source).toBe('lead_reactivation');
});

test('envía el segundo seguimiento y marca done', async () => {
    followups().set(WA, { waId: WA, status: 'pending', stage: 1, lastInboundAt: Date.now() - 5 * HOUR, attempts: 0 });
    const summary = await runLeadReactivationSweep();
    expect(summary.sent).toBe(1);
    expect(followups().get(WA).status).toBe('done');
});

test('cancela sin enviar si el cliente registró pedido después de escribir', async () => {
    const inbound = Date.now() - 20 * MIN;
    colMap('contacts_whatsapp').set(WA, { wa_id: WA, name: 'Karla López', lastOrderDate: inbound + 5 * MIN });
    followups().set(WA, { waId: WA, status: 'pending', stage: 0, lastInboundAt: inbound, attempts: 0 });

    const summary = await runLeadReactivationSweep();
    expect(summary.sent).toBe(0);
    expect(summary.finished).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
    const doc = followups().get(WA);
    expect(doc.status).toBe('cancelled');
    expect(doc.cancelReason).toBe('pedido_registrado');
});

test('dryRun reporta lo que enviaría sin enviar ni mutar', async () => {
    followups().set(WA, { waId: WA, status: 'pending', stage: 0, lastInboundAt: Date.now() - 20 * MIN, attempts: 0 });
    const summary = await runLeadReactivationSweep({ dryRun: true });
    expect(summary.wouldSend).toHaveLength(1);
    expect(summary.wouldSend[0].waId).toBe(WA);
    expect(mockSend).not.toHaveBeenCalled();
    expect(followups().get(WA).stage).toBe(0);
});

test('cooldown: no rearma una secuencia recién terminada aunque el cliente escriba', async () => {
    followups().set(WA, { waId: WA, status: 'done', stage: 2, lastInboundAt: Date.now() - 6 * HOUR, lastSentAt: new Date(), totalSent: 2 });
    await armLeadFollowup(WA, 'Karla López');
    expect(followups().get(WA).status).toBe('done'); // no se reinició
});

test('sí rearma cuando el cooldown ya pasó', async () => {
    followups().set(WA, { waId: WA, status: 'done', stage: 2, lastInboundAt: 0, lastSentAt: new Date(Date.now() - 25 * HOUR), totalSent: 2 });
    await armLeadFollowup(WA, 'Karla López');
    const doc = followups().get(WA);
    expect(doc.status).toBe('pending');
    expect(doc.stage).toBe(0);
    expect(doc.totalSent).toBe(2); // conserva el histórico
});

test('un mensaje nuevo del cliente reinicia la secuencia pendiente', async () => {
    followups().set(WA, { waId: WA, status: 'pending', stage: 1, lastInboundAt: Date.now() - 3 * HOUR, attempts: 0 });
    await armLeadFollowup(WA, 'Karla López');
    const doc = followups().get(WA);
    expect(doc.stage).toBe(0);
    expect(doc.lastInboundAt.toMillis()).toBeGreaterThan(Date.now() - 5000);
});

test('las rutas exportan un router de Express', () => {
    const routes = require('../server/leads/leadReactivationRoutes');
    expect(typeof routes).toBe('function');
});
