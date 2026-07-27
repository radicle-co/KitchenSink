/**
 * @module tokens/native — React Native-typed design tokens, DERIVED from the single numeric source
 * (`scale.ts`). Where the web tokens emit `rem`/px strings, native consumes raw numbers and structured
 * objects; `nativeTokens` is the RN-facing projection of the exact same scale, so the two platforms
 * cannot drift. This module is pure data (no `react-native` import) and safe under Node/Vitest.
 */
import {
    borderSubtle,
    displayFontFace,
    elevation,
    fontSize,
    fontWeight,
    lineHeightRatio,
    mediaHeight,
    radius,
    spacing,
} from './scale.js';

/**
 * A React Native shadow, composed from a `scale.elevation` spec. `shadowColor` + `shadowOpacity` are
 * kept separate (iOS), `shadowRadius` is the blur, `shadowOffset` the drop, and `elevation` the Android
 * depth (mapped from the vertical offset). CSS `spread` has no RN equivalent and is intentionally dropped.
 */
export interface NativeShadow {
    readonly shadowColor: string;
    readonly shadowOffset: { readonly width: number; readonly height: number };
    readonly shadowOpacity: number;
    readonly shadowRadius: number;
    readonly elevation: number;
}

function toNativeShadow(spec: (typeof elevation)[keyof typeof elevation]): NativeShadow {
    return {
        shadowColor: `rgb(${spec.color})`,
        shadowOffset: { width: spec.offsetX, height: spec.offsetY },
        shadowOpacity: spec.opacity,
        shadowRadius: spec.blur,
        elevation: spec.offsetY,
    };
}

const nativeElevation = {
    sm: toNativeShadow(elevation.sm),
    md: toNativeShadow(elevation.md),
    lg: toNativeShadow(elevation.lg),
    xl: toNativeShadow(elevation.xl),
    glow: toNativeShadow(elevation.glow),
} as const;

/**
 * The React Native projection of the design scale. `spacing`/`radius`/`fontSize` are pixel numbers,
 * `lineHeight` are unitless ratios, `fontWeight` are numeric weights, `elevation` are RN shadow objects,
 * and `borderSubtle` is the shared string.
 *
 * Type is projected as `fontFace` — the REGISTERED face names — and NOT as the web `fontFamily` stacks:
 * React Native resolves `fontFamily` to one registered face, so handing it a stack silently renders the
 * system font. Withholding the stack here is what makes that bug unrepresentable on native (guarded by
 * `__tests__/nativeFontFace.test.ts`).
 */
export const nativeTokens = {
    spacing,
    radius,
    mediaHeight,
    fontFace: { display: displayFontFace },
    fontWeight,
    lineHeight: lineHeightRatio,
    fontSize,
    elevation: nativeElevation,
    borderSubtle,
} as const;

export type NativeTokens = typeof nativeTokens;
