/**
 * @module @commise/ui/sheet — the native sheet's width and motion (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * @pattern Policy — pure rules that map the window width and the reduce-motion setting to the sheet's width and motion.
 */
import { spacing } from '../tokens/scale.js';

/** The sheet's edge padding, in dp, before a device inset is added to it. */
export const SHEET_EDGE_PADDING_DP = spacing[4];

/** The window width, in dp, from which the sheet stops spanning the full width. */
export const SHEET_WIDE_FROM_DP = 600;

/** The widest the sheet grows, in dp. */
export const SHEET_MAX_WIDTH_DP = 560;

/**
 * The sheet's width for a window width. Pure.
 *
 * @param windowWidth - The window's width, in dp.
 * @returns Full width, capped at {@link SHEET_MAX_WIDTH_DP} from {@link SHEET_WIDE_FROM_DP}.
 */
export function sheetWidthStyle(windowWidth: number): { readonly width: '100%'; readonly maxWidth?: number } {
    return windowWidth >= SHEET_WIDE_FROM_DP ? { width: '100%', maxWidth: SHEET_MAX_WIDTH_DP } : { width: '100%' };
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
