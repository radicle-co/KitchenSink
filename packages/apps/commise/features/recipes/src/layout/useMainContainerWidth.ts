'use client';

/**
 * @module @commise/features-recipes/layout — the web content width of `<main>`, in px, read through the one shared
 * observer (`useMainContentReading`). It re-renders on every width change, so a reader that needs only the class uses
 * `useMainContainerClass`.
 *
 * @sideEffect Observes the measured `<main>` while mounted.
 */
import { useMainContentReading } from './useMainContentReading.js';

const identity = (px: number): number => px;

/**
 * The content width of `<main>`, following it as it resizes.
 *
 * @returns The width, in px; 0 on the server and until `<main>` is measured.
 */
export function useMainContainerWidth(): number {
    return useMainContentReading(identity, 0);
}
