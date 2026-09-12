/**
 * Integration (mocked, `docs/CODING_STANDARDS.md` §7.1a): food's remote search over real HTTP — the real
 * `SearchServiceRemoteSearch` signing real URLs, the real `CacheFirstAdmissionTransport`, the real
 * `RequesterWindowAdmission` and `RollingWindowLimiter` — through a CloudFront stand-in that checks signatures and
 * keeps answers by path and `q` (`support/searchEdgeStandIn.ts`), in front of a double of the search function that
 * keeps its contract (`support/searchFunctionDouble.ts`). The budget, the call ledger and the block ledger are
 * in-memory fakes; their SQL is the LOCAL e2e tier's.
 *
 * What only the composition shows (ADR-0055 points 2, 4, 6 and 7):
 *
 * - a second cook's search for a term already asked is answered from the cache, and charges neither the cook nor the
 *   shared window, nor reaches the source;
 * - a cached answer's stale quota never writes a block, while the same reading on the answer to THIS request does;
 * - an answer the origin did not produce for this request (a failed signature, the function URL's own throttle)
 *   reaches nobody as a source signal;
 * - a cook at their limit still gets a cached answer;
 * - an admitted request the caller has stopped waiting for still fills the cache.
 */
import { createPublicKey, generateKeyPairSync } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { REQUESTER_SOURCE_BUDGET_PER_HOUR } from '../src/common/throttle/throttle.config.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import type { RemoteSourceOutcome } from '../src/sources/remote/remoteSearchPort.js';
import { SearchServiceRemoteSearch } from '../src/sources/remote/SearchServiceRemoteSearch.js';
import type { SourceBlock } from '../src/sources/transport/transportPorts.js';
import { countingLedger, type LedgerCall } from './support/countingLedger.js';
import { startSearchEdgeStandIn, type SearchEdgeStandIn } from './support/searchEdgeStandIn.js';
import { searchFunctionDouble, type SearchFunctionDouble } from './support/searchFunctionDouble.js';
import { fakeSourceBudget, type FakeSourceBudget } from './support/sourceBudgetFake.js';

