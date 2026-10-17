/**
 * @module @commise/ui/large-title-header — the shared contract of the design-system `LargeTitleHeader` and its
 * `CondensedTitleBar` (`docs/design/uiOverhaul/buildSpec.md` §3.3; blueprint slice 3 step 3). Every screen with a
 * title uses them.
 *
 * - **Phone and tablet (web below 840, native at every size):** a transparent 44 px row holds `back` (start) and
 *   `action` (end); the H1 sits under it in `largeTitle`. On a pushed web screen and on every native screen, once the
 *   heading scrolls under that row the SCREEN shows a `CondensedTitleBar` — a 56 px bar on the floating layer, the title
 *   in `barTitle`, one line. A top-level web page mounts none: the tab bar already says where you are.
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

/** The cross-platform `CondensedTitleBar` contract. */
export interface CondensedTitleBarProps {
    /** The title, repeated from the H1 in one line; hidden from assistive tech. */
    readonly title: string;
    /** The way back, kept one tap away (Nielsen #3). */
    readonly back?: HeaderBack;
    /** A ⋯ menu at the end. */
    readonly menu?: ReactNode;
    /** Whether the bar shows: the screen's `ScrollHost` `condensed`. Display derivation, not a mode. */
    readonly visible: boolean;
}
