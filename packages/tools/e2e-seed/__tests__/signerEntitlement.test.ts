/**
 * The pool signer must be entitled to the paid features before `provision` seeds its world.
 *
 * Why: every Maestro flow of one run failed in its per-flow reset with `400 INVALID_VISIBILITY`, because the pool
 * signers' Clerk users carried no roles (`poolAdmin --apply` had not been run). The seeded world gives the signer
 * PRIVATE recipes, and the recipe service admits those only for an entitled caller. Identity reports that as
 * `account.paidFeatures` on `GET /api/v1/users/me`, so `provision` reads it first and refuses with the fix.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    assertSignerEntitled,
    isSignerNotEntitledError,
    judgeSignerEntitlement,
    SignerNotEntitledError,
} from '../src/signerEntitlement.js';

const ORIGIN = 'https://identity.sandbox.commise.app';
const SIGNER = 'test-signer+clerk_test@radcile.com';

/** A `GET /api/v1/users/me` body in the shape identity publishes, with the entitlement set. */
const profile = (paidFeatures: unknown): Record<string, unknown> => ({
    user: {
        id: '01J0K6000000000000000000AA',
        email: SIGNER,
        displayName: '',
        username: 'test_signer',
        avatarUrl: null,
        status: 'active',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
    },
    account: {
        id: '01J0K6000000000000000000AB',
        userId: '01J0K6000000000000000000AA',
        paidFeatures,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
    },
});

describe('judgeSignerEntitlement — the decision, over every answer', () => {
    it.each([
        ['granted', profile('granted'), 'entitled'],
        ['upsell (no paid role, gate on)', profile('upsell'), 'notEntitled'],
        ['hidden (no paid role, gate off)', profile('hidden'), 'notEntitled'],
        ['a value identity does not publish', profile('premium'), 'unreadable'],
        ['no account', { user: profile('granted')['user'] }, 'unreadable'],
        ['an account with no paidFeatures', { account: {} }, 'unreadable'],
        ['not an object', 'granted', 'unreadable'],
        ['null', null, 'unreadable'],
    ])('%s', (_label, body, kind) => {
        expect(judgeSignerEntitlement(body).kind).toBe(kind);
    });

    it('reads only account.paidFeatures: a body with no `user` half is still judged', () => {
        expect(judgeSignerEntitlement({ account: { paidFeatures: 'granted' } }).kind).toBe('entitled');
        expect(judgeSignerEntitlement({ account: { paidFeatures: 'upsell' } }).kind).toBe('notEntitled');
    });

    it('⛔ names the failing path in the reason, so a drifted field is found without a debugger', () => {
        const verdict = judgeSignerEntitlement(profile('premium'));

        expect(verdict.kind).toBe('unreadable');
        expect((verdict as { reason: string }).reason).toContain('account.paidFeatures');
        expect((judgeSignerEntitlement({ ok: true }) as { reason: string }).reason).toContain('account');
    });

    it('carries the value it saw when the signer is not entitled', () => {
        expect(judgeSignerEntitlement(profile('hidden'))).toEqual({ kind: 'notEntitled', paidFeatures: 'hidden' });
    });
});

/** A fetch double that answers each call in turn (the last repeats), and records what it was asked. */
function identity(...answers: readonly (Response | Error)[]) {
    const calls: { url: string; authorization: string | null }[] = [];
    let index = 0;
    // `assertSignerEntitled` always passes a string URL, so the double accepts only that.
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
        const answer = answers[Math.min(index, answers.length - 1)] as Response | Error;
        index += 1;

        if (answer instanceof Error) {
            throw answer;
        }

        return answer.clone();
    });

    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

/** A fetch double that keeps the `signal` each attempt carried. */
function identityRecordingSignals(answer: Response) {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        signals.push(init?.signal);

        return answer.clone();
    });

    return { fetch: fetch as unknown as typeof globalThis.fetch, signals };
}

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const NO_WAIT = { retries: 2, intervalMs: 0, attemptDeadlineMs: 1_000 };
const input = { identityOrigin: ORIGIN, signerEmail: SIGNER, token: async () => 'signer-token' };

