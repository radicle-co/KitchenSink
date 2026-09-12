/**
 * @module @commise/ui/dialog-frame — the centred dialog's geometry (`docs/design/compactHeightLayout.md` §9.2).
 *
 * @pattern Policy — pure rules from the device insets to the frame's geometry.
 */
import { spacing } from '../tokens/scale.js';

/** The widest a centred dialog's card grows, in dp. One value for every dialog. */
export const DIALOG_CARD_MAX_WIDTH_DP = 480;

/**
 * The scrim's padding on one edge: the device inset there, and never less than 16 dp. Pure.
 *
 * @param inset - The device inset on that edge, in dp.
 * @returns `max(spacing[4], inset)`.
 */
export function dialogScrimPadding(inset: number): number {
    return Math.max(spacing[4], inset);
}
