/**
 * Invariants for the brand gradient + frosted-glass surface language (`gradients.ts`). These lock the
 * single-source specs the two platforms derive from (web composes CSS strings; native projects
 * expo-linear-gradient / expo-blur props), and prove the pure composition/projection helpers, so the web
 * and native brand surfaces can never drift on colour, direction, or blur.
 */
import { describe, expect, it } from 'vitest';

import { palette } from '../colors.js';
import {
    glass,
    glassBackdropCss,
    gradient,
    gradientCss,
    supportsNativeBlur,
    toNativeGlass,
    toNativeGradient,
    toWebGlass,
} from '../gradients.js';

describe('gradient specs', () => {
    it('threads the SAME brand CTA gradient the web Button carries (seafoam → ocean-dark, 135°)', () => {
        expect(gradient.brand).toEqual({
            angle: 135,
            stops: [
                { color: palette.seafoam, position: 0 },
                { color: palette['ocean-dark'], position: 100 },
            ],
        });
    });

    it('carries the beach-glow hero gradient (sand → tints, 135°) from the mockup', () => {
        expect(gradient.hero).toEqual({
            angle: 135,
            stops: [
                { color: palette.sand, position: 0 },
                { color: '#F0F7F4', position: 50 },
                { color: '#E8F4F8', position: 100 },
            ],
        });
    });

    it('carries the bottom-up cover scrim (charcoal 60% → charcoal 0%, "to top")', () => {
        expect(gradient.scrim).toEqual({
            angle: 0,
            stops: [
                { color: 'rgba(45, 52, 54, 0.6)', position: 0 },
                { color: 'rgba(45, 52, 54, 0)', position: 100 },
            ],
        });
    });

    it('fades the scrim through a CONSTANT rgb, never the keyword transparent (which is transparent BLACK)', () => {
        const rgb = (rgba: string): string => rgba.slice(0, rgba.lastIndexOf(','));

        // Both CSS and expo-linear-gradient interpolate premultiplied RGB, so charcoal→`transparent` would
        // pass through a muddy grey. Holding the rgb fixed and moving only alpha is what keeps the fade clean.
        expect(rgb(gradient.scrim.stops[1].color)).toBe(rgb(gradient.scrim.stops[0].color));
        for (const stop of gradient.scrim.stops) {
            expect(stop.color).not.toBe('transparent');
        }
    });

    it('every stop position is a percentage in 0..100, monotonically non-decreasing', () => {
        for (const spec of Object.values(gradient)) {
            const positions = spec.stops.map((s) => s.position);
            expect(positions[0]).toBe(0);
            expect(positions[positions.length - 1]).toBe(100);
            for (let i = 1; i < positions.length; i += 1) {
                expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]!);
            }
        }
    });
});

describe('gradientCss (web composition)', () => {
    it('composes a CSS linear-gradient with the angle and percentage stops', () => {
        expect(gradientCss(gradient.brand)).toBe(
            `linear-gradient(135deg, ${palette.seafoam} 0%, ${palette['ocean-dark']} 100%)`,
        );
    });

    it('emits every stop for a 3-stop gradient', () => {
        expect(gradientCss(gradient.hero)).toBe(
            `linear-gradient(135deg, ${palette.sand} 0%, #F0F7F4 50%, #E8F4F8 100%)`,
        );
    });
});

describe('toNativeGradient (expo-linear-gradient projection)', () => {
    it('projects the stop colours in order', () => {
        expect(toNativeGradient(gradient.brand).colors).toEqual([palette.seafoam, palette['ocean-dark']]);
    });

    it('projects stop positions to 0..1 locations', () => {
        expect(toNativeGradient(gradient.hero).locations).toEqual([0, 0.5, 1]);
    });

    it('maps the 135° angle to a top-left → bottom-right diagonal', () => {
        const { start, end } = toNativeGradient(gradient.brand);
        // A 135° CSS gradient runs toward the bottom-right, so the end point is down-and-right of start.
        expect(end.x).toBeGreaterThan(start.x);
        expect(end.y).toBeGreaterThan(start.y);
    });

    it('keeps native colours byte-identical to the web CSS stops (no drift)', () => {
        for (const spec of Object.values(gradient)) {
            expect(toNativeGradient(spec).colors).toEqual(spec.stops.map((s) => s.color));
        }
    });
});