describe('assertSignerEntitled — read the signer, refuse with the fix', () => {
    it('resolves when identity says the signer is granted, and asks as the signer', async () => {
        const { fetch, calls } = identity(json(200, profile('granted')));

        await expect(assertSignerEntitled(input, { fetch, retry: NO_WAIT })).resolves.toBeUndefined();
        expect(calls).toEqual([{ url: `${ORIGIN}/api/v1/users/me`, authorization: 'Bearer signer-token' }]);
    });

    it('⛔ refuses a signer with no paid role, naming the signer, the value and poolAdmin --apply', async () => {
        const { fetch } = identity(json(200, profile('hidden')));
        const failure = await assertSignerEntitled(input, { fetch, retry: NO_WAIT }).catch((error: unknown) => error);

        expect(isSignerNotEntitledError(failure)).toBe(true);
        expect(failure).toBeInstanceOf(SignerNotEntitledError);
        expect(String((failure as Error).message)).toContain(SIGNER);
        expect(String((failure as Error).message)).toContain("'hidden'");
        expect(String((failure as Error).message)).toContain('poolAdmin --apply');
        expect(String((failure as Error).message)).toContain('INVALID_VISIBILITY');
    });

    it('refuses an upsell answer the same way', async () => {
        const { fetch } = identity(json(200, profile('upsell')));

        await expect(assertSignerEntitled(input, { fetch, retry: NO_WAIT })).rejects.toSatisfy(
            isSignerNotEntitledError,
        );
    });

    it.each([
        ['401', json(401, { message: 'Unauthorized' }), /answered 401/u],
        ['403', json(403, { message: 'Forbidden' }), /answered 403/u],
        ['a body that is not JSON', new Response('<html>', { status: 200 }), /not JSON/u],
        ['a body that is not a profile', json(200, { ok: true }), /not the profile/u],
    ])('fails loudly, and NOT as "not entitled", on %s', async (_label, answer, message) => {
        const { fetch, calls } = identity(answer);
        const failure = await assertSignerEntitled(input, { fetch, retry: NO_WAIT }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(isSignerNotEntitledError(failure)).toBe(false);
        expect((failure as Error).message).toMatch(message);
        expect((failure as Error).message).toContain(SIGNER);
        // A refusal is the service's answer; asking again would hide it behind a loop.
        expect(calls).toHaveLength(1);
    });

    it('rides out a cold identity task: a 503 and a dropped connection, then the answer', async () => {
        const { fetch, calls } = identity(json(503, {}), new TypeError('fetch failed'), json(200, profile('granted')));

        await expect(assertSignerEntitled(input, { fetch, retry: NO_WAIT })).resolves.toBeUndefined();
        expect(calls).toHaveLength(3);
    });

    it('gives up after its bound, with the last status', async () => {
        const { fetch, calls } = identity(json(503, {}));
        const failure = await assertSignerEntitled(input, { fetch, retry: NO_WAIT }).catch((error: unknown) => error);

        expect((failure as Error).message).toMatch(/answered 503/u);
        expect(calls).toHaveLength(NO_WAIT.retries + 1);
    });

    it('⛔ bounds each attempt with a signal, so a server that never answers cannot hold the read', async () => {
        const { fetch, signals } = identityRecordingSignals(json(200, profile('granted')));

        await assertSignerEntitled(input, { fetch, retry: NO_WAIT });

        expect(signals).toHaveLength(1);
        expect(signals[0]).toBeInstanceOf(AbortSignal);
    });

    it('drops trailing slashes from the origin', async () => {
        const { fetch, calls } = identity(json(200, profile('granted')));

        await assertSignerEntitled({ ...input, identityOrigin: `${ORIGIN}//` }, { fetch, retry: NO_WAIT });

        expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/users/me`);
    });
});

describe('assertSignerEntitled — a body read that is cut short', () => {
    /** A 200 whose body read fails with `failure`, then (when `then` is given) a good answer. */
    function bodyFails(failure: Error, then?: Response) {
        const failing = { ok: true, status: 200, json: async () => Promise.reject(failure) } as unknown as Response;
        const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 || then === undefined ? failing : then.clone()));

        return fetch;
    }

    it.each([
        ['a timeout', new DOMException('The operation timed out.', 'TimeoutError')],
        ['an abort', new DOMException('The operation was aborted.', 'AbortError')],
        ['a stream cut short', new TypeError('terminated')],
    ])('⛔ retries when the body read is cut short (%s), as it does before the headers', async (_l, failure) => {
        const fetch = bodyFails(failure, json(200, profile('granted')));

        await expect(
            assertSignerEntitled(input, { fetch: fetch as unknown as typeof globalThis.fetch, retry: NO_WAIT }),
        ).resolves.toBeUndefined();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('stays final for a body that really is not JSON: one attempt, and it says so', async () => {
        const fetch = bodyFails(new SyntaxError('Unexpected token < in JSON'));

        await expect(
            assertSignerEntitled(input, { fetch: fetch as unknown as typeof globalThis.fetch, retry: NO_WAIT }),
        ).rejects.toThrow(/body that is not JSON/u);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
