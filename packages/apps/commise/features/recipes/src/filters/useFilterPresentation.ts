'use client';

/**
 * @module @commise/features-recipes/filters — which place Discover's facets take, on web
 * (`docs/architecture/uiOverhaulBlueprint.md` Part C, slice 5): `filterPresentationOf(container class of <main>, whether
 * the window is short)`. It replaces `useFilterBarLayout`, which asked a media query about the WINDOW; the panel is the
 * main column's, so it asks the main column.
 *
 * The container class comes from `useMainContainerClass`, and the window's height from a `resize` subscription. Both
 * answer `narrow` / "not short" on the server and until measured, so a server render and its hydration agree; the
 * presentation is then the sheet, which draws nothing until opened.
 *
 * @pattern Adapter over `window` resize as a `useSyncExternalStore` source — the `filterPresentationOf` Policy, kept current
 * @sideEffect Subscribes to the window's `resize` while mounted, and (through `useMainContainerClass`) to `<main>`'s size.
 */
import { isCompactHeight } from '@commise/ui/compact-height';
import { useSyncExternalStore } from 'react';

import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { filterPresentationOf, type FilterPresentation } from './filterPresentation.js';

/**
 * Subscribe to the window's size changes.
 *
 * @param notify - React's change callback.
 * @returns The unsubscribe.
 */
function subscribe(notify: () => void): () => void {
    window.addEventListener('resize', notify);

    return () => window.removeEventListener('resize', notify);
}

const compactNow = (): boolean => isCompactHeight(window.innerHeight);
const compactOnServer = (): boolean => false;

/**
 * Where Discover's facets live for the current window.
 *
 * @returns `'panel'` or `'sheet'`.
 */
export function useFilterPresentation(): FilterPresentation {
    const container = useMainContainerClass();
    const compact = useSyncExternalStore(subscribe, compactNow, compactOnServer);

    return filterPresentationOf(container, compact);
}
