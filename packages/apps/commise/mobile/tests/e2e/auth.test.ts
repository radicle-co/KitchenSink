/**
 * Hermetic contract test for the mobile account-state gate (CODING_STANDARDS §7.1a, ADR-0032: this suite
 * boots nothing and targets no deployed origin, so it is a hermetic contract test — the directory keeps its
 * historical `e2e` name, and the CI job that globs it keeps its key).
 *
 * ⛔ WHAT THIS FILE USED TO BE, so nobody restores it. Until 2026-09-05 it declared its OWN copy of
 * `deriveAuthState` at the top of the file and asserted against that copy: its only import was `vitest`, it
 * touched no app code, and it therefore could not fail for ANY change to the shipped derivation. The copy had
 * already drifted structurally — its `reason` was `{ code: string }` while the shipped `AuthBlockMessage`
 * carries `title`/`body`/`code`, and its `error` state carried no `error` payload — so it was also asserting a
 * state model the app has not had for some time.
 *
 * WHAT IT PROVES NOW, and why it is not a duplicate of the two suites that already cover the pure function
 * (`packages/apps/commise/features/account/src/__tests__/authState.test.ts` and this package's
 * `tests/auth.test.ts`): both of those call `deriveAuthState` directly with hand-built inputs. NOTHING
 * covered the mobile `useAuth` hook's WIRING — which Clerk facts it reads and which it feeds to the shared
 * derivation. `AuthGate.native.test.tsx` mocks `useAuth` wholesale, so the hook itself had no test at all.
 * This suite drives the REAL hook over a mocked `@clerk/expo` and asserts, in particular, that the metadata
 * consulted is `user.publicMetadata` — the only one Clerk treats as server-authored and therefore the only
 * one a suspension may be read from. A gate that read `unsafeMetadata` would be user-settable and trivially
 * bypassable, and no other test in the repository would notice.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({
    useAuth: vi.fn(),
    useUser: vi.fn(),
}));

const { useAuth: useClerkAuth, useUser: useClerkUser } = await import('@clerk/expo');
const { useAuth } = await import('../../src/hooks/useAuth.js');
const { IMPERSONATION_BLOCK, SUSPENDED_BLOCK } = await import('../../src/types/auth.js');

const clerkAuthMock = vi.mocked(useClerkAuth);
const clerkUserMock = vi.mocked(useClerkUser);

const getToken = vi.fn(async () => 'token');
const signOut = vi.fn(async () => undefined);

interface ClerkFacts {
    isLoaded?: boolean;
    isSignedIn?: boolean | null;
    userId?: string | null;
    sessionClaims?: Record<string, unknown> | null;
    publicMetadata?: Record<string, unknown> | null;
    unsafeMetadata?: Record<string, unknown> | null;
    privateMetadata?: Record<string, unknown> | null;
    userLoaded?: boolean;
}

/**
 * Referential identity is load-bearing for the memo tests below, so equal content must yield the SAME
 * object across two `givenClerkSession` calls. Without this, every re-render would hand `useMemo` a fresh
 * `user` and a fresh `sessionClaims`, every dependency would appear to have changed, and a "recomputes"
 * assertion could not distinguish a correct dependency list from a missing one.
 */
const identityCache = new Map<string, object>();

function stableObject<T extends object>(value: T): T {
    const key = JSON.stringify(value);
    const existing = identityCache.get(key);

    if (existing !== undefined) {
        return existing as T;
    }

    identityCache.set(key, value);

    return value;
}

/**
 * Stand the two Clerk hooks the mobile `useAuth` composes on the facts a session would carry.
 *
 * @sideEffect Mutates the module-level `@clerk/expo` mocks.
 */
function givenClerkSession(facts: ClerkFacts): void {
    clerkAuthMock.mockReturnValue({
        isLoaded: facts.isLoaded ?? true,
        isSignedIn: facts.isSignedIn ?? true,
        userId: facts.userId === undefined ? 'user_abc' : facts.userId,
        sessionClaims:
            facts.sessionClaims === null || facts.sessionClaims === undefined
                ? null
                : stableObject(facts.sessionClaims),
        getToken,
        signOut,
    } as unknown as ReturnType<typeof useClerkAuth>);

    clerkUserMock.mockReturnValue({
        user:
            facts.userLoaded === false
                ? null
                : stableObject({
                      publicMetadata: facts.publicMetadata ?? {},
                      unsafeMetadata: facts.unsafeMetadata ?? {},
                      privateMetadata: facts.privateMetadata ?? {},
                  }),
    } as unknown as ReturnType<typeof useClerkUser>);
}

