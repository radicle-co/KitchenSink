/**
 * Invariants for the single-source numeric design scale (`scale.ts`). These lock the canonical
 * unit-neutral values that every platform token set is derived from — a change here is a deliberate
 * design-scale change and must be paired with updated web-snapshot / native goldens.
 */
import { describe, expect, it } from 'vitest';

import { palette } from '../colors.js';
import {
    borderSubtle,
    elevation,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeightRatio,
    radius,
    spacing,
} from '../scale.js';

describe('scale — spacing', () => {
    it('is the 4px-base pixel ramp 0,4,8,12,16,24,32,48,64,96', () => {
        expect(spacing).toEqual({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96 });
    });

    it('every step is a raw pixel number (unit-neutral)', () => {
        for (const value of Object.values(spacing)) {
            expect(typeof value).toBe('number');
        }
    });
});

describe('scale — radius', () => {
    it('is sm 6 / md 12 / lg 20 / xl 28 / full 9999 (pixels)', () => {
        expect(radius).toEqual({ sm: 6, md: 12, lg: 20, xl: 28, full: 9999 });
    });
});

describe('scale — type', () => {
    it('names the display, body, and mono font stacks', () => {
        expect(fontFamily).toEqual({
            display: '"Playfair Display", Georgia, serif',
            body: 'Inter, system-ui, sans-serif',
            mono: '"JetBrains Mono", monospace',
        });
    });

    it('exposes numeric font weights', () => {
        expect(fontWeight).toEqual({ normal: 400, medium: 500, semibold: 600, bold: 700 });
    });

    it('exposes unitless line-height ratios', () => {
        expect(lineHeightRatio).toEqual({ heading: 1.2, body: 1.5, caption: 1.4 });
    });

    it('carries the full displayXl…overline ramp in pixels, including the Playfair/display steps', () => {
        expect(fontSize).toEqual({
            displayXl: 48,
            displayLg: 36,
            displayMd: 28,
            headingLg: 24,
            headingMd: 20,
            headingSm: 18,
            bodyLg: 18,
            bodyMd: 16,
            bodySm: 14,
            caption: 12,
            overline: 11,
        });
    });

    it('contains every size the mobile display (Playfair) ramp needs (16,20,24,28,36,48)', () => {
        const sizes = new Set<number>(Object.values(fontSize));

        for (const displayStep of [16, 20, 24, 28, 36, 48]) {
            expect(sizes.has(displayStep)).toBe(true);
        }
    });
});

describe('scale — elevation', () => {
    it('specifies each shadow as offset/blur/spread + rgb-triplet colour + opacity', () => {
        expect(elevation).toEqual({
            sm: { offsetX: 0, offsetY: 1, blur: 3, spread: 0, color: '45,52,54', opacity: 0.04 },
            md: { offsetX: 0, offsetY: 4, blur: 6, spread: -1, color: '45,52,54', opacity: 0.07 },
            lg: { offsetX: 0, offsetY: 10, blur: 15, spread: -3, color: '45,52,54', opacity: 0.08 },
            xl: { offsetX: 0, offsetY: 20, blur: 25, spread: -5, color: '45,52,54', opacity: 0.09 },
            glow: { offsetX: 0, offsetY: 0, blur: 32, spread: 0, color: '49,128,122', opacity: 0.25 },
        });
    });

    it('keeps the glow halo pointed at the seafoam TOKEN, which it can only re-spell in decimal', () => {
        // `colors.ts` imports this module for `borderSubtle`, so `scale.ts` cannot import the palette back —
        // which makes `glow.color` the one place a palette colour is written twice. The #113 lightness move to
        // `seafoam` left it stale (a halo one hue-step off its own button) until this assertion existed.
        const channels = [1, 3, 5].map((at) => Number.parseInt(palette.seafoam.slice(at, at + 2), 16));

        expect(elevation.glow.color).toBe(channels.join(','));
    });
});

describe('scale — borderSubtle', () => {
    it('is the single source for the subtle border colour', () => {
        expect(borderSubtle).toBe('rgba(178, 190, 195, 0.3)');
    });
});
