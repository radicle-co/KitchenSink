/**
 * The session layer's rules, exercised where they can fail: the `azp` guard, the test-address gate, the
 * re-mint's refusal to hand back nothing, and the claim decoding that everything else rests on.
 *
 * The sign-in handshake itself is NOT re-implemented here — a test double of Clerk's FAPI would assert that
 * our mock matches our code, which proves nothing about Clerk. What is asserted is the handshake's
 * SEQUENCE and the facts it must carry (`Origin` on every call, the ticket in the form body, the dev-browser
 * JWT on the query string, the pause after a create), because those are the parts a refactor breaks silently.
 * Clerk's own behaviour — which steps it throttles, that a ticket sign-in stamps `azp` from `Origin` — was
 * measured live against the sandbox instance and is recorded on the implementation.
 */
import { ClerkAPIResponseError } from '@clerk/backend/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    assertAzp,
    decodeClaims,
    establishSession,
    fapiHostFromPublishableKey,
    remintFromSession,
    SIGN_IN_CREATE_GAP_MS,
    ticketMinterFor,
    type SessionHandle,
    withClerkBackendRetry,
} from '../src/clerkSession.js';

/** The Backend API client `ticketMinterFor` builds — the two calls it makes are the whole surface. */
const clerk = vi.hoisted(() => ({
    getUserList: vi.fn(),
    createSignInToken: vi.fn(),
}));

vi.mock('@clerk/backend', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@clerk/backend')>()),
    createClerkClient: () => ({
        users: { getUserList: clerk.getUserList },
        signInTokens: { createSignInToken: clerk.createSignInToken },
    }),
}));

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

    it('never prints the response body — a FAPI body piggybacks the client, whose sessions carry live JWTs', async () => {
        // clerk-js reads `payload.client || payload.meta?.client` from every Frontend API answer, and a session in
        // that client carries `last_active_token.jwt`. The old message was `JSON.stringify(minted)`, which would
        // print that token into a CI log the moment Clerk answered without a top-level `jwt`.
        const body = {
            errors: [{ code: 'session_not_found' }],
            meta: { client: { sessions: [{ last_active_token: { jwt: 'live-session-jwt' } }] } },
        };
        const doFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 404 }));

        const failure = remintFromSession(handle, doFetch as unknown as typeof fetch);

        await expect(failure).rejects.toThrow(
            /token re-mint for commise-e2e-signin-k\+clerk_test@example\.com: 404.*session_not_found/,
        );
        await expect(failure).rejects.not.toThrow(/live-session-jwt|dev_1/);
    });

    it('REFUSES a token whose azp is not this session"s origin', async () => {
        const doFetch = vi.fn().mockResolvedValue(jsonResponse({ jwt: jwt({ azp: 'https://other', sub: 'u' }) }));

        await expect(remintFromSession(handle, doFetch as unknown as typeof fetch)).rejects.toThrow(/expected/);
    });
});

/**
 * ⛔ REWRITTEN, not edited to compile: `establishSession` used to walk the EMAIL-CODE handshake
 * (`sign_ins` → `prepare_first_factor` → `attempt_first_factor`), and these tests pinned those four calls.
 * The deployed k6 pool died three runs out of four on Clerk refusing exactly those verification steps
 * (`too_many_requests`, and `verification_not_sent` when the unread prepare had been refused). A TICKET sign-in
 * has no verification step to refuse, so the tests now prove the ticket path and the rules around it.
 */
