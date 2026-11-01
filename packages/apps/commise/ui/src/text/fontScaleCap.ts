/**
 * @module @commise/ui/font-scale-cap — the most native text grows with the system's text-size setting: 2×, WCAG 1.4.4's
 * 200 % (owner ruling, ADR-0080 §8). As React Native's `maxFontSizeMultiplier` it caps a text's size; on Android it does
 * NOT cap a set line height (`TextAttributeProps.kt:42`), which is why the design-system Text draws both itself
 * (`text/scaledType.ts`). Free of Tamagui, so code that measures text, or a React Native text that cannot be the
 * design system's (a brand-coloured label), can read it without bringing Tamagui into the web graph.
 */

/** The cap, as React Native's `maxFontSizeMultiplier`. */
export const FONT_SCALE_CAP = 2;

/**
 * The scale capped text is drawn at: the system scale, up to the cap. A box sized around capped text reads it, so the box
 * stops growing where its text does. Pure.
 *
 * @param fontScale - The system font scale (`useWindowDimensions().fontScale`).
 * @returns The scale, at most {@link FONT_SCALE_CAP}.
 */
export function cappedFontScale(fontScale: number): number {
    return Math.min(fontScale, FONT_SCALE_CAP);
}
