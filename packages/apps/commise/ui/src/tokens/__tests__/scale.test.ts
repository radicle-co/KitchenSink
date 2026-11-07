/**
 * Invariants for the single-source numeric design scale (`scale.ts`). These lock the canonical
 * unit-neutral values that every platform token set is derived from — a change here is a deliberate
 * design-scale change and must be paired with updated web-snapshot / native goldens.
 */
import { describe, expect, it } from 'vitest';

import { dimmedOpacity, elevation, fontFamily, fontSize, fontWeight, lineHeightPx, radius, spacing } from '../scale.js';

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
    // REWRITTEN for the redesign (8 / 12 / 18 / 24; they were 6 / 12 / 20 / 28).
    it('is sm 8 / md 12 / lg 18 / xl 24 / full 9999 (pixels)', () => {
        expect(radius).toEqual({ sm: 8, md: 12, lg: 18, xl: 24, full: 9999 });
    });
});

describe('scale — type', () => {
    it('names the display, body, and mono font stacks', () => {
        expect(fontFamily).toEqual({
            display: '"Manrope", Inter, system-ui, sans-serif',
            body: 'Inter, system-ui, sans-serif',
            mono: '"JetBrains Mono", monospace',
        });
    });

    it('exposes numeric font weights', () => {
        // REWRITTEN for the redesign: the weight ceiling is 600, so `bold` is 600 (it was 700).
        expect(fontWeight).toEqual({ normal: 400, medium: 500, semibold: 600, bold: 600 });
    });

    it('exposes a px line height for each allowed font size, on the 4 px grid', () => {
        expect(lineHeightPx).toEqual({ 14: 20, 16: 24, 18: 24, 28: 32 });
    });

    it('carries the displayMd…caption ramp in pixels, only 14, 16, 18 and 28 (owner ruling 2026-10-25)', () => {
        expect(fontSize).toEqual({
            displayMd: 28,
            headingLg: 18,
            headingMd: 18,
            headingSm: 18,
            bodyLg: 18,
            bodyMd: 16,
            bodySm: 14,
            caption: 14,
        });
    });

    // REWRITTEN for the owner's type-scale ruling (2026-10-25): the display ramp stops at 28 and had 20, 24, 36 and 48
    // steps, none of which exist now.
    it('contains every size the mobile display (display) ramp needs (16,18,28)', () => {
        const sizes = new Set<number>(Object.values(fontSize));

        for (const displayStep of [16, 18, 28]) {
            expect(sizes.has(displayStep)).toBe(true);
        }
    });
});

describe('scale — elevation', () => {
    // REWRITTEN for the redesign: cool, soft shadows, and `md` and `lg` are two layers (web emits both, native takes the
    // last). `glow` is a 3 px steel ring now, not a 32 px teal haze. The values are pinned to tokens.css in
    // `redesignPin.test.ts`; this pins the spec's SHAPE. There is no second test that the `glow` colour agrees with
    // `palette.steel`: it used to be a decimal twin of it (`scale.ts` could not import `colors.ts`), kept in step by a
    // test that read both. It is derived from `palette.steel` now, and the pinned triplet below fails if either moves.
    it('specifies each shadow as one or two layers of offset/blur/spread + rgb-triplet colour + opacity', () => {
        expect(elevation).toEqual({
            sm: [{ offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: '20,30,45', opacity: 0.05 }],
            md: [
                { offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: '20,30,45', opacity: 0.05 },
                { offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: '20,30,45', opacity: 0.05 },
            ],
            lg: [
                { offsetX: 0, offsetY: 2, blur: 4, spread: 0, color: '10,20,30', opacity: 0.08 },
                { offsetX: 0, offsetY: 8, blur: 22, spread: 0, color: '10,20,30', opacity: 0.12 },
            ],
            xl: [{ offsetX: 0, offsetY: 12, blur: 30, spread: 0, color: '10,20,30', opacity: 0.18 }],
            glow: [{ offsetX: 0, offsetY: 0, blur: 0, spread: 3, color: '50,92,127', opacity: 0.25 }],
        });
    });
});

describe('scale — dimmedOpacity', () => {
    // The design system's "40%" for a locked, unavailable or disabled control (§1.10). Every native control that dims
    // reads it, so a change here moves them all together; this pin is what makes that change a decision.
    it('is 40%', () => {
        expect(dimmedOpacity).toBe(0.4);
    });
});
