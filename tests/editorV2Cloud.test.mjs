import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRepository } from '../public/editor-v2/cloud.mjs';
import { blankDocument, createObject } from '../public/editor-v2/model.mjs';

// Transaction test double: stages writes and applies them only after a successful callback.
// These tests cover the repository protocol; they do not claim to test deployed Firestore rules.
function fixture() {
    const records = new Map(); let sequence = 0;
    const read = ref => ({ exists: () => records.has(ref.id), data: () => structuredClone(records.get(ref.id)) });
    const sdk = {
        collection: () => ({}), doc: (_, id) => ({ id: id || `project-${++sequence}` }),
        serverTimestamp: () => 'server-time', getDocFromServer: async ref => read(ref),
        runTransaction: async (_, callback) => {
            const writes = [];
            const result = await callback({ get: async ref => read(ref), set: (ref, data) => writes.push([ref, data]) });
            for (const [ref, data] of writes) records.set(ref.id, { ...records.get(ref.id), ...data });
            return result;
        },
    };
    return { records, repository: createProjectRepository(sdk, {}, () => ({ uid: 'test-user' })), sdk };
}
test('cloud save/load round trip and updates preserve project identity and creator', async () => {
    const { repository, records } = fixture();
    const document = blankDocument(); document.objects.push(createObject('rect', 12, 15));
    const binding = await repository.save(document, null);
    assert.equal(binding.revision, 1);
    assert.deepEqual((await repository.load(binding.id)).document, document);
    document.name = 'Corte actualizado';
    const updated = await repository.save(document, binding);
    assert.equal(updated.id, binding.id); assert.equal(updated.revision, 2);
    assert.equal(records.get(binding.id).createdBy, 'test-user');
    assert.equal((await repository.load(binding.id)).document.name, 'Corte actualizado');
    const copy = await repository.save(document, null);
    assert.notEqual(copy.id, binding.id); assert.equal(records.size, 2);
});
test('stale revisions and removed projects cannot overwrite current server data', async () => {
    const { repository, records } = fixture();
    const document = blankDocument(); const binding = await repository.save(document, null);
    await repository.save({ ...document, name: 'Desde otra sesión' }, binding);
    await assert.rejects(repository.save({ ...document, name: 'Obsoleto' }, binding), /otra sesión/);
    assert.equal((await repository.load(binding.id)).document.name, 'Desde otra sesión');
    records.delete(binding.id);
    await assert.rejects(repository.save(document, binding), /otra sesión/);
    assert.equal(records.size, 0);
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
