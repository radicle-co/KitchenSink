/**
 * @module tokens/emit — unit-aware web emission for the numeric design scale. The single formatter for
 * turning `scale.ts` pixels into the web token strings, so the ÷16 → `rem` convention lives in one place.
 */

/**
 * Pixel value → web length. A unitless `0` is preserved as the number `0` (matching CSS + the historical
 * token output); every other value becomes a `rem` string at the 16px root.
 *
 * @example pxToRem(24) // '1.5rem'
 * @example pxToRem(0)  // 0
 */
export function pxToRem(px: number): string | 0 {
    return px === 0 ? 0 : `${px / 16}rem`;
}
