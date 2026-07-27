/**
 * @module tokens/gradients — the brand gradient + frosted-glass surface language, single-sourced.
 *
 * U8's visual uplift (gradient hero surfaces, frosted-glass cards, the gradient CTA) needs ONE definition
 * of each gradient/glass treatment that both platforms derive from — otherwise the web `linear-gradient`
 * and the native `expo-linear-gradient` inevitably drift on colour or direction. This module holds the
 * resolution-neutral specs (an angle + colour stops; a translucent surface + blur + a solid fallback) and
 * the PURE composition/projection helpers: web composes CSS strings, native projects the props
 * `expo-linear-gradient` / `expo-blur` consume. It imports only the palette (no platform API), so it is
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
} as const satisfies Record<string, GradientSpec>;

/** The name of a brand gradient (`brand` | `hero`). */
export type GradientName = keyof typeof gradient;

/**
 * A frosted-glass surface spec. `surface` is the translucent tint painted OVER the blur; `fallback` is the
 * more-opaque solid colour used where backdrop blur is unsupported or too expensive; `blur` is the blur
 * radius in px; `saturate` is the backdrop saturation multiplier (a subtle vibrancy boost).
 */
export interface GlassSpec {
    readonly surface: string;
    readonly fallback: string;
    readonly blur: number;
    readonly saturate: number;
}

/**
 * The frosted-glass tiers. `card` is the standard stat/widget/detail glass card; `subtle` is a lighter
 * treatment for chrome (rails, banners). Each carries a solid `fallback` so the surface stays readable
 * when blur is unavailable.
 */
export const glass = {
    card: { surface: 'rgba(255, 255, 255, 0.85)', fallback: 'rgba(255, 255, 255, 0.96)', blur: 16, saturate: 1.6 },
    subtle: { surface: 'rgba(255, 255, 255, 0.6)', fallback: 'rgba(255, 255, 255, 0.9)', blur: 10, saturate: 1.4 },
} as const satisfies Record<string, GlassSpec>;

/** The name of a frosted-glass tier (`card` | `subtle`). */
export type GlassName = keyof typeof glass;

/** Compose a CSS `linear-gradient(...)` from a neutral gradient spec (web leg). Pure. */
export function gradientCss(spec: GradientSpec): string {
    const stops = spec.stops.map((s) => `${s.color} ${s.position}%`).join(', ');

    return `linear-gradient(${spec.angle}deg, ${stops})`;
}

/** Compose the CSS `backdrop-filter` value for a glass spec (web leg). Pure. */
export function glassBackdropCss(spec: GlassSpec): string {
    return `blur(${spec.blur}px) saturate(${spec.saturate})`;
}

/**
 * The CSS declarations that paint a frosted-glass surface on the web — structurally assignable to React's
 * `CSSProperties` without this token module having to import a React type. The blur properties are ABSENT
 * (not empty strings) on the no-blur path, so an unsupported host carries no `backdrop-filter` declaration
 * at all.
 */
export interface WebGlass {
    readonly backgroundColor: string;
    readonly backdropFilter?: string;
    readonly WebkitBackdropFilter?: string;
}

/**
 * Project a neutral {@link GlassSpec} to the CSS declarations the web paints (web leg) — the mirror of
 * {@link toNativeGlass}. This is the ONE place a glass tier becomes a web surface, so every consumer converges
 * on it: the {@link import('../surface/GlassCard.js').GlassCard} primitive (whose own element IS the glass) and
 * any component whose shell must stay a specific element — an `<article>`, a `<button>` — and therefore cannot
 * be wrapped in the primitive without changing its DOM semantics.
 *
 * When `blurSupported` is false the more-opaque solid `fallback` is used and no blur is emitted, so content
 * stays readable where `backdrop-filter` is unavailable or too expensive. Pure.
 *
 * @param spec - The glass tier spec to paint.
 * @param blurSupported - Whether the host supports `backdrop-filter`.
 * @returns The CSS declarations for the surface.
 */
export function toWebGlass(spec: GlassSpec, blurSupported: boolean): WebGlass {
    if (!blurSupported) {
        return { backgroundColor: spec.fallback };
    }

    const backdrop = glassBackdropCss(spec);

    return { backgroundColor: spec.surface, backdropFilter: backdrop, WebkitBackdropFilter: backdrop };
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

/** The blur intensity (0..100) `expo-blur` accepts per blur px — clamped so heavy blur saturates at 100. */
const BLUR_PX_TO_INTENSITY = 4;

/** The `expo-blur` `BlurView` projection of a {@link GlassSpec} — intensity, tint, and the solid fallback. */
export interface NativeGlass {
    readonly intensity: number;
    readonly tint: 'light' | 'default' | 'dark';
    readonly surface: string;
    readonly fallback: string;
}

/**
 * Project a neutral {@link GlassSpec} to the props `expo-blur`'s `BlurView` consumes (native leg): the blur
 * px maps to a clamped 0..100 `intensity`, the white frosted surface uses the `light` tint, and the solid
 * `fallback`/translucent `surface` colours are carried through for the no-blur path. Pure.
 */
export function toNativeGlass(spec: GlassSpec): NativeGlass {
    return {
        intensity: Math.min(100, spec.blur * BLUR_PX_TO_INTENSITY),
        tint: 'light',
        surface: spec.surface,
        fallback: spec.fallback,
    };
}
