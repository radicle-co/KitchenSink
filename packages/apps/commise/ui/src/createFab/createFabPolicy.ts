/**
 * @module @commise/ui/create-fab — the floating create button's presentation rules (`docs/design/uiOverhaul/buildSpec.md`
 * §3.4), once for both platforms. Every screen that floats "New recipe" or "New collection" takes its presentation
 * from here, so the rules live once.
 *
 * @pattern Policy — a pure decision over the screen's state, read by the button's leaves
 */
import type { ViewportClass } from '../tokens/layout.js';
import { spacing } from '../tokens/scale.js';
import { scaledTypeSize } from '../text/scaledType.js';
import { nativeTokens } from '../tokens/native.js';

/** How the floating button presents: not at all, as a 56 px icon button, or with its label. */
export type FabPresentation = 'hidden' | 'icon' | 'extended';

/** The visual height of the floating button, px (§3.4). */
export const FAB_HEIGHT_PX = 56;

/** How far above the screen's foot the floating button rests, px, before a snackbar lifts it. */
export const FAB_BOTTOM_MARGIN_PX = spacing[4];

/** The floating button's label follows the navigation-chrome cap (designer ruling d, 2026-11-02). */
export const FAB_LABEL_CHROME_CAP = '1.5';

/**
 * The extended button's drawn height at a text scale, px: 56 is the floor and the label's leading beyond its scale-1
 * size is added (designer, 2026-11-02): 66 at the 1.5x cap. The collapsed disc stays 56, and every screen reserves
 * room for THIS height so its foot does not jump when the button shrinks on scroll. Pure.
 *
 * @param textScale - The system text scale.
 * @returns The height, px.
 */
export function fabHeightAt(textScale: number): number {
    const { lineHeight } = scaledTypeSize('label', Math.max(textScale, 1), FAB_LABEL_CHROME_CAP);

    return FAB_HEIGHT_PX + lineHeight - nativeTokens.type.label.lineHeight;
}

/**
 * Web only (designer ruling, `nativeBoards/designAnswers.md`, 2026-11-02): the viewport height, in CSS px, from which the
 * floating button floats. Below it (a 320 by 200 window, a 1280 by 800 one at 400% zoom) the tab bar and the button
 * would leave a few dozen px of page, so the button sits in the page header and nothing is reserved under it. The theme
 * generates the `fab-floats` variant and the media rule that zeroes the reserve from THIS number; nothing else spells it.
 */
export const FAB_FLOATS_FROM_HEIGHT_PX = 400;

/**
 * The bottom padding a screen the floating button covers reserves: the button's DRAWN height, the margin it rests at,
 * and 16 px, computed so it follows the button (designer rulings 2026-11-01 and 2026-11-02,
 * `nativeBoards/designAnswers.md`). A focused last card is never hidden behind it (WCAG 2.2 SC 2.4.11). This is the
 * ONE formula: native screens call it with the drawn height at the current text scale, and the web theme declares
 * its value at {@link FAB_HEIGHT_PX}.
 *
 * @param drawnHeightPx - The button's drawn height, px.
 * @returns The room, px. Pure.
 */
export function fabReservedBottomOf(drawnHeightPx: number): number {
    return drawnHeightPx + FAB_BOTTOM_MARGIN_PX + spacing[4];
}

/** The room with the button at its 56 px floor (88). The web theme's `--fab-reserved-bottom` is this, in rem. */
export const FAB_RESERVED_BOTTOM_PX = fabReservedBottomOf(FAB_HEIGHT_PX);

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
    /**
     * Whether the button yields its place: while the screen's first load is in flight, or in its first-run state, whose
     * own start buttons take its place.
     */
    readonly yielded: boolean;
    /** The label's laid-out width, px. */
    readonly labelWidthPx: number;
    /** The window's width, px. */
    readonly windowWidthPx: number;
}

/**
 * The floating button's presentation.
 *
 * A label wider than half the window (a long translation, 200% text, the iOS accessibility sizes) keeps the button
 * icon-only, never wrapped and never truncated; its accessible name stays the label either way. A button that has
 * focus when it must yield stays until it loses focus, so focus never drops to the page.
 *
 * @param inputs - The screen's state.
 * @returns The presentation. Pure.
 */
export function fabPresentationOf(inputs: FabInputs): FabPresentation {
    if (inputs.chrome === 'sidebar' || inputs.keyboardOpen || (inputs.yielded && !inputs.focused)) {
        return 'hidden';
    }

    if (inputs.labelWidthPx > inputs.windowWidthPx / 2) {
        return 'icon';
    }

    const shrinks = inputs.viewportClass === 'compact' && inputs.scrollingDown && !inputs.atTop && !inputs.focused;

    return shrinks ? 'icon' : 'extended';
}