describe('establishSession', () => {
    const publishableKey = `pk_test_${Buffer.from('x.clerk.accounts.dev$').toString('base64')}`;
    /** A roster address — `establishSession` signs into nothing else. */
    const email = 'test-alfa+clerk_test@radcile.com';

    /** The two Frontend API answers of a sign-in that works. */
    const signInFetch = () =>
        vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'dev_1' }))
            .mockResolvedValueOnce(jsonResponse({ response: { status: 'complete', created_session_id: 'sess_9' } }));

    const run = (overrides: {
        readonly fetch: ReturnType<typeof vi.fn>;
        readonly mintTicket?: ReturnType<typeof vi.fn>;
        readonly sleep?: ReturnType<typeof vi.fn>;
        readonly email?: string;
        readonly publishableKey?: string;
    }) =>
        establishSession({
            email: overrides.email ?? email,
            publishableKey: overrides.publishableKey ?? publishableKey,
            origin: ORIGIN,
            mintTicket: (overrides.mintTicket ?? vi.fn().mockResolvedValue('ticket_1')) as (
                e: string,
            ) => Promise<string>,
            fetch: overrides.fetch as unknown as typeof fetch,
            sleep: (overrides.sleep ?? vi.fn().mockResolvedValue(undefined)) as (ms: number) => Promise<void>,
        });

    it('signs in by TICKET — a dev browser, then ONE sign-in carrying the ticket — and mints no token', async () => {
        const doFetch = signInFetch();
        const mintTicket = vi.fn().mockResolvedValue('ticket_1');

        const established = await run({ fetch: doFetch, mintTicket });

        expect(established).toMatchObject({ sessionId: 'sess_9', devJwt: 'dev_1', origin: ORIGIN, email });
        expect(mintTicket).toHaveBeenCalledWith(email);

        const urls = doFetch.mock.calls.map((call) => String(call[0]));

        expect(urls[0]).toContain('/dev_browser');
        expect(urls[1]).toContain('/client/sign_ins?__clerk_db_jwt=dev_1');
        // ⛔ TWO calls. No `prepare_first_factor` / `attempt_first_factor` — the verification steps Clerk
        // throttled — and no token mint, because establishing a session is the once-per-identity half.
        expect(doFetch).toHaveBeenCalledTimes(2);

        const signInInit = doFetch.mock.calls[1]?.[1] as RequestInit | undefined;
        const body = signInInit?.body;

        expect(body instanceof URLSearchParams ? Object.fromEntries(body) : undefined).toEqual({
            strategy: 'ticket',
            ticket: 'ticket_1',
        });

        // Every call carries the Origin, because Clerk stamps it as `azp`.
        for (const call of doFetch.mock.calls) {
            expect(((call[1] as RequestInit).headers as Record<string, string>)['Origin']).toBe(ORIGIN);
        }
    });

    it('holds SIGN_IN_CREATE_GAP_MS AFTER the sign-in is created, so the next create cannot land inside the window', async () => {
        const order: string[] = [];
        const doFetch = vi.fn().mockImplementation(async (url: string) => {
            order.push(url.includes('/dev_browser') ? 'dev_browser' : 'sign_in');

            return url.includes('/dev_browser')
                ? jsonResponse({ token: 'dev_1' })
                : jsonResponse({ response: { status: 'complete', created_session_id: 'sess_9' } });
        });
        const sleep = vi.fn().mockImplementation(async (ms: number) => {
            order.push(`sleep ${ms}`);
        });

        await run({ fetch: doFetch, sleep });

        expect(order).toEqual(['dev_browser', 'sign_in', `sleep ${SIGN_IN_CREATE_GAP_MS}`]);
        // Clerk allows 5 sign-in creates per 10 s per IP; a gap of at least 2.5 s keeps any window at 4.
        expect(SIGN_IN_CREATE_GAP_MS).toBeGreaterThanOrEqual(2_500);
    });

    it('THROWS on a throttled sign-in with the step, status, Retry-After and Clerk code — ONE call, never slept on', async () => {
        const doFetch = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'dev_1' }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ errors: [{ code: 'too_many_requests' }] }), {
                    status: 429,
                    headers: { 'retry-after': '600' },
                }),
            );
        const sleep = vi.fn();

        const failure = run({ fetch: doFetch, mintTicket: vi.fn().mockResolvedValue('ticket_secret'), sleep });

        await expect(failure).rejects.toThrow(
            /sign-in create for test-alfa\+clerk_test@radcile\.com: 429.*retry-after 600.*too_many_requests/,
        );
        // A 600 s penalty slept on inside a CI step is a hang, not a recovery.
        expect(doFetch).toHaveBeenCalledTimes(2);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('never puts the dev-browser JWT or the ticket in an error — both are credentials', async () => {
        // A real Response carries the URL it answered — and that URL's query string carries the dev-browser JWT.
        const answering = (response: Response, url: string): Response =>
            Object.defineProperty(response, 'url', { value: url });
        const doFetch = vi
            .fn()
            .mockImplementationOnce(async (url: string) => answering(jsonResponse({ token: 'dev_secret' }), url))
            .mockImplementationOnce(async (url: string) =>
                answering(new Response('{"errors":[{"code":"form_param_missing"}]}', { status: 422 }), url),
            );

        const failure = run({ fetch: doFetch, mintTicket: vi.fn().mockResolvedValue('ticket_secret') });

        await expect(failure).rejects.toThrow(/sign-in create.*422.*form_param_missing/);
        await expect(failure).rejects.not.toThrow(/dev_secret|ticket_secret/);
    });

    it('THROWS naming the dev-browser step when it is refused, rather than proceeding blind', async () => {
        const doFetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }));

        await expect(run({ fetch: doFetch })).rejects.toThrow(/dev browser.*503/);
    });

    it('THROWS when the ticket sign-in answers 200 but does not complete', async () => {
        const doFetch = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'dev_1' }))
            .mockResolvedValueOnce(jsonResponse({ response: { status: 'needs_second_factor' } }));

        await expect(run({ fetch: doFetch })).rejects.toThrow(/did not complete.*needs_second_factor/);
    });

    it('names the IDENTITY and the step when the ticket cannot be minted, never the ticket or the key', async () => {
        const mintTicket = vi.fn().mockRejectedValue(new Error('Unprocessable Entity'));

        await expect(run({ fetch: vi.fn(), mintTicket })).rejects.toThrow(
            /ticket mint for test-alfa\+clerk_test@radcile\.com: Unprocessable Entity/,
        );
    });

    it('REFUSES a real address before minting a ticket or calling Clerk at all', async () => {
        const doFetch = vi.fn();
        const mintTicket = vi.fn();

        await expect(run({ fetch: doFetch, mintTicket, email: 'someone@example.com' })).rejects.toThrow(
            /not a member of the test pool/,
        );
        expect(mintTicket).not.toHaveBeenCalled();
        expect(doFetch).not.toHaveBeenCalled();
    });

    /**
     * ⛔ REWRITTEN to prove the STRICTER gate. It used to accept any `+clerk_test` address, which admits every
     * other test user on the shared instance — including run-minted sign-up users and fixtures this repo no
     * longer owns. A ticket signs in whoever it names, so only the committed roster may be named.
     */
    it('REFUSES a +clerk_test address that is not on the pool roster', async () => {
        const doFetch = vi.fn();
        const mintTicket = vi.fn();

        await expect(
            run({ fetch: doFetch, mintTicket, email: 'commise-e2e-signin+clerk_test@example.com' }),
        ).rejects.toThrow(/not a member of the test pool/);
        expect(mintTicket).not.toHaveBeenCalled();
        expect(doFetch).not.toHaveBeenCalled();
    });

    it('REFUSES a production instance key before minting a ticket — a ticket signs in ANY user', async () => {
        const doFetch = vi.fn();
        const mintTicket = vi.fn();
        const liveKey = `pk_live_${Buffer.from('clerk.commise.app$').toString('base64')}`;

        await expect(run({ fetch: doFetch, mintTicket, publishableKey: liveKey })).rejects.toThrow(/development/);
        expect(mintTicket).not.toHaveBeenCalled();
        expect(doFetch).not.toHaveBeenCalled();
    });
});

