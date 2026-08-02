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
 *
 * Written before the factory existed (TDD red → green).
 */
import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CallerToken } from '../../auth/caller-token.js';
import { FoodServiceClients } from '../food-service-clients.factory.js';

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

/** A `fetch` double that records every call and answers with an empty search result. */
function recordingFetch(): { impl: typeof fetch; calls: { url: string; headers: Record<string, string> }[] } {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
            url: String(input),
            headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
        });

        return new Response(JSON.stringify({ results: [] }), {
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

describe('FoodServiceClients — forwarding the caller credential', () => {
    it('sends the caller bearer on the typeahead client', async () => {
        const { calls } = recordingFetch();

        await clients().typeahead(caller()).search('chicken');

        expect(calls).toHaveLength(1);
        expect(calls[0]?.headers['authorization']).toBe(`Bearer ${SECRET}`);
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

        expect(calls.map((call) => call.headers['authorization'])).toEqual(['Bearer alice-token', 'Bearer bob-token']);
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
