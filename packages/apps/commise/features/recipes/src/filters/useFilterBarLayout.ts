/**
 * @module @commise/features-recipes — which layout the WEB recipe filter bar takes (spec §S8.1a "Web below 640 px").
 *
 * The bar is inline only in a window at least 640 px wide AND 480 px tall: the Sheet's `sm` and Material's compact
 * window-height class (`COMPACT_HEIGHT_BELOW_DP` in `@commise/ui/layout`). Anywhere else, an upright phone or one
 * turned sideways, the seven facet groups would push the results screens down, so they go into the Sheet.
 *
 * Keyed on the WINDOW (`docs/design/compactHeightLayout.md` §2): current browsers resize only the visual viewport for
 * an on-screen keyboard, so the query does not flip while a cook types in the Sheet.
 *
 * The answer is `undefined` where the window cannot be asked: on the server, while hydrating, and in an environment
 * with no `matchMedia` (jsdom). The bar then renders both layouts and lets CSS pick by the same query, so nothing above
 * the results moves when the client takes over.
 *
 * @pattern Observer — `useSyncExternalStore` over a `MediaQueryList`
 */
import { useSyncExternalStore } from 'react';

/**
 * The window in which the bar is inline. The bar's Tailwind classes carry the same query as the arbitrary variant
 * `[@media(min-width:40rem)_and_(min-height:30rem)]`, because Tailwind reads class names as literal text.
 */
export const FILTER_BAR_INLINE_QUERY = '(min-width: 40rem) and (min-height: 30rem)';

/** The bar's two layouts. */
type FilterBarLayout = 'inline' | 'sheet';

/**
 * Subscribe to the inline query's changes.
 *
 * @sideEffect Adds a listener to a `MediaQueryList`; the returned function removes it.
 */
function subscribe(onChange: () => void): () => void {
    if (typeof window.matchMedia !== 'function') {
        return () => undefined;
    }

    const list = window.matchMedia(FILTER_BAR_INLINE_QUERY);

    list.addEventListener('change', onChange);

    return () => list.removeEventListener('change', onChange);
}

/** The layout the window holds now, or `undefined` with no `matchMedia` to ask. */
function readLayout(): FilterBarLayout | undefined {
    if (typeof window.matchMedia !== 'function') {
        return undefined;
    }

    return window.matchMedia(FILTER_BAR_INLINE_QUERY).matches ? 'inline' : 'sheet';
}

/** On the server and while hydrating, the window is unknown. */
function readServerLayout(): undefined {
    return undefined;
}

/**
 * The filter bar's layout for the current window.
 *
 * @returns `'inline'` or `'sheet'`, or `undefined` where the window cannot be asked.
 * @sideEffect Subscribes to the window's media query while mounted.
 */
export function useFilterBarLayout(): FilterBarLayout | undefined {
    return useSyncExternalStore(subscribe, readLayout, readServerLayout);
}
