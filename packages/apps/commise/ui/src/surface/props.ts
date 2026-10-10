/**
 * @module @commise/ui/surface — the shared, platform-neutral prop contract for the brand surface primitive
 * `GradientSurface` (the "surface-treatment adapter" pattern). The web (`*.tsx`, CSS `linear-gradient`) and native
 * (`*.native.tsx`, `expo-linear-gradient`) leaves both implement it, so the two platform renders can never drift on
 * the brand treatment.
 *
 * The layout passthrough is intentionally split by platform (each leaf consumes only its own): `className`
 * is the web hook (a plain string — no react-native type leaks into the shared contract), `style` is the
 * native hook. This mirrors the `PressScaleProps` idiom where a leaf
 * honours the props its platform can, and ignores the rest.
 */
import type { ReactNode } from 'react';

import type { GradientName } from '../tokens/gradients.js';

/**
 * A native style passthrough kept free of a `react-native` type import so the shared contract stays
 * platform-neutral (a plain object, or an array of them — the native leaf narrows it to `StyleProp`).
 */
export type SurfaceStyle = object | readonly object[];

/** The contract for the gradient background surface primitive. */
export interface GradientSurfaceProps {
    /** Which brand gradient to paint. Defaults to `hero` (the beach-glow background). */
    readonly gradient?: GradientName;
    /** The surface content, painted over the gradient. */
    readonly children?: ReactNode;
    /** Web-only layout/positioning classes for the surface element. Ignored on native. */
    readonly className?: string;
    /** Native-only style for the surface element. Ignored on web. */
    readonly style?: SurfaceStyle;
    /** Optional accessible label for the surface region (e.g. a hero banner). */
    readonly accessibilityLabel?: string;
}
