/**
 * The session layer's rules, exercised where they can fail: the `azp` guard, the test-address gate, the
 * re-mint's refusal to hand back nothing, and the claim decoding that everything else rests on.
 *
 * The sign-in handshake itself is NOT re-implemented here — a test double of Clerk's FAPI would assert that
 * our mock matches our code, which proves nothing about Clerk. What is asserted is the handshake's
 * SEQUENCE and the facts it must carry (`Origin` on every call, the fixed dev code, the dev-browser JWT on
 * the query string), because those are the parts a refactor breaks silently.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    assertAzp,
    assertTestAddress,
    CLERK_TEST_CODE,
    decodeClaims,
    establishSession,
    fapiHostFromPublishableKey,
    remintFromSession,
    type SessionHandle,
} from '../src/clerkSession.js';

/** A JWT with the given claims — signature irrelevant, nothing here verifies one. */
const jwt = (claims: Record<string, unknown>): string =>
    `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const ORIGIN = 'https://pr-91.sandbox.commise.app';

const handle: SessionHandle = {
    sessionId: 'sess_1',
    devJwt: 'dev_1',
    fapi: 'https://x.clerk.accounts.dev/v1',
    origin: ORIGIN,
    email: 'commise-e2e-signin-k+clerk_test@example.com',
};

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe('fapiHostFromPublishableKey', () => {
    it('decodes the host the publishable key carries, dropping the trailing $', () => {
        const key = `pk_test_${Buffer.from('nice-fowl-6.clerk.accounts.dev$').toString('base64')}`;

        expect(fapiHostFromPublishableKey(key)).toBe('nice-fowl-6.clerk.accounts.dev');
    });
});

describe('decodeClaims', () => {
    it('reads the payload', () => {
        expect(decodeClaims(jwt({ azp: ORIGIN, sub: 'user_1' }))).toEqual({ azp: ORIGIN, sub: 'user_1' });
    });

    it('answers empty for anything that is not a JWT, rather than throwing', () => {
        expect(decodeClaims('not-a-jwt')).toEqual({});
        expect(decodeClaims('')).toEqual({});
    });
});

describe('assertAzp', () => {
    it('accepts a token whose azp is the origin we asked for', () => {
        expect(assertAzp(jwt({ azp: ORIGIN, sub: 'user_1' }), ORIGIN)).toEqual({
            token: expect.any(String),
            azp: ORIGIN,
            sub: 'user_1',
        });
    });

    it('REFUSES a token minted for another origin — the deployed services would answer 401', () => {
        expect(() => assertAzp(jwt({ azp: 'https://evil.example', sub: 'u' }), ORIGIN)).toThrow(/expected/);
    });

    it('REFUSES an azp-less token — the Backend API shape both services reject', () => {
        expect(() => assertAzp(jwt({ sub: 'u' }), ORIGIN)).toThrow(/azp=undefined/);
    });

    it('tolerates a missing sub rather than crashing on it', () => {
        expect(assertAzp(jwt({ azp: ORIGIN }), ORIGIN).sub).toBe('');
    });
});

describe('assertTestAddress', () => {
    it('accepts a +clerk_test address', () => {
        expect(() => assertTestAddress('a+clerk_test@example.com')).not.toThrow();
    });

    it('REFUSES a real address — it would send real mail and reject the fixed code', () => {
        expect(() => assertTestAddress('someone@example.com')).toThrow(/clerk_test/);
    });
});

describe('remintFromSession', () => {
    it('mints from the SESSION endpoint, carrying the dev JWT and the Origin', async () => {
        const doFetch = vi.fn().mockResolvedValue(jsonResponse({ jwt: jwt({ azp: ORIGIN, sub: 'user_1' }) }));

        const credential = await remintFromSession(handle, doFetch as unknown as typeof fetch);

        expect(credential.sub).toBe('user_1');

        const [url, init] = doFetch.mock.calls[0] as [string, RequestInit];

        // The rate-limited endpoint is sign-in; this must be the session-token one, or a long run trips a
        // multi-minute cool-down halfway through.
        expect(url).toContain('/client/sessions/sess_1/tokens');
        expect(url).toContain('__clerk_db_jwt=dev_1');
        expect((init.headers as Record<string, string>)['Origin']).toBe(ORIGIN);
    });

    it('THROWS, naming the session, when Clerk returns no jwt', async () => {
        const doFetch = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ code: 'session_not_found' }] }));

        await expect(remintFromSession(handle, doFetch as unknown as typeof fetch)).rejects.toThrow(
            /could not re-mint a token for commise-e2e-signin-k\+clerk_test@example\.com/,
        );
    });

    it('REFUSES a token whose azp is not this session"s origin', async () => {
        const doFetch = vi.fn().mockResolvedValue(jsonResponse({ jwt: jwt({ azp: 'https://other', sub: 'u' }) }));

        await expect(remintFromSession(handle, doFetch as unknown as typeof fetch)).rejects.toThrow(/expected/);
    });
});

describe('establishSession', () => {
    const publishableKey = `pk_test_${Buffer.from('x.clerk.accounts.dev$').toString('base64')}`;

    it('walks the handshake in order and returns a handle, minting NO token', async () => {
        const doFetch = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'dev_1' }))
            .mockResolvedValueOnce(
                jsonResponse({
                    response: {
                        id: 'sia_1',
                        supported_first_factors: [{ strategy: 'email_code', email_address_id: 'idn_1' }],
                    },
                }),
            )
            .mockResolvedValueOnce(jsonResponse({}))
            .mockResolvedValueOnce(jsonResponse({ response: { created_session_id: 'sess_9' } }));

        const established = await establishSession({
            email: 'a+clerk_test@example.com',
            publishableKey,
            origin: ORIGIN,
            fetch: doFetch as unknown as typeof fetch,
        });

        expect(established).toMatchObject({ sessionId: 'sess_9', devJwt: 'dev_1', origin: ORIGIN });

        const urls = doFetch.mock.calls.map((call) => String(call[0]));

        expect(urls[0]).toContain('/dev_browser');
        expect(urls[1]).toContain('/client/sign_ins');
        expect(urls[2]).toContain('/prepare_first_factor');
        expect(urls[3]).toContain('/attempt_first_factor');

        // ⛔ FOUR calls, not five. Establishing a session must not also mint — the whole point is that the
        // expensive half happens once and the cheap half happens per reset.
        expect(doFetch).toHaveBeenCalledTimes(4);

        // Every call carries the Origin, because Clerk stamps it as `azp`.
        for (const call of doFetch.mock.calls) {
            expect(((call[1] as RequestInit).headers as Record<string, string>)['Origin']).toBe(ORIGIN);
        }

        // The fixed dev code, not a password: a password sign-in on this instance demands a second factor.
        const attemptInit = doFetch.mock.calls[3]?.[1] as RequestInit | undefined;
        expect(String(attemptInit?.body)).toContain(CLERK_TEST_CODE);
    });

    it('THROWS when the dev-browser handshake fails, rather than proceeding blind', async () => {
        const doFetch = vi.fn().mockResolvedValue(jsonResponse({}));

        await expect(
            establishSession({
                email: 'a+clerk_test@example.com',
                publishableKey,
                origin: ORIGIN,
                fetch: doFetch as unknown as typeof fetch,
            }),
        ).rejects.toThrow(/dev_browser handshake failed/);
    });

    it('THROWS when the instance offers no email_code factor for the address', async () => {
        const doFetch = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'dev_1' }))
            .mockResolvedValueOnce(jsonResponse({ response: { id: 'sia_1', supported_first_factors: [] } }));

        await expect(
            establishSession({
                email: 'a+clerk_test@example.com',
                publishableKey,
                origin: ORIGIN,
                fetch: doFetch as unknown as typeof fetch,
            }),
        ).rejects.toThrow(/no email_code first factor/);
    });

    it('REFUSES a real address before making any network call at all', async () => {
        const doFetch = vi.fn();

        await expect(
            establishSession({
                email: 'someone@example.com',
                publishableKey,
                origin: ORIGIN,
                fetch: doFetch as unknown as typeof fetch,
            }),
        ).rejects.toThrow(/clerk_test/);
        expect(doFetch).not.toHaveBeenCalled();
    });
});
