'use client';

/**
 * `useColorScheme` — the scheme the BROWSER is in, `light` or `dark` (`docs/design/uiOverhaul/ownerDecisions.md` D17:
 * the app follows the device setting and has no switch of its own).
 *
 * Almost nothing needs it: every web colour is a role utility whose custom property the `prefers-color-scheme: dark`
 * block swaps in CSS. It exists for the one renderer that cannot read a custom property — Clerk's `variables` take
 * concrete colours — so the sign-in and sign-up forms build their appearance for the scheme this reports.
 *
 * The server render and the hydration pass read `light`; the client then reports the real setting and follows it live
 * (the cook flipping their OS theme with the page open).
 */
import { useSyncExternalStore } from 'react';

import type { ColorSchemeName } from '@commise/ui/theme';

/** The media query the dark theme is emitted under (`tokens/themeCss.ts`). */
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** @returns The media query list, or `undefined` where there is no `matchMedia` (a server render, an embedded view). */
function darkQueryOrUndefined(): MediaQueryList | undefined {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(DARK_QUERY)
        : undefined;
}

/**
 * @param listener - Called when the setting changes.
 * @returns The unsubscribe function.
 */
function subscribe(listener: () => void): () => void {
    const query = darkQueryOrUndefined();

    query?.addEventListener('change', listener);

    return () => query?.removeEventListener('change', listener);
}

/** @returns The browser's scheme now. */
function snapshot(): ColorSchemeName {
    return darkQueryOrUndefined()?.matches === true ? 'dark' : 'light';
}

/** @returns The scheme the server and hydration read. */
function serverSnapshot(): ColorSchemeName {
    return 'light';
}

/** @returns The browser's colour scheme, following the system setting live. */
export function useColorScheme(): ColorSchemeName {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
