/**
 * The identity request loop's FINAL refusals are typed: a caller that needs to tell one status from another (the
 * settings reset reads a `404` as "the deploy has not landed") reads `status`, never the message text.
 */
import { describe, expect, it, vi } from 'vitest';

import { isIdentityRefusedError } from '../src/identityRefusedError.js';
import { requestIdentity } from '../src/identityRequest.js';

const NO_WAIT = { retries: 1, intervalMs: 0, attemptDeadlineMs: 1_000 };

/** A fetch double that always answers `code`. */
const answering = (code: number): typeof globalThis.fetch =>
    vi.fn(async () => new Response('{}', { status: code })) as unknown as typeof globalThis.fetch;

const call = (fetch: typeof globalThis.fetch) =>
    requestIdentity(
        {
            identityOrigin: 'https://identity.sandbox.commise.app',
            path: '/api/v1/users/me/settings',
            method: 'DELETE',
            asDescription: 'signer@example.com',
            token: async () => 'token',
            onOk: async () => undefined,
        },
        { fetch, retry: NO_WAIT },
    ).catch((error: unknown) => error);

describe('requestIdentity refusals', () => {
    it.each([400, 401, 403, 404, 409])(
        'a %s rejects with an IdentityRefusedError carrying that status',
        async (code) => {
            const failure = await call(answering(code));

            expect(isIdentityRefusedError(failure)).toBe(true);
            expect(isIdentityRefusedError(failure) && failure.status).toBe(code);
            expect((failure as Error).message).toBe(
                `DELETE https://identity.sandbox.commise.app/api/v1/users/me/settings as signer@example.com answered ${code}`,
            );
        },
    );

    it('a transient status that never clears is NOT a refusal: identity never answered finally', async () => {
        const failure = await call(answering(503));

        expect(failure).toBeInstanceOf(Error);
        expect(isIdentityRefusedError(failure)).toBe(false);
    });

    it('the guard refuses lookalikes', () => {
        expect(isIdentityRefusedError(new Error('answered 404'))).toBe(false);
        expect(isIdentityRefusedError({ status: 404, name: 'IdentityRefusedError' })).toBe(false);
    });
});
