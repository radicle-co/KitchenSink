/**
 * @module tokens/scale — the single numeric source of truth for the Commise design scale.
 *
 * Every platform token set is DERIVED from the values here — the web `rem`/px token strings
 * (`spacing.ts`, `radius.ts`, `shadows.ts`, `typography.ts`), the React Native `nativeTokens`
 * (`native.ts`), and the Tamagui tokens and fonts (`tamagui/tamaguiTokens.ts`, `tamagui/tamaguiFonts.ts`). Web
 * and native therefore cannot drift on a value: there is exactly one place a number lives.
 *
 * Values are deliberately unit-NEUTRAL. Lengths are raw pixels (each consumer applies its own
 * unit-aware emission: web ÷16 → `rem`, native → the number as-is); line-heights are px (see `lineHeightPx`);
 * font weights are numbers; families and the border colour are CSS-ready strings. Nothing here imports
 * a platform API, so the module is safe for web, React Native, and Node alike. (`colors.ts` is the one sibling it
 * reads, for the `glow` halo's colour; `colors.ts` imports nothing, so there is no cycle.)
 */

import { hexChannels, palette } from './colors.js';

/**
 * Spacing scale in pixels on a 4px base (step index → px). Web emits `rem` (÷16, unitless `0`);
 * native and Tamagui use the pixel number directly.
 */
export const spacing = {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 24,
    6: 32,
    7: 48,
    8: 64,
    9: 96,
} as const;

/**
 * Named MEDIA-BOX heights in pixels — the geometry of a lead image surface, which is a design decision
 * (how much of a screen the cover claims) rather than a spacing step, so it is named rather than derived
 * from the 4px ramp.
 *
 * `hero` is the recipe-detail cover box: the mockup's `h-64` phone value (`screenRecipeDetail`).
 * `heroPlaceholder` is the deliberately COMPACT band the no-cover fallback paints on a phone — a full-height
 * empty gradient would claim most of a phone's first screen and push the title below the fold. Web keeps the
 * full box on both states because a desktop hero has the room; see `RecipeHero.native.tsx` for the rationale.
 */
export const mediaHeight = {
    hero: 256,
    heroPlaceholder: 96,
} as const;

/**
 * Corner radii in pixels. `full` is a pill sentinel — web emits it as `px` (not `rem`); Tamagui keeps the names, so
 * it is the `$full` token.
 */
export const radius = {
    sm: 8,
    md: 12,
    lg: 18,
    xl: 24,
    full: 9999,
} as const;

/**
 * Font families as CSS font-stack strings — **web only** (`--font-*`). A stack is meaningless to React
 * Native, whose `fontFamily` resolves exactly one REGISTERED face; native display type selects a face from
 * {@link displayFontFace} instead (and `nativeTokens` deliberately exposes no stack at all).
 */
export const fontFamily = {
    display: '"Manrope", Inter, system-ui, sans-serif',
    body: 'Inter, system-ui, sans-serif',
    mono: '"JetBrains Mono", monospace',
} as const;

/**
 * The REGISTERED native faces of the display family, keyed by the {@link fontWeight} step each one paints.
 *
 * React Native resolves `fontFamily` to a single registered face name; handed the CSS stack above it falls
 * back to the system face **silently** — brand type that never renders and never errors. These are the
 * faces the apps load at start-up (`@expo-google-fonts/manrope`), and they are single-sourced here
 * so no consumer re-types a face-name literal. Their shape is asserted against {@link fontFamily}.display
 * and {@link fontWeight} in the token tests, so renaming the family or moving a weight step cannot leave a
 * stale name pointing at a font nobody loads.
 */
export const displayFontFace = {
    semibold: 'Manrope_600SemiBold',
    // The weight ceiling is 600 (`fontWeight.bold`), so the bold step is the same face. No 700 face is loaded.
    bold: 'Manrope_600SemiBold',
} as const;

/**
 * The REGISTERED native faces of the body family (Inter), one per {@link fontWeight} step (§1.5). Loaded at start-up
 * from `@expo-google-fonts/inter` beside the display faces (`mobile/App.tsx`), and guarded by the same face-contract
 * test as {@link displayFontFace}. A native type role picks the face for its weight and never sets `fontWeight`.
 */
