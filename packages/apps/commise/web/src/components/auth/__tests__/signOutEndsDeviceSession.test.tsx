// @vitest-environment jsdom
/**
 * The sign-out command ends the device session BEFORE it leaves (D18, ADR-0054, ADR-0057), with nothing between the
 * two doubled: the real `endDeviceSession` over jsdom's real `sessionStorage`. `useSignOutAndLeave.test.tsx` doubles
 * `endDeviceSession` to pin the ordering against Clerk, so it cannot see what the call removes; this suite can.
 *
 * Cook marks are the case that needs it. The `CookMarksProvider` also removes them when the cook changes, but from an
 * effect — and the leave is a full document load that can unload the page before that effect runs, leaving the last
 * cook's marks in the tab. `navigateTo` here records what the tab held at the moment of leaving.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const { clerkState, loadSafeSignOut } = vi.hoisted(() => ({
    clerkState: { loaded: true, status: 'ready', session: { id: 'sess_live' } as { id: string } | null },
    loadSafeSignOut: vi.fn(),
}));
vi.mock('@clerk/nextjs', () => ({
    useClerk: () => ({
        signOut: vi.fn(),
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
    useAuth: () => ({ signOut: loadSafeSignOut, userId: 'user_cook' }),
}));
vi.mock('@/lib/basePath', () => ({ withBasePath: (p: string) => p }));

/** The cook-marks keys the tab held when the command left. */
const { keysAtLeave, keptKeysAtLeave, navigateTo } = vi.hoisted(() => {
    const keysAtLeave: string[][] = [];
    const keptKeysAtLeave: string[][] = [];

    return {
        keysAtLeave,
        keptKeysAtLeave,
        navigateTo: vi.fn(() => {
            keysAtLeave.push(Object.keys(window.sessionStorage).filter((key) => key.startsWith('cook.v1.')));
            keptKeysAtLeave.push(Object.keys(window.localStorage).filter((key) => key.startsWith('cook.v2.')));
        }),
    };
});
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const { useSignOutAndLeave } = await import('../useSignOutAndLeave');

beforeEach(() => {
    clerkState.session = { id: 'sess_live' };
    loadSafeSignOut.mockReset().mockImplementation(async () => {
        clerkState.session = null;
    });
    keysAtLeave.length = 0;
    keptKeysAtLeave.length = 0;
    window.localStorage.setItem('cook.v2.user_cook', '{"v":1,"rev":1,"entries":{},"timers":[]}');
    navigateTo.mockClear();
    window.sessionStorage.setItem('cook.v1.user_cook.11111111-1111-4111-8111-111111111111', '{"lines":["a"],"step":2}');
    window.sessionStorage.setItem('cook.v1..22222222-2222-4222-8222-222222222222', '{"lines":[],"step":1}');
});

afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
});

describe('useSignOutAndLeave — the device session ends before the leave', () => {
    it('removes every cook mark from the tab before it navigates away', async () => {
        const { result } = renderHook(() => useSignOutAndLeave());

        await result.current.signOutAndLeave();

        expect(navigateTo).toHaveBeenCalledTimes(1);
        expect(keysAtLeave).toEqual([[]]);
    });

    it('⛔ removes the kept cooking session from localStorage before it navigates away (AE10; mutant: the wrapper does not pass the store)', async () => {
        const { result } = renderHook(() => useSignOutAndLeave());

        await result.current.signOutAndLeave();

        expect(keptKeysAtLeave).toEqual([[]]);
    });

    it('keeps the marks when the sign-out could not be proven', async () => {
        loadSafeSignOut.mockImplementationOnce(async () => undefined);
        const { result } = renderHook(() => useSignOutAndLeave());

        await expect(result.current.signOutAndLeave()).rejects.toThrow();

        expect(navigateTo).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem('cook.v1.user_cook.11111111-1111-4111-8111-111111111111')).not.toBeNull();
    });
});
