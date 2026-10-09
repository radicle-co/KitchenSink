'use client';

/**
 * @module @commise/features-recipes/layout — the web container class of `<main>`, the space every surface's cards get
 * (`docs/design/uiOverhaul/buildSpec.md` §1.2). The shell makes `<main>` the `main` container and pads it, so its
 * content box is the width the content gets — the same width `@regular/main:` and `@wide/main:` read in CSS.
 *
 * A JavaScript reading is needed only where the class picks a COMPONENT, not a style: `cardVariantOf` and the library's
 * default view. It is `narrow` on the server and until `<main>` is measured, so a server render and its hydration agree.
 *
 * @pattern Adapter over `ResizeObserver` as a `useSyncExternalStore` source
 * @sideEffect Observes the document's `<main>` element while mounted.
 */
import { containerClassOf, type ContainerClass } from '@commise/ui/container-class';
import { useSyncExternalStore } from 'react';

/** The last content width read; one module value, because the document has one `<main>`. Re-read on each subscribe. */
let lastWidth = 0;

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
 * Observe `<main>`'s content box.
 *
 * @param notify - React's change callback.
 * @returns The unsubscribe.
 */
function subscribe(notify: () => void): () => void {
    const main = typeof document === 'undefined' ? null : document.querySelector('main');

    lastWidth = main === null ? 0 : contentWidthOfElement(main);

    if (main === null || typeof ResizeObserver === 'undefined') {
        return () => undefined;
    }

    const observer = new ResizeObserver((entries) => {
        const width = entries[entries.length - 1]?.contentRect.width;

        if (width !== undefined) {
            lastWidth = width;
            notify();
        }
    });

    observer.observe(main);

    return () => observer.disconnect();
}

const snapshot = (): ContainerClass => containerClassOf(lastWidth);
const serverSnapshot = (): ContainerClass => 'narrow';

/**
 * The container class of `<main>`, following it as it resizes.
 *
 * @returns `narrow`, `regular` or `wide`.
 */
export function useMainContainerClass(): ContainerClass {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
