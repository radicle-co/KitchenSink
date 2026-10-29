'use client';

/**
 * @module @commise/ui/snackbar — the height of one DOM element, read from its box and kept current. The web
 * `SnackbarHost` uses it to tell the floating create button how far to rise (`SnackbarClearanceContext`).
 *
 * The element is held by a callback ref in state — the shape `FabFace` uses — and read in an effect, never in render.
 * A change of `remeasureKey` measures again, for a box whose content changed in a way no observer is told about.
 *
 * @pattern Observer — a `ResizeObserver` over the element
 */
import { useEffect, useState } from 'react';

/**
 * @param remeasureKey - A value whose change means the element's content changed; measure again when it does.
 * @returns The element's height in px (`0` before it is measured) and the callback ref to put on the element.
 * @sideEffect Measures the element, and again whenever its box changes.
 */
export function useMeasuredHeight(remeasureKey: unknown): readonly [number, (element: HTMLElement | null) => void] {
    const [element, setElement] = useState<HTMLElement | null>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        if (element === null) {
            return undefined;
        }

        const measure = (): void => setHeight(element.getBoundingClientRect().height);
        measure();

        if (typeof ResizeObserver !== 'function') {
            return undefined;
        }

        const observer = new ResizeObserver(measure);
        observer.observe(element);

        return () => observer.disconnect();
    }, [element, remeasureKey]);

    return [height, setElement];
}