/**
 * The blur/saturation pairs the MOCKUPS actually specify, read out of `docs/mockups/screens/*.html`.
 *
 * These are not taste — they are a transcription, and they are the reason the tier values below are what
 * they are. Across all nine screens the frosted treatments come in exactly three pairs, and each blur
 * radius binds to ONE saturation with no exception anywhere in the corpus:
 *
 *  - `backdrop-blur-[12px] saturate-[130%]` — the chrome/control glass (this is the surface the mockups'
 *    own secondary BUTTON is built on: `bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-[12px]
 *    saturate-[130%] border-2 border-coral text-coral`, screen-profile "Change Password" / "Change Plan").
 *  - `backdrop-blur-[16px] saturate-[140%]` — the standard content card (screen-profile's "Personal
 *    Information" / "Login & Security" / "Danger Zone" panels, screen-recipes' cards, and 27 more).
 *  - `backdrop-blur-[24px] saturate-[160%]` — the fixed nav rail / sticky top bar chrome.
 *
 * `saturate-[160%]` NEVER appears with a 16px blur, and a 10px blur appears NOWHERE in any mockup — which
 * is what makes the previous `card.saturate: 1.6` and `subtle: { blur: 10, saturate: 1.4 }` wrong rather
 * than merely different. The 24px/160% pair is deliberately NOT tokenised here: no Commise surface paints
 * it today, and a tier nobody consumes is exactly the speculative capability YAGNI forbids.
 */
const MOCKUP_GLASS = {
    control: { blur: 12, saturate: 1.3 },
    card: { blur: 16, saturate: 1.4 },
} as const;

describe('glass specs', () => {
    it('defines a frosted card surface with a translucent tint, a solid fallback, blur, saturation and edge', () => {
        expect(glass.card).toEqual({
            surface: 'rgba(255, 255, 255, 0.85)',
            fallback: 'rgba(255, 255, 255, 0.96)',
            blur: 16,
            saturate: 1.4,
            border: 'rgba(255, 255, 255, 0.3)',
        });
    });

    it('pins the card tier to the mockups’ content-card treatment (blur 16 / saturate 140%)', () => {
        // Derived from the transcription above, so re-reading the mockups moves the assertion — not a
        // second literal that could agree with a wrong token by coincidence.
        expect({ blur: glass.card.blur, saturate: glass.card.saturate }).toEqual(MOCKUP_GLASS.card);
    });

    it('pins the subtle tier to the mockups’ chrome/control treatment (blur 12 / saturate 130%)', () => {
        expect({ blur: glass.subtle.blur, saturate: glass.subtle.saturate }).toEqual(MOCKUP_GLASS.control);
    });

    it('keeps the subtle tier LIGHTER than the card tier on both axes (that is what makes it subtle)', () => {
        // The ordering is the tier's whole meaning: a "subtle" tier that blurred or saturated harder than
        // the card would be misnamed, and this catches a future re-tone that swaps the two by mistake.
        expect(glass.subtle.blur).toBeLessThan(glass.card.blur);
        expect(glass.subtle.saturate).toBeLessThan(glass.card.saturate);
    });

    it('saturates every tier — a glass pane with no vibrancy boost is just a translucent rectangle', () => {
        for (const spec of Object.values(glass)) {
            expect(spec.saturate).toBeGreaterThan(1);
            // Nothing in the mockup corpus exceeds 160%; a runaway multiplier would blow out the backdrop.
            expect(spec.saturate).toBeLessThanOrEqual(1.6);
        }
    });

    it('every glass fallback is more opaque than its translucent surface (readable when blur is unsupported)', () => {
        const alpha = (rgba: string): number => Number(rgba.slice(rgba.lastIndexOf(',') + 1, -1));
        for (const spec of Object.values(glass)) {
            expect(alpha(spec.fallback)).toBeGreaterThan(alpha(spec.surface));
        }
    });

    it('gives every tier a TRANSLUCENT edge — an opaque border frames the glass instead of edging it', () => {
        const alpha = (rgba: string): number => Number(rgba.slice(rgba.lastIndexOf(',') + 1, -1));
        for (const spec of Object.values(glass)) {
            expect(alpha(spec.border)).toBeGreaterThan(0);
            expect(alpha(spec.border)).toBeLessThan(1);
        }
    });
});

