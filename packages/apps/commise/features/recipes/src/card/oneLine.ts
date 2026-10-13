/**
 * @module @commise/features-recipes/card — the height of a native card's one-line rows.
 *
 * A native row cannot clip by `:empty` or a container query, so a "one line" row is a wrapping row with a FIXED height
 * that hides the second line (`buildSpec.md` §4.1: items drop from the end). That height used to be 24 for every row.
 * At the OS's largest font scale the text is twice as tall as that, so the text tops and the badges clipped (A-028),
 * and at the default scale a 14 pt meta line (19.6 pt tall) left 4 pt of a dropped item showing under it (W-06). The
 * height is therefore exactly the line the row holds, scaled by the font scale.
 *
 * Pure.
 */
import { nativeTokens } from '@commise/ui/native';

/** A badge's own floor, and the padding above and below its word (`DifficultyBadge`, `StatusBadge`). */
const BADGE_MIN_HEIGHT = 24;
const BADGE_VERTICAL_PADDING = 4;

/**
 * A type role's leading, in points. The roles all state one; a role that did not would fall back to its size.
 *
 * @param style - The native type role.
 * @returns The leading.
 */
function leadingOf(style: { readonly lineHeight?: number; readonly fontSize?: number }): number {
    return style.lineHeight ?? style.fontSize ?? 0;
}

/**
 * The height of a row of `meta` text and 16 pt icons, at an OS font scale.
 *
 * @param fontScale - The OS font scale (`useWindowDimensions().fontScale`).
 * @returns The height, in points, rounded up so the text is never clipped.
 */
export function metaLineHeightOf(fontScale: number): number {
    return Math.ceil(leadingOf(nativeTokens.type.meta) * fontScale);
}

/**
 * The height of a row that holds a badge (difficulty, status) beside `meta` text (the rating, "No ratings yet").
 *
 * @param fontScale - The OS font scale.
 * @returns The height, in points: the larger of the badge floor, the badge's word with its padding, and the meta text.
 */
export function badgeLineHeightOf(fontScale: number): number {
    const word = Math.ceil(leadingOf(nativeTokens.type.caption) * fontScale) + BADGE_VERTICAL_PADDING;

    return Math.max(BADGE_MIN_HEIGHT, word, metaLineHeightOf(fontScale));
}
