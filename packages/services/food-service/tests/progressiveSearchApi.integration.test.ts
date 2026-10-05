/**
 * Integration (mocked, `docs/CODING_STANDARDS.md` §7.1a): the progressive search route,
 * `GET /api/v1/foods/search/progressive` (ADR-0055 points 5 and 9; review rulings 1 and 4), over a real HTTP listener
 * booted by `support/mockedFoodsApi.ts`: the real auth guard, validation pipe, per-minute search cap, controller,
 * `ProgressiveFoodSearch`, `SearchServiceRemoteSearch` and cache-first transport, through the CloudFront stand-in in
 * front of the search function's double. The database reads, the catalog's standing, the budget's and the window's
 * stores and the gap store are doubled; their SQL is the LOCAL e2e tier's.
 *
 * | What the route must do on the wire                                     | Pinned here                                  |
 * | ---------------------------------------------------------------------- | -------------------------------------------- |
 * | refuse before the first byte                                           | `400`, `401`, `429 SEARCH_RATE_LIMITED`      |
 * | answer NDJSON, never shared                                            | the media type, `private, no-store`          |
 * | send the database frame before a remote source answers                 | the first line read while the source waits   |
 * | charge the cook only for a miss                                        | a second cook's search charges nothing       |
 * | read no authored foods for a service                                   | an empty authored group, no read             |
 * | issue a reference the remote pick accepts                              | the frame's reference adopts                 |
 * | hide a hit a named catalog root answers, and record its gap (R66)      | an empty source frame, the gap recorded      |
 * | end the body at completion, not after the gap write                    | the last frame read while the gap store waits |
 * | fall back to the database when search refuses food's adapter revision  | the database frame, the source unavailable   |
 */
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { SEARCH_PER_USER_LIMIT } from '../src/common/throttle/throttle.config.js';
import { AUTHOR_ID, STRANGER_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import type { NamedRoot } from '../src/foods/dao/remoteAdoption.dao.js';
import type { SearchGap } from '../src/foods/domain/remoteHitTriage.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { ProgressiveFoodSearch } from '../src/foods/progressive/ProgressiveFoodSearch.js';
import {
    PROGRESSIVE_SEARCH_CONTENT_TYPE,
    progressiveSearchFrameSchema,
    type ProgressiveSearchFrame,
} from '../src/foods/progressiveSearch.schema.js';
import { AdoptRemoteFood } from '../src/foods/remote/AdoptRemoteFood.js';
import { RemoteReferenceSealer } from '../src/foods/remote/RemoteReferenceSealer.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { SearchServiceRemoteSearch } from '../src/sources/remote/SearchServiceRemoteSearch.js';
import { countingLedger, type LedgerCall } from './support/countingLedger.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';
import { startSearchEdgeStandIn, type SearchEdgeStandIn } from './support/searchEdgeStandIn.js';
import { searchFunctionDouble } from './support/searchFunctionDouble.js';
import { fakeSourceBudget, type FakeSourceBudget } from './support/sourceBudgetFake.js';

const mockVerify = vi.mocked(verifyClerkToken);
const SEARCH = '/api/v1/foods/search/progressive';
const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const { privateKey: SIGNING_KEY, publicKey: PUBLIC_PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SEALER = new RemoteReferenceSealer(new Uint8Array(randomBytes(32)));
const KALE_CHIPS = { externalKey: '900001', name: 'Kale chips, baked', lineageKey: null };

const origin = searchFunctionDouble();
let edge: SearchEdgeStandIn;
let api: MockedFoodsApi;
let budget: FakeSourceBudget = fakeSourceBudget();
let calls: LedgerCall[] = [];
/** Opens when a case lets the search function answer; open unless a case closes it. */
let originGate: Promise<void> = Promise.resolve();
const authoredReads: string[] = [];
/** The live catalog roots by name key a case stands up; none unless a case sets them. */
let namedRoots: ReadonlyMap<string, NamedRoot> = new Map();
const recordedGaps: SearchGap[] = [];
/** Opens when a case lets the gap store write; open unless a case closes it. */
let gapGate: Promise<void> = Promise.resolve();

beforeAll(async () => {
    edge = await startSearchEdgeStandIn({
        origin: async (event) => {
            await originGate;

            return origin.origin(event);
        },
        publicKey: createPublicKey(PUBLIC_PEM),
        keyPairId: KEY_PAIR_ID,
    });

    const progressive = new ProgressiveFoodSearch({
        database: {
            searchCatalog: async () => ({ results: [{ id: 'R-kale', name: 'kale', score: 1 }] }),
            searchAuthored: async (_term, authorId) => {
                authoredReads.push(authorId);

                return { results: [{ id: 'A-mine', name: 'my kale salad', score: 0.5 }] };
            },
        },
        remote: new SearchServiceRemoteSearch({
            // The stand-in's clock is frozen within a test, so a pause must move it past the kept second.
            pause: async (ms) => {
                edge.now += ms;
            },
            origin: edge.origin,
            keyPairId: KEY_PAIR_ID,
            signingKey: SIGNING_KEY,
            window: {
                admit: async (source, lane) =>
                    new RollingWindowLimiter(countingLedger(calls, { now: Date.now() }), {}).admit(source, lane),
            },
            budget: {
                charge: async (input) => budget.store.charge(input),
                refund: async (r, n) => budget.store.refund(r, n),
            },
            blocks: { record: async () => undefined },
            metrics: { recordSourceRateLimit: () => undefined },
            endings: { record: () => undefined },
            logger: { warn: () => undefined, error: () => undefined },
        }),
        owners: { standingOfKeys: async () => ({ owners: new Map(), retired: new Set() }) },
        namedRoots: {
            liveCatalogRootsNamed: async (keys) => new Map([...namedRoots].filter(([key]) => keys.includes(key))),
        },
        sealer: SEALER,
        gaps: {
            record: async (_source, gaps) => {
                await gapGate;
                recordedGaps.push(...gaps);
            },
        },
        logger: { warn: () => undefined, error: () => undefined },
    });
    const adopt = new AdoptRemoteFood({
        sealer: SEALER,
        owners: { standingOfKeys: async () => ({ owners: new Map(), retired: new Set() }) },
        registry: {
            adapterFor: () => ({
                source: 'usda',
                searchByName: async () => [],
                fetchByKey: async (externalKey) => makeMergeCandidate('usda', { externalKey, name: 'KALE CHIPS' }),
            }),
        },
        adoption: {
            liveCatalogRootNamed: async () => undefined,
            adopt: async () => ({ kind: 'created', id: 'R-new' }),
        },
        queue: { leaseFood: async () => ({ kind: 'idle' }), deferLease: async () => undefined },
        persistRoot: () => async () => undefined,
        logger: { warn: () => undefined },
    });

    api = await bootMockedFoodsApi({ foodDao: {}, progressive, remoteAdopt: adopt });
});

afterAll(async () => {
    await api.close();
    await edge.close();
});

beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockImplementation(async (token: string) => principalFor(token));
    origin.mode = { kind: 'found', items: [KALE_CHIPS] };
    origin.servesAnotherRevision = false;
    origin.sourceCalls.length = 0;
    edge.clear();
    budget = fakeSourceBudget();
    calls = [];
    originGate = Promise.resolve();
    authoredReads.length = 0;
    namedRoots = new Map();
    recordedGaps.length = 0;
    gapGate = Promise.resolve();
});

