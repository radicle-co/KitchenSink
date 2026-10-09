/**
 * @module components/home/chrome/tabBarInsets — the strip of the viewport the shell's bottom tab bar covers, for the
 * design system's popups to keep clear of (`@commise/ui/popup-insets`; finding D2: the recipe detail's ⋯ panel opened
 * under the bar at 390 px, hiding most of "Delete recipe").
 *
 * The bar is `fixed bottom-0`, so the strip it covers is its own height. It is measured rather than re-stated because it
 * grows by the device's bottom safe-area inset, which only the laid-out box knows. A bar the layout hides (the sidebar
 * takes over at `lg`) has no height and covers nothing.
 */
import type { PopupInsets } from '@commise/ui/popup-insets';

/** No chrome along either edge. */
const NONE: PopupInsets = { top: 0, bottom: 0 };

/**
 * The chrome the tab bar puts along the foot of the viewport.
 *
 * @param bar - The laid-out tab bar, or `null` where the shell shows none (a focused task).
 * @returns The bar's height as the bottom inset, and no top inset.
 * @sideEffect Reads layout (`getBoundingClientRect`).
 */
export function tabBarInsets(bar: HTMLElement | null): PopupInsets {
    if (bar === null) {
        return NONE;
    }

    return { top: 0, bottom: bar.getBoundingClientRect().height };
}
