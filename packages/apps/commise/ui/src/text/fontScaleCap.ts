/**
 * @module text/fontScaleCap — the most native text grows with the system's text-size setting: 2×, WCAG 1.4.4's
 * 200 % (owner ruling, ADR-0080 §8). React Native scales a set line height by the same capped multiplier, so a px
 * leading keeps holding its text. Free of Tamagui, so code that measures text can read it without bringing Tamagui
 * into the web graph; it gains a package export with its first such consumer.
 */

/** The cap, as React Native's `maxFontSizeMultiplier`. */
export const FONT_SCALE_CAP = 2;
