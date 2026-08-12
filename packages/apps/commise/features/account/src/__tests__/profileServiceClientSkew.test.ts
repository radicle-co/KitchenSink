/**
 * DRIFT LAYER 3 (Skew) WIRING for identity — CODING_STANDARDS §15.2.5, GR-017 §17-b.5, owner ruling 2026-08-11
 * (a mismatch WARNS).
 *
 * `contractSkew.test.ts` proves the comparison itself. These cases prove the CLIENT's half of the contract: that
 * the check fires from the TRANSPORT (not the constructor), that it reaches the configured sink, and — the part
 * that actually matters in production — that it cannot influence the caller's call in any way.
 *
 * ⚠️ IT IS A SEPARATE FILE, NOT A `describe` ADDED TO `profileServiceClient.test.ts`, and that is deliberate: the
 * once-per-origin latch is MODULE scope, so it must be reset per case, and `resetContractSkewLatchForTests` clears
 * a set the other file's cases would otherwise be silently racing.
 *
 * ⚠️ THE REASON THIS SURFACE MATTERS MOST. Identity is the service every request touches and the one every
 * already-shipped mobile binary must keep talking to — the released-binary case §15.2.5 names as the reason drift
 * layer 3 exists. It had NO consumer-side guard at all until this change, while food and recipe both did.
 */
import { CONTRACT_HASH } from '@kitchensink/schema-identity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetContractSkewLatchForTests } from '../contractSkew.js';
import { makeUserProfile } from '../__fixtures__/index.js';
import { ProfileServiceClient } from '../profileServiceClient.js';

const BASE = 'https://identity.example.test';

/** A well-formed fingerprint that is deliberately NOT this package's pinned one. */
const SERVED_HASH = 'b'.repeat(64);

/**
 * A `fetch` double answering `/health` with `healthBody` and every other path with the profile.
 *
 * A FRESH `Response` per call, never a shared instance: a `Response` body is a single-use stream, so a reused one
 * makes the second read throw "Body is unusable" — which the probe correctly swallows into silence, silently
 * voiding any test that expects a warning.
 */
function routingFetch(healthBody: unknown): typeof fetch {
    return vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith('/health')
            ? new Response(JSON.stringify(healthBody), { status: 200 })
            : new Response(JSON.stringify(makeUserProfile()), { status: 200 }),
    ) as unknown as typeof fetch;
}

beforeEach(() => {
    resetContractSkewLatchForTests();
});

