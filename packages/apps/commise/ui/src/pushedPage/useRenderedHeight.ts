/**
 * @module @commise/ui/pushed-page — the pinned bar's height as the browser renders it.
 */
import { useEffect, useState } from 'react';

/**
 * The element's rendered height, px, kept current while it is mounted.
 *
 * The bar is `var(--pinned-bar-height) + env(safe-area-inset-top)` tall, and `IntersectionObserver`'s margin takes px (not
 * `calc()`, `rem` or `env()`), so the number has to be read from the laid-out element. It is 0 where the bar is
 * `display: none` (from 840), which is also right: there is nothing to measure the heading from under.
 *
 * @sideEffect Reads layout, and listens to the element's size and to the window's resize (a rotation changes the inset).
 * @param node - The element, held as state by a callback ref; `null` before it mounts.
 * @param initial - The height to use until it is measured.
 * @returns The element's height, px.
 */
export function useRenderedHeight(node: HTMLElement | null, initial: number): number {
    const [height, setHeight] = useState(initial);

    useEffect(() => {
        if (node === null) {
            return undefined;
        }

        const measure = (): void => setHeight(node.getBoundingClientRect().height);

        measure();
        window.addEventListener('resize', measure);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
        observer?.observe(node);

        return () => {
            window.removeEventListener('resize', measure);
            observer?.disconnect();
        };
    }, [node]);

    return height;
}
