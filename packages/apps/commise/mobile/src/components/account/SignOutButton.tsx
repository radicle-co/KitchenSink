/**
 * @module components/account/SignOutButton — the mobile sign-out control: the Profile page's sign-out row (the
 * counterpart of the web `LogoutButton`).
 *
 * The orchestration half of the sign-out surface: it binds the shared control state (`useSignOutControl`, busy and
 * failed) and the shared row (`SignOutRow`) to the app's one sign-out command,
 * `useSignOutAndVerify` — which owns the mechanism
 * (Clerk's load-safe `signOut`), the ordering, and the post-condition that the session really ended. Read
 * that module, and ADR-0009, before changing anything here.
 *
 * B17 — a sign-out that fails, OR that resolves without actually ending the session, is surfaced and never
 * swallowed: the busy state is released and a localized alert appears, so the control is retryable instead of
 * leaving the viewer silently signed in with no feedback. The previous shape was `onPress={() => void
 * signOut()}` — nothing awaited, nothing reported.
 *
 * It exists as its own component because TWO surfaces need exactly this behaviour: the Profile page's sign-out
 * group, and the danger zone's recovery after an erasure that was ACCEPTED but whose sign-out failed. The row is
 * `ink`, not red: signing out is not destructive (`buildSpec.md` §9.1). Colour comes from the theme at render.
 *
 * @pattern Command over the app's one sign-out use case, `useSignOutAndVerify` — that module owns the mechanism, the
 *     ordering and the session-ended post-condition (ADR-0009); this leaf only binds it to the shared control state and row.
 */
import { SignOutRow, useSignOutControl } from '@commise/features-account/profile';
import type { JSX } from 'react';

import { useSignOutAndVerify } from '../../hooks/useSignOutAndVerify.js';

/** The mobile sign-out control: issues the sign-out command and surfaces its failure. */
export function SignOutButton(): JSX.Element {
    const { signOutAndVerify } = useSignOutAndVerify();
    // The busy state is deliberately NOT released on success: the session is gone, so the auth gate replaces this tree
    // (see `useSignOutControl`). The row is `ink`, not red: signing out is not destructive.
    const { busy, failed, run } = useSignOutControl(signOutAndVerify);

    return <SignOutRow busy={busy} failed={failed} onPress={run} />;
}