/**
 * The create pause holds under CONCURRENT callers, not only sequential ones.
 *
 * The pause after a create keeps any 10 s window at four of Clerk's five creates — but only if the next create
 * cannot start before the pause ends. Every caller awaits today; these tests make that a property of the
 * function rather than of its callers. Each loads a FRESH module, because the queue is module state.
 */
describe('establishSession under concurrency', () => {
    const publishableKey = `pk_test_${Buffer.from('x.clerk.accounts.dev$').toString('base64')}`;

    /** A deferred sleep, so a test decides when a pause ends. */
    const gate = () => {
        let release: () => void = () => undefined;
        const done = new Promise<void>((resolve) => {
            release = resolve;
        });

        return { done, release };
    };

    const load = async () => {
        vi.resetModules();

        return (await import('../src/clerkSession.js')).establishSession;
    };

    const created = (sessionId: string): Response =>
        jsonResponse({ response: { status: 'complete', created_session_id: sessionId } });

    it('does not start a second sign-in create until the first create’s pause has ended', async () => {
        const establish = await load();
        const events: string[] = [];
        const firstPause = gate();
        const doFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
            const who = (init.body as URLSearchParams | undefined)?.get('ticket') ?? 'handshake';

            events.push(url.includes('/dev_browser') ? 'dev_browser' : `create ${who}`);

            return url.includes('/dev_browser') ? jsonResponse({ token: 'dev' }) : created(`sess_${who}`);
        });
        const call = (email: string, sleep: (ms: number) => Promise<void>) =>
            establish({
                email,
                publishableKey,
                origin: ORIGIN,
                mintTicket: async (address) => (address.includes('alfa') ? 'ticket_a' : 'ticket_b'),
                fetch: doFetch as unknown as typeof fetch,
                sleep,
            });

        const first = call('test-alfa+clerk_test@radcile.com', async () => {
            events.push('pause a');
            await firstPause.done;
        });
        const second = call('test-bravo+clerk_test@radcile.com', async () => {
            events.push('pause b');
        });

        await vi.waitFor(() => expect(events).toContain('pause a'));
        // Give the second caller every chance to run ahead of the pause.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(events).not.toContain('create ticket_b');

        firstPause.release();
        await Promise.all([first, second]);

        expect(events.indexOf('create ticket_b')).toBeGreaterThan(events.indexOf('pause a'));
    });

    it('owes the next sign-in a pause after a REFUSED create, without making the refused caller sleep', async () => {
        const establish = await load();
        const order: string[] = [];
        const doFetch = vi
            .fn()
            .mockImplementationOnce(async () => jsonResponse({ token: 'dev' }))
            .mockImplementationOnce(async () => {
                order.push('create 1');

                return new Response('{"errors":[{"code":"too_many_requests"}]}', { status: 429 });
            })
            .mockImplementationOnce(async () => jsonResponse({ token: 'dev' }))
            .mockImplementationOnce(async () => {
                order.push('create 2');

                return created('sess_2');
            });
        const refusedSleep = vi.fn();
        const nextSleep = vi.fn().mockImplementation(async (ms: number) => {
            order.push(`pause ${ms}`);
        });
        const input = {
            publishableKey,
            origin: ORIGIN,
            mintTicket: async () => 'ticket',
            fetch: doFetch as unknown as typeof fetch,
        };

        await expect(
            establish({ ...input, email: 'test-alfa+clerk_test@radcile.com', sleep: refusedSleep }),
        ).rejects.toThrow(/429/);
        expect(refusedSleep).not.toHaveBeenCalled();

        await establish({ ...input, email: 'test-bravo+clerk_test@radcile.com', sleep: nextSleep });

        // A refused create still counted against Clerk's window, so the next create waits the gap first.
        expect(order).toEqual([
            'create 1',
            `pause ${SIGN_IN_CREATE_GAP_MS}`,
            'create 2',
            `pause ${SIGN_IN_CREATE_GAP_MS}`,
        ]);
    });

    it('lets a queued caller proceed after the one ahead of it threw — the queue never jams on a failure', async () => {
        const establish = await load();
        const doFetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }));

        await expect(
            establish({
                email: 'test-alfa+clerk_test@radcile.com',
                publishableKey,
                origin: ORIGIN,
                mintTicket: async () => 'ticket',
                fetch: doFetch as unknown as typeof fetch,
            }),
        ).rejects.toThrow(/503/);

        doFetch.mockResolvedValueOnce(jsonResponse({ token: 'dev' })).mockResolvedValueOnce(created('sess_ok'));

        await expect(
            establish({
                email: 'test-bravo+clerk_test@radcile.com',
                publishableKey,
                origin: ORIGIN,
                mintTicket: async () => 'ticket',
                fetch: doFetch as unknown as typeof fetch,
                sleep: async () => undefined,
            }),
        ).resolves.toMatchObject({ sessionId: 'sess_ok' });
    });
});