describe('mobile useAuth — derived account state', () => {
    it('is loading until Clerk has loaded, whatever the other facts say', () => {
        givenClerkSession({ isLoaded: false, isSignedIn: true, userId: 'user_abc' });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'loading' });
    });

    it('is unauthenticated when Clerk reports no session', () => {
        givenClerkSession({ isSignedIn: false, userId: null });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'unauthenticated' });
    });

    it('is unauthenticated when the signed-in flag is set but no user id came with it', () => {
        givenClerkSession({ isSignedIn: true, userId: null });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'unauthenticated' });
    });

    it('is authenticated, carrying the id Clerk reported, for an ordinary active session', () => {
        givenClerkSession({ userId: 'user_abc' });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    it('blocks an impersonated session on the `act` claim, with the impersonation copy', () => {
        givenClerkSession({ sessionClaims: { act: { sub: 'admin_1' } } });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'blocked', reason: IMPERSONATION_BLOCK });
        expect(result.current.state).toMatchObject({ reason: { code: 'impersonation_blocked' } });
    });

    it('blocks an impersonated session even when the impersonated account is itself suspended', () => {
        givenClerkSession({
            sessionClaims: { act: { sub: 'admin_1' } },
            publicMetadata: { status: 'suspended' },
        });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'blocked', reason: IMPERSONATION_BLOCK });
    });

    it('does not block on a present-but-falsy `act` claim', () => {
        givenClerkSession({ sessionClaims: { act: null } });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    it('blocks a suspended account, with the suspension copy', () => {
        givenClerkSession({ publicMetadata: { status: 'suspended' } });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'blocked', reason: SUSPENDED_BLOCK });
        expect(result.current.state).toMatchObject({ reason: { code: 'account_suspended' } });
    });

    it('reads the suspension from PUBLIC metadata only — user-writable metadata cannot forge a block', () => {
        givenClerkSession({
            publicMetadata: {},
            unsafeMetadata: { status: 'suspended' },
            privateMetadata: { status: 'suspended' },
        });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    it('reads the suspension from PUBLIC metadata only — a suspension there is not masked by clean siblings', () => {
        givenClerkSession({
            publicMetadata: { status: 'suspended' },
            unsafeMetadata: { status: 'active' },
            privateMetadata: { status: 'active' },
        });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'blocked', reason: SUSPENDED_BLOCK });
    });

    it('survives a session whose user record has not arrived yet', () => {
        givenClerkSession({ userLoaded: false });

        const { result } = renderHook(() => useAuth());

        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    /**
     * The three memo tests each move EXACTLY ONE Clerk fact across a re-render and leave the others
     * referentially identical (see `stableObject`), so each one fails if — and only if — the corresponding
     * entry is missing from `useMemo`'s dependency list. A single test that changed several facts at once
     * would pass on any dependency list containing any one of them, which is the shape this file is being
     * repaired for.
     */
    it('recomputes when ONLY the load flag changes', () => {
        givenClerkSession({ isLoaded: false });

        const { result, rerender } = renderHook(() => useAuth());
        expect(result.current.state).toEqual({ status: 'loading' });

        givenClerkSession({ isLoaded: true });
        rerender();

        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    it('recomputes when ONLY the user record changes — a mid-session suspension is not masked by the memo', () => {
        givenClerkSession({ publicMetadata: {} });

        const { result, rerender } = renderHook(() => useAuth());
        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });

        givenClerkSession({ publicMetadata: { status: 'suspended' } });
        rerender();

        expect(result.current.state).toEqual({ status: 'blocked', reason: SUSPENDED_BLOCK });
    });

    it('recomputes when ONLY the session claims change — an impersonation swap is not masked by the memo', () => {
        givenClerkSession({ sessionClaims: { act: null } });

        const { result, rerender } = renderHook(() => useAuth());
        expect(result.current.state).toEqual({ status: 'authenticated', userId: 'user_abc' });

        givenClerkSession({ sessionClaims: { act: { sub: 'admin_1' } } });
        rerender();

        expect(result.current.state).toEqual({ status: 'blocked', reason: IMPERSONATION_BLOCK });
    });
});

describe('mobile useAuth — passthrough of the session commands', () => {
    it('hands back the identity provider’s own getToken and signOut rather than re-implementing them', () => {
        givenClerkSession({});

        const { result } = renderHook(() => useAuth());

        expect(result.current.getToken).toBe(getToken);
        expect(result.current.signOut).toBe(signOut);
    });
});
