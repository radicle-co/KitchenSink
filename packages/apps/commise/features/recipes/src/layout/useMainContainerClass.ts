'use client';

/**
 * @module @commise/features-recipes/layout — the web container class of `<main>`, the space every surface's cards get
 * (`docs/design/uiOverhaul/buildSpec.md` §1.2). The shell makes `<main>` the `main` container and pads it, so its
 * content box is the width the content gets — the same width `@regular/main:` and `@wide/main:` read in CSS.
 *
 * A JavaScript reading is needed only where the class picks a COMPONENT, not a style: `cardVariantOf` and the library's
 * default view. It is `narrow` on the server and until `<main>` is measured, so a server render and its hydration agree.
 *
 * ⛔ Inside the shell it measures the `<main>` the shell provides (`MainElementContext`), never the document's first:
 * during a load the document held a second, hidden `<main>` ahead of the shell's, and measuring that one left Discover's
 * filter panel a Filters button at 1440 px. And the class is read from the element's LIVE width on every snapshot, never
 * from a cached number: the observer is only the signal that it changed. Both are measured history in
 * `__tests__/useMainContainerClass.test.tsx`. Outside a shell (a canvas board, a test) it measures the document's `<main>`.
 *
 * @pattern Adapter over `ResizeObserver` as a `useSyncExternalStore` source
 * @sideEffect Observes the measured `<main>` while mounted.
 */
import { containerClassOf, type ContainerClass } from '@commise/ui/container-class';
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

const serverSnapshot = (): ContainerClass => 'narrow';

/**
 * The container class of `<main>`, following it as it resizes.
 *
 * @returns `narrow`, `regular` or `wide`.
 */
export function useMainContainerClass(): ContainerClass {
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

    const snapshot = useCallback((): ContainerClass => {
        const main = measuredMain(provided);

        return main === null ? 'narrow' : containerClassOf(contentWidthOfElement(main));
    }, [provided]);

    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
