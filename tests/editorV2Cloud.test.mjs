import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRepository, VERSION_INTERVAL, MAX_VERSIONS } from '../public/editor-v2/cloud.mjs';
import { blankDocument, createObject } from '../public/editor-v2/model.mjs';

// Transaction test double: stages writes and applies them only after a successful callback. Records are
// keyed by path, so a project's versions live beside it.
// These tests cover the repository protocol; they do not claim to test deployed Firestore rules.
function fixture() {
    const records = new Map(); let sequence = 0;
    const read = ref => ({ exists: () => records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
    const sdk = {
        collection: (parent, name) => ({ path: parent?.path ? `${parent.path}/${name}` : name }),
        doc: (collection, id) => { const docId = id || `doc-${++sequence}`; return { id: docId, path: `${collection.path}/${docId}` }; },
        serverTimestamp: () => 'server-time', getDocFromServer: async ref => read(ref),
        runTransaction: async (_, callback) => {
            const writes = [];
            const result = await callback({ get: async ref => read(ref), set: (ref, data) => writes.push([ref, data]), delete: ref => writes.push([ref, null]) });
            for (const [ref, data] of writes) { if (data) records.set(ref.path, { ...records.get(ref.path), ...data }); else records.delete(ref.path); }
            return result;
        },
    };
    const project = id => records.get(`editor_v2_projects/${id}`);
    const projectCount = () => [...records.keys()].filter(path => !path.includes('/versions/')).length;
    return { records, project, projectCount, repository: createProjectRepository(sdk, {}, () => ({ uid: 'test-user' })), sdk };
}
test('cloud save/load round trip and updates preserve project identity and creator', async () => {
    const { repository, project, projectCount } = fixture();
    const document = blankDocument(); document.objects.push(createObject('rect', 12, 15));
    const binding = await repository.save(document, null);
    assert.equal(binding.revision, 1);
    assert.deepEqual((await repository.load(binding.id)).document, document);
    document.name = 'Corte actualizado';
    const updated = await repository.save(document, binding);
    assert.equal(updated.id, binding.id); assert.equal(updated.revision, 2);
    assert.equal(project(binding.id).createdBy, 'test-user');
    assert.equal((await repository.load(binding.id)).document.name, 'Corte actualizado');
    const copy = await repository.save(document, null);
    assert.notEqual(copy.id, binding.id); assert.equal(projectCount(), 2);
});
test('stale revisions and removed projects cannot overwrite current server data', async () => {
    const { repository, records, projectCount } = fixture();
    const document = blankDocument(); const binding = await repository.save(document, null);
    await repository.save({ ...document, name: 'Desde otra sesión' }, binding);
    await assert.rejects(repository.save({ ...document, name: 'Obsoleto' }, binding), error => error.code === 'editor/conflict' && /otra sesión/.test(error.message));
    assert.equal((await repository.load(binding.id)).document.name, 'Desde otra sesión');
    records.delete(`editor_v2_projects/${binding.id}`);
    await assert.rejects(repository.save(document, binding), /otra sesión/);
    assert.equal(projectCount(), 0);
});
test('reject invalid/oversized documents and require a session before writes', async () => {
    const { repository, records, sdk } = fixture();
    await assert.rejects(repository.save({ ...blankDocument(), width: -1 }, null));
    const oversized = blankDocument();
    for (let i = 0; i < 100; i++) { const object = createObject('text', 0, 0); object.text = 'á'.repeat(10000); oversized.objects.push(object); }
    await assert.rejects(repository.save(oversized, null), /tamaño/);
    const signedOut = createProjectRepository(sdk, {}, () => null);
    await assert.rejects(signedOut.save(blankDocument(), null), /Inicia sesión/);
    await assert.rejects(signedOut.load('project-1'), /Inicia sesión/);
    assert.equal(records.size, 0);
});
test('a version is kept at most every ten minutes, the newest thirty, and each can be opened', async () => {
    const { repository, records } = fixture();
    const document = blankDocument(), start = 1_000_000;
    let binding = await repository.save({ ...document, name: 'v0' }, null, start);
    // Saves within ten minutes only update the design.
    binding = await repository.save({ ...document, name: 'v0b' }, binding, start + VERSION_INTERVAL - 1);
    assert.equal((await repository.versions(binding.id)).length, 1);
    for (let i = 1; i <= MAX_VERSIONS + 2; i++) binding = await repository.save({ ...document, name: `v${i}` }, binding, start + i * VERSION_INTERVAL);
    const versions = await repository.versions(binding.id);
    assert.equal(versions.length, MAX_VERSIONS);
    assert.equal([...records.keys()].filter(path => path.includes('/versions/')).length, MAX_VERSIONS);
    assert.ok(versions[0].savedAt > versions[1].savedAt);
    assert.equal((await repository.loadVersion(binding.id, versions[0].id)).name, `v${MAX_VERSIONS + 2}`);
    assert.equal((await repository.loadVersion(binding.id, versions.at(-1).id)).name, 'v3');
    await assert.rejects(repository.loadVersion(binding.id, 'missing'), /ya no existe/);
});
