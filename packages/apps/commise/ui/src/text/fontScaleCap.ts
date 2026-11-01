/**
 * @module @commise/ui/font-scale-cap — the most native text grows with the system's text-size setting: 2×, WCAG 1.4.4's
 * 200 % (owner ruling, ADR-0080 §8). React Native scales a set line height by the same capped multiplier, so a px
 * leading keeps holding its text. Pure and free of Tamagui, so a module that only measures (a card row's height) reads
 * the cap without bringing Tamagui into the web graph.
 */

/** The cap, as React Native's `maxFontSizeMultiplier`. */
export const FONT_SCALE_CAP = 2;

/**
 * The scale capped text is drawn at. Pure.
 *
 * @param fontScale - The system font scale (`useWindowDimensions().fontScale`).
 * @returns The scale, at most {@link FONT_SCALE_CAP}.
 */
export function cappedFontScale(fontScale: number): number {
    return Math.min(fontScale, FONT_SCALE_CAP);
}
