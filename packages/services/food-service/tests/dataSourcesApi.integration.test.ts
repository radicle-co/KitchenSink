/**
 * `GET /api/v1/foods/sources` over a real HTTP request, with the cited-dataset read DOUBLED (§7.1a: integration mocks
 * its dependencies). Booted by `support/mockedFoodsApi.ts`: the real CORS policy, auth guard, controller, service,
 * listing policy and exception filter; no database.
 *
 * | Requirement (plan R55, design §S16) | Pinned here |
 * | --- | --- |
 * | the route is reachable, not swallowed by `GET /:id` | `200` with the listing, not `400 INVALID_ID` |
 * | it answers 401 without a session token (U25) | the guard's envelope, and the read never ran |
 * | any verified principal reads the same answer | a user and a `svc_*` principal get byte-equal bodies |
 * | only cited sources, in the register's order | the doubled rows arrive shuffled; the body is ordered and filtered |
 * | no Cache-Control of its own, as `GET /nutrition` | the header is absent |
 * | the web page can read it from its origin | the admitted origin is echoed, with `Vary: Origin` |
 * | a failed read is the generic 500, never a leak | the filter's envelope, without the driver's message |
 *
 * What the database does with the read is `tests/e2e/dataSources.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { apiErrorSchema } from '../src/common/apiError.schema.js';
import type { CitedDataset } from '../src/foods/domain/citedSources.js';
import { dataSourcesResponseSchema } from '../src/foods/dataSources.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const PATH = '/api/v1/foods/sources';

/** The origin the harness's `CLERK_AUTHORIZED_PARTIES` admits. */
const ADMITTED = 'https://app.example.com';

describe('GET /api/v1/foods/sources (booted Nest, read doubled)', () => {
    /** What the doubled read answers; each case may replace it. */
    let rows: CitedDataset[] = [];
    let failure: Error | undefined;
    const listCitedDatasets = vi.fn(async (): Promise<CitedDataset[]> => {
        if (failure !== undefined) {
            throw failure;
        }

        return rows;
    });
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({ foodDao: {}, citedSources: { listCitedDatasets } });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        rows = [
            { dataset: 'cofid', converted: true },
            { dataset: 'label', converted: false },
            { dataset: 'ciqual', converted: false },
            { dataset: 'usdaFndds', converted: false },
        ];
        failure = undefined;
        listCitedDatasets.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('is reachable at its path, not answered by GET /:id as a malformed id', async () => {
        const res = await api.call('GET', PATH, { token: 'author' });

        expect(res.status).toBe(200);
        expect(listCitedDatasets).toHaveBeenCalledTimes(1);
    });

    it('lists only the registered sources cited, in the register’s order, in the published shape', async () => {
        const res = await api.call('GET', PATH, { token: 'author' });

        expect(
            dataSourcesResponseSchema.parse(res.body).sources.map((source) => [source.id, source.converted]),
        ).toEqual([
            ['usda', false],
            ['ciqual', false],
            ['cofid', true],
        ]);
    });

    it('answers 401 without a session token, before the read runs', async () => {
        const res = await api.call('GET', PATH);

        expect(res.status).toBe(401);
        expect(apiErrorSchema.safeParse(res.body).success).toBe(true);
        expect(listCitedDatasets).not.toHaveBeenCalled();
    });

    it('answers a user and a service principal the same bytes, because nothing in it is the caller’s', async () => {
        const asUser = await api.call('GET', PATH, { token: 'author' });
        const asService = await api.call('GET', PATH, { token: 'service' });

        expect(asService.status).toBe(200);
        expect(asService.text).toBe(asUser.text);
    });

    it('sends no Cache-Control of its own, as the sibling catalog reads send none', async () => {
        const res = await api.call('GET', PATH, { token: 'author' });

        expect(res.headers.get('cache-control')).toBeNull();
    });

    it('echoes the admitted web origin, so the page can read it from the browser', async () => {
        const res = await api.call('GET', PATH, { token: 'author', headers: { origin: ADMITTED } });

        expect(res.headers.get('access-control-allow-origin')).toBe(ADMITTED);
        expect(res.headers.get('vary')).toContain('Origin');
    });

    it('answers a failed read with the generic 500 envelope, never the driver’s message', async () => {
        failure = new Error('password authentication failed for user "food_app"');

        const res = await api.call('GET', PATH, { token: 'author' });

        expect(res.status).toBe(500);
        expect(apiErrorSchema.safeParse(res.body).success).toBe(true);
        expect(res.text).not.toContain('password');
    });
});
