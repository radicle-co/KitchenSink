/**
 * The split food search over a real HTTP listener (plan 002 R40, S3), booted by `support/mockedFoodsApi.ts`: the real
 * auth middleware, validation pipe, controller, service, throttler and exception filter, with the database doubled.
 * Target: the mocked integration tier (`docs/CODING_STANDARDS.md` §7.1a). What the SQL itself returns is
 * `tests/e2e/catalogSearchPrivacy.e2e.test.ts`'s (LOCAL, a real Postgres).
 *
 * | Property (plan 002 S3)                                              | Pinned here                                         |
 * | ------------------------------------------------------------------- | --------------------------------------------------- |
 * | 1 — the catalog answer does not depend on who asks                  | four callers, byte-identical bodies AND headers     |
 * | 3 — strict query only; the client's canonical form is what is read | the DAO sees the canonical term; an extra key is 400 |
 * | 5 — an error is never shared                                        | every error carries `private, no-store`             |
 * | 5 — a shared body carries no caller's counter                       | no `x-ratelimit-*` (positive control: remote pick)  |
 * | 5b — the limit answers its own code                                 | 120 admitted, then `429 SEARCH_RATE_LIMITED`        |
 * | 6 — the authored route: own foods, `private, no-store`, `svc_*` empty | service → `[]` with no read; unsynced → 401       |
 *
 * Three cases drove the live search until plan 002 S7.9 deleted it: the counter's positive control now drives the
 * remote pick, and the per-route count and the NUL refusal drive the progressive search.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { SEARCH_PER_USER_LIMIT } from '../src/common/throttle/throttle.config.js';
import { AUTHOR_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import type { ProgressiveFoodSearch } from '../src/foods/progressive/ProgressiveFoodSearch.js';
import type { AdoptRemoteFood } from '../src/foods/remote/AdoptRemoteFood.js';
import {
    bootMockedFoodsApi,
    principalFor,
    type MockedFoodsApi,
    type MockedResponse,
} from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const CATALOG = '/api/v1/foods/catalog/search';
const AUTHORED = '/api/v1/foods/authored/search';
const ROOT_ID = '01JCATA10GF00D000000000000';
const MINE_ID = '01JM1NEF00D000000000000000';
const KEY_ROOT_ID = '01JKEYR00TF00D000000000000';

/** The headers a response may legitimately carry per request rather than per answer. */
const PER_REQUEST_HEADERS: ReadonlySet<string> = new Set(['date', 'connection', 'keep-alive']);

/**
 * The response's headers minus the per-request ones, as a sorted list.
 *
 * @param res - The response.
 * @returns `[name, value]` pairs.
 */
function answerHeaders(res: MockedResponse): [string, string][] {
    return [...res.headers.entries()].filter(([name]) => !PER_REQUEST_HEADERS.has(name)).sort();
}

/**
 * The database doubles the two routes read, recording every call.
 *
 * @returns The doubles.
 */
function makeDoubles(): {
    searchCatalog: ReturnType<typeof vi.fn>;
    searchAuthored: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    findCatalogFoodByBarcode: ReturnType<typeof vi.fn>;
    findCatalogFoodById: ReturnType<typeof vi.fn>;
    ownersOfKeys: ReturnType<typeof vi.fn>;
    listLive: ReturnType<typeof vi.fn>;
    adopt: Mock<AdoptRemoteFood['execute']>;
    progressive: Mock<ProgressiveFoodSearch['run']>;
} {
    return {
        searchCatalog: vi.fn(async () => [{ id: ROOT_ID, name: 'chicken breast', aliases: null, score: 0.8 }]),
        searchAuthored: vi.fn(async () => [
            {
                id: MINE_ID,
                name: 'my chicken breast',
                aliases: null,
                score: 0.7,
                userId: AUTHOR_ID,
                visibility: 'private',
            },
        ]),
        search: vi.fn(async () => []),
        findCatalogFoodByBarcode: vi.fn(async () => undefined),
        findCatalogFoodById: vi.fn(async () => undefined),
        ownersOfKeys: vi.fn(async () => new Map()),
        listLive: vi.fn(async () => []),
        adopt: vi.fn<AdoptRemoteFood['execute']>(async () => ({ id: 'R-adopted' })),
        // Writes no frame: the harness reads an empty body, and these cases read only the status.
        progressive: vi.fn<ProgressiveFoodSearch['run']>(async () => undefined),
    };
}

/**
 * Boot the mocked app over the doubles.
 *
 * @param doubles - From {@link makeDoubles}.
 * @returns The booted app.
 */
