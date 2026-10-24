/**
 * @module @commise/ui/horizontal-scroller — the scroll behaviour for a programmatic move.
 */

/**
 * The scroll behaviour for a programmatic move.
 *
 * @returns `'auto'` under `prefers-reduced-motion: reduce`, else `'smooth'`.
 * @sideEffect Reads the `prefers-reduced-motion` media query.
 */
export function scrollBehaviorOf(): ScrollBehavior {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
}
