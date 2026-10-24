/**
 * @module @commise/ui/dialog-frame — the centred dialog's geometry (`docs/design/compactHeightLayout.md` §9.2) and motion.
 *
 * @pattern Policy — pure rules from the device insets and the reduce-motion setting to the frame's geometry and motion.
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

/**
 * How the dialog's window enters and leaves: the Sheet's rule (`sheetAnimationType`), with a fade for a slide. Pure.
 *
 * @param reduceMotion - The platform's reduce-motion setting; `undefined` while it has not answered.
 * @returns `fade` only when reduce motion is known to be off (WCAG 2.3.3).
 */
export function dialogAnimationType(reduceMotion: boolean | undefined): 'fade' | 'none' {
    return reduceMotion === false ? 'fade' : 'none';
}
