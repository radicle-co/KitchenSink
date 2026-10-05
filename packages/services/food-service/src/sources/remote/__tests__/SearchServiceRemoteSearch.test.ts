/**
 * Food's Adapter over the remote search service's CDN (ADR-0055 points 3, 6 and 7; rulings 2 and 8). It signs every
 * request with a short expiry, with `q`, `admit` and `rid` inside the signature; it asks cache-first, admitting a miss
 * against the cook's budget and then the shared window; and it turns every ending into the source's outcome, so a
 * search never rejects.
 *
 * The CDN, the budget, the window and the block ledger are fakes; `tests/remoteSearchProtocol.integration.test.ts`
 * drives the same Adapter over HTTP.
 */
import { createPublicKey, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    REMOTE_SEARCH_LATENCY_BOUND_MS,
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchPath,
    remoteSearchQuerySchema,
} from '@kitchensink/schema-remote-search';

import { checkSignedUrl } from '../../../../tests/support/cloudFrontSignature.js';
import type { BudgetCharge, BudgetWindow } from '../../../foods/dao/requesterSourceBudget.dao.js';
import type { Admission, FetchFn, SourceBlock } from '../../transport/transportPorts.js';
import type { RemoteSourceOutcome } from '../remoteSearchPort.js';
import {
    ADMITTED_SEARCH_TIMEOUT_MS,
    SearchServiceRemoteSearch,
    SIGNED_URL_LIFETIME_SECONDS,
} from '../SearchServiceRemoteSearch.js';

/**
 * The URL a `fetch` was asked for.
 *
 * @param input - The request target.
 * @returns Its URL.
 */
function urlOf(input: string | URL | Request): string {
    if (typeof input === 'string') {
        return input;
    }

    return input instanceof URL ? input.href : input.url;
}

/** 2026-10-02 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 2, 5, 0, 0);
const ORIGIN = 'https://d111111abcdef8.cloudfront.net';
const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const RID = '0d7c1f0e-5b7a-4d36-9a3e-2b4f6c1d8e90';
const REQUESTER = '01JREQUESTER0000000000000A';
const { privateKey: SIGNING_KEY, publicKey: PUBLIC_PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PUBLIC_KEY = createPublicKey(PUBLIC_PEM);
const ITEMS = [
    { externalKey: '2346405', name: 'Kale, raw', lineageKey: 'foundation:11233' },
    { externalKey: '168421', name: 'Kale, cooked', lineageKey: null },
];

/** One CDN answer. */
interface Answer {
    readonly status: number;
    readonly echo?: string | null;
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
}

/** What one case's fakes saw. */
interface Harness {
    readonly remote: SearchServiceRemoteSearch;
    readonly urls: string[];
    readonly events: string[];
    readonly blocks: SourceBlock[];
    readonly warnings: string[];
}

/**
 * The Adapter over recording fakes. The CDN answers each request with the next answer.
 *
 * @param options - The CDN's answers, and what the budget and the window say.
 * @returns The harness.
 */
function makeHarness(options: {
    readonly answers: readonly (Answer | Error)[];
    readonly charge?: BudgetCharge;
    readonly window?: Admission;
}): Harness {
    const urls: string[] = [];
    const events: string[] = [];
    const blocks: SourceBlock[] = [];
    const warnings: string[] = [];

    const upstream: FetchFn = async (input) => {
        const answer = options.answers[urls.length];

        urls.push(urlOf(input));

        if (answer === undefined) {
            throw new Error('unexpected request');
        }

        if (answer instanceof Error) {
            throw answer;
        }

        const headers = new Headers(answer.headers);
        const echo = answer.echo === undefined ? RID : answer.echo;

        if (echo !== null) {
            headers.set(REMOTE_SEARCH_RID_HEADER, echo);
        }

        return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers });
    };

    return {
        urls,
        events,
        blocks,
        warnings,
        remote: new SearchServiceRemoteSearch({
            origin: ORIGIN,
            keyPairId: KEY_PAIR_ID,
            signingKey: SIGNING_KEY,
            window: {
                admit: async (source, lane) => {
                    events.push(`window:${source}:${lane}`);

                    return options.window ?? { admitted: true };
                },
            },
            budget: {
                charge: async (input) => {
                    events.push(`charge:${input.requesterId}:${String(input.cost)}`);

                    return (
                        options.charge ?? {
                            admitted: true,
                            receipt: {
                                requesterId: input.requesterId,
                                cost: input.cost,
                                window: '2026-10-02T06:00:00.000000Z' as BudgetWindow,
                            },
                        }
                    );
                },
                refund: async () => {
                    events.push('refund');

                    return 'refunded';
                },
            },
            blocks: { record: async (block) => void blocks.push(block) },
            metrics: { recordSourceRateLimit: () => undefined },
            endings: { record: () => undefined },
            upstream,
            now: () => NOW,
            newRequestId: () => RID,
            logger: {
                warn: (message) => warnings.push(message),
                error: (message) => warnings.push(message),
            },
        }),
    };
}