async function boot(doubles: ReturnType<typeof makeDoubles>): Promise<MockedFoodsApi> {
    return bootMockedFoodsApi({
        foodDao: { readRefFacts: async () => [] },
        searchDao: {
            search: doubles.search,
            searchCatalog: doubles.searchCatalog,
            searchAuthored: doubles.searchAuthored,
        },
        sources: {
            findCatalogFoodByBarcode: doubles.findCatalogFoodByBarcode,
            findCatalogFoodById: doubles.findCatalogFoodById,
        },
        owners: { ownersOfKeys: doubles.ownersOfKeys },
        variants: { listLive: doubles.listLive },
        remoteAdopt: { execute: doubles.adopt },
        progressive: { run: doubles.progressive },
    });
}

beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockImplementation(async (token: string) => principalFor(token));
});

describe('GET /api/v1/foods/catalog/search — one answer for every caller', () => {
    const doubles = makeDoubles();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await boot(doubles);
    });

    afterAll(async () => {
        await api.close();
    });

    it('⛔ answers the author, a stranger, a service and an unsynced user the SAME bytes and headers', async () => {
        const answers = [];

        for (const token of ['author', 'stranger', 'service', 'unsynced']) {
            answers.push(await api.call('GET', `${CATALOG}?query=chicken%20breast`, { token }));
        }

        // Positive control: the answer is not empty, so "identical" is not "identically nothing".
        expect(answers[0]!.status).toBe(200);
        expect(answers[0]!.body).toStrictEqual({ results: [{ id: ROOT_ID, name: 'chicken breast', score: 0.8 }] });

        for (const answer of answers.slice(1)) {
            expect(answer.status).toBe(200);
            expect(answer.text).toBe(answers[0]!.text);
            expect(answerHeaders(answer)).toStrictEqual(answerHeaders(answers[0]!));
        }
    });

    it('⛔ sends no rate-limit counter and no Cache-Control on the shared 200, so the edge decides', async () => {
        const res = await api.call('GET', `${CATALOG}?query=chicken%20breast`, { token: 'author' });

        expect(res.status).toBe(200);
        expect([...res.headers.keys()].filter((name) => name.startsWith('x-ratelimit'))).toStrictEqual([]);
        expect(res.headers.get('cache-control')).toBeNull();
    });

    // Positive control for the absence above: the stock per-user guard, on the remote pick, does write its counters.
    it('is the search guard that stops the counters: the remote pick still advertises its limit', async () => {
        const res = await api.call('POST', '/api/v1/foods/remote/adopt', {
            token: 'author',
            body: { reference: 'sealed-reference' },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('x-ratelimit-limit')).not.toBeNull();
    });

    it('reads the CANONICAL term, so every spelling of one search is one answer', async () => {
        doubles.searchCatalog.mockClear();

        const res = await api.call('GET', `${CATALOG}?query=%20%20Chicken%20%20%20BREAST%09`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(doubles.searchCatalog.mock.calls).toStrictEqual([['chicken breast']]);
    });

    it.each([
        ['an unknown parameter', `${CATALOG}?query=egg&scope=mine`],
        ['the per-caller enrichment flag', `${CATALOG}?query=egg&withNutrition=true`],
        ['no term', CATALOG],
        ['a blank term', `${CATALOG}?query=%20%20`],
    ])('refuses %s with 400 VALIDATION_FAILED, never reading, marked no-store', async (_label, path) => {
        doubles.searchCatalog.mockClear();

        const res = await api.call('GET', path, { token: 'author' });

        expect(res.status).toBe(400);
        expect(foodErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(doubles.searchCatalog).not.toHaveBeenCalled();
    });

    // sec-aud-1 S3 review, F1: the owner reader names a key's root; only the catalog gate's SQL may publish it.
    it('⛔ publishes a USDA-key hit only when the catalog gate admits the root the owner reader named', async () => {
        const owner = { kind: 'root', id: KEY_ROOT_ID, rootId: KEY_ROOT_ID, rootName: 'beef brisket', parts: [] };

        const ask = async (listed: { id: string; name: string } | undefined): Promise<MockedResponse> => {
            doubles.searchCatalog.mockResolvedValueOnce([]);
            doubles.ownersOfKeys.mockResolvedValueOnce(new Map([['174532', { ...owner, seedOwned: false }]]));
            doubles.findCatalogFoodById.mockResolvedValueOnce(listed);

            return api.call('GET', `${CATALOG}?query=174532`, { token: 'stranger' });
        };

        doubles.findCatalogFoodById.mockClear();

        const refused = await ask(undefined);
        const admitted = await ask({ id: KEY_ROOT_ID, name: 'beef brisket' });

        expect([refused.status, refused.body]).toStrictEqual([200, { results: [] }]);
        expect([admitted.status, admitted.body]).toStrictEqual([
            200,
            { results: [{ id: KEY_ROOT_ID, name: 'beef brisket', score: 1 }] },
        ]);
        expect(doubles.findCatalogFoodById.mock.calls).toStrictEqual([[KEY_ROOT_ID], [KEY_ROOT_ID]]);
    });

    it('answers a below-minimum term with an empty 200 and no read', async () => {
        doubles.searchCatalog.mockClear();

        const res = await api.call('GET', `${CATALOG}?query=eg`, { token: 'author' });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ results: [] });
        expect(doubles.searchCatalog).not.toHaveBeenCalled();
    });

    it('is served under the deprecated /v1 alias too (ADR-0011)', async () => {
        const res = await api.call('GET', '/v1/foods/catalog/search?query=chicken%20breast', { token: 'author' });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ results: [{ id: ROOT_ID, name: 'chicken breast', score: 0.8 }] });
    });
});

