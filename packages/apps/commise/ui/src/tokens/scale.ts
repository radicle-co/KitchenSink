/**
 * @module tokens/scale — the single numeric source of truth for the Commise design scale.
 *
 * Every platform token set is DERIVED from the values here — the web `rem`/px token strings
 * (`spacing.ts`, `radius.ts`, `shadows.ts`, `typography.ts`), the React Native `nativeTokens`
 * (`native.ts`), and the mobile Tamagui `createTokens`/`createFont` ramps (`tamagui.config.ts`). Web
 * and native therefore cannot drift on a value: there is exactly one place a number lives.
 *
 * Values are deliberately unit-NEUTRAL. Lengths are raw pixels (each consumer applies its own
 * unit-aware emission: web ÷16 → `rem`, native → the number as-is); line-heights are unitless ratios;
 * font weights are numbers; families and the border colour are CSS-ready strings. Nothing here imports
 * a platform API, so the module is safe for web, React Native, and Node alike.
 */

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
 * `hero` is the recipe-detail cover box: the mockup's `h-64` phone value (`screen-recipe-detail`).
 * `heroPlaceholder` is the deliberately COMPACT band the no-cover fallback paints on a phone — a full-height
 * empty gradient would claim most of a phone's first screen and push the title below the fold. Web keeps the
 * full box on both states because a desktop hero has the room; see `RecipeHero.native.tsx` for the rationale.
 */
export const mediaHeight = {
    hero: 256,
    heroPlaceholder: 96,
} as const;

/**
 * Corner radii in pixels. `full` is a pill sentinel — web emits it as `px` (not `rem`); Tamagui maps
 * it to its highest numeric radius step.
 */
export const radius = {
    sm: 6,
    md: 12,
    lg: 20,
    xl: 28,
    full: 9999,
} as const;

/**
 * Font families as CSS font-stack strings — **web only** (`--font-*`). A stack is meaningless to React
 * Native, whose `fontFamily` resolves exactly one REGISTERED face; native display type selects a face from
 * {@link displayFontFace} instead (and `nativeTokens` deliberately exposes no stack at all).
 */
export const fontFamily = {
    display: '"Playfair Display", Georgia, serif',
    body: 'Inter, system-ui, sans-serif',
    mono: '"JetBrains Mono", monospace',
} as const;

/**
 * The REGISTERED native faces of the display family, keyed by the {@link fontWeight} step each one paints.
 *
 * React Native resolves `fontFamily` to a single registered face name; handed the CSS stack above it falls
 * back to the system face **silently** — brand type that never renders and never errors. These are the
 * faces the apps load at start-up (`@expo-google-fonts/playfair-display`), and they are single-sourced here
 * so no consumer re-types a face-name literal. Their shape is asserted against {@link fontFamily}.display
 * and {@link fontWeight} in the token tests, so renaming the family or moving a weight step cannot leave a
 * stale name pointing at a font nobody loads.
 */
export const displayFontFace = {
    semibold: 'PlayfairDisplay_600SemiBold',
    bold: 'PlayfairDisplay_700Bold',
} as const;

/** Numeric font weights (web stringifies them; native/Tamagui keep the `'400'`-style string form). */
export const fontWeight = {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
} as const;

/**
 * Unitless line-height ratios. Web emits them verbatim as CSS `line-height` multipliers; native
 * multiplies a font size by the ratio to get an absolute px leading.
 */
export const lineHeightRatio = {
    heading: 1.2,
    body: 1.5,
    caption: 1.4,
} as const;

/**
 * The named type ramp — font size in pixels, largest to smallest. Web emits `rem` under kebab-case
 * keys (`display-xl` …); native uses the pixel number. The set intentionally includes every size the
 * mobile Playfair/display ramp needs (16, 20, 24, 28, 36, 48) so that ramp derives from here too.
 */
export const fontSize = {
    displayXl: 48,
    displayLg: 36,
    displayMd: 28,
    headingLg: 24,
    headingMd: 20,
    headingSm: 18,
    bodyLg: 18,
    bodyMd: 16,
    bodySm: 14,
    caption: 12,
    overline: 11,
} as const;

/**
 * Elevation specs. Each is a resolution-neutral shadow: `offsetX`/`offsetY`/`blur`/`spread` in px, an
 * `r,g,b` colour triplet, and an `opacity`. Web composes a CSS `box-shadow` string (spread omitted
 * when 0); native composes an RN shadow object. `glow` is an ambient (spread-less) halo.
 */
export const elevation = {
    sm: { offsetX: 0, offsetY: 1, blur: 3, spread: 0, color: '45,52,54', opacity: 0.04 },
    md: { offsetX: 0, offsetY: 4, blur: 6, spread: -1, color: '45,52,54', opacity: 0.07 },
    lg: { offsetX: 0, offsetY: 10, blur: 15, spread: -3, color: '45,52,54', opacity: 0.08 },
    xl: { offsetX: 0, offsetY: 20, blur: 25, spread: -5, color: '45,52,54', opacity: 0.09 },
    // `glow` is the seafoam halo. Its triplet is `palette.seafoam` re-spelled in decimal, because `colors.ts`
    // imports THIS module (`borderSubtle`) and the reverse import would be a cycle. It is therefore the one
    // place a palette colour lives twice — kept in agreement by `__tests__/scale.test.ts`, which asserts the
    // triplet against the token. Move `seafoam` and that test fails until this follows.
    glow: { offsetX: 0, offsetY: 0, blur: 32, spread: 0, color: '49,128,122', opacity: 0.25 },
} as const;

/** The subtle border colour — single source for the web `semantic.border` and the native theme. */
export const borderSubtle = 'rgba(178, 190, 195, 0.3)';

export type Spacing = typeof spacing;
export type Radius = typeof radius;
export type FontFamily = typeof fontFamily;
export type DisplayFontFace = typeof displayFontFace;
export type FontWeight = typeof fontWeight;
export type LineHeightRatio = typeof lineHeightRatio;
export type FontSize = typeof fontSize;
export type Elevation = typeof elevation;

/** Ramp step name (`displayXl` … `overline`). */
export type FontSizeName = keyof FontSize;
