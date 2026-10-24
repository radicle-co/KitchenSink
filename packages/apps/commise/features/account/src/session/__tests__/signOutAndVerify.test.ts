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
 *  - ADR-0068 — offline, the command refuses BEFORE delegating. Clerk cannot end a session at the server with no network,
 *    and the attempt drops it into its loading state for good (Android, 2026-10-23: the app stayed on "Checking your
 *    session…"). So an offline device never reaches the sign-out.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    isSignOutNotVerifiedError,
    signOutAndVerify,
    SignOutNotVerifiedError,
    type SignOutVerificationClient,
} from '../signOutAndVerify.js';

/** The device is online: what every test outside the offline block runs under. */
const ONLINE = { isOnline: () => true } as const;

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

            await expect(signOutAndVerify(client, signOut, ONLINE)).resolves.toBeUndefined();

            expect(signOut).toHaveBeenCalledTimes(1);
            expect(signOut).toHaveBeenCalledWith();
        });

        it('accepts a client that reports no session at all (undefined, not null)', async () => {
            const client = makeClient();
            const signOut = vi.fn(async () => {
                client.session = undefined;
            });

            await expect(signOutAndVerify(client, signOut, ONLINE)).resolves.toBeUndefined();
        });

        it('still delegates while the client is loading — the load-safe wrapper is what waits', async () => {
            const client = makeClient({ status: 'loading', loaded: false });
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut, ONLINE)).resolves.toBeUndefined();

            expect(signOut).toHaveBeenCalledTimes(1);
        });

        it('delegates on a degraded client (its load awaiter settles)', async () => {
            const client = makeClient({ status: 'degraded' });
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut, ONLINE)).resolves.toBeUndefined();

            expect(signOut).toHaveBeenCalledTimes(1);
        });
    });

    describe('the fail-closed post-condition (ADR-0009 §3)', () => {
        it('throws SignOutNotVerifiedError when the sign-out resolved but a session is still live', async () => {
            const client = makeClient();
            // Exactly the observed defect: resolves having revoked nothing.
            const signOut = vi.fn(async () => undefined);

            await expect(signOutAndVerify(client, signOut, ONLINE)).rejects.toThrow(SignOutNotVerifiedError);
            await expect(signOutAndVerify(client, signOut, ONLINE)).rejects.toThrow(/sess_live/);
        });

        it('throws SignOutNotVerifiedError when the sign-out resolved without the client ever loading', async () => {
            const client = makeClient({ status: 'loading', loaded: false });
            // The premount queue: the call is stored, resolves, and the getters report `undefined`.
            const signOut = vi.fn(async () => {
                client.session = undefined;
            });

            await expect(signOutAndVerify(client, signOut, ONLINE)).rejects.toThrow(SignOutNotVerifiedError);
            await expect(signOutAndVerify(client, signOut, ONLINE)).rejects.toThrow(/loaded/i);
        });

        it('checks the post-condition AFTER the sign-out, not before', async () => {
            // The client starts SIGNED IN. An implementation that asserted before delegating would reject.
            const client = makeClient({ session: { id: 'sess_before' } });
            const signOut = makeRealSignOut(client);

            await expect(signOutAndVerify(client, signOut, ONLINE)).resolves.toBeUndefined();
        });
    });

    describe('when the client failed to load (status "error", ADR-0009 §4)', () => {
        it('throws immediately and NEVER delegates to a wrapper whose awaiter cannot settle', async () => {
            const client = makeClient({ status: 'error', loaded: false });
            const signOut = vi.fn(async () => undefined);

            await expect(signOutAndVerify(client, signOut, ONLINE)).rejects.toThrow(SignOutNotVerifiedError);
            expect(signOut).not.toHaveBeenCalled();
        });
    });

    describe('when the sign-out itself rejects', () => {
        it('propagates the original rejection unchanged, so a transport failure is not disguised', async () => {
            const client = makeClient();
            const signOut = vi.fn(async () => {
                throw new Error('clerk unreachable');
            });

            await expect(signOutAndVerify(client, signOut, ONLINE)).rejects.toThrow('clerk unreachable');
        });
    });
});

/**
 * ADR-0057 / ADR-0054: the cook's device state — the editor's drafts and the outbox — ends with their session, and only
 * once the session is PROVEN ended. Cleared before the proof, a failed sign-out would leave a still-signed-in cook with
 * their unsynced work gone.
 */
describe('signOutAndVerify — offline', () => {
    it('refuses before it delegates, so Clerk is never asked to sign out with no network', async () => {
        const client = makeClient();
        const signOut = makeRealSignOut(client);
        const endDeviceSession = vi.fn(async () => undefined);

        await expect(
            signOutAndVerify(client, signOut, { isOnline: () => false, endDeviceSession }),
        ).rejects.toBeInstanceOf(SignOutNotVerifiedError);
        expect(signOut).not.toHaveBeenCalled();
        expect(endDeviceSession).not.toHaveBeenCalled();
        expect(client.session).toEqual({ id: 'sess_live' });
    });

    it('reads the connection when it is run, not when it was built', async () => {
        let online = false;
        const client = makeClient();
        const signOut = makeRealSignOut(client);
        const isOnline = () => online;

        await expect(signOutAndVerify(client, signOut, { isOnline })).rejects.toBeInstanceOf(SignOutNotVerifiedError);
        online = true;
        await expect(signOutAndVerify(client, signOut, { isOnline })).resolves.toBeUndefined();
        expect(signOut).toHaveBeenCalledTimes(1);
    });
});

describe('signOutAndVerify — the device session end', () => {
    it('runs after the sign-out is proven, and the command resolves only once it has', async () => {
        const order: string[] = [];
        const client = makeClient();
        const signOut = vi.fn(async () => {
            order.push('signOut');
            client.session = null;
        });
        const endDeviceSession = vi.fn(async () => {
            order.push('endDeviceSession');
        });

        await signOutAndVerify(client, signOut, { ...ONLINE, endDeviceSession });

        expect(order).toEqual(['signOut', 'endDeviceSession']);
    });

    // ADR-0009: the command never says something false about whether the session ended. Once it is proven ended, a
    // failed clear (a storage write that rejects) must not report "we couldn't sign you out" and skip leaving.
    it('resolves when the session is proven ended even if clearing the device state rejects', async () => {
        const client = makeClient();
        const signOut = vi.fn(async () => {
            client.session = null;
        });
        const endDeviceSession = vi.fn(async () => Promise.reject(new Error('storage write failed')));

        await expect(signOutAndVerify(client, signOut, { ...ONLINE, endDeviceSession })).resolves.toBeUndefined();
        expect(endDeviceSession).toHaveBeenCalledTimes(1);
    });

    it('never runs when the sign-out could not be proven, so a live session keeps its device state', async () => {
        const client = makeClient();
        const endDeviceSession = vi.fn(async () => undefined);

        await expect(
            signOutAndVerify(
                client,
                vi.fn(async () => undefined),
                { ...ONLINE, endDeviceSession },
            ),
        ).rejects.toBeInstanceOf(SignOutNotVerifiedError);
        expect(endDeviceSession).not.toHaveBeenCalled();
    });

    it('never runs when the sign-out itself rejects', async () => {
        const endDeviceSession = vi.fn(async () => undefined);

        await expect(
            signOutAndVerify(
                makeClient(),
                vi.fn(async () => Promise.reject(new Error('down'))),
                { ...ONLINE, endDeviceSession },
            ),
        ).rejects.toThrow('down');
        expect(endDeviceSession).not.toHaveBeenCalled();
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
