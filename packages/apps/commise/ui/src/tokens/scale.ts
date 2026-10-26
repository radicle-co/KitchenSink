/**
 * @module tokens/scale — the single numeric source of truth for the Commise design scale.
 *
 * Every platform token set is DERIVED from the values here — the web `rem`/px token strings
 * (`spacing.ts`, `radius.ts`, `shadows.ts`, `typography.ts`), the React Native `nativeTokens`
 * (`native.ts`), and the mobile Tamagui `createTokens`/`createFont` ramps (`tamagui.config.ts`). Web
 * and native therefore cannot drift on a value: there is exactly one place a number lives.
 *
 * Values are deliberately unit-NEUTRAL. Lengths are raw pixels (each consumer applies its own
 * unit-aware emission: web ÷16 → `rem`, native → the number as-is); line-heights are px (see `lineHeightPx`);
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

/**
 * The REGISTERED native faces of the body family (Inter), one per {@link fontWeight} step (§1.5). Loaded at start-up
 * from `@expo-google-fonts/inter` beside the display faces (`mobile/App.tsx`), and guarded by the same face-contract
 * test as {@link displayFontFace}. A native type role picks the face for its weight and never sets `fontWeight`.
 */
export const bodyFontFace = {
    normal: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
} as const;

/** Numeric font weights (web stringifies them; native/Tamagui keep the `'400'`-style string form). */
export const fontWeight = {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
} as const;

/**
 * Unitless line-height ratios — **DEPRECATED, and not a way to set a line height.** A ratio times a size gives 21,
 * 21.6 or 33.6 px, which cannot sit on the 4 px grid; use {@link lineHeightPx} or a type role. It stays for one
 * consumer, `tools/designArtifact` (`buildTokens.ts`), which reads `heading` for its design-canvas ramp and is not
 * edited from this package. Delete it with that consumer.
 */
export const lineHeightRatio = {
    heading: 1.2,
    body: 1.5,
    caption: 1.4,
} as const;

/**
 * Line height in px for each allowed font size (owner ruling 2026-10-25: line heights are whole px on a 4 px grid).
 * A pixel value is the source of truth: native uses it as is, and web writes it as the unitless `calc(px / size)`.
 * 18 is 24 for a heading or figure; reading text sets itself at 28 (`typeRole.readingBody`).
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
export type LineHeightRatio = typeof lineHeightRatio;
export type FontSize = typeof fontSize;
export type Elevation = typeof elevation;

/** Ramp step name (`displayMd` … `caption`). */
export type FontSizeName = keyof FontSize;
