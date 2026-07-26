import { pxToRem } from './emit.js';
import { spacing } from './scale.js';

/**
 * Web spacing scale — `rem` strings derived from the single numeric source (`scale.spacing`, px ÷16),
 * with the unitless `0`. `space` and `size` share the same ramp (Tamagui parity on the mobile side).
 */
export const space = {
    0: pxToRem(spacing[0]),
    1: pxToRem(spacing[1]),
    2: pxToRem(spacing[2]),
    3: pxToRem(spacing[3]),
    4: pxToRem(spacing[4]),
    5: pxToRem(spacing[5]),
    6: pxToRem(spacing[6]),
    7: pxToRem(spacing[7]),
    8: pxToRem(spacing[8]),
    9: pxToRem(spacing[9]),
} as const;

export const size = {
    0: pxToRem(spacing[0]),
    1: pxToRem(spacing[1]),
    2: pxToRem(spacing[2]),
    3: pxToRem(spacing[3]),
    4: pxToRem(spacing[4]),
    5: pxToRem(spacing[5]),
    6: pxToRem(spacing[6]),
    7: pxToRem(spacing[7]),
    8: pxToRem(spacing[8]),
    9: pxToRem(spacing[9]),
} as const;

export type Space = typeof space;
export type Size = typeof size;
