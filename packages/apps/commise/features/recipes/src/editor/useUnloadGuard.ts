'use client';

/**
 * @module @commise/features-recipes/editor — the WEB editor's one warning before work is lost: the browser's own
 * unsaved-changes prompt, armed while the tab holds work the server does not.
 *
 * The editor never asks on × (build spec Settled 24): a draft saves itself, and a published recipe's changes stay in
 * the device draft. On web that device draft and the outbox journal are `sessionStorage` (owner D7), which a closed tab
 * takes with it — so closing the tab loses whatever has not reached the server, for every recipe. When that is, is
 * `closingTabLosesWork` (`saveStatus.ts`). The browser supplies the words, so there is no copy to key.
 *
 * ⚠️ `beforeunload` does not fire for a client-side route change, and nothing is lost by one: the device draft
 * outlives the editor within the tab.
 *
 * ⛔ Web-only by construction: it touches `window`. Imported only by the web editor leaf, which Metro never bundles.
 *
 * @pattern Adapter over the `beforeunload` platform event
 */
import { useEffect } from 'react';

/**
 * Arm the browser's unsaved-changes prompt while `isDirty` is true.
 *
 * No message is supplied, and none can be: browsers have ignored page-supplied text since 2016 and show their
 * own copy — which is also why this needs no localization key.
 *
 * @param isDirty - Whether closing the tab would lose work (`closingTabLosesWork`).
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
