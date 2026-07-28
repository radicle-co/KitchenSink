/**
 * Tests for the mobile sign-out command (ADR-0009, mobile half).
 *
 * Requirement map:
 *  - ADR-0009 §2 — the hook signs out through `useAuth().signOut`, Clerk's LOAD-SAFE wrapper, and NEVER
 *    through `useClerk().signOut` (the raw `IsomorphicClerk` method, which queues during the bootstrap and
 *    resolves having revoked nothing).
 *  - ADR-0009 §3 — it issues the SHARED `signOutAndVerify` command, so the fail-closed post-condition (the
 *    client must end up loaded with no session) is the same one the web sign-out enforces.
 *  - ADR-0009 §4 — a Clerk in `status: 'error'` rejects immediately instead of awaiting a load that never
 *    settles (B17 — the mobile control must never spin forever).
 *  - There is deliberately NO navigation step: mobile has no document to replace, and `AuthGate` re-renders
 *    the unauthenticated tree off Clerk's own state once the session is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { SignOutNotVerifiedError } from '@commise/features-account';

const { rawClerkSignOut, loadSafeSignOut, clerkState } = vi.hoisted(() => ({
    // The raw, premount-queuing method. The command must NEVER call this one.
    rawClerkSignOut: vi.fn(),
    // Clerk's load-safe wrapper, which awaits clerk-js before delegating.
    loadSafeSignOut: vi.fn(),
    clerkState: {
        loaded: true,
        status: 'ready' as 'degraded' | 'error' | 'loading' | 'ready',
        session: null as { id: string } | null | undefined,
    },
}));

vi.mock('@clerk/expo', () => ({
    useClerk: () => ({
        signOut: rawClerkSignOut,
        get loaded() {
            return clerkState.loaded;
        },
        get status() {
            return clerkState.status;
        },
        get session() {
            return clerkState.session;
        },
    }),
    useAuth: () => ({ signOut: loadSafeSignOut }),
}));

const { useSignOutAndVerify } = await import('../../src/hooks/useSignOutAndVerify.js');

beforeEach(() => {
    rawClerkSignOut.mockReset().mockResolvedValue(undefined);
    loadSafeSignOut.mockReset().mockImplementation(async () => {
        clerkState.loaded = true;
        clerkState.session = null;
    });
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
});

afterEach(cleanup);

describe('useSignOutAndVerify (mobile)', () => {
    it('signs out through the LOAD-SAFE wrapper, never the raw premount-queuing method', async () => {
        const { result } = renderHook(() => useSignOutAndVerify());

        await result.current.signOutAndVerify();

        expect(loadSafeSignOut).toHaveBeenCalledTimes(1);
        expect(rawClerkSignOut).not.toHaveBeenCalled();
    });

    it('resolves once the session is really gone', async () => {
        const { result } = renderHook(() => useSignOutAndVerify());

        await expect(result.current.signOutAndVerify()).resolves.toBeUndefined();
    });

    it('REJECTS when the sign-out resolved but Clerk still holds a session', async () => {
        // The silent no-op: resolved, nothing revoked. Mobile must not report success for this.
        loadSafeSignOut.mockResolvedValueOnce(undefined);
        const { result } = renderHook(() => useSignOutAndVerify());

        await expect(result.current.signOutAndVerify()).rejects.toThrow(SignOutNotVerifiedError);
    });

    it('REJECTS when the sign-out resolved without clerk-js ever loading', async () => {
        loadSafeSignOut.mockImplementationOnce(async () => {
            clerkState.loaded = false;
            clerkState.session = undefined;
        });
        const { result } = renderHook(() => useSignOutAndVerify());

        await expect(result.current.signOutAndVerify()).rejects.toThrow(SignOutNotVerifiedError);
    });

    it('propagates a rejected sign-out unchanged', async () => {
        loadSafeSignOut.mockRejectedValueOnce(new Error('clerk unreachable'));
        const { result } = renderHook(() => useSignOutAndVerify());

        await expect(result.current.signOutAndVerify()).rejects.toThrow('clerk unreachable');
    });

    it('rejects IMMEDIATELY when clerk-js failed to load, without awaiting an awaiter that never settles', async () => {
        clerkState.loaded = false;
        clerkState.status = 'error';
        const { result } = renderHook(() => useSignOutAndVerify());

        await expect(result.current.signOutAndVerify()).rejects.toThrow(SignOutNotVerifiedError);
        expect(loadSafeSignOut).not.toHaveBeenCalled();
    });

    it('still issues the sign-out while clerk-js is loading — the wrapper waits, the click is not lost', async () => {
        clerkState.loaded = false;
        clerkState.status = 'loading';
        const { result } = renderHook(() => useSignOutAndVerify());

        await result.current.signOutAndVerify();

        expect(loadSafeSignOut).toHaveBeenCalledTimes(1);
    });
});
