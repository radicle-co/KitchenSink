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

/**
 * Pixel value → `rem` string, ALWAYS unit-bearing (never the unitless `0`). For scales where `0` is not a
 * valid value and the consumer's type must stay a plain `string` — e.g. font sizes fed to Clerk's
 * `Theme.variables.fontSize` (`string | FontSizeScale`), which rejects the number `0` that {@link pxToRem}'s
 * union carries for the spacing scale.
 *
 * @example pxToRemUnit(16) // '1rem'
 */
export function pxToRemUnit(px: number): string {
    return `${px / 16}rem`;
}