describe("GET /api/v1/foods/authored/search — the caller's own foods only", () => {
    const doubles = makeDoubles();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await boot(doubles);
    });

    afterAll(async () => {
        await api.close();
    });

    it('answers a user their own foods, with no visibility field, as private and uncacheable', async () => {
        doubles.searchAuthored.mockClear();

        const res = await api.call('GET', `${AUTHORED}?query=Chicken%20Breast`, { token: 'author' });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ results: [{ id: MINE_ID, name: 'my chicken breast', score: 0.7 }] });
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(doubles.searchAuthored.mock.calls).toStrictEqual([['chicken breast', AUTHOR_ID]]);
    });

    it('answers a service principal an empty list without reading, still uncacheable', async () => {
        doubles.searchAuthored.mockClear();

        const res = await api.call('GET', `${AUTHORED}?query=chicken%20breast`, { token: 'service' });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ results: [] });
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(doubles.searchAuthored).not.toHaveBeenCalled();
    });

    it('defers an unsynced user with 401 IDENTITY_SYNC_PENDING, marked no-store', async () => {
        const res = await api.call('GET', `${AUTHORED}?query=chicken%20breast`, { token: 'unsynced' });

        expect(res.status).toBe(401);
        expect(foodErrorSchema.parse(res.body).code).toBe('IDENTITY_SYNC_PENDING');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
    });

    it('sends no rate-limit counter on its answer either', async () => {
        const res = await api.call('GET', `${AUTHORED}?query=chicken%20breast`, { token: 'author' });

        expect([...res.headers.keys()].filter((name) => name.startsWith('x-ratelimit'))).toStrictEqual([]);
    });
});

describe('the per-user search limit (R42) — 120 a minute per route, refused as SEARCH_RATE_LIMITED', () => {
    const doubles = makeDoubles();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await boot(doubles);
    });

    afterAll(async () => {
        await api.close();
    });

    // ⛔ ONE case on purpose: the counters live for the app's life, so the order of these observations is the test.
    it('admits a caller up to the limit, refuses the next before any read, and counts users and routes apart', async () => {
        doubles.searchCatalog.mockClear();

        for (let request = 1; request <= SEARCH_PER_USER_LIMIT; request += 1) {
            const res = await api.call('GET', `${CATALOG}?query=chicken%20breast`, { token: 'author' });

            expect(res.status, `request ${request} of ${SEARCH_PER_USER_LIMIT}`).toBe(200);
        }

        const refused = await api.call('GET', `${CATALOG}?query=chicken%20breast`, { token: 'author' });
        const body = foodErrorSchema.parse(refused.body);

        expect(refused.status).toBe(429);
        expect(body.code).toBe('SEARCH_RATE_LIMITED');
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(body.code === 'SEARCH_RATE_LIMITED' && body.details.retryAfterSeconds).toBe(
            Number(refused.headers.get('retry-after')),
        );
        expect(refused.headers.get('cache-control')).toBe('private, no-store');
        expect([...refused.headers.keys()].filter((name) => name.startsWith('x-ratelimit'))).toStrictEqual([]);
        // Refused before the handler: the database was asked exactly `limit` times.
        expect(doubles.searchCatalog).toHaveBeenCalledTimes(SEARCH_PER_USER_LIMIT);

        // The deprecated alias is the same handler, so it shares the counter rather than doubling the budget.
        expect((await api.call('GET', '/v1/foods/catalog/search?query=egg', { token: 'author' })).status).toBe(429);

        // Another user from the same address, and the author's other two search routes, all pass: the same guard and
        // limit count each route apart.
        expect((await api.call('GET', `${CATALOG}?query=egg`, { token: 'stranger' })).status).toBe(200);
        expect((await api.call('GET', `${AUTHORED}?query=egg`, { token: 'author' })).status).toBe(200);
        expect((await api.call('GET', '/api/v1/foods/search/progressive?query=egg', { token: 'author' })).status).toBe(
            200,
        );
    });

    it('refuses the authored route past its own limit in the same code', async () => {
        // The case above spent one authored request for the author.
        for (let request = 2; request <= SEARCH_PER_USER_LIMIT; request += 1) {
            expect((await api.call('GET', `${AUTHORED}?query=egg`, { token: 'author' })).status).toBe(200);
        }

        const refused = await api.call('GET', `${AUTHORED}?query=egg`, { token: 'author' });

        expect(refused.status).toBe(429);
        expect(foodErrorSchema.parse(refused.body).code).toBe('SEARCH_RATE_LIMITED');
        expect(refused.headers.get('cache-control')).toBe('private, no-store');
    });
});

