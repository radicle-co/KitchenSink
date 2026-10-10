/**
 * Invariants for the brand gradient language (`gradients.ts`). These lock the single-source specs the two platforms
 * derive from (web composes CSS strings; native projects expo-linear-gradient props), and prove the pure
 * composition/projection helpers, so the web and native brand surfaces can never drift on colour or direction.
 */
import { describe, expect, it } from 'vitest';

import { palette } from '../colors.js';
import * as gradients from '../gradients.js';
import { gradient, gradientCss, toNativeGradient } from '../gradients.js';

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
 * The page-canvas ramp (`gradient.hero`) must stay a real, correctly-oriented gradient.
 *
 * `hero` IS the wireframes' own `--gradient-beach-glow` — the wash all nine screens paint on their page — and
 * both platforms derive their canvas from it (web's `body` rule via `--background-image-hero`, native's
 * `AppCanvas` via `toNativeGradient`). These are the invariants that keep it from silently degenerating back
 * into the flat fill the apps used to paint (issue #145).
 *
 * VALUE parity against the archive is asserted where the repo already owns mockup parity and has Node's
 * filesystem available: `@commise/web`'s `tests/mockupContrast.test.ts` compares this token to the
 * `--gradient-beach-glow` declaration in every one of the nine screens. It cannot live here — this package
 * deliberately ships no `@types/node`, so a token module's tests cannot read files.
 */
describe('gradient specs — the canvas ramp cannot collapse to a flat fill', () => {
    it('is a real multi-stop ramp, not a flat fill dressed up as a gradient', () => {
        const distinct = new Set(gradient.hero.stops.map((stop) => stop.color.toLowerCase()));

        expect(gradient.hero.stops.length).toBeGreaterThanOrEqual(3);
        // A "gradient" whose stops are all one colour renders identically to `background-color` — the exact
        // regression this whole surface exists to prevent.
        expect(distinct.size).toBe(gradient.hero.stops.length);
        expect(gradient.hero.stops[0].position).toBe(0);
        expect(gradient.hero.stops[gradient.hero.stops.length - 1]?.position).toBe(100);
    });

    it('runs top-left → bottom-right on BOTH platforms (the wireframes’ 135° diagonal)', () => {
        const native = toNativeGradient(gradient.hero);

        expect(gradient.hero.angle).toBe(135);
        // The native projection must agree with the CSS angle, or the two platforms' washes mirror each other.
        expect(native.start.x).toBeLessThan(native.end.x);
        expect(native.start.y).toBeLessThan(native.end.y);
        expect(native.colors).toEqual(gradient.hero.stops.map((stop) => stop.color));
    });
});

/**
 * Owner D12: glass goes on the navigation and control layer only, never on a card. The frosted-card tiers were the
 * only way a card could be glass, and the one card that used them read 1.1:1 in dark mode (`evaluateFinal.md` F1).
 * With the tiers gone the class is unrepresentable rather than merely avoided.
 */
describe('no card glass', () => {
    it('exports no frosted-glass tier or projection', () => {
        expect(Object.keys(gradients).filter((name) => /glass|blur/iu.test(name))).toEqual([]);
    });
});
