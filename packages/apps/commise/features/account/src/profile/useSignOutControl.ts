/**
 * @module @commise/features-account/profile/useSignOutControl — the sign-out control's own state, once for both apps.
 *
 * The control owns only `busy` and `failed`; the sign-out itself is the app's one verified command (`useSignOutAndLeave`
 * on web, `useSignOutAndVerify` on mobile; ADR-0009) and is passed in. B17 — a sign-out that fails, OR resolves without
 * ending the session, is surfaced and never swallowed: the busy state is released and `failed` is set, so the control is
 * retryable instead of leaving the viewer silently signed in with no feedback.
 *
 * A SUCCESS deliberately does not release `busy`: the session is gone and the app replaces this tree (web replaces the
 * document, mobile's auth gate re-renders), so clearing it first would flash an idle control.
 *
 * @pattern State — idle, busy and failed as one headless hook, with `run` as its one Command over the injected sign-out
 */
import { useState } from 'react';

/** The control's state and its one action. */
export interface SignOutControl {
    /** The sign-out is in flight (or has succeeded and the app is leaving). */
    readonly busy: boolean;
    /** The last attempt failed. */
    readonly failed: boolean;
    /**
     * Issue the sign-out.
     *
     * @sideEffect Destroys the session through the injected command.
     */
    readonly run: () => void;
}

/**
 * @param signOut - The app's verified sign-out command; rejects when it cannot prove the session ended.
 * @returns The control's state and its action.
 */
export function useSignOutControl(signOut: () => Promise<void>): SignOutControl {
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const run = (): void => {
        setBusy(true);
        setFailed(false);

        void (async () => {
            try {
                await signOut();
            } catch {
                // Generic on purpose: the raw error is never echoed to the viewer (B17).
                setFailed(true);
                setBusy(false);
            }
        })();
    };

    return { busy, failed, run };
}
