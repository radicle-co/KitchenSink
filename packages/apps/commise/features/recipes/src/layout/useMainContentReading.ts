'use client';

/**
 * @module @commise/features-recipes/layout — the ONE observer of `<main>`'s content width on the web, which
 * `useMainContainerClass` and `useMainContainerWidth` share. The element measured is the one `MainElementContext` names
 * (the shell's `<main>`, or a `MainColumn`), the `main` container whose content box is the width the content gets — the
 * same width `@regular/main:` and `@wide/main:` read in CSS.
 *
 * ⛔ Inside the shell it measures the `<main>` the shell provides (`MainElementContext`), never the document's first:
 * during a load the document held a second, hidden `<main>` ahead of the shell's, and measuring that one left Discover's
 * filter panel a Filters button at 1440 px. And the width is read from the element's LIVE size on every snapshot, never
 * from a cached number: the observer is only the signal that it changed. Both are measured history in
 * `__tests__/useMainContainerClass.test.tsx`. Outside a shell (a canvas board, a test) it measures the document's `<main>`.
 *
 * @pattern Adapter over `ResizeObserver` as a `useSyncExternalStore` source
 * @sideEffect Observes the measured `<main>` while mounted.
 */
import { MainElementContext } from '@commise/ui/main-element';
import { use, useCallback, useSyncExternalStore } from 'react';

/**
 * An element's content-box width: its client width less its horizontal padding.
 *
 * @param element - The element.
 * @returns The width, in px.
 */
function contentWidthOfElement(element: Element): number {
    const style = getComputedStyle(element);

    return element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/**
 * The `<main>` to measure: the shell's when one is provided (`null` until it mounts), else the document's.
 *
 * @param provided - The context value: the shell's element, `null` before it mounts, or `undefined` outside a shell.
 * @returns The element, or `null` when there is none to measure.
 */
function measuredMain(provided: HTMLElement | null | undefined): Element | null {
    if (provided !== undefined) {
        return provided;
    }

    return typeof document === 'undefined' ? null : document.querySelector('main');
}

/**
 * A reading of `<main>`'s content width, following it as it resizes. The caller's `read` decides what a change is: a
 * reader that keeps only the class re-renders only when the class changes.
 *
 * @param read - Turns the content width, in px, into the value the caller wants. Must be stable across renders.
 * @param server - The value on the server and until `<main>` is measured.
 * @returns The reading.
 */
export function useMainContentReading<T>(read: (contentPx: number) => T, server: T): T {
    const provided = use(MainElementContext);

    const subscribe = useCallback(
        (notify: () => void): (() => void) => {
            const main = measuredMain(provided);

            if (main === null || typeof ResizeObserver === 'undefined') {
                return () => undefined;
            }

            const observer = new ResizeObserver(notify);

            observer.observe(main);

            return () => observer.disconnect();
        },
        [provided],
    );

    const snapshot = useCallback((): T => {
        const main = measuredMain(provided);

        return main === null ? server : read(contentWidthOfElement(main));
    }, [provided, read, server]);

    return useSyncExternalStore(subscribe, snapshot, () => server);
}
