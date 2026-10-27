/**
 * Drift guard for the mobile Tamagui token/font ramps (module-graph reverse edge, F-R2). `@commise/ui`
 * cannot import the mobile Tamagui config, so the config→scale agreement is asserted HERE, in the mobile
 * package. Two independent checks:
 *
 *   1. GOLDEN — the synthesized `createTokens` space/radius and both `createFont` size/lineHeight/weight
 *      ramps still equal the exact values the hand-declared config produced before U0. Any change to a
 *      synthesized number (including a floating-point regression on `size × ratio`) fails here.
 *   2. SINGLE-SOURCE — the same maps are re-derivable from `@commise/ui/scale`, proving they are derived
 *      from the shared numeric source rather than re-hardcoded.
 */
import { describe, expect, it } from 'vitest';

import { fontSize, lineHeightPx, radius, spacing } from '@commise/ui/scale';
import { TYPE_SIZES } from '@commise/ui/tokens/typography';

import {
    bodyLineHeight,
    bodyFontSize,
    displayLineHeight,
    displayFontSize,
    fontWeightRamp,
    radiusScale,
    sizeScale,
    spaceScale,
} from '../../src/theme/scaleTokens.js';

describe('mobile Tamagui token ramps — GOLDEN (unchanged synthesized values)', () => {
    it('createTokens.space equals the pre-U0 map (0…96 + true=16)', () => {
        expect(spaceScale).toEqual({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96, true: 16 });
    });

    it('createTokens.size equals the pre-U0 map', () => {
        expect(sizeScale).toEqual({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96, true: 16 });
    });

    it('createTokens.radius equals the redesign map (0 + sm…full: 8, 12, 18, 24; REWRITTEN, it was 6, 12, 20, 28)', () => {
        expect(radiusScale).toEqual({ 0: 0, 1: 8, 2: 12, 3: 18, 4: 24, 5: 9999 });
    });

    // REWRITTEN for the owner's type-scale ruling (2026-10-25): sizes 14/16/18/28 only, capped at 28, and the leading is
    // the shared px value for each size (it was `round1(size × ratio)`: 21, 21.6, 28.8, 33.6, 43.2, 57.6 ...).
    it('body createFont size ramp states only 14, 16, 18 and 28', () => {
        expect(bodyFontSize).toEqual({ 1: 14, 2: 16, 3: 18, 4: 18, 5: 18, 6: 18, 7: 28, 8: 28, 9: 28 });
    });

    it('body createFont lineHeight ramp is whole px: 20, 24, 24 ... 32', () => {
        expect(bodyLineHeight).toEqual({ 1: 20, 2: 24, 3: 24, 4: 24, 5: 24, 6: 24, 7: 32, 8: 32, 9: 32 });
    });

    it('display (Manrope) createFont size ramp stops at the 28 px large title', () => {
        expect(displayFontSize).toEqual({ 1: 16, 2: 18, 3: 18, 4: 28, 5: 28, 6: 28, 7: 28, 8: 28, 9: 28 });
    });

    it('display (Manrope) createFont lineHeight ramp is whole px', () => {
        expect(displayLineHeight).toEqual({ 1: 24, 2: 24, 3: 24, 4: 32, 5: 32, 6: 32, 7: 32, 8: 32, 9: 32 });
    });

    // REWRITTEN for the redesign: the weight ceiling is 600, so step 4 (bold) is '600' (it was '700').
    it('shared createFont weight ramp tops out at 600', () => {
        expect(fontWeightRamp).toEqual({ 1: '400', 2: '500', 3: '600', 4: '600' });
    });
});

describe('mobile Tamagui token ramps — SINGLE-SOURCE (derived from @commise/ui/scale)', () => {
    it('space/size steps 1-9 and the base `true` step come from scale.spacing', () => {
        for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
            expect(spaceScale[step]).toBe(spacing[step]);
            expect(sizeScale[step]).toBe(spacing[step]);
        }

        expect(spaceScale.true).toBe(spacing[4]);
        expect(sizeScale.true).toBe(spacing[4]);
    });

    it('radius keys 1-5 map sm→1 … full→5 from scale.radius (0 synthesized)', () => {
        expect(radiusScale[0]).toBe(0);
        expect(radiusScale[1]).toBe(radius.sm);
        expect(radiusScale[2]).toBe(radius.md);
        expect(radiusScale[3]).toBe(radius.lg);
        expect(radiusScale[4]).toBe(radius.xl);
        expect(radiusScale[5]).toBe(radius.full);
    });

    // REWRITTEN for the owner's type-scale ruling (2026-10-25): the ramp stops at 28, so $7-$9 are all displayMd, and the
    // 20/24/36/48 steps are gone.
    it('body font sizes select the expected scale ramp steps', () => {
        expect(bodyFontSize).toEqual({
            1: fontSize.bodySm,
            2: fontSize.bodyMd,
            3: fontSize.bodyLg,
            4: fontSize.headingSm,
            5: fontSize.headingMd,
            6: fontSize.headingLg,
            7: fontSize.displayMd,
            8: fontSize.displayMd,
            9: fontSize.displayMd,
        });
    });

    it('display sizes select the Manrope ramp steps, which stop at the 28 px large title', () => {
        expect(displayFontSize).toEqual({
            1: fontSize.bodyMd,
            2: fontSize.headingMd,
            3: fontSize.headingLg,
            4: fontSize.displayMd,
            5: fontSize.displayMd,
            6: fontSize.displayMd,
            7: fontSize.displayMd,
            8: fontSize.displayMd,
            9: fontSize.displayMd,
        });
    });
});

describe('mobile Tamagui font ramps — the owner’s type scale (2026-10-25)', () => {
    const ramps = { bodyFontSize, displayFontSize } as const;
    const leadings = { bodyLineHeight, displayLineHeight } as const;

    it.each(Object.entries(ramps))('%s use only 14, 16, 18 or 28', (_name, ramp) => {
        for (const size of Object.values(ramp)) {
            expect(TYPE_SIZES as readonly number[]).toContain(size);
        }
    });

    it.each(Object.entries(leadings))('%s steps are whole px on the 4 px grid, with no rounding', (_name, ramp) => {
        for (const lineHeight of Object.values(ramp)) {
            expect(lineHeight % 4).toBe(0);
        }
    });

    it('sets each step’s leading from its size, in the shared px table', () => {
        for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
            expect(bodyLineHeight[step]).toBe(lineHeightPx[bodyFontSize[step]]);
            expect(displayLineHeight[step]).toBe(lineHeightPx[displayFontSize[step]]);
        }
    });

    it('caps both ramps at 28', () => {
        expect(Math.max(...Object.values(bodyFontSize), ...Object.values(displayFontSize))).toBe(28);
    });
});
