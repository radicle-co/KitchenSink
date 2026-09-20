'use client';

/**
 * @module @commise/features-recipes/wizard — the WEB half of "warn before losing unsaved work": arm the
 * browser's own unsaved-changes prompt while the draft is dirty.
 *
 * The two platforms answer the same requirement with their own standard pattern, and neither invents one.
 * Native intercepts the hardware back button and raises the app's `ConfirmDialog` (`@commise/ui/back-intercept`,
 * wired in `Wizard.native.tsx`); web arms `beforeunload`, which is what a browser offers for a tab close, a
 * reload, or a navigation out of the app. Both are keyed on the SAME `isDirty` from `useDiscardGuard`
 * that the in-app discard dialog uses, so no two surfaces can disagree about whether anything would be lost.
 *
 * ⚠️ **WHAT THIS DOES NOT COVER, STATED SO IT IS NOT RE-DERIVED AS A BUG.** `beforeunload` does not fire for a
 * client-side route change, and the Next.js App Router exposes no supported navigation blocker — there is no
 * `router.events` and no `useBlocker`, and browser back/`popstate` cannot be cancelled at all. The wizard's own
 * exits (the header back control, the overflow menu's Cancel) are guarded because they route through
 * `requestCancel`; an app-shell link click or a `router.push` from elsewhere is not. That gap is a DECISION:
 * the available workaround is a sentinel history entry, which corrupts the history stack and breaks forward
 * navigation and gesture back — a worse defect than the one it patches.
 *
 * ⚠️ The residual is narrower than "web is unguarded" sounds: `useRecipeAutoSave` is wired on the EDIT path and
 * deliberately not on create, so the unguarded loss is concentrated on create — which is exactly the case this
 * hook covers for close and reload.
 *
 * ⛔ Web-only by construction: it touches `window`, which React Native has not. It is imported only by
 * `Wizard.tsx`, the leaf Metro never bundles, so it cannot reach the native tree.
 *
 * @pattern Adapter over the `beforeunload` platform event — the browser's own discard prompt, armed from the
 *     same `isDirty` predicate the in-app confirmation dialog is keyed on.
 */
import { useEffect } from 'react';

/**
 * Arm the browser's unsaved-changes prompt while `isDirty` is true.
 *
 * No message is supplied, and none can be: browsers have ignored page-supplied text since 2016 and show their
 * own copy — which is also why this needs no localization key.
 *
 * @param isDirty - Whether the draft has unsaved edits (from `useDiscardGuard`).
 * @sideEffect Adds and removes a `window` `beforeunload` listener.
 */
export function useUnloadGuard(isDirty: boolean): void {
    useEffect(() => {
        // Not armed at all while clean. A listener that always registered and decided inside itself would
        // still be correct, but this way a completed save genuinely detaches it rather than relying on a
        // closure to stay right.
        if (!isDirty) {
            return undefined;
        }

        const warn = (event: BeforeUnloadEvent): void => {
            // `preventDefault` is the specified trigger; `returnValue` is the legacy field Chrome still reads.
            // Both, because neither alone prompts everywhere.
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', warn);

        return () => window.removeEventListener('beforeunload', warn);
    }, [isDirty]);
}
