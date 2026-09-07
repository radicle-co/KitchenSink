/**
 * Unit tests for {@link FoodServiceClients} — the Factory that mints a food-service client bound to ONE
 * caller's credential and to the ONE config-supplied food origin (issue #120).
 *
 * This is the confused-deputy boundary, so the suite is written to fail if any of these stop holding:
 *
 *  - the caller's bearer reaches the wire as `Authorization: Bearer <token>` — the reason the seam exists;
 *  - the target origin is ALWAYS the configured one, whatever else is in play — a forwarded user credential
 *    aimed at an attacker-chosen host is the actual vulnerability class here;
 *  - two different callers never share a credential (no ambient/static token);
 *  - an absent caller yields a client with NO `Authorization` header — never a fallback credential;
 *  - `typeahead()` and `standard()` really do carry DIFFERENT deadlines (the per-keystroke bound vs the 8s
 *    one) — collapsing them would let a degraded food service stall the typeahead;
 *  - the credential appears in NO error thrown out of a failed call, however that error is stringified.
 *  - the drift-layer-3 skew probe the client fires (`GET /health`, CODING_STANDARDS §15.2.5) carries NO caller
 *    credential and is aimed at the configured origin — a background diagnostic must not spend, or misaim, a
 *    forwarded user token.
 *
 * Written before the factory existed (TDD red → green).
 */
import { inspect } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetContractSkewLatchForTests } from '@kitchensink/food-service-client';

import { CallerToken } from '../../auth/CallerToken.js';
import { FoodServiceClients } from '../FoodServiceClients.factory.js';

const FOOD_ORIGIN = 'https://food-pr-73.commise.app';
const SECRET = 'eyJhbGciOiJSUzI1NiJ9.CALLER-SESSION-JWT-DO-NOT-LOG.sIgNaTuRe';

/** The caller credential a request would carry. */
function caller(raw = SECRET): CallerToken {
    const token = CallerToken.fromAuthorizationHeader(`Bearer ${raw}`);

    if (token === undefined) {
        throw new Error('fixture: expected a CallerToken');
    }

    return token;
}

/** Split recorded calls into the API requests and the drift-layer-3 `GET /health` skew probes (§15.2.5). */
function partitionCalls(calls: readonly { url: string; headers: Record<string, string> }[]): {
    api: { url: string; headers: Record<string, string> }[];
    healthProbes: { url: string; headers: Record<string, string> }[];
} {
    return {
        api: calls.filter((call) => !call.url.endsWith('/health')),
        healthProbes: calls.filter((call) => call.url.endsWith('/health')),
    };
}

/** A `fetch` double that records every call and answers with an empty search result. */
function recordingFetch(): { impl: typeof fetch; calls: { url: string; headers: Record<string, string> }[] } {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({
            url,
            headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
        });

        // The skew probe reads `contractHash`; answering it with the search body would simply be indeterminate,
        // but answering it properly keeps the double honest about what each endpoint returns.
        const body = url.endsWith('/health') ? { status: 'ok', service: 'food' } : { results: [] };

        return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    });

    vi.stubGlobal('fetch', impl);

    return { impl: impl as unknown as typeof fetch, calls };
}

