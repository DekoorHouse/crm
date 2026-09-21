// Firestore contract used by payment tests: atomic commits, exclusive transactions,
// create conflicts and injected storage failures. No credentials or network.
module.exports = function paymentFirestore() {
    const rows = new Map();
    let serial = Promise.resolve(), fault = null, nextId = 0;
    const copy = v => v && typeof v === 'object' ? (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(copy) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)]))) : v;
    function fail(kind, path) {
        if (fault && fault.kind === kind && path.includes(fault.path)) { const e = fault.error; fault = null; throw e; }
    }
    function snapshot(ref) { return { id: ref.id, ref, exists: rows.has(ref.path), data: () => copy(rows.get(ref.path)) }; }
    function apply(writes) {
        for (const [op, ref] of writes) {
            fail(op, ref.path);
            if (op === 'create' && rows.has(ref.path)) throw Object.assign(new Error('already exists'), { code: 6 });
            if (op === 'update' && !rows.has(ref.path)) throw new Error('not found: ' + ref.path);
        }
        for (const [op, ref, data, opts] of writes) rows.set(ref.path, copy(op === 'update' || opts?.merge ? { ...rows.get(ref.path), ...data } : data));
    }
    function doc(path) {
        const ref = { path, id: path.split('/').pop(), collection: name => query(path + '/' + name), get: async () => { fail('get', path); return snapshot(ref); } };
        for (const op of ['set', 'update', 'create']) ref[op] = async (d, opts) => apply([[op, ref, d, opts]]);
        return ref;
    }
    function query(path, filters = [], sort = null, limit = Infinity) {
        return { doc: (id = 'auto-' + (++nextId)) => doc(path + '/' + id),
            where: (key, op, value) => query(path, [...filters, [key, op, value]], sort, limit),
            orderBy: (key, direction) => query(path, filters, [key, direction], limit),
            limit: n => query(path, filters, sort, n),
            get: async () => {
                fail('get', path);
                let docs = [...rows.keys()].filter(p => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1).map(p => snapshot(doc(p)));
                docs = docs.filter(d => filters.every(([k, op, val]) => op === 'in' ? val.includes(d.data()[k]) : d.data()[k] === val));
                if (sort) docs.sort((a, b) => (Number(a.data()[sort[0]]) - Number(b.data()[sort[0]])) * (sort[1] === 'desc' ? -1 : 1));
                docs = docs.slice(0, limit);
                return { docs, empty: !docs.length, size: docs.length, forEach: f => docs.forEach(f) };
            }
        };
    }
    function writer() {
        const writes = [], w = {};
        for (const op of ['set', 'update', 'create']) w[op] = (ref, d, opts) => { writes.push([op, ref, d, opts]); return w; };
        w.get = ref => { if (writes.length) throw new Error('Firestore requires reads before writes'); return ref.get(); };
        w.commit = async () => { fail('commit', writes.map(x => x[1].path).join(',')); apply(writes); };
        return w;
    }
    return { collection: query, batch: writer,
        runTransaction: fn => {
            const next = serial.then(async () => { const w = writer(); const result = await fn(w); await w.commit(); return result; });
            serial = next.catch(() => {}); return next;
        },
        seed: (path, value) => rows.set(path, copy(value)), read: path => copy(rows.get(path)),
        all: path => [...rows.entries()].filter(([p]) => p.startsWith(path + '/')).map(([p, d]) => ({ path: p, ...copy(d) })),
        reset: () => { rows.clear(); fault = null; serial = Promise.resolve(); },
        failNext: (kind, path, error = new Error('storage unavailable')) => { fault = { kind, path, error }; }
    };
};
