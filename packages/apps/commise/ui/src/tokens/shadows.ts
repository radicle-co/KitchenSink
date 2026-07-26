import { elevation } from './scale.js';

/** CSS length: `0` stays unitless, everything else is `px` (matches the historical box-shadow output). */
function len(n: number): string {
    return n === 0 ? '0' : `${n}px`;
}

/** Compose a CSS `box-shadow` from a `scale.elevation` spec. `spread` is omitted when it is 0. */
function boxShadow(spec: (typeof elevation)[keyof typeof elevation]): string {
    const spread = spec.spread === 0 ? '' : ` ${len(spec.spread)}`;

    return `${len(spec.offsetX)} ${len(spec.offsetY)} ${len(spec.blur)}${spread} rgba(${spec.color},${spec.opacity})`;
}

/**
 * Web elevation — CSS `box-shadow` strings composed from the single numeric source (`scale.elevation`).
 * `glow` is an ambient seafoam halo; the rest are stacked drop shadows.
 */
export const shadows = {
    sm: boxShadow(elevation.sm),
    md: boxShadow(elevation.md),
    lg: boxShadow(elevation.lg),
    xl: boxShadow(elevation.xl),
    glow: boxShadow(elevation.glow),
} as const;

export type Shadows = typeof shadows;
