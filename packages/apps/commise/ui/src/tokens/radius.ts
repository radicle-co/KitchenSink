import { pxToRemUnit } from './emit.js';
import { radius as scaleRadius } from './scale.js';

/**
 * Web corner radii — `rem` derived from the single numeric source (`scale.radius`, px ÷16). The `full`
 * pill sentinel is emitted as `px` (a `rem` pill would scale with the root font, which we don't want).
 */
export const radius = {
    sm: pxToRemUnit(scaleRadius.sm),
    md: pxToRemUnit(scaleRadius.md),
    lg: pxToRemUnit(scaleRadius.lg),
    xl: pxToRemUnit(scaleRadius.xl),
    full: `${scaleRadius.full}px`,
} as const;

export type Radius = typeof radius;