/**
 * Search USDA for a term as a cook.
 *
 * @param harness - The harness.
 * @param term - The term.
 * @returns The outcome.
 */
async function search(harness: Harness, term = 'kale'): Promise<RemoteSourceOutcome> {
    return harness.remote.search({
        source: 'usda',
        term,
        requesterId: REQUESTER,
        signal: new AbortController().signal,
    });
}

const NOT_ADMITTED: Answer = { status: 200, body: { outcome: 'notAdmitted' } };

describe('SearchServiceRemoteSearch — how long it waits on an admitted request', () => {
    // A request its viewer ends is not cached, so the CDN must be the one to end a slow request.
    it('waits longer than the CDN waits on the search service', () => {
        expect(ADMITTED_SEARCH_TIMEOUT_MS).toBeGreaterThan(REMOTE_SEARCH_LATENCY_BOUND_MS);
    });
});

describe('SearchServiceRemoteSearch — the request it signs', () => {
    it('asks the source’s search path at its adapter revision, with the term, admission off and its request id', async () => {
        const harness = makeHarness({
            answers: [{ status: 200, echo: 'another-request-0000', body: { outcome: 'empty' } }],
        });

        await search(harness, 'chicken breast');

        const url = new URL(harness.urls[0] ?? '');

        expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}${remoteSearchPath('usda')}`);
        expect(url.searchParams.get('q')).toBe('chicken breast');
        expect(url.searchParams.get('admit')).toBe('0');
        expect(url.searchParams.get('rid')).toBe(RID);
        expect(remoteSearchQuerySchema.shape.rid.safeParse(url.searchParams.get('rid')).success).toBe(true);
    });

    it('⛔ signs the exact URL it sends, so the term, the admission flag and the request id are all inside the signature', async () => {
        const harness = makeHarness({ answers: [NOT_ADMITTED, { status: 200, body: { outcome: 'empty' } }] });

        await search(harness);

        for (const [index, admit] of [
            [0, '0'],
            [1, '1'],
        ] as const) {
            const signed = harness.urls[index] ?? '';
            const check = checkSignedUrl(signed, { publicKey: PUBLIC_KEY, keyPairId: KEY_PAIR_ID }, NOW / 1_000);

            expect(check).toEqual({
                ok: true,
                resource: `${ORIGIN}${remoteSearchPath('usda')}?q=kale&admit=${admit}&rid=${RID}`,
            });
            // Any change to a signed parameter breaks the signature.
            const tampered = signed.replace(`admit=${admit}`, `admit=${admit === '0' ? '1' : '0'}`);

            expect(checkSignedUrl(tampered, { publicKey: PUBLIC_KEY, keyPairId: KEY_PAIR_ID }, NOW / 1_000)).toEqual({
                ok: false,
                refusal: 'badSignature',
            });
        }
    });

    it('signs with a short expiry, and with SHA-256', async () => {
        const harness = makeHarness({
            answers: [{ status: 200, echo: 'another-request-0000', body: { outcome: 'empty' } }],
        });

        await search(harness);

        const params = new URL(harness.urls[0] ?? '').searchParams;

        expect(Number(params.get('Expires'))).toBe(NOW / 1_000 + SIGNED_URL_LIFETIME_SECONDS);
        expect(SIGNED_URL_LIFETIME_SECONDS).toBeLessThanOrEqual(60);
        expect(params.get('Hash-Algorithm')).toBe('SHA256');
        expect(params.get('Key-Pair-Id')).toBe(KEY_PAIR_ID);
    });

    it('asks nothing for a term that is not canonical, which the search service would refuse', async () => {
        const harness = makeHarness({ answers: [] });

        await expect(search(harness, 'Chicken  Breast')).resolves.toEqual({ kind: 'unavailable' });
        expect(harness.urls).toEqual([]);
        expect(harness.events).toEqual([]);
    });
});

describe('SearchServiceRemoteSearch — what each ending reports', () => {
    it('answers a cached hit with its items, charging nobody', async () => {
        const harness = makeHarness({
            answers: [{ status: 200, echo: 'another-request-0000', body: { outcome: 'found', items: ITEMS } }],
        });

        await expect(search(harness)).resolves.toEqual({ kind: 'answered', items: ITEMS });
        expect(harness.events).toEqual([]);
    });

    it('answers an empty source as answered with no items', async () => {
        const harness = makeHarness({
            answers: [{ status: 200, echo: 'another-request-0000', body: { outcome: 'empty' } }],
        });

        await expect(search(harness)).resolves.toEqual({ kind: 'answered', items: [] });
    });

    it('charges a miss to the cook, then the shared window, on the interactive lane, and answers its items', async () => {
        const harness = makeHarness({
            answers: [NOT_ADMITTED, { status: 200, body: { outcome: 'found', items: ITEMS } }],
        });

        await expect(search(harness)).resolves.toEqual({ kind: 'answered', items: ITEMS });
        expect(harness.events).toEqual([`charge:${REQUESTER}:1`, 'window:usda:interactive']);
    });

    it('reports the cook’s limit, with the seconds until it ends, and sends no admitted request', async () => {
        const harness = makeHarness({ answers: [NOT_ADMITTED], charge: { admitted: false, retryAfterSeconds: 1_500 } });

        await expect(search(harness)).resolves.toEqual({ kind: 'limited', retryAfterSeconds: 1_500 });
        expect(harness.urls).toHaveLength(1);
    });

    it('reports a full window as busy until it frees, and gives the cook’s call back', async () => {
        const harness = makeHarness({
            answers: [NOT_ADMITTED],
            window: { admitted: false, reason: 'ceiling', retryAt: new Date(NOW + 90_500).toISOString() },
        });

        await expect(search(harness)).resolves.toEqual({ kind: 'busy', retryAfterSeconds: 91 });
        expect(harness.events).toContain('refund');
    });

    it('reports a source 429 as busy for the block it earned', async () => {
        const harness = makeHarness({
            answers: [
                NOT_ADMITTED,
                {
                    status: 502,
                    body: { code: 'SOURCE_ERROR', message: 'The source answered 429.', details: { sourceStatus: 429 } },
                    headers: { 'Retry-After': '240' },
                },
            ],
        });

        await expect(search(harness)).resolves.toEqual({ kind: 'busy', retryAfterSeconds: 240 });
        expect(harness.blocks).toEqual([{ source: 'usda', reason: 'rateLimited', seconds: 240 }]);
    });

    it.each<[string, readonly (Answer | Error)[]]>([
        ['an answer with no echo', [{ status: 200, echo: null, body: { outcome: 'empty' } }]],
        ['a "not admitted" that echoes another request', [{ ...NOT_ADMITTED, echo: 'another-request-0000' }]],
        ['a source timeout', [NOT_ADMITTED, { status: 504, body: { code: 'SOURCE_TIMEOUT', message: 'Slow.' } }]],
        ['the search service failing', [NOT_ADMITTED, { status: 500, body: { code: 'INTERNAL', message: 'Down.' } }]],
        ['a 200 whose body breaks the contract', [{ status: 200, echo: 'another-1234567890', body: { outcome: 'x' } }]],
        [
            'a refused request',
            [{ status: 400, body: { code: 'INVALID_REQUEST', message: 'Bad.', details: { parameter: 'q' } } }],
        ],
        ['a network failure', [new TypeError('fetch failed')]],
    ])('reports %s as unavailable, and logs why', async (_label, answers) => {
        const harness = makeHarness({ answers });

        await expect(search(harness)).resolves.toEqual({ kind: 'unavailable' });
        expect(harness.warnings).toHaveLength(1);
        expect(harness.blocks).toEqual([]);
    });

    it('reports a caller that left before any answer as unavailable, without a warning', async () => {
        const harness = makeHarness({ answers: [new DOMException('aborted', 'AbortError')] });
        const caller = new AbortController();

        caller.abort();

        await expect(
            harness.remote.search({ source: 'usda', term: 'kale', requesterId: REQUESTER, signal: caller.signal }),
        ).resolves.toEqual({ kind: 'unavailable' });
        expect(harness.warnings).toEqual([]);
    });
});
