import { pxToRem } from './emit.js';
import { fontFamily, fontSize, fontWeight, lineHeightRatio } from './scale.js';

/** Web font families — the shared stacks from the single source. */
export const fonts = fontFamily;

/**
 * Web font sizes — `rem` derived from the single numeric source (`scale.fontSize`, px ÷16). Keys stay in
 * the web's kebab-case (`display-xl` …) convention; the ramp order is largest → smallest.
 */
export const fontSizes = {
    'display-xl': pxToRem(fontSize.displayXl),
    'display-lg': pxToRem(fontSize.displayLg),
    'display-md': pxToRem(fontSize.displayMd),
    'heading-lg': pxToRem(fontSize.headingLg),
    'heading-md': pxToRem(fontSize.headingMd),
    'heading-sm': pxToRem(fontSize.headingSm),
    'body-lg': pxToRem(fontSize.bodyLg),
    'body-md': pxToRem(fontSize.bodyMd),
    'body-sm': pxToRem(fontSize.bodySm),
    caption: pxToRem(fontSize.caption),
    overline: pxToRem(fontSize.overline),
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
