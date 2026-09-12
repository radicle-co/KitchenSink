/**
 * @module @commise/features-recipes/hooks — whether the app has focus, as TanStack Query reads it.
 *
 * TanStack parks a read whose retry cannot continue, and `canContinue` needs focus AND a connection. So a parked read
 * in a focused app is waiting for a connection, and in an unfocused one only for focus. The entry's food search uses
 * this to tell the two apart (`ingredientSuggestionSource.ts`, the `offline` kind) without reading connectivity itself:
 * `@commise/query`'s `useIsOffline` is the one connectivity reader, and this package may not depend on that one.
 * Each platform drives `focusManager` already (web from `visibilitychange`, mobile from `AppState`).
 *
 * @pattern Adapter over TanStack's `focusManager` singleton — an Observer subscription read as a React snapshot
 *     through `useSyncExternalStore`.
 */
import { focusManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** Re-read whenever TanStack's focus changes. */
function subscribe(onChange: () => void): () => void {
    return focusManager.subscribe(() => onChange());
}

/** Whether the app has focus now. */
function snapshot(): boolean {
    return focusManager.isFocused();
}

/** The server renders a focused app: that answer shows nothing a client render would have to correct. */
const serverSnapshot = (): boolean => true;

/**
 * Whether the app has focus.
 *
 * @returns TanStack's `focusManager.isFocused()`, kept current.
 * @sideEffect Subscribes to TanStack's focus changes while mounted.
 */
export function useAppFocused(): boolean {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
