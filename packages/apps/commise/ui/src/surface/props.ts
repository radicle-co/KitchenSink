/**
 * @module @commise/ui/surface — shared, platform-neutral prop contracts for the brand surface primitives
 * {@link import('./GradientSurface.js').GradientSurface} and {@link import('./GlassCard.js').GlassCard}
 * (the "surface-treatment adapter" pattern). The web (`*.tsx`, CSS `linear-gradient` / `backdrop-filter`)
 * and native (`*.native.tsx`, `expo-linear-gradient` / `expo-blur`) leaves both implement these exact
 * surfaces, so the two platform renders can never drift on the brand treatment.
 *
 * The layout passthrough is intentionally split by platform (each leaf consumes only its own): `className`
 * is the web hook (a plain string — no react-native type leaks into the shared contract), `style` is the
 * native hook. This mirrors the {@link import('../pressScale/props.js').PressScaleProps} idiom where a leaf
 * honours the props its platform can, and ignores the rest.
 */
import type { ReactNode } from 'react';

import type { GlassName, GradientName } from '../tokens/gradients.js';

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

/** The contract for the frosted-glass card primitive. */
export interface GlassCardProps {
    /** Which glass tier to render. Defaults to `card` (the standard frosted card). */
    readonly tier?: GlassName;
    /**
     * Whether the host supports backdrop blur. Defaults to the platform capability probe
     * (`isBlurSupported()` — a static `Platform.OS` / baseline-CSS read, not a runtime measurement), so the
     * honest treatment is the DEFAULT rather than something each caller must remember to detect. When
     * `false`, the card renders the tier's more-opaque solid `fallback` instead of the
     * translucent-surface-over-blur treatment, so content stays readable where blur is unavailable
     * (notably Android, where `expo-blur` renders a translucent UNBLURRED view) or too expensive. Pass it
     * explicitly only to override that default.
     */
    readonly blurSupported?: boolean;
    /** The card content. */
    readonly children?: ReactNode;
    /** Web-only layout/positioning classes for the card element. Ignored on native. */
    readonly className?: string;
    /** Native-only style for the card element. Ignored on web. */
    readonly style?: SurfaceStyle;
    /** Optional accessible label for the card region. */
    readonly accessibilityLabel?: string;
}