/** A factory over the fixed origin with a deliberately tiny typeahead deadline. */
function clients(typeaheadTimeoutMs = 25): FoodServiceClients {
    return new FoodServiceClients({ baseUrl: FOOD_ORIGIN, typeaheadTimeoutMs });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

// The client's skew probe latches once per ORIGIN per process (`@kitchensink/food-service-client`'s
// `contractSkew.ts`). Clearing it keeps these cases order-independent: otherwise only whichever test ran first
// would see a probe at all, and the probe-credential assertions below would pass vacuously.
beforeEach(() => {
    resetContractSkewLatchForTests();
});

describe('FoodServiceClients — forwarding the caller credential', () => {
    it('sends the caller bearer on the typeahead client', async () => {
        const { calls } = recordingFetch();

        await clients().typeahead(caller()).search('chicken');

        // Exactly ONE API request. The client also fires the unauthenticated `/health` skew probe, which is
        // asserted on separately below — it is not a call made on the caller's behalf.
        const { api } = partitionCalls(calls);
        expect(api).toHaveLength(1);
        expect(api[0]?.headers['authorization']).toBe(`Bearer ${SECRET}`);
    });

    it('sends the caller bearer on the standard (8s) client too', async () => {
        const { calls } = recordingFetch();

        await clients().standard(caller()).search('chicken');

        expect(calls[0]?.headers['authorization']).toBe(`Bearer ${SECRET}`);
    });

    it('gives each caller their OWN credential — there is no ambient or shared token', async () => {
        const { calls } = recordingFetch();
        const factory = clients();

        await factory.typeahead(caller('alice-token')).search('a');
        await factory.typeahead(caller('bob-token')).search('b');

        expect(partitionCalls(calls).api.map((call) => call.headers['authorization'])).toEqual([
            'Bearer alice-token',
            'Bearer bob-token',
        ]);
    });

    it('sends NO Authorization header when there is no caller credential (never a fallback token)', async () => {
        const { calls } = recordingFetch();

        await clients().standard(undefined).search('chicken');

        expect(calls[0]?.headers['authorization']).toBeUndefined();
    });
});

describe('FoodServiceClients — the target origin is not caller-influenceable', () => {
    it('always calls the configured food origin', async () => {
        const { calls } = recordingFetch();

        await clients().typeahead(caller()).search('chicken');

        expect(calls[0]?.url.startsWith(`${FOOD_ORIGIN}/api/v1/foods/search`)).toBe(true);
    });

    it('cannot be aimed elsewhere by the query — a URL-ish query stays a query parameter', async () => {
        const { calls } = recordingFetch();

        await clients().typeahead(caller()).search('https://attacker.example/steal');

        // The credential still goes to the food origin only; the hostile value is percent-encoded into
        // `?query=`, never into the request target.
        expect(calls[0]?.url.startsWith(`${FOOD_ORIGIN}/api/v1/foods/search?query=`)).toBe(true);
        expect(calls[0]?.url).not.toContain('//attacker.example');
    });
});

describe('FoodServiceClients — the two deadlines stay distinct', () => {
    /** A `fetch` that resolves only after `delayMs`, honouring an abort signal. */
    function slowFetch(delayMs: number): void {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (_input: string | URL | Request, init?: RequestInit) =>
                    new Promise<Response>((resolve, reject) => {
                        const timer = setTimeout(
                            () => resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })),
                            delayMs,
                        );

                        init?.signal?.addEventListener('abort', () => {
                            clearTimeout(timer);
                            reject(new DOMException('aborted', 'AbortError'));
                        });
                    }),
            ),
        );
    }

    it('aborts the typeahead client at its short deadline', async () => {
        slowFetch(400);

        await expect(clients(25).typeahead(caller()).search('chicken')).rejects.toMatchObject({ status: 503 });
    });

    it('does NOT abort the standard client at the typeahead deadline (they are separate budgets)', async () => {
        slowFetch(120);

        await expect(clients(25).standard(caller()).search('chicken')).resolves.toEqual({ results: [] });
    });
});

describe('FoodServiceClients — the credential never reaches an error', () => {
    it('is absent from a transport failure however it is stringified', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('fetch failed');
            }),
        );

        const error = await clients()
            .typeahead(caller())
            .search('chicken')
            .catch((thrown: unknown) => thrown);

        // The message, the stack, the JSON form and the full-depth inspect (which walks `cause`) must all
        // be clean — these are every route by which a swallowed error reaches a log or Sentry.
        expect(String((error as Error).message)).not.toContain(SECRET);
        expect(String((error as Error).stack)).not.toContain(SECRET);
        expect(JSON.stringify(error)).not.toContain(SECRET);
        expect(inspect(error, { depth: null })).not.toContain(SECRET);
    });

    it('is absent from an HTTP 401 error body mapping (the near-expiry case)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ error: 'Valid Clerk session or M2M token required' }), {
                        status: 401,
                    }),
            ),
        );

        const error = await clients()
            .standard(caller())
            .search('chicken')
            .catch((thrown: unknown) => thrown);

        expect(inspect(error, { depth: null })).not.toContain(SECRET);
    });
});

/**
 * The skew probe is a SECOND request this seam now emits, so it gets the same confused-deputy scrutiny as the
 * first. Drift layer 3 (CODING_STANDARDS §15.2.5), owner ruling 2026-08-11.
 */
describe('FoodServiceClients — the contract-skew probe is credential-free and correctly aimed', () => {
    it('fires the probe at the CONFIGURED origin only, carrying no caller credential', async () => {
        const { calls } = recordingFetch();

        await clients().typeahead(caller()).search('chicken');

        const { healthProbes } = partitionCalls(calls);
        expect(healthProbes).toHaveLength(1);
        expect(healthProbes[0]?.url).toBe(`${FOOD_ORIGIN}/health`);
        // The whole point: the forwarded user token does NOT ride along on a background diagnostic.
        expect(healthProbes[0]?.headers['authorization']).toBeUndefined();
    });

    it('never puts the caller secret anywhere in the probe request', async () => {
        const { calls } = recordingFetch();

        await clients().standard(caller()).search('chicken');

        const { healthProbes } = partitionCalls(calls);
        expect(healthProbes).toHaveLength(1);
        expect(inspect(healthProbes[0], { depth: null })).not.toContain(SECRET);
    });

    // Per-keystroke clients are the reason the latch is keyed on the origin rather than the instance: a probe per
    // client would be a probe per keystroke, i.e. a network call on the hottest path in the system.
    it('fires ONCE across many per-keystroke clients from the same factory', async () => {
        const { calls } = recordingFetch();
        const factory = clients();

        for (const term of ['c', 'ch', 'chi', 'chic', 'chick']) {
            await factory.typeahead(caller()).search(term);
        }

        const { api, healthProbes } = partitionCalls(calls);
        expect(api).toHaveLength(5);
        expect(healthProbes).toHaveLength(1);
    });
});
