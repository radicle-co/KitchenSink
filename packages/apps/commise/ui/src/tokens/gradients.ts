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

/** The name of a brand gradient (`brand` | `hero`). */
export type GradientName = keyof typeof gradient;

/**
 * A frosted-glass surface spec. `surface` is the translucent tint painted OVER the blur; `fallback` is the
 * more-opaque solid colour used where backdrop blur is unsupported or too expensive; `blur` is the blur
 * radius in px; `saturate` is the backdrop saturation multiplier (a subtle vibrancy boost); `border` is the
 * translucent-white hairline that gives the pane its lit edge (the mockup's `border-white/30`) — an opaque
 * border would read as a frame drawn AROUND the glass rather than the edge OF it.
 */
export interface GlassSpec {
    readonly surface: string;
    readonly fallback: string;
    readonly blur: number;
    readonly saturate: number;
    readonly border: string;
}

/**
 * The frosted-glass tiers. `card` is the standard stat/widget/detail glass card; `subtle` is a lighter
 * treatment for chrome (rails, banners). Each carries a solid `fallback` so the surface stays readable
 * when blur is unavailable.
 *
 * **The blur/saturate pairs are TRANSCRIBED from `docs/mockups/screens/*.html`, not chosen.** Across all
 * nine screens the frosted treatments come in exactly three pairs, and each blur radius binds to ONE
 * saturation with no exception anywhere in the corpus:
 *
 *  - `backdrop-blur-[12px] saturate-[130%]` → **`subtle`** — the chrome/control glass (it is also the
 *    surface the mockups' own secondary BUTTON is built on: `from-white/80 to-white/60
 *    backdrop-blur-[12px] saturate-[130%] border-2 border-coral text-coral`).
 *  - `backdrop-blur-[16px] saturate-[140%]` → **`card`** — the standard content card (30 occurrences).
 *  - `backdrop-blur-[24px] saturate-[160%]` — the fixed nav rail / sticky top bar. Deliberately NOT
 *    tokenised: no Commise surface paints it today, and a tier nobody consumes is speculative capability.
 *
 * Both tiers were previously off-mockup (`card` saturated at 1.6 — a value that pairs only with the 24px
 * nav blur, never with 16px; `subtle` at blur 10 / 1.4 — a 10px blur appears in NO mockup at all), so the
 * web `backdrop-filter` and the native `expo-blur` intensity were both single-sourced to a wrong number.
 */
export const glass = {
    card: {
        surface: 'rgba(255, 255, 255, 0.85)',
        fallback: 'rgba(255, 255, 255, 0.96)',
        blur: 16,
        saturate: 1.4,
        border: 'rgba(255, 255, 255, 0.3)',
    },
    subtle: {
        surface: 'rgba(255, 255, 255, 0.6)',
        fallback: 'rgba(255, 255, 255, 0.9)',
        blur: 12,
        saturate: 1.3,
        border: 'rgba(255, 255, 255, 0.3)',
    },
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
 * on it: the `GlassCard` primitive (whose own element IS the glass) and
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

/**
 * The hosts on which a backdrop blur is REAL, as opposed to silently degraded to a translucent-but-unblurred
 * panel. This is a capability fact about `expo-blur`, verified against the installed package (57.x) rather
 * than assumed:
 *
 *  - **ios** — a genuine `UIVisualEffectView`-backed blur.
 *  - **web** — `BlurView.web.tsx` maps to a real CSS `backdrop-filter`.
 *  - **android** — NOT supported by default. The package README states "This package only supports iOS. On
 *    Android, a plain `View` with a translucent background will be rendered", and `BlurView._getBlurMethod()`
 *    returns `'none'` unless the caller opts into `dimezisBlurView` / `dimezisBlurViewSdk31Plus` AND supplies
 *    a `blurTarget` ancestor (without which it warns and falls back to `'none'` anyway). No Commise surface
 *    configures that today, so Android must take the solid fallback.
 */
const BLUR_CAPABLE_HOSTS: readonly string[] = ['ios', 'web'];

/**
 * Whether `expo-blur` can actually BLUR a backdrop on the given host — the pure predicate behind the
 * per-platform `isBlurSupported` probes in `../surface/blurSupport{,.native}.ts`.
 *
 * The branch logic lives here, platform-neutrally, for two reasons: it is exhaustively testable for every
 * host (a probe that inlined `Platform.OS === 'ios'` could only ever be observed on the one host the test
 * runner happens to be), and it keeps ONE authoritative answer that both the `GlassCard` primitive and any
 * component painting its own glass converge on. Unknown hosts fail CLOSED — a surface that guessed "blur
 * works" would ship the washed-out unblurred panel the solid fallback exists to prevent. Pure.
 *
 * @param os - The host platform identifier (React Native's `Platform.OS`).
 * @returns `true` when the host renders a real backdrop blur.
 */
export function supportsNativeBlur(os: string): boolean {
    return BLUR_CAPABLE_HOSTS.includes(os);
}

/** The blur intensity (0..100) `expo-blur` accepts per blur px — clamped so heavy blur saturates at 100. */
const BLUR_PX_TO_INTENSITY = 4;

/** The `expo-blur` `BlurView` projection of a {@link GlassSpec} — intensity, tint, and the solid fallback. */
export interface NativeGlass {
    readonly intensity: number;
    readonly tint: 'light' | 'default' | 'dark';
    readonly surface: string;
    readonly fallback: string;
    readonly border: string;
}

/**
 * Project a neutral {@link GlassSpec} to the props `expo-blur`'s `BlurView` consumes (native leg): the blur
 * px maps to a clamped 0..100 `intensity`, the white frosted surface uses the `light` tint, and the solid
 * `fallback`/translucent `surface`/`border` colours are carried through for the no-blur path. Pure.
 *
 * `saturate` has no `expo-blur` analogue (the native blur carries its own vibrancy), so it is intentionally
 * dropped rather than approximated — mirroring how {@link toNativeGradient} drops CSS `spread`.
 */
export function toNativeGlass(spec: GlassSpec): NativeGlass {
    return {
        intensity: Math.min(100, spec.blur * BLUR_PX_TO_INTENSITY),
        tint: 'light',
        surface: spec.surface,
        fallback: spec.fallback,
        border: spec.border,
    };
}
