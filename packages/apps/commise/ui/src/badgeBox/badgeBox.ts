/**
 * @module @commise/ui/badge-box — the one box both native badges draw (`StatusBadge`, `DifficultyBadge`), and its
 * height at a font scale. A box draws at its floor or at its contents, whichever is taller; the contents are a caption
 * line, the padding and the edges. The values are chosen so the contents fill the floor exactly at 1×, so every tone
 * draws 24 pt: a neutral badge's 1 pt edges once made it 26 pt where a row let it grow, and a card row that restated
 * the padding without the edges was 2 pt short of it. Pure.
 */
import { nativeTokens } from '../tokens/native.js';

/** The badge's floor, and the padding and edge above and below its word, in points. */
export const BADGE_BOX = { minHeight: 24, paddingVertical: 1, borderWidth: 1 } as const;

/**
 * A badge's drawn height at a font scale. A caller passes the scale its word is drawn at: the capped scale for text on
 * the design system's `Text` (at most `FONT_SCALE_CAP`), the system scale for text not yet on it. Pure.
 *
 * @param fontScale - The scale the badge's caption is drawn at.
 * @returns The height, in points, rounded up so the word is never clipped.
 */
export function badgeHeightOf(fontScale: number): number {
    const { minHeight, paddingVertical, borderWidth } = BADGE_BOX;
    const word = Math.ceil(nativeTokens.type.caption.lineHeight * fontScale);

    return Math.max(minHeight, word + 2 * (paddingVertical + borderWidth));
}
