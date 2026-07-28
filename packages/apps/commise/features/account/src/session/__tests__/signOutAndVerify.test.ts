/**
 * Unit tests for the CROSS-PLATFORM core of the sign-out command (ADR-0009).
 *
 * Requirement map:
 *  - ADR-0009 §2 — the command delegates to the caller's LOAD-SAFE sign-out, and never reaches for a
 *    client method itself.
 *  - ADR-0009 §3 — the fail-CLOSED post-condition: after the sign-out resolves, the client must be loaded
 *    AND hold no session. A sign-out that resolved without revoking must be reported, never treated as
 *    success. Asserted BOTH for the still-live-session shape and the never-loaded (premount-queue) shape.
 *  - ADR-0009 §4 — a client in `status: 'error'` is short-circuited BEFORE delegating, because Clerk's
 *    load awaiter never settles on that status (B17 — never spin forever).
 *  - The ordering is load-bearing: the post-condition is evaluated AFTER the sign-out resolves. A fixture
 *    that starts with a live session and is cleared by the sign-out fails any implementation that checks
 *    first.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    isSignOutNotVerifiedError,
    signOutAndVerify,
    SignOutNotVerifiedError,
    type SignOutVerificationClient,
} from '../signOutAndVerify.js';

/** A mutable stand-in for the identity client, starting from a signed-IN, fully loaded state. */
function makeClient(overrides: Partial<SignOutVerificationClient> = {}) {
    return {
        status: 'ready' as SignOutVerificationClient['status'],
        loaded: true,
        session: { id: 'sess_live' } as SignOutVerificationClient['session'],
        ...overrides,
    };
}

/** A sign-out that really ends the session (what a load-safe, working wrapper does). */
function makeRealSignOut(client: { loaded: boolean; session: SignOutVerificationClient['session'] }) {
    return vi.fn(async () => {
        client.loaded = true;
        client.session = null;
    });
}

describe('signOutAndVerify', () => {
    describe('when the sign-out really ends the session', () => {
        it('delegates to the supplied sign-out and resolves', async () => {
            const client = makeClient();
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut)).resolves.toBeUndefined();

            expect(signOut).toHaveBeenCalledTimes(1);
            expect(signOut).toHaveBeenCalledWith();
        });

        it('accepts a client that reports no session at all (undefined, not null)', async () => {
            const client = makeClient();
            const signOut = vi.fn(async () => {
                client.session = undefined;
            });

            await expect(signOutAndVerify(client, signOut)).resolves.toBeUndefined();
        });

        it('still delegates while the client is loading — the load-safe wrapper is what waits', async () => {
            const client = makeClient({ status: 'loading', loaded: false });
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut)).resolves.toBeUndefined();

            expect(signOut).toHaveBeenCalledTimes(1);
        });

        it('delegates on a degraded client (its load awaiter settles)', async () => {
            const client = makeClient({ status: 'degraded' });
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut)).resolves.toBeUndefined();

            expect(signOut).toHaveBeenCalledTimes(1);
        });
    });

    describe('the fail-closed post-condition (ADR-0009 §3)', () => {
        it('throws SignOutNotVerifiedError when the sign-out resolved but a session is still live', async () => {
            const client = makeClient();
            // Exactly the observed defect: resolves having revoked nothing.
            const signOut = vi.fn(async () => undefined);

            await expect(signOutAndVerify(client, signOut)).rejects.toThrow(SignOutNotVerifiedError);
            await expect(signOutAndVerify(client, signOut)).rejects.toThrow(/sess_live/);
        });

        it('throws SignOutNotVerifiedError when the sign-out resolved without the client ever loading', async () => {
            const client = makeClient({ status: 'loading', loaded: false });
            // The premount queue: the call is stored, resolves, and the getters report `undefined`.
            const signOut = vi.fn(async () => {
                client.session = undefined;
            });

            await expect(signOutAndVerify(client, signOut)).rejects.toThrow(SignOutNotVerifiedError);
            await expect(signOutAndVerify(client, signOut)).rejects.toThrow(/loaded/i);
        });

        it('checks the post-condition AFTER the sign-out, not before', async () => {
            // The client starts SIGNED IN. An implementation that asserted before delegating would reject.
            const client = makeClient({ session: { id: 'sess_before' } });
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut)).resolves.toBeUndefined();
        });
    });

    describe('when the client failed to load (status "error", ADR-0009 §4)', () => {
        it('throws immediately and NEVER delegates to a wrapper whose awaiter cannot settle', async () => {
            const client = makeClient({ status: 'error', loaded: false });
            const signOut = vi.fn(async () => undefined);

            await expect(signOutAndVerify(client, signOut)).rejects.toThrow(SignOutNotVerifiedError);
            expect(signOut).not.toHaveBeenCalled();
        });
    });

    describe('when the sign-out itself rejects', () => {
        it('propagates the original rejection unchanged, so a transport failure is not disguised', async () => {
            const client = makeClient();
            const signOut = vi.fn(async () => {
                throw new Error('clerk unreachable');
            });

            await expect(signOutAndVerify(client, signOut)).rejects.toThrow('clerk unreachable');
        });
    });
});

describe('SignOutNotVerifiedError', () => {
    it('is an Error, keeps its name, and survives an instanceof check', () => {
        const error = new SignOutNotVerifiedError('nope');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(SignOutNotVerifiedError);
        expect(error.name).toBe('SignOutNotVerifiedError');
        expect(error.message).toBe('nope');
    });

    it('has a type guard that accepts it and rejects anything else', () => {
        expect(isSignOutNotVerifiedError(new SignOutNotVerifiedError('nope'))).toBe(true);
        expect(isSignOutNotVerifiedError(new Error('nope'))).toBe(false);
        expect(isSignOutNotVerifiedError(undefined)).toBe(false);
    });
});
