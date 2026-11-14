/**
 * @module @commise/features-recipes/form — whether the row editor may open inline or must open as the sheet.
 *
 * The inline editor is drawn in the page, between the sticky header and the action bar. When it is taller than that
 * space its Done and Cancel cannot both stay in reach, whatever the page scrolls to. So from a wide container it opens
 * inline only when the window is tall enough, in the cook's own text size, and otherwise as the same sheet a phone
 * gets, whose Done and Cancel are pinned. The test is in rem, so it is a pure function of two numbers the page already
 * has, and it needs no measurement of the editor and no ref.
 *
 * Pure and platform-agnostic.
 */

/**
 * The window height, in rem, that the inline editor needs.
 *
 * ⚠️ CHOSEN, not measured. It approximates the header, the action bar with the chrome's own clearance, and the tallest
 * editor the designs draw (a line under review, with its notice and "You wrote"), and 46 was picked so that an 800 px
 * window at the default text size stays inline while the same window at 200% text opens the sheet.
 *
 * What was checked, and what was not: `needsReviewJump.spec.ts` opens the editor at its tallest (a range, a note, a
 * preparation and a long "You wrote" line) at 1280 px wide in a window one pixel above 46 rem, at 100% and at 200% text,
 * and asserts it is inline with its reason on top and Done and Cancel in view between the header and the action bar. That
 * proves 46 rem is ENOUGH for that content at that width. The smallest height that is enough was not searched for, so the
 * true minimum is lower, and a narrower container or longer content than that case's may need more.
 */
export const INLINE_EDITOR_MIN_VIEWPORT_REM = 46;

/** The root font size taken when none can be read. */
const DEFAULT_ROOT_FONT_PX = 16;

/** What the choice reads. */
export interface InlineEditorFitFacts {
    /** The window's height, in CSS px (dp on native). */
    readonly viewportHeight: number;
    /** The root font size, in CSS px (16 scaled by the text size on native); not a positive number when unreadable. */
    readonly rootFontPx: number;
}

/**
 * Whether the window is tall enough for the inline editor, at the cook's text size.
 *
 * @param facts - The window's height and the root font size.
 * @returns `true` when the window holds at least {@link INLINE_EDITOR_MIN_VIEWPORT_REM} rem. Pure.
 */
export function editorFitsInline({ viewportHeight, rootFontPx }: InlineEditorFitFacts): boolean {
    const rem = rootFontPx > 0 ? rootFontPx : DEFAULT_ROOT_FONT_PX;

    return viewportHeight / rem >= INLINE_EDITOR_MIN_VIEWPORT_REM;
}
