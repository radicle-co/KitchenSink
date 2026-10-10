/**
 * Integration (mocked, `docs/CODING_STANDARDS.md` §7.1a): what food PUBLISHES for each way a remote search ends, over
 * real HTTP. The real `SearchServiceRemoteSearch` signs real URLs through the CloudFront stand-in
 * (`support/searchEdgeStandIn.ts`) in front of the search function's double (`support/searchFunctionDouble.ts`), and
 * the real `RemoteSearchEndingMetrics` writes real EMF lines through `FoodMetrics`.
 *
 * The failure it exists for (ADR-0055 point 7): a signature the distribution refuses is CloudFront's own `403`, which
 * never reaches the search function's error or throttle alarms. Only food sees it, so the line food writes for it must
 * name it and count it as dark, at the stage the alarm reads.
 */
import { createPublicKey, generateKeyPairSync } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FoodMetrics, type EmfPayload } from '../src/observability/emfMetrics.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { RemoteSearchEndingMetrics } from '../src/sources/remote/remoteSearchEndings.js';
import { SearchServiceRemoteSearch } from '../src/sources/remote/SearchServiceRemoteSearch.js';
import { countingLedger, type LedgerCall } from './support/countingLedger.js';
import { startSearchEdgeStandIn, type SearchEdgeStandIn } from './support/searchEdgeStandIn.js';
import { searchFunctionDouble, type SearchFunctionDouble } from './support/searchFunctionDouble.js';
import { fakeSourceBudget } from './support/sourceBudgetFake.js';

const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const STAGE = 'pr-7';
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
let calls: LedgerCall[];

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
    origin.mode = { kind: 'found', items: KALE };
    origin.retryAfter = undefined;
    origin.sourceCalls.length = 0;
    edge.clear();
    edge.originRequests.length = 0;
    edge.now = Date.now();
    calls = [];
});

/** What one search published. */
interface Published {
    /** The ending's reason, from the `remote-search-ending` line. */
    readonly reason: unknown;
    /** The stage that line was published under. */
    readonly stage: unknown;
    /** The `remote-search-unavailable-rate` observation, if any. */
    readonly unavailablePercent: unknown;
}

/**
 * Search USDA for kale once, as the API composes the adapter, and read back the EMF lines it wrote.
 *
 * @param signingKey - The key the adapter signs with.
 * @returns What the search published.
 */
async function publishedBy(signingKey: string = SIGNING_KEY): Promise<Published> {
    const lines: string[] = [];
    const remote = new SearchServiceRemoteSearch({
        // The stand-in's clock is frozen within a test, so a pause must move it past the kept second.
        pause: async (ms) => {
            edge.now += ms;
        },
        origin: edge.origin,
        keyPairId: KEY_PAIR_ID,
        signingKey,
        window: new RollingWindowLimiter(countingLedger(calls, { now: Date.now() }), {}),
        budget: fakeSourceBudget(1_800).store,
        blocks: { record: async () => undefined },
        metrics: { recordSourceRateLimit: () => undefined },
        endings: new RemoteSearchEndingMetrics(new FoodMetrics((line) => lines.push(line)), STAGE),
        logger: { warn: () => undefined, error: () => undefined },
    });

    await remote.search({
        source: 'usda',
        term: 'kale',
        requesterId: '01JCOOKA000000000000000000',
        signal: new AbortController().signal,
    });

    const payloads = lines.map((line) => JSON.parse(line) as EmfPayload);
    const ending = payloads.find((payload) => payload['remote-search-ending'] !== undefined);
    const rate = payloads.find((payload) => payload['remote-search-unavailable-rate'] !== undefined);

    return {
        reason: ending?.['reason'],
        stage: ending?.['stage'],
        unavailablePercent: rate?.['remote-search-unavailable-rate'],
    };
}

describe('remote search through the edge — what food publishes when it goes dark', () => {
    it('publishes a signature the distribution refuses as noEcho, 100% unavailable, without reaching the origin', async () => {
        await expect(publishedBy(STRANGER_KEY)).resolves.toEqual({
            reason: 'noEcho',
            stage: STAGE,
            unavailablePercent: 100,
        });
        expect(edge.originRequests).toEqual([]);
    });

    it('publishes an expired signature as noEcho, 100% unavailable', async () => {
        edge.now = Date.now() + 120_000;

        await expect(publishedBy()).resolves.toEqual({ reason: 'noEcho', stage: STAGE, unavailablePercent: 100 });
    });

    it('publishes the function URL’s own throttle as noEcho, 100% unavailable', async () => {
        origin.mode = { kind: 'functionThrottled' };

        await expect(publishedBy()).resolves.toEqual({ reason: 'noEcho', stage: STAGE, unavailablePercent: 100 });
    });
});

describe('remote search through the edge — what food publishes when it is not dark', () => {
    it('publishes an admitted answer as answered, 0% unavailable', async () => {
        await expect(publishedBy()).resolves.toEqual({ reason: 'answered', stage: STAGE, unavailablePercent: 0 });
        expect(origin.sourceCalls).toEqual(['kale']);
    });

    it('publishes a source 429 as the block it earned, 0% unavailable: a refusal is not darkness', async () => {
        origin.mode = { kind: 'sourceStatus', status: 429 };
        origin.retryAfter = '240';

        await expect(publishedBy()).resolves.toEqual({ reason: 'blockEarned', stage: STAGE, unavailablePercent: 0 });
    });
});