describe('ticketMinterFor', () => {
    beforeEach(() => {
        clerk.getUserList.mockReset();
        clerk.createSignInToken.mockReset();
    });

    it('finds the ONE user with the address and mints a short-lived ticket for them', async () => {
        clerk.getUserList.mockResolvedValue({ data: [{ id: 'user_1' }], totalCount: 1 });
        clerk.createSignInToken.mockResolvedValue({ token: 'ticket_1' });

        await expect(ticketMinterFor('sk_test_x')('a+clerk_test@example.com')).resolves.toBe('ticket_1');

        expect(clerk.getUserList).toHaveBeenCalledWith({ emailAddress: ['a+clerk_test@example.com'] });

        const [params] = clerk.createSignInToken.mock.calls[0] as [{ userId: string; expiresInSeconds: number }];

        expect(params.userId).toBe('user_1');
        // An unused ticket is a live credential until it expires, so it must not outlive its use by much.
        expect(params.expiresInSeconds).toBeLessThanOrEqual(120);
    });

    it('THROWS when no user, or more than one, has the address', async () => {
        clerk.getUserList.mockResolvedValueOnce({ data: [], totalCount: 0 });
        await expect(ticketMinterFor('sk')('a+clerk_test@example.com')).rejects.toThrow(/found 0/);

        clerk.getUserList.mockResolvedValueOnce({ data: [{ id: 'u1' }, { id: 'u2' }], totalCount: 2 });
        await expect(ticketMinterFor('sk')('a+clerk_test@example.com')).rejects.toThrow(/found 2/);
        expect(clerk.createSignInToken).not.toHaveBeenCalled();
    });

    it('retries a Backend API 429 — a shared, recoverable limit — and does not retry anything else', async () => {
        vi.useFakeTimers();

        try {
            const throttled = new ClerkAPIResponseError('throttled', { data: [], status: 429 });

            clerk.getUserList.mockRejectedValueOnce(throttled).mockResolvedValue({ data: [{ id: 'user_1' }] });
            clerk.createSignInToken.mockResolvedValue({ token: 'ticket_1' });

            const minted = ticketMinterFor('sk')('a+clerk_test@example.com');
            await vi.runAllTimersAsync();

            await expect(minted).resolves.toBe('ticket_1');
            expect(clerk.getUserList).toHaveBeenCalledTimes(2);

            clerk.getUserList
                .mockReset()
                .mockRejectedValue(new ClerkAPIResponseError('forbidden', { data: [], status: 403 }));

            const refused = ticketMinterFor('sk')('a+clerk_test@example.com').catch((caught: unknown) => caught);
            await vi.runAllTimersAsync();

            expect(await refused).toBeInstanceOf(ClerkAPIResponseError);
            expect(clerk.getUserList).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

/**
 * ONE policy for waiting out the instance-wide Backend API rate limit, shared by the session minter, the lease port
 * and `poolAdmin`. Measured 2026-09-14: `poolAdmin --apply` died on a `429` carrying `retryAfter: 2` after p-retry's
 * default three quick retries, so the wait is what Clerk states. Each caller keeps its own retry budget — a CI
 * session has a deadline, a reconciliation does not — and a stated wait longer than the caller can afford fails at
 * once rather than retrying before Clerk said it would answer.
 */
describe('withClerkBackendRetry', () => {
    const throttled = (retryAfter?: number) =>
        new ClerkAPIResponseError('throttled', { data: [], status: 429, retryAfter });

    it('waits the retry-after Clerk states, then returns the answer', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const call = vi
            .fn()
            .mockRejectedValueOnce(throttled(2))
            .mockRejectedValueOnce(throttled(3))
            .mockResolvedValue('ok');

        await expect(withClerkBackendRetry(call, { retries: 3, maxWaitSeconds: 30, sleep })).resolves.toBe('ok');
        expect(sleep.mock.calls).toEqual([[2000], [3000]]);
    });

    it('doubles from two seconds when no retry-after is stated, capped at the caller’s maximum wait', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const call = vi.fn();

        for (let attempt = 0; attempt < 5; attempt += 1) {
            call.mockRejectedValueOnce(throttled());
        }

        call.mockResolvedValue('ok');

        await expect(withClerkBackendRetry(call, { retries: 5, maxWaitSeconds: 10, sleep })).resolves.toBe('ok');
        expect(sleep.mock.calls).toEqual([[2000], [4000], [8000], [10000], [10000]]);
    });

    it('gives up after the caller’s retry budget, with the 429 itself', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const call = vi.fn().mockRejectedValue(throttled(1));

        await expect(withClerkBackendRetry(call, { retries: 2, maxWaitSeconds: 30, sleep })).rejects.toMatchObject({
            status: 429,
        });
        expect(call).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('fails at once when Clerk asks for a longer wait than the caller can afford', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const call = vi.fn().mockRejectedValue(throttled(600));

        await expect(withClerkBackendRetry(call, { retries: 3, maxWaitSeconds: 30, sleep })).rejects.toMatchObject({
            status: 429,
        });
        expect(call).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    /**
     * Measured in CI run 34856885723 (shard 1): `@clerk/backend` turns a request that never got a response ("fetch
     * failed") into a `ClerkAPIResponseError` with NO status and one `unexpected_error` code, and an empty message.
     * One dropped connection failed the whole shard's global setup. It is retried like the rate limit, on the doubling
     * wait. No status reached the SDK, so the server may still have acted: a retried create then meets Clerk's
     * duplicate-address `422` rather than making a second user.
     */
    it('retries a transport failure — no status, `unexpected_error` — on the doubling wait', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const dropped = new ClerkAPIResponseError('', {
            data: [{ code: 'unexpected_error', message: 'fetch failed', long_message: '', meta: {} }],
            status: undefined as unknown as number,
        });
        const call = vi.fn().mockRejectedValueOnce(dropped).mockRejectedValueOnce(dropped).mockResolvedValue('ok');

        await expect(withClerkBackendRetry(call, { retries: 3, maxWaitSeconds: 30, sleep })).resolves.toBe('ok');
        expect(sleep.mock.calls).toEqual([[2000], [4000]]);
    });

    it('does not retry a Clerk answer that merely carries `unexpected_error` with a status', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const answered = new ClerkAPIResponseError('server error', {
            data: [{ code: 'unexpected_error', message: 'boom', long_message: '', meta: {} }],
            status: 500,
        });
        const call = vi.fn().mockRejectedValue(answered);

        await expect(withClerkBackendRetry(call, { retries: 3, maxWaitSeconds: 30, sleep })).rejects.toMatchObject({
            status: 500,
        });
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('never retries or waits on an error that is not the rate limit', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const call = vi.fn().mockRejectedValue(new ClerkAPIResponseError('forbidden', { data: [], status: 403 }));

        await expect(withClerkBackendRetry(call, { retries: 3, maxWaitSeconds: 30, sleep })).rejects.toMatchObject({
            status: 403,
        });
        expect(call).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });
});
