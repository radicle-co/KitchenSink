/**
 * @module @commise/features-recipes/card — where the cover's status chip may be as wide as it needs (designer ruling
 * 2026-11-03, `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`).
 *
 * The chip takes its content width and its word never truncates. The status chip and the PRO badge share one wrapping row,
 * so a second chip that does not fit moves whole to the next line. A chip wider than the cover less its insets drops its
 * glyph and keeps the word, so the room the WORD has is the cover less the insets and the chip's own padding. The old
 * rule capped the chip at half the cover (W-08): on a 148 pt tile that left 38 pt, and "Private" needs 47.
 *
 * Pure. Both leaves draw to these numbers (`RecipeCard.native.tsx` uses the constants; the web classes `inset-x-2` and
 * `px-2` are the same 8 pt), and `list/__tests__/libraryGrid.fit.test.ts` measures the words against `coverChipWordRoom`.
 *
 * @pattern Policy — the room a cover chip's word has
 */
import { nativeTokens } from '@commise/ui/native';

/** The gap between the cover's edge and its chips, on each side. */
export const COVER_CHIP_INSET = nativeTokens.spacing[2];

/** The chip's own horizontal padding, on each side. */
export const COVER_CHIP_PADDING = nativeTokens.spacing[2];

/** The chip's own vertical padding, on each side. */
export const COVER_CHIP_PADDING_V = 2;

/**
 * The width the status chip's word has on a cover: the cover less its insets and the chip's padding, with the glyph
 * dropped when the word would otherwise not fit.
 *
 * @param coverWidth - The cover's width, which is the card's.
 * @returns The room for the word, never below 0.
 */
export function coverChipWordRoom(coverWidth: number): number {
    return Math.max(0, coverWidth - 2 * COVER_CHIP_INSET - 2 * COVER_CHIP_PADDING);
}
