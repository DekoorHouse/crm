jest.mock('firebase-admin', () => ({
    auth: jest.fn(), firestore: jest.fn(),
}));
const admin = require('firebase-admin');
const { requireApiUser } = require('../server/apiAuth');
let response, next;
beforeEach(() => {
    response = { status: jest.fn().mockReturnThis(), json: jest.fn() }; next = jest.fn();
    jest.clearAllMocks();
});
test('no deja gastar créditos sin sesión aunque la API general esté en observación', async () => {
    await requireApiUser({ get: () => '', apiAuth: { via: 'log-pass' } }, response, next);
    expect(response.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
});
test('reutiliza la identidad ya validada por la API del CRM', async () => {
    await requireApiUser({ apiAuth: { via: 'token', uid: 'u1' } }, response, next);
    expect(next).toHaveBeenCalled();
});
test('token válido de alguien que no pertenece al CRM sigue rechazado', async () => {
    admin.auth.mockReturnValue({ verifyIdToken: async () => ({ uid: 'outsider', email: 'outsider@example.com' }) });
    admin.firestore.mockReturnValue({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) });
    await requireApiUser({ get: name => name === 'authorization' ? 'Bearer test' : '' }, response, next);
    expect(response.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
});
