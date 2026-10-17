/**
 * @module @commise/ui/section-index — the shared contract of the design-system `SectionIndex`
 * (`docs/design/uiOverhaul/buildSpec.md` §7.2, owner decision D2, `editorNavA.md` / `editorNavB.md`).
 *
 * One component, one data model, three presentations, chosen by the width the content gets: a sticky **rail** (240 px)
 * at `@wide` (≥ 960), a one-row **strip** (48 px) at `@regular` (600–959), and a one-line **bar** (44 px) that opens a
 * sheet at `@narrow` (< 600).
 *
 * ⛔ The index knows nothing about recipes. The caller decides each item's tone, words and counts — for the editor,
 * from the ONE publish validator, so the index and Publish cannot disagree — and passes localized copy only. The index
 * only draws what it is given. A jump goes through the screen's ONE `ScrollHost` (`useScrollHost().scrollToSection`,
 * blueprint A7): on web that also moves focus to the heading and writes the hash; on native the caller moves
 * accessibility focus to the heading when `onJump` reports, because the host holds no heading refs.
 */
import type { ReactNode } from 'react';

/**
 * How an item's status is drawn. Never colour alone (SC 1.4.1): each tone has a glyph or words.
 *
 * - `fix` — `dangerText` ⚠ with the reason ("Fix 2 things"); counted in the bar. (`danger` is the destructive FILL.)
 * - `attention` — `attention` ⚠ with the reason ("2 need a match"); counted in the bar.
 * - `muted` — `inkMuted` reason only ("Not started", "Title needed", "Optional", "Start here"); no glyph.
 * - `complete` — `ink` ✓, no colour; the reason, when given, is shown in `ink` ("Ready to publish"). GOV.UK: done is
 *   quiet, so the rows that need action stand out.
 */
export type SectionIndexTone = 'fix' | 'attention' | 'muted' | 'complete';

/** One section the index lists. `id` is the section heading's element id (web) and its section id (native). */
export interface SectionIndexItem {
    readonly id: string;
    /** The section's name: the exact text of its heading, and the link's accessible name. */
    readonly label: string;
    /** The strip's visible label ("Photos" for "Photos & publish"). Defaults to `label`. */
    readonly shortLabel?: string;
    readonly tone: SectionIndexTone;
    /**
     * The status in words, linked to the item with `aria-describedby`. Shown under the label in the rail and the
     * sheet; screen-reader text in the strip. Absent for a plain `complete`.
     */
    readonly reason?: string;
    /**
     * The words a screen reader hears for a status that SHOWS none — a plain `complete`, which is quiet by design
     * (GOV.UK) and would otherwise be a bare ✓ with no text alternative (SC 1.1.1). Never shown; ignored when `reason`
     * is given.
     */
    readonly spokenStatus?: string;
    /** How many things need action: the strip's glyph count, and the bar's total. Only `fix` and `attention`. */
    readonly count?: number;
    /** The guided-progress hint under the label (rail and sheet only), for a first recipe. */
    readonly hint?: string;
}

/** Props for the `SectionIndex` leaves (web and native). */
export interface SectionIndexProps {
    /** The navigation's name ("Recipe sections"). */
    readonly label: string;
    /** The phone sheet's title ("Sections"). */
    readonly sheetTitle: string;
    /**
     * The accessible name of the phone sheet's icon-only close control ("Close sections"): `@commise/ui/sheet` requires
     * one, and the index holds no copy of its own.
     */
    readonly sheetCloseLabel: string;
    /** The items, in page order. */
    readonly items: readonly SectionIndexItem[];
    /** The section the reader is in (a position, not a status): marked with the 3 px `hereBar` and `aria-current`. */
    readonly currentId?: string;
    /**
     * The phone bar's accessible name, composed by the caller
     * ("Sections. Current: Ingredients. 2 need attention. 1 of 4 done.").
     */
    readonly barName: string;
    /** Text after the current label in the phone bar (" · 1 of 4 done" for a first recipe). */
    readonly barSuffix?: string;
    /** The phone bar's end text when anything needs action ("⚠ 2"); hidden from screen readers (the name says it). */
    readonly barCount?: string;
    /** The rail's foot (the nutrition total, the done count). Rail only. */
    readonly railFooter?: ReactNode;
    /**
     * Called with the section chosen, after the phone sheet has closed and the jump has been asked of the screen's
     * `ScrollHost`. The editor uses it as a section-change checkpoint and, on native, to move accessibility focus.
     */
    readonly onJump?: (id: string) => void;
    /**
     * Web only: names the two boxes that stick under the page's header, the strip `{stickyId}-strip` and the phone bar
     * `{stickyId}-bar`, so the page can keep its popups clear of them. Native places its bar itself and ignores it.
     */
    readonly stickyId?: string;
    /**
     * Web only: the page's bars are past the limit (`compactHeightLayout.md` A1 — a phone keyboard, or large text on a
     * short screen), so the strip and the phone bar are not drawn; the rail stays. Native hides its bar itself.
     */
    readonly narrowHidden?: boolean;
}
