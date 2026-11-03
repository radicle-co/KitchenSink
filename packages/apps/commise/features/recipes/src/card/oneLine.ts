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
import { badgeHeightOf } from '@commise/ui/badge-box';
import { lineHeightPx } from '@commise/ui/scale';

/**
 * The `meta` leading (14 pt text), in points. It is the scale's raw value, not `nativeTokens.type.meta.lineHeight`: on
 * iOS that projection sits 0.001 above the pixel grid (react/react-native#58970) and `ceil` would add a whole point.
 */
const META_LEADING = lineHeightPx[14];

/**
 * The height of a row of `meta` text and 16 pt icons, at an OS font scale.
 *
 * @param fontScale - The OS font scale (`useWindowDimensions().fontScale`).
 * @returns The height, in points, rounded up so the text is never clipped.
 */
export function metaLineHeightOf(fontScale: number): number {
    return Math.ceil(META_LEADING * fontScale);
}

/**
 * The height of a row that holds a badge (difficulty, status) beside `meta` text (the rating, "No ratings yet"). The
 * badge's box is the design system's (`@commise/ui/badge-box`). The status badge's word stops growing at the 2× cap,
 * but the difficulty badge's word is not on the capped `Text` yet and grows with the system scale, so it sets the row.
 * When it ports, its term becomes `badgeHeightOf(Math.min(fontScale, FONT_SCALE_CAP))`.
 *
 * @param fontScale - The OS font scale.
 * @returns The height, in points: the taller of the badge and the meta text.
 */
export function badgeLineHeightOf(fontScale: number): number {
    return Math.max(badgeHeightOf(fontScale), metaLineHeightOf(fontScale));
}
