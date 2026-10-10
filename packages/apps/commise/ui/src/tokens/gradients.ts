/**
 * @module tokens/gradients — the brand gradient language, single-sourced.
 *
 * Gradient surfaces need ONE definition of each treatment that both platforms derive from — otherwise the web
 * `linear-gradient` and the native `expo-linear-gradient` inevitably drift on colour or direction. This module holds
 * the resolution-neutral specs (an angle + colour stops) and the PURE composition/projection helpers: web composes CSS
 * strings, native projects the props `expo-linear-gradient` consumes. There is no glass here: owner D12 keeps glass
 * off cards, and the navigation layer's glass is `barMaterial.ts` and `expo-glass-effect`. It imports only the palette (no platform API), so it is
 * safe under web, React Native, and Node/Vitest alike.
 *
 * The `brand` gradient is deliberately the SAME seafoam → ocean-dark ramp the web design-system `Button`
 * already carries as `from-seafoam to-ocean-dark` (round-2 R7): the native `Button` and the shared surface
 * primitives derive from here so the two platforms' CTA gradient converge on one source instead of two.
 */
import { palette } from './colors.js';

/** One colour stop on a gradient — a CSS colour and its position as a percentage (0..100). */
export interface GradientStop {
    readonly color: string;
    readonly position: number;
}

/** A resolution-neutral linear gradient: a CSS angle (deg, clockwise from "to top") and ≥2 colour stops. */
export interface GradientSpec {
    readonly angle: number;
    readonly stops: readonly [GradientStop, GradientStop, ...GradientStop[]];
}

/**
 * The brand gradients. `brand` is the seafoam → ocean-dark CTA ramp (identical to the web Button's
 * `from-seafoam to-ocean-dark`); `hero` is the mockup's "beach-glow" background (sand → cool tints) that
 * paints the home/recipes/auth hero surfaces.
 */
export const gradient = {
    brand: {
        angle: 135,
        stops: [
            { color: palette.seafoam, position: 0 },
            { color: palette['ocean-dark'], position: 100 },
        ],
    },
    // The two intermediate/terminal tints are mockup-specific cool washes (not palette colours) — the
    // beach-glow ramp is a bespoke background, so the literals live here with the spec they belong to.
    hero: {
        angle: 135,
        stops: [
            { color: palette.sand, position: 0 },
            { color: '#F0F7F4', position: 50 },
            { color: '#E8F4F8', position: 100 },
        ],
    },
    /**
     * The bottom-up cover SCRIM the recipe-detail hero lays over its photo — the mockup's
     * `bg-gradient-to-t from-charcoal/60 to-transparent`. Angle `0` is CSS "to top", so the opaque end sits
     * at the BOTTOM of the box and fades upward.
     *
     * The terminal stop is charcoal at ZERO alpha, deliberately NOT the keyword `transparent`: `transparent`
     * is transparent BLACK, and both CSS and `expo-linear-gradient` interpolate through premultiplied RGB, so
     * a charcoal→transparent ramp passes through a muddy grey haze. Holding the RGB constant and moving only
     * alpha is what makes the fade clean — and it must stay identical on both platforms, hence a token.
     */
    scrim: {
        angle: 0,
        stops: [
            { color: 'rgba(45, 52, 54, 0.6)', position: 0 },
            { color: 'rgba(45, 52, 54, 0)', position: 100 },
        ],
    },
} as const satisfies Record<string, GradientSpec>;

/**
 * The canvas wash in the dark theme (`darkTheme.md` §3.3): the same warm → green → blue path as `gradient.hero`, at
 * the dark canvas's lightness. Web overrides `--background-image-hero` with it; native paints it under `useTheme()`.
 */
export const heroDark = {
    angle: 135,
    stops: [
        { color: '#141210', position: 0 },
        { color: '#101714', position: 50 },
        { color: '#0F181A', position: 100 },
    ],
} as const satisfies GradientSpec;

/** The name of a brand gradient (`brand` | `hero`). */
export type GradientName = keyof typeof gradient;

/** Compose a CSS `linear-gradient(...)` from a neutral gradient spec (web leg). Pure. */
export function gradientCss(spec: GradientSpec): string {
    const stops = spec.stops.map((s) => `${s.color} ${s.position}%`).join(', ');

    return `linear-gradient(${spec.angle}deg, ${stops})`;
}

/** The `expo-linear-gradient` projection of a {@link GradientSpec} — colours, 0..1 locations, and a vector. */
export interface NativeGradient {
    readonly colors: readonly [string, string, ...string[]];
    readonly locations: readonly [number, number, ...number[]];
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
}

/**
 * Convert a CSS gradient angle (deg, clockwise from "to top") to `expo-linear-gradient` start/end points in
 * the unit square (y grows downward). The direction is centred on the box, so a 135° angle runs from the
 * top-left toward the bottom-right — the same visual diagonal the web `linear-gradient(135deg, …)` draws.
 */
function angleToVector(angle: number): { start: { x: number; y: number }; end: { x: number; y: number } } {
    const radians = (angle * Math.PI) / 180;
    // CSS 0° points "to top"; x = sin, y = -cos gives the direction in screen space (y-down).
    const dx = Math.sin(radians);
    const dy = -Math.cos(radians);

    return {
        start: { x: 0.5 - dx / 2, y: 0.5 - dy / 2 },
        end: { x: 0.5 + dx / 2, y: 0.5 + dy / 2 },
    };
}

/**
 * Project a neutral {@link GradientSpec} to the props `expo-linear-gradient` consumes (native leg). Colours
 * are carried verbatim (so they cannot drift from the web CSS), positions become 0..1 `locations`, and the
 * angle becomes a start→end vector. Pure.
 */
export function toNativeGradient(spec: GradientSpec): NativeGradient {
    const colors = spec.stops.map((s) => s.color) as unknown as NativeGradient['colors'];
    const locations = spec.stops.map((s) => s.position / 100) as unknown as NativeGradient['locations'];

    return { colors, locations, ...angleToVector(spec.angle) };
}