const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const COOK_A = '01JCOOKA000000000000000000';
const COOK_B = '01JCOOKB000000000000000000';
const KALE = [{ externalKey: '2346405', name: 'Kale, raw', lineageKey: 'foundation:11233' }];
const { privateKey: SIGNING_KEY, publicKey: PUBLIC_PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const { privateKey: STRANGER_KEY } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

let edge: SearchEdgeStandIn;
let origin: SearchFunctionDouble;
let budget: FakeSourceBudget;
let calls: LedgerCall[];
let blocks: SourceBlock[];

beforeAll(async () => {
    origin = searchFunctionDouble();
    edge = await startSearchEdgeStandIn({
        origin: async (event) => origin.origin(event),
        publicKey: createPublicKey(PUBLIC_PEM),
        keyPairId: KEY_PAIR_ID,
    });
});

afterAll(async () => {
    await edge.close();
});

beforeEach(() => {
    const fresh = searchFunctionDouble();

    origin.mode = fresh.mode;
    origin.quota = {};
    origin.retryAfter = undefined;
    origin.sourceCalls.length = 0;
    origin.rids.length = 0;
    edge.clear();
    edge.originRequests.length = 0;
    edge.now = Date.now();
    budget = fakeSourceBudget(1_800);
    calls = [];
    blocks = [];
});

/**
 * The Adapter as the API composes it, over this suite's fakes.
 *
 * @param signingKey - The key it signs with.
 * @returns The Adapter.
 */
function remoteSearch(signingKey: string = SIGNING_KEY): SearchServiceRemoteSearch {
    const clock = { now: Date.now() };

    return new SearchServiceRemoteSearch({
        origin: edge.origin,
        keyPairId: KEY_PAIR_ID,
        signingKey,
        window: new RollingWindowLimiter(countingLedger(calls, clock), {}),
        budget: budget.store,
        blocks: { record: async (block) => void blocks.push(block) },
        metrics: { recordSourceRateLimit: () => undefined },
        endings: { record: () => undefined },
        logger: { warn: () => undefined, error: () => undefined },
    });
}

/**
 * Search USDA for `term` as `cook`.
 *
 * @param cook - The requester.
 * @param term - The canonical term.
 * @param remote - The Adapter.
 * @returns The outcome.
 */
async function searchAs(cook: string, term = 'kale', remote = remoteSearch()): Promise<RemoteSourceOutcome> {
    return remote.search({ source: 'usda', term, requesterId: cook, signal: new AbortController().signal });
}

describe('remote search through the edge — a hit costs nothing', () => {
    it('asks the source once for two cooks’ searches of one term, and charges only the first cook', async () => {
        origin.mode = { kind: 'found', items: KALE };

        await expect(searchAs(COOK_A)).resolves.toEqual({ kind: 'answered', items: KALE });
        await expect(searchAs(COOK_B)).resolves.toEqual({ kind: 'answered', items: KALE });

        expect(origin.sourceCalls).toEqual(['kale']);
        expect(budget.spentBy(COOK_A)).toBe(1);
        expect(budget.spentBy(COOK_B)).toBe(0);
        expect(calls).toHaveLength(1);
        // The probe and the admitted request reached the origin for the first cook; nothing did for the second.
        expect(edge.originRequests).toHaveLength(2);
    });

    it('keeps an empty answer too, so a term nobody holds is asked of the source once', async () => {
        origin.mode = { kind: 'empty' };

        await searchAs(COOK_A, 'unobtanium');

        await expect(searchAs(COOK_B, 'unobtanium')).resolves.toEqual({ kind: 'answered', items: [] });
        expect(origin.sourceCalls).toEqual(['unobtanium']);
    });

    it('⛔ blocks the source from the quota on the answer to THIS request, and never from the same reading replayed by the cache', async () => {
        origin.mode = { kind: 'found', items: KALE };
        origin.quota = { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Limit': '1000' };

        await searchAs(COOK_A);

        expect(blocks).toEqual([{ source: 'usda', reason: 'quotaExhausted', seconds: 3_600 }]);

        blocks.length = 0;
        await expect(searchAs(COOK_B)).resolves.toEqual({ kind: 'answered', items: KALE });
        expect(blocks).toEqual([]);
    });

    it('gives a cook at their limit the cached answer, and refuses only their miss', async () => {
        origin.mode = { kind: 'found', items: KALE };
        await searchAs(COOK_A);
        await budget.store.charge({
            requesterId: COOK_B,
            cost: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            windowSeconds: 3_600,
        });

        await expect(searchAs(COOK_B)).resolves.toEqual({ kind: 'answered', items: KALE });
        await expect(searchAs(COOK_B, 'collard greens')).resolves.toEqual({
            kind: 'limited',
            retryAfterSeconds: 1_800,
        });
        expect(origin.sourceCalls).toEqual(['kale']);
        expect(calls).toHaveLength(1);
    });
});

describe('remote search through the edge — only this request’s answer carries the source’s signals', () => {
    it('writes the block a source 429 earns, answers busy for it, and keeps nothing', async () => {
        origin.mode = { kind: 'sourceStatus', status: 429 };
        origin.retryAfter = '600';

        await expect(searchAs(COOK_A)).resolves.toEqual({ kind: 'busy', retryAfterSeconds: 600 });
        expect(blocks).toEqual([{ source: 'usda', reason: 'rateLimited', seconds: 600 }]);

        origin.mode = { kind: 'found', items: KALE };
        await expect(searchAs(COOK_B)).resolves.toEqual({ kind: 'answered', items: KALE });
        expect(origin.sourceCalls).toEqual(['kale', 'kale']);
    });

    it('reads the function URL’s own throttle as the search service unavailable: no echo, no block', async () => {
        origin.mode = { kind: 'functionThrottled' };

        await expect(searchAs(COOK_A)).resolves.toEqual({ kind: 'unavailable' });
        expect(blocks).toEqual([]);
        expect(origin.sourceCalls).toEqual([]);
    });

    it('refuses a request signed with a key the distribution does not trust, before the origin', async () => {
        await expect(searchAs(COOK_A, 'kale', remoteSearch(STRANGER_KEY))).resolves.toEqual({ kind: 'unavailable' });
        expect(edge.originRequests).toEqual([]);
        expect(budget.charges).toEqual([]);
    });

    it('refuses a signed URL once it expires', async () => {
        edge.now = Date.now() + 120_000;

        await expect(searchAs(COOK_A)).resolves.toEqual({ kind: 'unavailable' });
        expect(edge.originRequests).toEqual([]);
    });
});

describe('remote search through the edge — an admitted request finishes', () => {
    it('fills the cache for a caller that stopped waiting after admission', async () => {
        origin.mode = { kind: 'found', items: KALE };

        const caller = new AbortController();
        const pending = remoteSearch().search({
            source: 'usda',
            term: 'kale',
            requesterId: COOK_A,
            signal: caller.signal,
        });

        await expect.poll(() => budget.charges.length).toBe(1);
        caller.abort(new Error('the cook moved on'));

        await expect(pending).resolves.toEqual({ kind: 'answered', items: KALE });
        await expect(searchAs(COOK_B)).resolves.toEqual({ kind: 'answered', items: KALE });
        expect(origin.sourceCalls).toEqual(['kale']);
    });
});