/**
 * A NUL byte in the term (sec-aud-1 S3 review, F3): Postgres `text` cannot hold one, so it answered `500` from the
 * database. Every search route parses its term with one of the two query schemas, which refuse it before any read. The
 * progressive search is the one that also calls a source.
 */
describe('a NUL byte in the term is a 400 on every search route, before any read or source call', () => {
    const doubles = makeDoubles();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await boot(doubles);
    });

    afterAll(async () => {
        await api.close();
    });

    it.each([
        ['the catalog search', CATALOG],
        ['the authored search', AUTHORED],
        ['the per-caller search', '/api/v1/foods/search'],
        ['the progressive search', '/api/v1/foods/search/progressive'],
    ])('%s refuses it as VALIDATION_FAILED, marked no-store', async (_label, route) => {
        for (const query of ['chicken%00breast', '%00']) {
            const res = await api.call('GET', `${route}?query=${query}`, { token: 'author' });

            expect(res.status, query).toBe(400);
            expect(foodErrorSchema.parse(res.body).code, query).toBe('VALIDATION_FAILED');
            expect(res.headers.get('cache-control'), query).toBe('private, no-store');
        }

        for (const read of [
            doubles.search,
            doubles.searchCatalog,
            doubles.searchAuthored,
            doubles.findCatalogFoodByBarcode,
            doubles.ownersOfKeys,
            doubles.progressive,
        ]) {
            expect(read).not.toHaveBeenCalled();
        }
    });

    // The positive control: the same routes, the same caller and the same doubles answer a clean term.
    it('answers the same term without the NUL on each route', async () => {
        for (const route of [CATALOG, AUTHORED, '/api/v1/foods/search', '/api/v1/foods/search/progressive']) {
            expect((await api.call('GET', `${route}?query=chicken%20breast`, { token: 'author' })).status, route).toBe(
                200,
            );
        }
    });
});

/**
 * The errors the auth MIDDLEWARE raises reach the same global filter, so they are uncacheable too. The shed case runs
 * LAST in this file: once the shedder has shed this address, every later request from it is shed for its window.
 */
describe('the auth middleware’s refusals on the shared route are uncacheable too', () => {
    const doubles = makeDoubles();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await boot(doubles);
    });

    afterAll(async () => {
        await api.close();
    });

    it('a missing bearer is 401 UNAUTHORIZED, marked no-store', async () => {
        const res = await api.call('GET', `${CATALOG}?query=chicken%20breast`);

        expect(res.status).toBe(401);
        expect(foodErrorSchema.parse(res.body).code).toBe('UNAUTHORIZED');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
    });

    it("the shedder's per-address 503 is marked no-store", async () => {
        let shed: MockedResponse | undefined;

        // The shedder's default threshold is 100 refused tokens per address in its window (`AuthLoadShedder.ts`).
        for (let attempt = 0; attempt < 200 && shed === undefined; attempt += 1) {
            const res = await api.call('GET', `${CATALOG}?query=chicken%20breast`, { token: 'forged' });

            if (res.status === 503) {
                shed = res;
            }
        }

        expect(shed?.status).toBe(503);
        expect(shed?.headers.get('cache-control')).toBe('private, no-store');
    });
});
