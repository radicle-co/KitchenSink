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
import { fontSize, fontWeight, lineHeightPx, radius, spacing } from '@commise/ui/scale';

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
 * Body (Inter) `createFont` size ramp, positions `1…9`. Ascends the shared type ramp: the three body steps, the
 * heading steps, then the display step. The ramp stops at 28 (owner ruling 2026-10-25), so `$5`/`$6` repeat 18 and
 * `$7`-`$9` are all 28 — a Tamagui position needs a value, and no value above 28 exists.
 */
export const bodyFontSize = {
    1: fontSize.bodySm,
    2: fontSize.bodyMd,
    3: fontSize.bodyLg,
    4: fontSize.headingSm,
    5: fontSize.headingMd,
    6: fontSize.headingLg,
    7: fontSize.displayMd,
    8: fontSize.displayMd,
    9: fontSize.displayMd,
} as const;

/** Body `createFont` leading ramp — the shared px leading for each step's size, on the 4 px grid. */
export const bodyLineHeight = {
    1: lineHeightPx[bodyFontSize[1]],
    2: lineHeightPx[bodyFontSize[2]],
    3: lineHeightPx[bodyFontSize[3]],
    4: lineHeightPx[bodyFontSize[4]],
    5: lineHeightPx[bodyFontSize[5]],
    6: lineHeightPx[bodyFontSize[6]],
    7: lineHeightPx[bodyFontSize[7]],
    8: lineHeightPx[bodyFontSize[8]],
    9: lineHeightPx[bodyFontSize[9]],
} as const;

/**
 * Display (Playfair) `createFont` size ramp, positions `1…9`. Steps `1-3` are the display scale (16 → 18); `4-9`
 * are the 28 px large title, the most Playfair sets.
 */
export const displayFontSize = {
    1: fontSize.bodyMd,
    2: fontSize.headingMd,
    3: fontSize.headingLg,
    4: fontSize.displayMd,
    5: fontSize.displayMd,
    6: fontSize.displayMd,
    7: fontSize.displayMd,
    8: fontSize.displayMd,
    9: fontSize.displayMd,
} as const;

/** Display `createFont` leading ramp — the shared px leading for each step's size. */
export const displayLineHeight = {
    1: lineHeightPx[displayFontSize[1]],
    2: lineHeightPx[displayFontSize[2]],
    3: lineHeightPx[displayFontSize[3]],
    4: lineHeightPx[displayFontSize[4]],
    5: lineHeightPx[displayFontSize[5]],
    6: lineHeightPx[displayFontSize[6]],
    7: lineHeightPx[displayFontSize[7]],
    8: lineHeightPx[displayFontSize[8]],
    9: lineHeightPx[displayFontSize[9]],
} as const;

/** Shared `createFont` weight ramp (`1…4`) — the scale's numeric weights as Tamagui weight strings. */
export const fontWeightRamp = {
    1: `${fontWeight.normal}`,
    2: `${fontWeight.medium}`,
    3: `${fontWeight.semibold}`,
    4: `${fontWeight.bold}`,
} as const;
