/**
 * @module tamagui/tamaguiFonts — the type scale as Tamagui's two fonts. Pure, and free of any Tamagui import.
 *
 * Tamagui needs a default font, so these exist; no component reads them. Text is set by type role (`typeRole`), which
 * names a face, a size and a leading together. The fonts are keyed by size, not by role, because they hold facts of
 * the scale (each allowed size and its leading), and a role such as `figureInline` has no size of its own.
 *
 * Each family and face is a REGISTERED face name. React Native resolves `fontFamily` to exactly one loaded face, and a
 * CSS stack or a bare family name falls back to the system face without an error. Each leading is a `px` string,
 * because Tamagui 3 reads a bare number as a ratio of the font size.
 *
 * @pattern Adapter — the type scale projected into Tamagui's font shape
 */
import { devicePixelScale, snapLineHeight } from '../tokens/iosLineHeight.js';
import { bodyFontFace, displayFontFace, fontWeight, lineHeightPx } from '../tokens/scale.js';
import type { TypeSize } from '../tokens/typography.js';

/** Typed over every allowed size, so a size added to the scale without an entry here does not compile. */
const size: Readonly<Record<TypeSize, TypeSize>> = { 14: 14, 16: 16, 18: 18, 28: 28 };

/**
 * A size's leading as the platform draws it: on iOS a hair above the pixel grid (react/react-native#58970, see
 * `iosLineHeight.native.ts`), exact elsewhere. `lineHeightPx` itself stays exact.
 */
function leadingOf(step: TypeSize): `${number}px` {
    return `${snapLineHeight(lineHeightPx[step], devicePixelScale())}px`;
}

const lineHeight: Readonly<Record<TypeSize, `${number}px`>> = {
    14: leadingOf(14),
    16: leadingOf(16),
    18: leadingOf(18),
    28: leadingOf(28),
};

export const tamaguiFonts = {
    body: {
        family: bodyFontFace.normal,
        size,
        lineHeight,
        face: {
            [fontWeight.normal]: { normal: bodyFontFace.normal },
            [fontWeight.medium]: { normal: bodyFontFace.medium },
            [fontWeight.semibold]: { normal: bodyFontFace.semibold },
        },
    },
    heading: {
        family: displayFontFace.semibold,
        size,
        lineHeight,
        face: {
            [fontWeight.semibold]: { normal: displayFontFace.semibold },
        },
    },
} as const;
