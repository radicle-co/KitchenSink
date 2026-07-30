/**
 * @module hooks/useSignOutAndVerify — the mobile app's ONE sign-out command.
 *
 * ⚠️ DELIBERATE — see `docs/architecture/decisions/0009-clerk-signout-load-gate.md` before switching this to
 * `useClerk().signOut` or dropping the verification. It is the MOBILE adapter of the shared
 * {@link import('@commise/features-account').signOutAndVerify} command: the shared module owns the ordering,
 * the `status: 'error'` short-circuit, and the fail-closed post-condition (after the sign-out resolves, Clerk
 * must be loaded and hold no session); this hook supplies the platform's client + its LOAD-SAFE `signOut`.
 * Web's `useSignOutAndLeave` issues the same core, so the two platforms cannot drift on what "signed out"
 * means.
 *
 * Pattern: **Command** behind a **headless hook** — every mobile control that ends the session (the account
 * hub's SIGN OUT, the danger zone's CLOSE and ERASE exits) issues this one command and owns only its own UI
 * state (busy, error). Calling `signOut` directly re-opens the hole: a fire-and-forget `void signOut()` has
 * no failure path at all, so a viewer left signed in is told nothing.
 *
 * **What mobile does NOT need, and why.** There is no "leave" step. Web must replace the document, because a
 * router-level redirect re-renders the authenticated shell from a payload resolved for the destroyed session.
 * Mobile has no document and no SSR payload: `AuthGate` derives its tree from Clerk's own state, so it swaps
 * to the unauthenticated surface the moment the session is gone. Adding a navigation here would duplicate the
 * gate's job.
 *
 * **What mobile is NOT exposed to.** The web load-race (ADR-0009) needed `useAuth().isLoaded` to be untrusted
 * because `@clerk/nextjs` feeds `deriveState` an SSR `initialState`; mobile has none, so `AuthGate` genuinely
 * blocks the tree while Clerk loads. The verification is kept regardless: it is cheap, it is the assertion
 * about the actual security property (rather than about which function was called), and it fails closed if a
 * future Clerk release regresses its own wrapper.
 */
import { useAuth, useClerk } from '@clerk/expo';
import { signOutAndVerify } from '@commise/features-account';

/** The mobile app's sign-out command. */
export interface SignOutAndVerify {
    /**
     * End the viewer's session, and prove it ended.
     *
     * @throws {import('@commise/features-account').SignOutNotVerifiedError} When Clerk failed to load, or
     *   when the sign-out resolved WITHOUT ending the session — so the caller surfaces a localized failure
     *   instead of leaving the viewer silently signed in.
     * @sideEffect Destroys the Clerk session.
     */
    readonly signOutAndVerify: () => Promise<void>;
}

/** The mobile app's sign-out command — see the module doc before calling `signOut` anywhere else. */
export function useSignOutAndVerify(): SignOutAndVerify {
    const clerk = useClerk();
    // ⚠️ DELIBERATE — ADR-0009. `useAuth().signOut` awaits clerk-js; `useClerk().signOut` silently queues.
    const { signOut } = useAuth();

    return { signOutAndVerify: () => signOutAndVerify(clerk, signOut) };
}
