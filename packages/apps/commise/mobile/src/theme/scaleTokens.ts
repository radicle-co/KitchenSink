/**
 * @module theme/scaleTokens — the mobile Tamagui token/font ramps, DERIVED from the single numeric
 * source (`@commise/ui/scale`). Tamagui's `createTokens`/`createFont` want positional numeric keys
 * (space/size `0…9` + `true`, radius `0…5`, fonts `1…9`), which the shared scale does not itself encode;
 * this module is the ONE place that positional mapping lives, so the mobile config cannot drift from web.
 *
 * Pure data (no `tamagui` import) so it is safe to unit-test under Node — the drift guard lives in
 * `tests/theme/scaleTokens.test.ts`. `tamagui.config.ts` spreads these maps straight into its token/font
 * definitions.
 */
import { fontSize, fontWeight, lineHeightRatio, radius, spacing } from '@commise/ui/scale';

/** Round to one decimal — `size × ratio` is not exact in IEEE-754 (e.g. 18×1.2), the ramp values are. */
function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

/** Absolute px leading = the font size scaled by an unitless line-height ratio, rounded to the ramp grid. */
function leading(size: number, ratio: number): number {
    return round1(size * ratio);
}

/**
 * Tamagui `space` scale. Steps `0…9` are the shared spacing ramp; `true` is Tamagui's default step (used
 * by `$true` and unsuffixed sizing) and equals the base scale value (step 4 = 16).
 */
export const spaceScale = {
    0: spacing[0],
    1: spacing[1],
    2: spacing[2],
    3: spacing[3],
    4: spacing[4],
    5: spacing[5],
    6: spacing[6],
    7: spacing[7],
    8: spacing[8],
    9: spacing[9],
    true: spacing[4],
} as const;

/** Tamagui `size` scale — identical to `space` (shared ramp). */
export const sizeScale = {
    0: spacing[0],
    1: spacing[1],
    2: spacing[2],
    3: spacing[3],
    4: spacing[4],
    5: spacing[5],
    6: spacing[6],
    7: spacing[7],
    8: spacing[8],
    9: spacing[9],
    true: spacing[4],
} as const;

/** Tamagui `radius` scale — explicit name→numeric-key map (`sm→1 … full→5`) with the synthesized `0`. */
export const radiusScale = {
    0: 0,
    1: radius.sm,
    2: radius.md,
    3: radius.lg,
    4: radius.xl,
    5: radius.full,
} as const;

/**
 * Body (Inter) `createFont` size ramp, positions `1…9`. Ascends the shared type ramp: the three body
 * steps, the three heading steps, then the three display steps.
 */
export const bodyFontSize = {
    1: fontSize.bodySm,
    2: fontSize.bodyMd,
    3: fontSize.bodyLg,
    4: fontSize.headingSm,
    5: fontSize.headingMd,
    6: fontSize.headingLg,
    7: fontSize.displayMd,
    8: fontSize.displayLg,
    9: fontSize.displayXl,
} as const;

/** Body `createFont` leading ramp — body ratio for the body steps (1-3), heading ratio above (4-9). */
export const bodyLineHeight = {
    1: leading(fontSize.bodySm, lineHeightRatio.body),
    2: leading(fontSize.bodyMd, lineHeightRatio.body),
    3: leading(fontSize.bodyLg, lineHeightRatio.body),
    4: leading(fontSize.headingSm, lineHeightRatio.heading),
    5: leading(fontSize.headingMd, lineHeightRatio.heading),
    6: leading(fontSize.headingLg, lineHeightRatio.heading),
    7: leading(fontSize.displayMd, lineHeightRatio.heading),
    8: leading(fontSize.displayLg, lineHeightRatio.heading),
    9: leading(fontSize.displayXl, lineHeightRatio.heading),
} as const;

/**
 * Display (Playfair) `createFont` size ramp, positions `1…9`. Steps `1-6` are the display scale
 * (16 → 48); `7-9` repeat the top three so `$7/$8/$9` alias the largest headings.
 */
export const displayFontSize = {
    1: fontSize.bodyMd,
    2: fontSize.headingMd,
    3: fontSize.headingLg,
    4: fontSize.displayMd,
    5: fontSize.displayLg,
    6: fontSize.displayXl,
    7: fontSize.displayMd,
    8: fontSize.displayLg,
    9: fontSize.displayXl,
} as const;

/** Display `createFont` leading ramp — heading ratio throughout (Playfair headings are tightly set). */
export const displayLineHeight = {
    1: leading(fontSize.bodyMd, lineHeightRatio.heading),
    2: leading(fontSize.headingMd, lineHeightRatio.heading),
    3: leading(fontSize.headingLg, lineHeightRatio.heading),
    4: leading(fontSize.displayMd, lineHeightRatio.heading),
    5: leading(fontSize.displayLg, lineHeightRatio.heading),
    6: leading(fontSize.displayXl, lineHeightRatio.heading),
    7: leading(fontSize.displayMd, lineHeightRatio.heading),
    8: leading(fontSize.displayLg, lineHeightRatio.heading),
    9: leading(fontSize.displayXl, lineHeightRatio.heading),
} as const;

/** Shared `createFont` weight ramp (`1…4`) — the scale's numeric weights as Tamagui weight strings. */
export const fontWeightRamp = {
    1: `${fontWeight.normal}`,
    2: `${fontWeight.medium}`,
    3: `${fontWeight.semibold}`,
    4: `${fontWeight.bold}`,
} as const;
