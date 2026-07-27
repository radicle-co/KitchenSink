// @vitest-environment jsdom
/**
 * Behaviour tests for the sign-out COMMAND (U3 / B23).
 *
 * The defect this hook exists for: `useClerk().signOut` is the RAW `IsomorphicClerk.signOut`, which — before
 * clerk-js has loaded — does not sign anybody out. It queues the call in `premountMethodCalls` and RESOLVES,
 * so `await signOut()` succeeds having done nothing; the caller's full-document navigation then destroys the
 * queued callback and the session is never revoked at Clerk. `useAuth().signOut` is Clerk's load-safe wrapper
 * (`createSignOut` → `await clerkLoaded(...)` → delegate), which is why the command uses it.
 *
 * These tests pin the contract that must hold even if Clerk's internals change under us: the command uses the
 * LOAD-SAFE wrapper (never the raw one), it VERIFIES the session actually ended before letting the caller
 * navigate away, and it never leaves a caller awaiting a load that will never happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

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
vi.mock('@clerk/nextjs', () => ({
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
vi.mock('@/lib/basePath', () => ({ withBasePath: (p: string) => p }));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const { useSignOutAndLeave } = await import('../useSignOutAndLeave');

beforeEach(() => {
    rawClerkSignOut.mockReset().mockResolvedValue(undefined);
    // A real sign-out leaves Clerk loaded with no session.
    loadSafeSignOut.mockReset().mockImplementation(async () => {
        clerkState.loaded = true;
        clerkState.session = null;
    });
    navigateTo.mockReset();
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
});

afterEach(cleanup);

describe('useSignOutAndLeave (U3 / B23)', () => {
    it('signs out through the LOAD-SAFE wrapper, never the raw premount-queuing method', async () => {
        const { result } = renderHook(() => useSignOutAndLeave());

        await result.current.signOutAndLeave();

        expect(loadSafeSignOut).toHaveBeenCalledTimes(1);
        expect(loadSafeSignOut).toHaveBeenCalledWith();
        // `useClerk().signOut` resolves without revoking anything while clerk-js loads — that IS the defect.
        expect(rawClerkSignOut).not.toHaveBeenCalled();
    });

    it('AWAITS the sign-out and only THEN leaves with a full-document navigation', async () => {
        const { result } = renderHook(() => useSignOutAndLeave());

        await result.current.signOutAndLeave();

        expect(navigateTo).toHaveBeenCalledWith('/');
        // Ordering is the point: the session is gone BEFORE the document is replaced.
        expect(loadSafeSignOut.mock.invocationCallOrder[0]).toBeLessThan(navigateTo.mock.invocationCallOrder[0] ?? 0);
    });

    it('propagates a rejected sign-out and does NOT navigate away on a session that may still be live', async () => {
        loadSafeSignOut.mockRejectedValueOnce(new Error('clerk unreachable'));
        const { result } = renderHook(() => useSignOutAndLeave());

        await expect(result.current.signOutAndLeave()).rejects.toThrow('clerk unreachable');
        expect(navigateTo).not.toHaveBeenCalled();
    });

    describe('the fail-closed post-condition', () => {
        it('REJECTS when the sign-out resolved but Clerk still holds a session', async () => {
            // Exactly the silent no-op: resolved, nothing revoked.
            loadSafeSignOut.mockResolvedValueOnce(undefined);
            const { result } = renderHook(() => useSignOutAndLeave());

            await expect(result.current.signOutAndLeave()).rejects.toThrow(/session/i);
            // Never tell the viewer they left while their session is still live at Clerk.
            expect(navigateTo).not.toHaveBeenCalled();
        });

        it('REJECTS when the sign-out resolved without clerk-js ever loading (the premount queue)', async () => {
            loadSafeSignOut.mockImplementationOnce(async () => {
                clerkState.loaded = false;
                // The IsomorphicClerk getters report `undefined`, not `null`, before clerk-js is attached.
                clerkState.session = undefined;
            });
            const { result } = renderHook(() => useSignOutAndLeave());

            await expect(result.current.signOutAndLeave()).rejects.toThrow(/loaded/i);
            expect(navigateTo).not.toHaveBeenCalled();
        });

        it('accepts a signed-out Clerk that reports no session at all', async () => {
            loadSafeSignOut.mockImplementationOnce(async () => {
                clerkState.loaded = true;
                clerkState.session = undefined;
            });
            const { result } = renderHook(() => useSignOutAndLeave());

            await result.current.signOutAndLeave();

            expect(navigateTo).toHaveBeenCalledWith('/');
        });
    });

    describe('when clerk-js failed to load (status "error")', () => {
        beforeEach(() => {
            clerkState.loaded = false;
            clerkState.status = 'error';
        });

        it('rejects IMMEDIATELY instead of awaiting a load that will never happen', async () => {
            const { result } = renderHook(() => useSignOutAndLeave());

            await expect(result.current.signOutAndLeave()).rejects.toThrow(/clerk/i);
            // Clerk's own awaiter only settles on "ready"/"degraded", so delegating here would hang the
            // caller's busy state forever (B17 — never spin forever).
            expect(loadSafeSignOut).not.toHaveBeenCalled();
            expect(navigateTo).not.toHaveBeenCalled();
        });
    });

    describe('while clerk-js is still loading', () => {
        beforeEach(() => {
            clerkState.loaded = false;
            clerkState.status = 'loading';
        });

        it('still issues the sign-out — the load-safe wrapper waits, so an early click is not lost', async () => {
            const { result } = renderHook(() => useSignOutAndLeave());

            await result.current.signOutAndLeave();

            expect(loadSafeSignOut).toHaveBeenCalledTimes(1);
            expect(navigateTo).toHaveBeenCalledWith('/');
        });
    });
});