describe('ProfileServiceClient — contract-skew reporting', () => {
    /*
     * The constructor runs per hook call on web and per server-rendered request. A probe there would put an extra
     * `/health` on the sign-in path — for the AUTH service — which is why the check hangs off the transport.
     */
    it('performs NO network call when a client is merely constructed', () => {
        const fetchMock = vi.fn() as unknown as typeof fetch;

        new ProfileServiceClient({ baseUrl: BASE, fetch: fetchMock, warn: vi.fn() });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('warns through the configured sink when identity serves a different fingerprint', async () => {
        const warn = vi.fn();
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            fetch: routingFetch({ status: 'ok', service: 'identity', contractHash: SERVED_HASH }),
            warn,
        });

        await client.getMe();

        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });
        // The message must name BOTH sides, or a reader cannot tell which artifact to rebuild.
        expect(warn.mock.calls[0]?.[0]).toContain(SERVED_HASH.slice(0, 12));
        expect(warn.mock.calls[0]?.[0]).toContain(CONTRACT_HASH.slice(0, 12));
        expect(warn.mock.calls[0]?.[0]).toContain('@kitchensink/schema-identity');
    });

    /*
     * THE ruling, asserted at the boundary that matters: warn, do not refuse. The call still succeeds and returns
     * exactly what it would have returned with no skew at all. On the auth surface, the alternative is an identity
     * deploy locking every non-lockstep client out of sign-in.
     */
    it('returns the caller a normal, unchanged profile while skewed — it does not refuse', async () => {
        const warn = vi.fn();
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            fetch: routingFetch({ status: 'ok', service: 'identity', contractHash: SERVED_HASH }),
            warn,
        });

        await expect(client.getMe()).resolves.toStrictEqual(makeUserProfile());
        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });
    });

    it('stays silent when identity serves the fingerprint this package was built against', async () => {
        const warn = vi.fn();
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            fetch: routingFetch({ status: 'ok', service: 'identity', contractHash: CONTRACT_HASH }),
            warn,
        });

        await client.getMe();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(warn).not.toHaveBeenCalled();
    });

    it('warns ONCE across several requests from separately constructed clients on one origin', async () => {
        const warn = vi.fn();
        const fetchImpl = routingFetch({ status: 'ok', service: 'identity', contractHash: SERVED_HASH });

        for (let index = 0; index < 3; index += 1) {
            await new ProfileServiceClient({ baseUrl: BASE, fetch: fetchImpl, warn }).getMe();
        }

        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });

        const healthCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
            String(url).endsWith('/health'),
        );

        expect(healthCalls).toHaveLength(1);
    });

    /*
     * The probe is fire-and-forget, and this is what proves it: a `/health` that NEVER answers must not delay or
     * hang the caller's request. If the probe were awaited, this test would time out rather than fail.
     */
    it('does not wait for the probe: the caller resolves even when /health never answers', async () => {
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            warn: vi.fn(),
            fetch: vi.fn(async (url: string | URL | Request) => {
                if (String(url).endsWith('/health')) {
                    return new Promise<Response>(() => {}); // never settles
                }

                return new Response(JSON.stringify(makeUserProfile()), { status: 200 });
            }) as unknown as typeof fetch,
        });

        await expect(client.getMe()).resolves.toStrictEqual(makeUserProfile());
    });

    /*
     * ⚠️ The probe must be UNAUTHENTICATED. `/health` is public precisely so a consumer can ask about skew before it
     * holds a credential, and a background diagnostic has no business spending the caller's token — which on THIS
     * service is the session token itself.
     */
    it('sends no Authorization header on the probe, even when the client holds a token', async () => {
        const fetchImpl = routingFetch({ status: 'ok', service: 'identity', contractHash: SERVED_HASH });
        const client = new ProfileServiceClient({ baseUrl: BASE, fetch: fetchImpl, token: 'tok-abc', warn: vi.fn() });

        await client.getMe();

        await vi.waitFor(() => {
            const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;

            expect(calls.filter(([url]) => String(url).endsWith('/health'))).toHaveLength(1);
        });

        const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
        const [, probeInit] = calls.find(([url]) => String(url).endsWith('/health')) as [unknown, RequestInit];
        const [, apiInit] = calls.find(([url]) => !String(url).endsWith('/health')) as [unknown, RequestInit];

        expect((probeInit.headers as Record<string, string>)['authorization']).toBeUndefined();
        // Non-vacuity: the API call DID carry the token, so the absence above is about the probe, not about a
        // client that never authenticates anything.
        expect((apiInit.headers as Record<string, string>)['authorization']).toBe('Bearer tok-abc');
    });

    /*
     * ⚠️ NOT GATED ON `response.ok`. A skew is MORE likely to surface as a FAILING request than a succeeding one —
     * a client sending a field the deployed service no longer accepts gets a 400 — so gating the probe on success
     * would mute the signal in exactly the case it exists for.
     */
    it('still reports skew when the caller’s own request failed', async () => {
        const warn = vi.fn();
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            warn,
            fetch: vi.fn(async (url: string | URL | Request) =>
                String(url).endsWith('/health')
                    ? new Response(JSON.stringify({ status: 'ok', service: 'identity', contractHash: SERVED_HASH }), {
                          status: 200,
                      })
                    : new Response(JSON.stringify({ code: 'BAD_REQUEST', message: 'nope' }), { status: 400 }),
            ) as unknown as typeof fetch,
        });

        await expect(client.getMe()).rejects.toThrow();
        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });
    });

    // Absence is silence: an identity older than `contractHash` publication must not look like skew, or every
    // pre-publication deployment is noisy and the real warning gets muted.
    it('stays silent when identity publishes no fingerprint at all', async () => {
        const warn = vi.fn();
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            fetch: routingFetch({ status: 'ok', service: 'identity' }),
            warn,
        });

        await client.getMe();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(warn).not.toHaveBeenCalled();
    });

    // The shared ALB answers an unmatched host with a fixed-response 404 whose body is `text/plain` (ADR-0003), so
    // a non-JSON body is a real production shape rather than a hypothetical.
    it('stays silent when /health answers with a non-JSON body', async () => {
        const warn = vi.fn();
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            warn,
            fetch: vi.fn(async (url: string | URL | Request) =>
                String(url).endsWith('/health')
                    ? new Response('<html>502 Bad Gateway</html>', { status: 200 })
                    : new Response(JSON.stringify(makeUserProfile()), { status: 200 }),
            ) as unknown as typeof fetch,
        });

        await client.getMe();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(warn).not.toHaveBeenCalled();
    });
});
