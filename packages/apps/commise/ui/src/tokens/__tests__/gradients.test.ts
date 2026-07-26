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
    toNativeGlass,
    toNativeGradient,
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
        expect(gradientCss(gradient.brand)).toBe(`linear-gradient(135deg, ${palette.seafoam} 0%, ${palette['ocean-dark']} 100%)`);
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

describe('glass specs', () => {
    it('defines a frosted card surface with a translucent tint, a solid fallback, blur and saturation', () => {
        expect(glass.card).toEqual({
            surface: 'rgba(255, 255, 255, 0.85)',
            fallback: 'rgba(255, 255, 255, 0.96)',
            blur: 16,
            saturate: 1.6,
        });
    });

    it('every glass fallback is more opaque than its translucent surface (readable when blur is unsupported)', () => {
        const alpha = (rgba: string): number => Number(rgba.slice(rgba.lastIndexOf(',') + 1, -1));
        for (const spec of Object.values(glass)) {
            expect(alpha(spec.fallback)).toBeGreaterThan(alpha(spec.surface));
        }
    });
});

describe('glassBackdropCss (web composition)', () => {
    it('composes a CSS backdrop-filter with blur px and saturation', () => {
        expect(glassBackdropCss(glass.card)).toBe('blur(16px) saturate(1.6)');
    });
});

describe('toNativeGlass (expo-blur projection)', () => {
    it('maps blur px to a clamped 0..100 expo-blur intensity', () => {
        expect(toNativeGlass(glass.card).intensity).toBe(64);
        expect(toNativeGlass({ ...glass.card, blur: 40 }).intensity).toBe(100);
    });

    it('carries the solid fallback colour for hosts where blur is unsupported', () => {
        expect(toNativeGlass(glass.card).fallback).toBe(glass.card.fallback);
    });

    it('uses a light tint for the white frosted surface', () => {
        expect(toNativeGlass(glass.card).tint).toBe('light');
    });
});
