/**
 * @module @commise/features-recipes/form — whether the row editor may open inline or must open as the sheet.
 *
 * The inline editor is drawn in the page, between the sticky header and the action bar. When it is taller than that
 * space its Done and Cancel cannot both stay in reach, whatever the page scrolls to, and a narrower container makes it
 * taller. So it opens inline only when the window is tall enough AND the container wide enough, in the cook's own text
 * size, and otherwise as the same sheet a phone gets, whose Done and Cancel are pinned. The test is in rem, so it is a
 * pure function of three numbers the page already has, and it needs no measurement of the editor and no ref.
 *
 * Pure and platform-agnostic.
 */

/**
 * The window height, in rem, that the inline editor needs.
 *
 * Measured, 2026-11-14: 46 rem. It is the smallest window height at which the editor at its tallest (a range, a note, a
 * preparation and a long "You wrote" line), reached by the "Needs review" jump, opens inline with the whole reason BELOW
 * ALL the sticky chrome (the header and the section tabs under it, read from computed styles) and above the action bar,
 * and Done and Cancel in view. An earlier reading measured the header alone, passed from 43 rem, and left the first line
 * of the reason under the section tabs. The steps were one rem at a time, with the inline editor forced, over a window
 * 1280 and 1024 px wide at 100% text (fails at 42 and 45 rem, passes from 43 and 46) and 2560 and 2048 px wide at 200%
 * text (the same rem widths; passes from 42 and 45). 46 is the largest, and it holds at the narrowest container the
 * width limit admits.
 */
export const INLINE_EDITOR_MIN_VIEWPORT_REM = 46;

/**
 * The width, in rem, that the editor's container needs for the inline editor.
 *
 * Measured, 2026-11-14: 43 rem, the content box of the editor's `MainColumn` (its client width less its padding, as
 * `useMainContainerWidth` reads it). The window was held at exactly 46 rem high (the height limit above), the editor was
 * the longest one (a range, a note, a preparation and a long "You wrote" line) reached by the "Needs review" jump, and the
 * container was widened one rem at a time with the strict reading (the whole reason below all the sticky chrome and above
 * the action bar, Done and Cancel in view). At 100% text it fails at 42 rem and passes from 43; at 200% text it fails at
 * 40 and passes from 41. 43 is the larger. A narrower container makes the editor taller, so the two limits are read
 * together.
 */
export const INLINE_EDITOR_MIN_CONTAINER_REM = 43;

/** The root font size taken when none can be read. */
const DEFAULT_ROOT_FONT_PX = 16;

/** What the choice reads. */
export interface InlineEditorFitFacts {
    /** The window's height, in CSS px (dp on native). */
    readonly viewportHeight: number;
    /** The width of the container the editor would open in, in CSS px (dp on native). */
    readonly containerWidth: number;
    /** The root font size, in CSS px (16 scaled by the text size on native); not a positive number when unreadable. */
    readonly rootFontPx: number;
}

/**
 * Whether the window is tall enough for the inline editor, at the cook's text size.
 *
 * @param facts - The window's height, the container's width and the root font size.
 * @returns `true` when the window is at least {@link INLINE_EDITOR_MIN_VIEWPORT_REM} rem high AND the container at least
 * {@link INLINE_EDITOR_MIN_CONTAINER_REM} rem wide. Pure.
 */
export function editorFitsInline({ viewportHeight, containerWidth, rootFontPx }: InlineEditorFitFacts): boolean {
    const rem = rootFontPx > 0 ? rootFontPx : DEFAULT_ROOT_FONT_PX;

    return (
        viewportHeight / rem >= INLINE_EDITOR_MIN_VIEWPORT_REM &&
        containerWidth / rem >= INLINE_EDITOR_MIN_CONTAINER_REM
    );
}
