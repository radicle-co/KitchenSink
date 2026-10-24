/**
 * The pool's settings reset (ADR-0059: `DELETE /api/v1/users/me/settings` restores "never chosen").
 *
 * Why it exists: `PATCH` can choose a setting and never un-choose it, and the deployed suites reuse pool users, so a
 * run that left `recipeViewMode = grid` on a signer changed what the next run saw (CI run 39165813897, iossigner02,
 * `recipes/delete`). The reset must therefore (a) really send the DELETE, as the slot, to identity, (b) treat a
 * refusal — a `404` from a server that predates the route included — as the FAILURE it is, never as "nothing to
 * reset", and (c) ride out only what a cold task causes.
 */
import { describe, expect, it, vi } from 'vitest';

import type { SessionHandle } from '@kitchensink/e2e-fixtures';

import { resetUserSettings, settingsResetVia } from '../src/settingsReset.js';

const ORIGIN = 'https://identity.sandbox.commise.app';
const URL_ = `${ORIGIN}/api/v1/users/me/settings`;
const SIGNER = 'iossigner02@example.com';
const NO_WAIT = { retries: 2, intervalMs: 0, attemptDeadlineMs: 1_000 };
const input = { identityOrigin: ORIGIN, subject: SIGNER, token: async () => 'signer-token' };

/** A fetch double that answers each call in turn (the last repeats), and records what it was asked. */
function identity(...answers: readonly (Response | Error)[]) {
    const calls: { url: string; method: string | undefined; authorization: string | null }[] = [];
    let index = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, authorization: new Headers(init?.headers).get('authorization') });
        const answer = answers[Math.min(index, answers.length - 1)] as Response | Error;
        index += 1;

        if (answer instanceof Error) {
            throw answer;
        }

        return answer.clone();
    });

    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const status = (code: number): Response => new Response(code === 204 ? null : '{}', { status: code });

describe('resetUserSettings', () => {
    it('sends DELETE /api/v1/users/me/settings as the slot, and resolves on 204', async () => {
        const { fetch, calls } = identity(status(204));

        await expect(resetUserSettings(input, { fetch, retry: NO_WAIT })).resolves.toBeUndefined();
        expect(calls).toEqual([{ url: URL_, method: 'DELETE', authorization: 'Bearer signer-token' }]);
    });

    it('drops trailing slashes from the origin', async () => {
        const { fetch, calls } = identity(status(204));

        await resetUserSettings({ ...input, identityOrigin: `${ORIGIN}//` }, { fetch, retry: NO_WAIT });

        expect(calls[0]?.url).toBe(URL_);
    });

    it('⛔ a 404 FAILS the reset, once, naming the route and the slot — it is never read as "nothing to reset"', async () => {
        const { fetch, calls } = identity(status(404));
        const failure = await resetUserSettings(input, { fetch, retry: NO_WAIT }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain('answered 404');
        expect((failure as Error).message).toContain(SIGNER);
        expect((failure as Error).message).toContain('DELETE /api/v1/users/me/settings');
        expect(calls).toHaveLength(1);
    });

    it.each([401, 403, 400, 409])(
        "⛔ a %s is identity's final answer: it fails the reset and is not retried",
        async (code) => {
            const { fetch, calls } = identity(status(code));

            await expect(resetUserSettings(input, { fetch, retry: NO_WAIT })).rejects.toThrow(`answered ${code}`);
            expect(calls).toHaveLength(1);
        },
    );

    it('rides out a cold identity task: a 503, a 429 and a dropped connection, then the 204', async () => {
        const { fetch, calls } = identity(status(503), status(429), new TypeError('fetch failed'), status(204));

        await expect(resetUserSettings(input, { fetch, retry: { ...NO_WAIT, retries: 3 } })).resolves.toBeUndefined();
        expect(calls).toHaveLength(4);
    });

    it('gives up after its bound, with the last status', async () => {
        const { fetch, calls } = identity(status(503));

        await expect(resetUserSettings(input, { fetch, retry: NO_WAIT })).rejects.toThrow('answered 503');
        expect(calls).toHaveLength(NO_WAIT.retries + 1);
    });

    it('⛔ bounds each attempt with a signal, so a server that never answers cannot hold the reset', async () => {
        const signals: (AbortSignal | null | undefined)[] = [];
        const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            signals.push(init?.signal);

            return status(204);
        }) as unknown as typeof globalThis.fetch;

        await resetUserSettings(input, { fetch, retry: NO_WAIT });

        expect(signals[0]).toBeInstanceOf(AbortSignal);
    });

    it('does not read the body of a 204 (there is none), so an empty answer is a success', async () => {
        const { fetch } = identity(new Response(null, { status: 204 }));

        await expect(resetUserSettings(input, { fetch, retry: NO_WAIT })).resolves.toBeUndefined();
    });
});

describe('settingsResetVia', () => {
    const handle = (email: string): SessionHandle => ({
        sessionId: `sess_${email}`,
        devJwt: 'dev',
        fapi: 'https://x.clerk.accounts.dev/v1',
        origin: 'https://pr-91.sandbox.commise.app',
        email,
    });

    it('resets as the HANDLE it is given: its own token, and its address in the message', async () => {
        const { fetch, calls } = identity(status(204), status(404));
        const port = settingsResetVia(ORIGIN, {
            fetch,
            retry: NO_WAIT,
            token: (h) => async () => `token-of-${h.email}`,
        });

        await port.reset(handle('a@example.com'));
        await expect(port.reset(handle('b@example.com'))).rejects.toThrow('b@example.com');

        expect(calls.map((call) => call.authorization)).toEqual([
            'Bearer token-of-a@example.com',
            'Bearer token-of-b@example.com',
        ]);
    });
});
