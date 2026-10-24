/**
 * @module @commise/ui/large-title-header — the shared contract of the design-system `LargeTitleHeader` and its
 * `CondensedTitleBar` (`docs/design/uiOverhaul/buildSpec.md` §3.3; blueprint slice 3 step 3). Every screen with a
 * title uses them.
 *
 * - **Phone and tablet (web below 840, native at every size):** a transparent 44 px row holds `action` (end); the H1 sits
 *   under it in `largeTitle`. `back` is NOT drawn here: a pushed page's Back is the PINNED `CondensedTitleBar` (a 56 px
 *   bar on the floating layer, in `PushedPageFrame`), reachable at every scroll position, and its title, in `barTitle`,
 *   one line, shows once the heading scrolls under it. A top-level web page mounts none: the tab bar already says where
 *   you are.
 * - **840 and wider (web):** no bar. `action` sits on the title's row at the end; `back` becomes an eyebrow link above
 *   the H1 ("‹ Collections"). Without room, the action moves below the title AS A GROUP — never a wrap inside a button.
 *
 * The H1 is the only level-1 heading and the route-change focus target, moved by `focusSignal` (no ref crosses the
 * package boundary). The bar title repeats it, so it is hidden from assistive tech.
 *
 * The orchestration (the screen) decides whether a condensed bar exists at all; neither component takes a mode prop.
 */
import type { ReactNode } from 'react';

/** The way back from a pushed screen. */
export interface HeaderBack {
    /** The accessible name: "Back to {parent}". */
    readonly label: string;
    /** The parent's name, shown in the 840+ eyebrow: "‹ {parent}". */
    readonly parent: string;
    /** Go back. On web a plain click comes here and the link's own navigation is cancelled. */
    readonly onPress: () => void;
    /** The parent's web URL, so a modified click still works. Native ignores it. */
    readonly href?: string;
}

/**
 * What sits at the end of the title: the avatar on a top-level screen, or at most one button and one ⋯ menu. A union,
 * so "a button, a menu AND the avatar" cannot be written.
 */
export type HeaderAction =
    | {
          readonly kind: 'avatar';
          /** The avatar entry. On web it shows below 840 only; the sidebar's profile row has it from 840. */
          readonly avatar: ReactNode;
      }
    | { readonly kind: 'controls'; readonly button?: ReactNode; readonly menu?: ReactNode };

/** The cross-platform `LargeTitleHeader` contract. */
export interface LargeTitleHeaderProps {
    /** The H1's element id (web) — the page's skip and focus target, and what a `ScrollHost` watches. */
    readonly headingId: string;
    /** The title: wraps to two lines, never truncated. */
    readonly title: string;
    /** One line under the title in `meta`, `inkMuted`. */
    readonly subtitle?: string;
    /** The way back, on a pushed screen. */
    readonly back?: HeaderBack;
    /** The end-of-row action. */
    readonly action?: HeaderAction;
    /**
     * What comes RIGHT AFTER the H1 in DOM and accessibility order: the screen's floating create button, which a
     * screen reader must meet early though it is drawn at the bottom (§3.4, SC 1.3.2).
     */
    readonly afterTitle?: ReactNode;
    /** The segments under the title (My recipes · Collections). */
    readonly segments?: ReactNode;
    /** Advance it to move focus to the H1: a route change, a "Back to top", a retry. */
    readonly focusSignal?: number;
}

/**
 * The cross-platform `CondensedTitleBar` contract: the PINNED bar of a pushed page
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md`). A given `back` or `menu` is always rendered, named and pressable,
 * whatever the two display facts say; the facts decide only what is drawn around them.
 */
export interface CondensedTitleBarProps {
    /** The title, repeated from the H1 in one line; hidden from assistive tech. Absent while the page does not know it. */
    readonly title?: string;
    /** The way back, kept one tap away at every scroll position (Nielsen #3). */
    readonly back?: HeaderBack;
    /** A ⋯ menu at the end. */
    readonly menu?: ReactNode;
    /** Whether the bar's material shows. Display derivation, not a mode: the page has scrolled, or the title is under it. */
    readonly surfaceShown: boolean;
    /** Whether the one-line title shows: the screen's `ScrollHost` `condensed`. Display derivation, not a mode. */
    readonly titleShown: boolean;
}

/**
 * The web `CondensedTitleBar`'s props: the shared contract plus the one thing only the DOM can do. The bar is
 * `3.5rem + env(safe-area-inset-top)` tall, and only the browser can resolve the second term, so the frame reads the
 * element's rendered height (an `IntersectionObserver` margin takes px, not `calc()`). Native has no such input.
 */
export interface CondensedTitleBarWebProps extends CondensedTitleBarProps {
    /** Receives the bar's element when it mounts and `null` when it unmounts. */
    readonly barRef?: (node: HTMLElement | null) => void;
}
