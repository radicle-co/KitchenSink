/**
 * @module @commise/ui/create-fab — the floating create button's presentation rules (`docs/design/uiOverhaul/buildSpec.md`
 * §3.4), once for both platforms. Every screen that floats "New recipe" or "New collection" takes its presentation
 * from here, so the rules live once.
 *
 * @pattern Policy — a pure decision over the screen's state, read by the button's leaves
 */
import type { ViewportClass } from '../tokens/layout.js';

/** How the floating button presents: not at all, as a 56 px icon button, or with its label. */
export type FabPresentation = 'hidden' | 'icon' | 'extended';

/** The visual height of the floating button, px (§3.4). */
export const FAB_HEIGHT_PX = 56;

/**
 * The bottom padding a list under the floating button reserves, and its `scroll-padding-bottom`: the button's height
 * plus 32 px, so a focused last card is never hidden behind it (WCAG 2.2 SC 2.4.11).
 */
export const FAB_RESERVED_BOTTOM_PX = FAB_HEIGHT_PX + 32;

/** What the presentation depends on. */
export interface FabInputs {
    /** The window's class. Only a `compact` window shrinks the button on scroll; a tablet keeps the label. */
    readonly viewportClass: ViewportClass;
    /** The shell's navigation. With a sidebar (web at 840 px and wider) "New recipe" lives there instead. */
    readonly chrome: 'tabBar' | 'sidebar';
    /** Whether the last scroll moved down the page. */
    readonly scrollingDown: boolean;
    /** Whether the scroller is at its top. */
    readonly atTop: boolean;
    /** Whether the button holds keyboard focus. A focused button always shows its label. */
    readonly focused: boolean;
    /** Whether the on-screen keyboard is open. */
    readonly keyboardOpen: boolean;
    /** Whether the screen shows its first-run state, whose own start buttons take the button's place. */
    readonly firstRun: boolean;
    /** The label's laid-out width, px. */
    readonly labelWidthPx: number;
    /** The window's width, px. */
    readonly windowWidthPx: number;
}

/**
 * The floating button's presentation.
 *
 * A label wider than half the window (a long translation, 200% text, the iOS accessibility sizes) keeps the button
 * icon-only, never wrapped and never truncated; its accessible name stays the label either way.
 *
 * @param inputs - The screen's state.
 * @returns The presentation. Pure.
 */
export function fabPresentationOf(inputs: FabInputs): FabPresentation {
    if (inputs.chrome === 'sidebar' || inputs.keyboardOpen || inputs.firstRun) {
        return 'hidden';
    }

    if (inputs.labelWidthPx > inputs.windowWidthPx / 2) {
        return 'icon';
    }

    const shrinks = inputs.viewportClass === 'compact' && inputs.scrollingDown && !inputs.atTop && !inputs.focused;

    return shrinks ? 'icon' : 'extended';
}
