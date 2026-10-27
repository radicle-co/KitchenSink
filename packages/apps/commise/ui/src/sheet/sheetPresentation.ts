/**
 * @module @commise/ui/sheet — the native sheet's width, side padding and motion
 * (`docs/design/ingredientSpecialization.md` §S8.1; `docs/design/compactHeightLayout.md` §6).
 *
 * @pattern Policy — pure rules that map the window width, the device insets and the reduce-motion setting to the sheet's
 *     width, side padding and motion.
 */
import { spacing } from '../tokens/scale.js';

/** The sheet's edge padding, in dp, before a device inset is added to it. */
export const SHEET_EDGE_PADDING_DP = spacing[4];

/** The window width, in dp, from which the sheet stops spanning the full width. */
export const SHEET_WIDE_FROM_DP = 600;

/** The widest the sheet grows, in dp. */
export const SHEET_MAX_WIDTH_DP = 560;

/** The widest a `dialog` presentation grows, in dp (owner ruling 2026-10-26: 448 on a tablet, 834 and 1194 alike). */
export const SHEET_DIALOG_MAX_WIDTH_DP = 448;

/** Whether the sheet is a `dialog` presentation or the default. */
export type SheetPresentation = 'sheet' | 'dialog';

/**
 * Whether the sheet is a centred dialog rather than a bottom sheet. Pure.
 *
 * @param presentation - The sheet's presentation.
 * @param windowWidth - The window's width, in dp.
 * @returns `true` only for a `dialog` presentation from {@link SHEET_WIDE_FROM_DP}.
 */
export function sheetIsCentred(presentation: SheetPresentation, windowWidth: number): boolean {
    return presentation === 'dialog' && windowWidth >= SHEET_WIDE_FROM_DP;
}

/** The widest the sheet grows for a presentation, in dp. */
const maxWidthOf = (presentation: SheetPresentation): number =>
    presentation === 'dialog' ? SHEET_DIALOG_MAX_WIDTH_DP : SHEET_MAX_WIDTH_DP;

/**
 * The sheet's width for a window width. Pure.
 *
 * @param windowWidth - The window's width, in dp.
 * @param presentation - The sheet's presentation.
 * @returns Full width, capped at {@link SHEET_MAX_WIDTH_DP} (a `dialog`: {@link SHEET_DIALOG_MAX_WIDTH_DP}) from
 *   {@link SHEET_WIDE_FROM_DP}.
 */
export function sheetWidthStyle(
    windowWidth: number,
    presentation: SheetPresentation = 'sheet',
): { readonly width: '100%'; readonly maxWidth?: number } {
    return windowWidth >= SHEET_WIDE_FROM_DP
        ? { width: '100%', maxWidth: maxWidthOf(presentation) }
        : { width: '100%' };
}

/**
 * The padding one side of the sheet needs for a device inset on that side (`docs/design/compactHeightLayout.md` §6).
 * Pure.
 *
 * Below {@link SHEET_WIDE_FROM_DP} the sheet spans the window and takes the whole inset. From it the sheet is centred at
 * {@link SHEET_MAX_WIDTH_DP}, so it reaches only the part of the inset deeper than its gap to that window edge: a
 * sideways phone's 48 dp navigation bar used to cost a sheet 145 dp clear of it 48 dp of its width.
 *
 * @param windowWidth - The window's width, in dp.
 * @param inset - The device inset on that side, in dp.
 * @param presentation - The sheet's presentation, which sets the width it is centred at.
 * @returns `max(0, inset − gap to that window edge)`.
 */
export function sheetSideInsetPadding(
    windowWidth: number,
    inset: number,
    presentation: SheetPresentation = 'sheet',
): number {
    const gap = windowWidth >= SHEET_WIDE_FROM_DP ? (windowWidth - maxWidthOf(presentation)) / 2 : 0;

    return Math.max(0, inset - gap);
}

/**
 * How the sheet enters and leaves. Pure.
 *
 * @param reduceMotion - The platform's reduce-motion setting; `undefined` while it has not answered.
 * @returns `slide` only when reduce motion is known to be off.
 */
export function sheetAnimationType(reduceMotion: boolean | undefined): 'slide' | 'none' {
    return reduceMotion === false ? 'slide' : 'none';
}
