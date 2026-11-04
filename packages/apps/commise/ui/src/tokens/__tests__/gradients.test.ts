/**
 * Invariants for the brand gradient language (`gradients.ts`). These lock the single-source specs the two platforms
 * derive from (web composes CSS strings; native projects expo-linear-gradient props), and prove the pure
 * composition/projection helpers, so the web and native brand surfaces can never drift on colour or direction.
 */
import { describe, expect, it } from 'vitest';

import { palette, role, roleDark } from '../colors.js';
import * as gradients from '../gradients.js';
import { coverGradient, gradient, gradientCss, toNativeGradient } from '../gradients.js';

describe('gradient specs', () => {
    it('threads the SAME brand CTA gradient the web Button carries (steel → ocean-dark, 135°)', () => {
        expect(gradient.brand).toEqual({
            angle: 135,
            stops: [
                { color: palette.steel, position: 0 },
                { color: palette['ocean-dark'], position: 100 },
            ],
        });
    });

    // REWRITTEN for the redesign: the canvas wash is FLAT (owner ruling, redesign.css: "the hero gradient is flat"): the
    // canvas role top to bottom, at 180 degrees. It used to be the three-stop 135 degree beach-glow ramp.
    it('carries the flat canvas wash (canvas to canvas, 180 degrees)', () => {
        expect(gradient.hero).toEqual({
            angle: 180,
            stops: [
                { color: role.canvas, position: 0 },
                { color: role.canvas, position: 100 },
            ],
        });
    });

    it('carries the bottom-up cover scrim (charcoal 60% → charcoal 0%, "to top")', () => {
        expect(gradient.scrim).toEqual({
            angle: 0,
            stops: [
                { color: 'rgba(23, 27, 32, 0.6)', position: 0 },
                { color: 'rgba(23, 27, 32, 0)', position: 100 },
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
            `linear-gradient(135deg, ${palette.steel} 0%, ${palette['ocean-dark']} 100%)`,
        );
    });

    it('emits every stop of a multi-stop gradient', () => {
        expect(
            gradientCss({
                angle: 90,
                stops: [
                    { color: '#111111', position: 0 },
                    { color: '#222222', position: 50 },
                    { color: '#333333', position: 100 },
                ],
            }),
        ).toBe('linear-gradient(90deg, #111111 0%, #222222 50%, #333333 100%)');
    });
});

describe('toNativeGradient (expo-linear-gradient projection)', () => {
    it('projects the stop colours in order', () => {
        expect(toNativeGradient(gradient.brand).colors).toEqual([palette.steel, palette['ocean-dark']]);
    });

    it('projects stop positions to 0..1 locations', () => {
        expect(
            toNativeGradient({
                angle: 90,
                stops: [
                    { color: '#111111', position: 0 },
                    { color: '#222222', position: 50 },
                    { color: '#333333', position: 100 },
                ],
            }).locations,
        ).toEqual([0, 0.5, 1]);
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
 * The page-canvas wash (`gradient.hero`) is FLAT in the redesign, on purpose, and derived from the canvas role.
 *
 * It was a three-stop beach-glow ramp, and a guard here stopped it collapsing into a flat fill (issue #145: native
 * painted a flat colour per screen). The redesign reverses that decision (steel is an accent and the page is one calm
 * cool colour), so the guard is REWRITTEN: the wash may be flat, but it must stay DERIVED from the canvas role (so the
 * page colour has one authority) and must still reach both platforms through the same spec, light and dark.
 */
describe('gradient specs — the flat canvas wash', () => {
    it('is the canvas role in both themes, so the page colour has one authority', () => {
        expect(gradient.hero.stops.map((stop) => stop.color)).toEqual([role.canvas, role.canvas]);
        expect(gradients.heroDark.stops.map((stop) => stop.color)).toEqual([roleDark.canvas, roleDark.canvas]);
    });

    it('runs top to bottom on BOTH platforms (180 degrees)', () => {
        const native = toNativeGradient(gradient.hero);

        expect(gradient.hero.angle).toBe(180);
        expect(native.start.y).toBeLessThan(native.end.y);
        expect(native.start.x).toBeCloseTo(native.end.x);
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

describe('coverGradient', () => {
    // The no-photo cover wash (designer ruling C2): sky to cream, leaning 170 degrees. The colours come from the caller
    // because the theme picks them; the slant is the token.
    it('runs the sky tint into the cream tint at 170 degrees', () => {
        expect(coverGradient({ sky: '#aaa', cream: '#bbb' })).toEqual({
            angle: 170,
            stops: [
                { color: '#aaa', position: 0 },
                { color: '#bbb', position: 100 },
            ],
        });
    });

    it('projects to a slight lean from straight down, top to bottom', () => {
        const { start, end } = toNativeGradient(coverGradient({ sky: '#aaa', cream: '#bbb' }));

        expect(start.y).toBeLessThan(0.05);
        expect(end.y).toBeGreaterThan(0.95);
        expect(end.x).toBeGreaterThan(start.x);
        expect(end.x - start.x).toBeLessThan(0.2);
    });
});