describe('supportsNativeBlur (host capability)', () => {
    it('reports blur on iOS, where expo-blur has a real native blur view', () => {
        expect(supportsNativeBlur('ios')).toBe(true);
    });

    it('reports NO blur on Android — expo-blur defaults blurMethod to "none" there', () => {
        // Evidence, not guesswork: expo-blur 57's own README says "This package only supports iOS. On
        // Android, a plain View with a translucent background will be rendered", and `_getBlurMethod()`
        // returns `'none'` unless the caller opts into `dimezisBlurView*` AND wires a `blurTarget`. A
        // surface that trusted `true` here would ship a translucent, UNBLURRED panel — the exact
        // dishonest degradation the solid fallback exists to prevent.
        expect(supportsNativeBlur('android')).toBe(false);
    });

    it('reports blur on web, where expo-blur maps to a real backdrop-filter', () => {
        expect(supportsNativeBlur('web')).toBe(true);
    });

    it('fails CLOSED for an unrecognized host rather than assuming blur', () => {
        expect(supportsNativeBlur('windows')).toBe(false);
    });
});

describe('glassBackdropCss (web composition)', () => {
    it('composes a CSS backdrop-filter with blur px and saturation', () => {
        expect(glassBackdropCss(glass.card)).toBe('blur(16px) saturate(1.4)');
    });
});

describe('toNativeGlass (expo-blur projection)', () => {
    it('maps blur px to a clamped 0..100 expo-blur intensity', () => {
        expect(toNativeGlass(glass.card).intensity).toBe(64);
        expect(toNativeGlass({ ...glass.card, blur: 40 }).intensity).toBe(100);
    });

    it('projects the SUBTLE tier’s own blur, so the native chrome glass tracks the mockup too', () => {
        // 12px × 4 = 48. Pinned separately from `card` because the tier's blur is the value the mockup
        // fidelity pass corrected (10 → 12) — an assertion only on `card` would not have caught it.
        expect(toNativeGlass(glass.subtle).intensity).toBe(48);
    });

    it('carries the solid fallback colour for hosts where blur is unsupported', () => {
        expect(toNativeGlass(glass.card).fallback).toBe(glass.card.fallback);
    });

    it('uses a light tint for the white frosted surface', () => {
        expect(toNativeGlass(glass.card).tint).toBe('light');
    });

    it('carries the translucent edge through, so native and web paint the same hairline', () => {
        expect(toNativeGlass(glass.card).border).toBe(glass.card.border);
    });
});

describe('toWebGlass (CSS surface projection)', () => {
    it('projects the translucent-surface-over-blur treatment when the host supports blur', () => {
        expect(toWebGlass(glass.card, true)).toEqual({
            backgroundColor: glass.card.surface,
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
        });
    });

    it('projects the OPAQUE solid fallback with NO blur property when the host cannot blur', () => {
        const style = toWebGlass(glass.card, false);

        expect(style.backgroundColor).toBe(glass.card.fallback);
        // Absent, not an empty string — an unsupported host must not carry a backdrop-filter declaration.
        expect(style.backdropFilter).toBeUndefined();
        expect(style.WebkitBackdropFilter).toBeUndefined();
    });

    it('is tier-aware — the subtle tier projects its OWN surface, blur and saturation', () => {
        expect(toWebGlass(glass.subtle, true)).toEqual({
            backgroundColor: glass.subtle.surface,
            backdropFilter: 'blur(12px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(12px) saturate(1.3)',
        });
    });

    it('composes its blur through the SAME glassBackdropCss the primitive uses (one source, no drift)', () => {
        for (const spec of Object.values(glass)) {
            expect(toWebGlass(spec, true).backdropFilter).toBe(glassBackdropCss(spec));
        }
    });

    it('is pure — projecting twice yields equal values and never mutates the spec', () => {
        const spec = { ...glass.card };
        const before = JSON.stringify(spec);

        expect(toWebGlass(spec, true)).toEqual(toWebGlass(spec, true));
        expect(JSON.stringify(spec)).toBe(before);
    });
});
