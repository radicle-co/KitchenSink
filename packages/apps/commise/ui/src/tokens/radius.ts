import { pxToRem } from './emit.js';
import { radius as scaleRadius } from './scale.js';

/**
 * Web corner radii — `rem` derived from the single numeric source (`scale.radius`, px ÷16). The `full`
 * pill sentinel is emitted as `px` (a `rem` pill would scale with the root font, which we don't want).
 */
export const radius = {
    sm: pxToRem(scaleRadius.sm),
    md: pxToRem(scaleRadius.md),
    lg: pxToRem(scaleRadius.lg),
    xl: pxToRem(scaleRadius.xl),
    full: `${scaleRadius.full}px`,
} as const;

export type Radius = typeof radius;
