'use client';

/**
 * @module useIsTwoColumn — whether the web window is wide enough for the ingredients column beside the step (L2 and L3).
 * The browser answers `TWO_COLUMN.webQuery`, in em, and the hook follows it live. The server render and the hydration
 * pass read narrow, so the session screen must never render during hydration, or a wide screen paints narrow first.
 * It has the shape of the web app's `useColorScheme`. A shared media query hook waits for a third caller.
 *
 * @pattern Observer, through `useSyncExternalStore` subscribed to the browser's media query list
 */
import { useSyncExternalStore } from 'react';

import { TWO_COLUMN } from './cookingLayout.js';

/** @returns The media query list, or `undefined` where there is no `matchMedia` (a server render, an embedded view). */
function queryOrUndefined(): MediaQueryList | undefined {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(TWO_COLUMN.webQuery)
        : undefined;
}

/**
 * @param listener - Called when the answer changes.
 * @returns The unsubscribe function.
 * @sideEffect Adds and removes a `change` listener on the media query list.
 */
function subscribe(listener: () => void): () => void {
    const query = queryOrUndefined();

    query?.addEventListener('change', listener);

    return () => query?.removeEventListener('change', listener);
}

/** @returns Whether the window is wide now. */
function snapshot(): boolean {
    return queryOrUndefined()?.matches === true;
}

/** @returns What the server and hydration read: narrow. */
function serverSnapshot(): boolean {
    return false;
}

/**
 * @returns Whether the ingredients are a column beside the step, following the window live.
 * @sideEffect Subscribes to the browser's media query.
 */
export function useIsTwoColumn(): boolean {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
