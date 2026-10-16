'use client';

/**
 * @module auth/LogoutButton — the web sign-out control: the Profile page's sign-out row.
 *
 * The orchestration half of the sign-out surface: it binds the shared control state (`useSignOutControl`, busy and
 * failed) and the shared row (`SignOutRow`) to the app's one sign-out command, `useSignOutAndLeave` —
 * which owns the mechanism (Clerk's load-safe `signOut`), the ordering (await the revoke, THEN replace the
 * document), and the post-condition that the session really ended. Read that module before changing anything
 * here; the post-condition guards a real, observed security defect (B23), not a hypothetical one.
 *
 * B17/B23 — a sign-out that fails, OR that resolves without actually ending the session, is surfaced and never
 * swallowed: the busy state is released and a localized alert appears, so the control is retryable instead of
 * marching the viewer to the public page on a session that is still live.
 *
 * @pattern Command over the app's one sign-out use case, `useSignOutAndLeave` — that module owns the mechanism, the
 *     ordering and the session-ended post-condition (ADR-0009); this leaf only binds it to the shared control state and row.
 */
import { SignOutRow, useSignOutControl } from '@commise/features-account/profile';

import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';

export function LogoutButton() {
    const { signOutAndLeave } = useSignOutAndLeave();
    // An ink row, not red: signing out is not destructive (`buildSpec.md` §9.1). The control owns busy and failed; the
    // command owns the mechanism. A rejection is surfaced as the row's alert and never navigates the viewer away.
    const { busy, failed, run } = useSignOutControl(signOutAndLeave);

    return <SignOutRow busy={busy} failed={failed} onPress={run} />;
}
