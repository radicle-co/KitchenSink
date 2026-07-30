/**
 * Headless-hook seam — a small, generic debounce over a changing value. Backs the ingredient typeahead's
 * REQ-057 debounce window (`useIngredientResolver`), but is deliberately value-agnostic (not
 * ingredient-specific) so any other orchestration hook needing the same "settle after N ms of no change"
 * behavior can reuse it instead of re-deriving its own timer.
 *
 * Platform-agnostic: no DOM/React Native imports, so it lives under the `./hooks` export subpath like the
 * package's other headless hooks.
 */
import { useEffect, useState } from 'react';

/**
 * Debounce `value`: returns the LAST value that has been stable for `delayMs` — every change restarts the
 * window, so a burst of rapid updates settles once, on the final value, rather than flickering through
 * every intermediate one.
 *
 * @param value - The live (un-debounced) value to track.
 * @param delayMs - How long `value` must stay unchanged before the debounced value catches up.
 * @returns The debounced value (starts equal to the initial `value`).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);

        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}
