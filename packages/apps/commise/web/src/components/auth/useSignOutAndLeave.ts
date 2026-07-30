'use client';

/**
 * @module auth/useSignOutAndLeave — the app's ONE sign-out command (U3 / B23).
 *
 * ⚠️ DELIBERATE — see docs/architecture/decisions/0009-clerk-signout-load-gate.md before switching this to
 * `useClerk().signOut`, dropping the post-condition, or dropping the `error`-status short-circuit. Undoing any
 * of them restores a sign-out that RESOLVES without revoking, and tells the viewer they left when they did not.
 *
 * Pattern: **Command** behind a **headless hook**. It is the single authoritative representation of "end this
 * viewer's session and leave the app" — the plain sign-out control, the account CLOSE flow, and the
 * irreversible account ERASE flow all issue this one command instead of each re-deriving the sequence (they
 * previously carried three copies of it, and therefore three copies of the defect below). Callers own only
 * their own UI state; the command owns the ordering, the mechanism, and the post-condition.
 *
 * The ordering + post-condition themselves live in `signOutAndVerify` (`@commise/features-account`), because
 * they are the same invariant on mobile and MUST NOT drift from it — this hook is the WEB adapter: it supplies
 * Clerk's load-safe `signOut` and the client to verify against, and owns what "leaving" means on the web.
 *
 * **Why `useAuth().signOut` and NOT `useClerk().signOut`.** `useClerk()` returns `IsomorphicClerk`, whose
 * `signOut` is the raw method:
 *
 * ```
 * signOut = async (...args) => {
 *   const callback = () => this.clerkjs?.signOut(...args);
 *   if (this.clerkjs && this.loaded) { return callback(); }
 *   else { this.premountMethodCalls.set('signOut', callback); }   // queued — and RESOLVES
 * };
 * ```
 *
 * Before clerk-js finishes loading, `await` on that resolves having signed nobody out: no revoke request
 * reaches Clerk's Frontend API, `__session` / `__client_uat` are untouched, and the session keeps minting
 * fresh JWTs. The queued callback would run when clerk-js loads — except the caller's own full-document
 * navigation destroys the page first. Observed end-to-end: the viewer is navigated away from the authenticated
 * surface while their session stays live at Clerk. On a shared device that is a real account-takeover window,
 * and nothing in the flow reports a failure. Clerk does not guard this for us — its own `<SignOutButton>` is
 * registered `renderWhileLoading: true` and calls the same raw method.
 *
 * `useAuth().signOut` is Clerk's load-SAFE wrapper — `createSignOut` → `await clerkLoaded(clerk)` → delegate —
 * so an early click waits for the bootstrap instead of being silently swallowed. Two consequences we own:
 *
 *  1. That awaiter resolves only on status `ready`/`degraded`; on `error` it NEVER settles, which would leave
 *     the caller's busy state spinning forever (B17). So a failed Clerk is short-circuited before delegating.
 *  2. It is an internal of Clerk's, so it is not the thing this module RELIES on. The post-condition below is:
 *     after the sign-out resolves, Clerk must be loaded and hold no session. That assertion is ours, is
 *     unit-tested, and fails CLOSED on any silent no-op — including a future regression in Clerk's wrapper.
 *
 * **Leaving is a FULL-DOCUMENT navigation, deliberately** (the conclusion the close/erase flows were already
 * fixed to): `signOut({ redirectUrl })` leaves via the Next router, which re-renders the authenticated shell
 * from a client payload resolved for the session that was just destroyed. So the command awaits the sign-out
 * — cookies gone — and only then replaces the document with the app's public entry (`/`), where the locale
 * root's own auth gate sends a signed-out caller to the sign-in form. That target is deliberately the bare
 * root rather than `/sign-in` directly: the ONE gate stays in `[locale]/page.tsx`, so this command cannot
 * drift from it, and the locale is negotiated by the middleware instead of guessed here.
 *
 * ⚠️ Owner decision, 2026-07-28: leaving used to land on a branded `/{locale}/welcome` hero, which is deleted.
 * The destination below did not change — its RESOLUTION did (`/` now resolves to sign-in).
 */
import { useAuth, useClerk } from '@clerk/nextjs';
import { signOutAndVerify } from '@commise/features-account';

import { withBasePath } from '@/lib/basePath';
import { navigateTo } from '@/lib/navigation';

/** The app's sign-out command. */
export interface SignOutAndLeave {
    /**
     * End the session, then leave the app with a full document load.
     *
     * @throws When Clerk failed to load, or when the sign-out resolved WITHOUT ending the session — so the
     *   caller surfaces a failure instead of navigating the viewer away from a session that is still live.
     * @sideEffect Destroys the Clerk session and replaces the current document.
     */
    readonly signOutAndLeave: () => Promise<void>;
}

/** The app's sign-out command — see the module doc for the load-race it exists to close. */
export function useSignOutAndLeave(): SignOutAndLeave {
    const clerk = useClerk();
    // ⚠️ DELIBERATE — ADR-0009. `useAuth().signOut` awaits clerk-js; `useClerk().signOut` silently queues.
    const { signOut } = useAuth();

    const signOutAndLeave = async (): Promise<void> => {
        // ⚠️ DELIBERATE — ADR-0009. The `error`-status short-circuit AND the fail-CLOSED post-condition live
        // in the shared command (`@commise/features-account`), because they are the SAME security invariant on
        // both platforms and must never drift: mobile's own sign-out hook issues the identical core. This hook
        // is the web ADAPTER — it supplies Clerk's load-safe `signOut` plus the client to verify against, and
        // owns only what "leaving" means here.
        await signOutAndVerify(clerk, signOut);

        // Clerk's own redirect is not basePath-aware (ADR-0001 / U2); prefix it. No-op in production.
        navigateTo(withBasePath('/'));
    };

    return { signOutAndLeave };
}
