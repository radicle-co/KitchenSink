import { pxToRemUnit } from './emit.js';
import { fontFamily, fontSize, fontWeight, lineHeightRatio } from './scale.js';

/** Web font families — the shared stacks from the single source. */
export const fonts = fontFamily;

/**
 * Web font sizes — `rem` derived from the single numeric source (`scale.fontSize`, px ÷16). Keys stay in
 * the web's kebab-case (`display-xl` …) convention; the ramp order is largest → smallest.
 */
export const fontSizes = {
    'display-xl': pxToRemUnit(fontSize.displayXl),
    'display-lg': pxToRemUnit(fontSize.displayLg),
    'display-md': pxToRemUnit(fontSize.displayMd),
    'heading-lg': pxToRemUnit(fontSize.headingLg),
    'heading-md': pxToRemUnit(fontSize.headingMd),
    'heading-sm': pxToRemUnit(fontSize.headingSm),
    'body-lg': pxToRemUnit(fontSize.bodyLg),
    'body-md': pxToRemUnit(fontSize.bodyMd),
    'body-sm': pxToRemUnit(fontSize.bodySm),
    caption: pxToRemUnit(fontSize.caption),
    overline: pxToRemUnit(fontSize.overline),
} as const;

/** Web line-heights — the unitless ratios from the single source, as CSS `line-height` multipliers. */
export const lineHeights = {
    heading: `${lineHeightRatio.heading}`,
    body: `${lineHeightRatio.body}`,
    caption: `${lineHeightRatio.caption}`,
} as const;

/** Web font weights — the numeric weights from the single source, as CSS `font-weight` strings. */
export const fontWeights = {
    normal: `${fontWeight.normal}`,
    medium: `${fontWeight.medium}`,
    semibold: `${fontWeight.semibold}`,
    bold: `${fontWeight.bold}`,
} as const;

export type Fonts = typeof fonts;
export type FontSizes = typeof fontSizes;
export type LineHeights = typeof lineHeights;
export type FontWeights = typeof fontWeights;
