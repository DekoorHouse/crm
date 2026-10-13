/**
 * Gasto por campaña/anuncio del desglose (server/meta/campaignSpendCache.js): reintento ante un 5xx
 * de Meta, respaldo por campaña y último dato bueno (13-oct-2026: un 503 dejó las tarjetas sin costo).
 */
const mockAds = jest.fn();
const mockCamps = jest.fn();
jest.mock('../server/meta/metaAdsService', () => ({
    getAdSpendForAccounts: (...a) => mockAds(...a),
    getCampaignSpendForAccounts: (...a) => mockCamps(...a),
}));
const { gastoPorCampana, limpiarCache } = require('../server/meta/campaignSpendCache');

const ok = { ads: [{ accountId: '1', adId: 'a1', campaignId: 'c1', spend: 100 }, { accountId: '1', adId: 'a2', campaignId: 'c1', spend: 50 }], errors: [] };
const falla = { ads: [], errors: [{ accountId: '1', error: 'Request failed with status code 503' }] };

beforeEach(() => { limpiarCache(); mockAds.mockReset(); mockCamps.mockReset(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test('suma por campaña y por anuncio', async () => {
    mockAds.mockResolvedValue(ok);
    const r = await gastoPorCampana(['1'], '2026-10-13', '2026-10-13');
    expect(r).toMatchObject({ porCampana: { c1: 150 }, porAnuncio: { a1: 100, a2: 50 }, total: 150, error: null });
});

test('un 503 pasajero se reintenta', async () => {
    mockAds.mockResolvedValueOnce(falla).mockResolvedValueOnce(ok);
    const r = await gastoPorCampana(['1'], '2026-10-13', '2026-10-13');
    expect(r.error).toBeNull();
    expect(r.porCampana).toEqual({ c1: 150 });
    expect(mockCamps).not.toHaveBeenCalled();
}, 10000);

test('si el nivel anuncio sigue fallando, la campaña sale del respaldo por campaña', async () => {
    mockAds.mockResolvedValue(falla);
    mockCamps.mockResolvedValue({ campaigns: [{ campaignId: 'c1', spend: 150 }], errors: [] });
    const r = await gastoPorCampana(['1'], '2026-10-13', '2026-10-13');
    expect(r).toMatchObject({ porCampana: { c1: 150 }, porAnuncio: {}, total: 150, error: null });
}, 10000);

test('si Meta falla del todo y no hay dato anterior, se informa el error', async () => {
    mockAds.mockResolvedValue(falla);
    mockCamps.mockResolvedValue({ campaigns: [], errors: [{ accountId: '1', error: 'Request failed with status code 503' }] });
    const r = await gastoPorCampana(['1'], '2026-10-13', '2026-10-13');
    expect(r.error).toMatch(/503/);
}, 10000);