/**
 * Open a search as a caller.
 *
 * @param query - The raw query string after `?`.
 * @param token - The bearer, if any.
 * @returns The response, its body unread.
 */
async function open(query: string, token?: string): Promise<Response> {
    return fetch(`${api.baseUrl}${SEARCH}?${query}`, {
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
}

/**
 * Read every frame of a body, splitting on the newline byte.
 *
 * @param response - The response.
 * @returns The frames, each parsed by the contract.
 */
async function framesOf(response: Response): Promise<ProgressiveSearchFrame[]> {
    const text = await response.text();

    expect(text.endsWith('\n')).toBe(true);

    return text
        .slice(0, -1)
        .split('\n')
        .map((line) => progressiveSearchFrameSchema.parse(JSON.parse(line)));
}

describe('GET /api/v1/foods/search/progressive — before the first byte', () => {
    it.each<[string, string, string | undefined, number, string]>([
        ['no token', 'query=kale', undefined, 401, 'UNAUTHORIZED'],
        ['a token whose user has not synced', 'query=kale', 'unsynced', 401, 'IDENTITY_SYNC_PENDING'],
        ['no query', '', 'author', 400, 'VALIDATION_FAILED'],
        ['a parameter the search does not take', 'query=kale&scope=mine', 'author', 400, 'VALIDATION_FAILED'],
    ])('refuses %s with an error envelope, not a stream', async (_label, query, token, status, code) => {
        const response = await open(query, token);

        expect(response.status).toBe(status);
        expect(response.headers.get('content-type')).toMatch(/^application\/json/u);
        expect(foodErrorSchema.parse(await response.json())).toMatchObject({ code });
        expect(origin.sourceCalls).toStrictEqual([]);
    });
});

describe('GET /api/v1/foods/search/progressive — the answer', () => {
    it('answers NDJSON, never shared, as a database frame, the source’s frame and completion', async () => {
        const response = await open('query=kale', 'author');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(PROGRESSIVE_SEARCH_CONTENT_TYPE);
        expect(response.headers.get('cache-control')).toBe('private, no-store');

        const frames = await framesOf(response);

        expect(frames.map((frame) => frame.type)).toStrictEqual(['database', 'source', 'complete']);
        expect(frames[0]).toStrictEqual({
            type: 'database',
            catalog: { outcome: 'answered', results: [{ id: 'R-kale', name: 'kale', score: 1 }] },
            authored: { outcome: 'answered', results: [{ id: 'A-mine', name: 'my kale salad', score: 0.5 }] },
        });
        expect(frames[1]).toMatchObject({ type: 'source', source: 'usda', outcome: 'answered' });
        expect(authoredReads).toStrictEqual([AUTHOR_ID]);
    });

    it('⛔ sends the database frame while the remote source is still answering', async () => {
        let release: () => void = () => undefined;

        originGate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const response = await open('query=kale', 'author');
        const reader = response.body?.getReader();

        if (reader === undefined) {
            throw new Error('expected a body');
        }

        const first = await reader.read();
        const firstText = new TextDecoder().decode(first.value);

        expect(progressiveSearchFrameSchema.parse(JSON.parse(firstText.split('\n')[0] ?? ''))).toMatchObject({
            type: 'database',
        });
        expect(origin.sourceCalls).toStrictEqual([]);
        release();

        let rest = firstText;

        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            rest += new TextDecoder().decode(chunk.value);
        }

        expect(rest.trimEnd().split('\n').at(-1)).toBe('{"type":"complete"}');
    });

    it('charges the first cook’s miss to that cook, and nothing for a second cook’s search of the same term', async () => {
        await framesOf(await open('query=kale', 'author'));
        await framesOf(await open('query=kale', 'stranger'));

        expect(origin.sourceCalls).toStrictEqual(['kale']);
        expect(budget.spentBy(AUTHOR_ID)).toBe(1);
        expect(budget.spentBy(STRANGER_ID)).toBe(0);
        expect(calls).toHaveLength(1);
    });

    it('reads no authored foods for a service, and answers its authored group empty', async () => {
        const frames = await framesOf(await open('query=kale', 'service'));

        expect(frames[0]).toMatchObject({ authored: { outcome: 'answered', results: [] } });
        expect(authoredReads).toStrictEqual([]);
    });

    it('issues a reference the remote pick accepts', async () => {
        const frames = await framesOf(await open('query=kale', 'author'));
        const source = frames[1];

        if (source?.type !== 'source' || source.outcome !== 'answered') {
            throw new Error('expected an answered source frame');
        }

        const picked = await api.call('POST', '/api/v1/foods/remote/adopt', {
            token: 'author',
            body: { reference: source.items[0]?.reference },
        });

        expect(picked.status).toBe(200);
        expect(picked.body).toStrictEqual({ id: 'R-new' });
    });

    it('⛔ hides a hit whose name a catalog root holding a record carries, and records it as a gap (R66)', async () => {
        namedRoots = new Map([['kale chips, baked', { id: 'R-chips', status: 'RESOLVED' }]]);

        const frames = await framesOf(await open('query=kale', 'author'));

        expect(frames[1]).toStrictEqual({ type: 'source', source: 'usda', outcome: 'answered', items: [] });
        // Recorded after the body ends (ADR-0055 point 4), so it may land just after the last byte.
        await expect
            .poll(() => recordedGaps)
            .toStrictEqual([
                {
                    query: 'kale',
                    source: 'usda',
                    externalKey: '900001',
                    foodId: 'R-chips',
                    foodVariantId: null,
                    remoteName: 'Kale chips, baked',
                },
            ]);
    });

    /**
     * Food asks one adapter revision and the search service serves only its own (ADR-0055 point 8), so between the
     * two deploys of a revision change the source answers nothing food can use. The cook still gets our database.
     */
    it('⛔ answers the database frame, and the source as unavailable, when search refuses food’s revision', async () => {
        origin.servesAnotherRevision = true;

        const frames = await framesOf(await open('query=kale', 'author'));

        expect(frames).toStrictEqual([
            {
                type: 'database',
                catalog: { outcome: 'answered', results: [{ id: 'R-kale', name: 'kale', score: 1 }] },
                authored: { outcome: 'answered', results: [{ id: 'A-mine', name: 'my kale salad', score: 0.5 }] },
            },
            { type: 'source', source: 'usda', outcome: 'unavailable' },
            { type: 'complete' },
        ]);
        expect(origin.sourceCalls).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it('⛔ ends the body at completion, while the search gaps are still being recorded', async () => {
        let release: () => void = () => undefined;

        gapGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        namedRoots = new Map([['kale chips, baked', { id: 'R-chips', status: 'RESOLVED' }]]);

        const frames = await framesOf(await open('query=kale', 'author'));

        expect(frames.at(-1)).toStrictEqual({ type: 'complete' });
        expect(recordedGaps).toStrictEqual([]);
        release();
        await expect.poll(() => recordedGaps.length).toBe(1);
    });
});

describe('GET /api/v1/foods/search/progressive — the per-minute search cap', () => {
    it('refuses past the cap before the first byte, as the search’s own limit', async () => {
        origin.mode = { kind: 'empty' };

        for (let request = 1; request <= SEARCH_PER_USER_LIMIT; request += 1) {
            const response = await open('query=kale', 'operator');

            expect(response.status, `request ${String(request)}`).toBe(200);
            await response.text();
        }

        const refused = await open('query=kale', 'operator');

        expect(refused.status).toBe(429);
        expect(foodErrorSchema.parse(await refused.json())).toMatchObject({ code: 'SEARCH_RATE_LIMITED' });
        expect(refused.headers.get('x-ratelimit-remaining')).toBeNull();
    });
});

/**
 * The on-demand live search this route replaced (plan 002 S7.9, ADR-0055 point 9) is unrouted on both prefixes: Nest's
 * own not-found answer, never a `:id` route's refusal of `search` as an id.
 */
describe('GET /search/live — the search the progressive search replaced', () => {
    it.each(['/api/v1/foods/search/live?query=egg', '/v1/foods/search/live?query=egg'])(
        'answers %s as a path no route matches',
        async (path) => {
            const res = await api.call('GET', path, { token: 'author' });

            expect(res.status).toBe(404);
            expect(res.body).toStrictEqual({ code: 'NOT_FOUND', message: `Cannot GET ${path}` });
        },
    );
});