export const bodyFontFace = {
    normal: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_600SemiBold',
} as const;

/** Numeric font weights (web stringifies them; native/Tamagui keep the `'400'`-style string form). */
export const fontWeight = {
    normal: 400,
    medium: 500,
    semibold: 600,
    // The ceiling is 600 (redesign): `bold` is the semibold step. A 700 weight is never drawn.
    bold: 600,
} as const;

/**
 * Line height in px for each allowed font size (owner ruling 2026-10-25: line heights are whole px on a 4 px grid).
 * A pixel value is the source of truth: native uses it as is, and web writes it as the unitless `calc(px / size)`.
 * Each type role sets its own leading in `typeRole`. This table is the leading for the size ramp and Tamagui's font
 * tokens.
 */
export const lineHeightPx = {
    14: 20,
    16: 24,
    18: 24,
    28: 32,
} as const;

/**
 * The named type ramp — font size in pixels, largest to smallest. Web emits `rem` under kebab-case keys
 * (`display-md` …); native uses the pixel number. Every value is one of 14, 16, 18 or 28 (the owner's type-scale
 * ruling, pinned by `__tests__/typeScale.test.ts`); several names share a size because a name says what a step is
 * for, and the rule says how many sizes there are. Nothing above 28: the 48 and 36 steps are retired.
 */
export const fontSize = {
    displayMd: 28,
    headingLg: 18,
    headingMd: 18,
    headingSm: 18,
    bodyLg: 18,
    bodyMd: 16,
    bodySm: 14,
    caption: 14,
} as const;

/** One layer of a shadow: `offsetX`/`offsetY`/`blur`/`spread` in px, an `r,g,b` colour triplet and an `opacity`. */
export interface ElevationLayer {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blur: number;
    readonly spread: number;
    readonly color: string;
    readonly opacity: number;
}

/** A `#RRGGBB` colour as the `r,g,b` triplet a shadow layer carries. */
function rgbTriplet(hex: string): string {
    return hexChannels(hex, 'rgbTriplet').join(',');
}

/**
 * Elevation specs, each a stack of one or two shadow layers (the redesign's cool, soft shadows). Web composes a CSS
 * `box-shadow` from EVERY layer (spread omitted when 0); native has one shadow per view, so it takes the LAST layer,
 * the diffuse one that carries the depth. `glow` is the focus halo: a 3 px ring, no blur.
 *
 * The `glow` colour is DERIVED from `palette.steel` ({@link rgbTriplet}), so the halo cannot drift from the button
 * it rings.
 */
export const elevation = {
    sm: [{ offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: '20,30,45', opacity: 0.05 }],
    md: [
        { offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: '20,30,45', opacity: 0.05 },
        { offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: '20,30,45', opacity: 0.05 },
    ],
    lg: [
        { offsetX: 0, offsetY: 2, blur: 4, spread: 0, color: '10,20,30', opacity: 0.08 },
        { offsetX: 0, offsetY: 8, blur: 22, spread: 0, color: '10,20,30', opacity: 0.12 },
    ],
    xl: [{ offsetX: 0, offsetY: 12, blur: 30, spread: 0, color: '10,20,30', opacity: 0.18 }],
    glow: [{ offsetX: 0, offsetY: 0, blur: 0, spread: 3, color: rgbTriplet(palette.steel), opacity: 0.25 }],
} as const satisfies Record<string, readonly [ElevationLayer, ...ElevationLayer[]]>;

/**
 * How far a locked, unavailable or disabled native control dims (§1.10). One number for every control that dims — the
 * `Button`, the stepper, a text field, and a control that cannot be a `Button` (the sign-in provider buttons) — so none
 * drifts from the rest. Unit-neutral: an opacity, 0 to 1.
 */
export const dimmedOpacity = 0.4;

export type Spacing = typeof spacing;
export type Radius = typeof radius;
export type FontFamily = typeof fontFamily;
export type DisplayFontFace = typeof displayFontFace;
export type BodyFontFace = typeof bodyFontFace;
export type FontWeight = typeof fontWeight;
export type FontSize = typeof fontSize;
export type Elevation = typeof elevation;

/** Ramp step name (`displayMd` … `caption`). */
export type FontSizeName = keyof FontSize;
