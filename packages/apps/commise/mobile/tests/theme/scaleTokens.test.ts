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

import { fontSize, lineHeightRatio, radius, spacing } from '@commise/ui/scale';

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

const round1 = (n: number): number => Math.round(n * 10) / 10;

describe('mobile Tamagui token ramps — GOLDEN (unchanged synthesized values)', () => {
    it('createTokens.space equals the pre-U0 map (0…96 + true=16)', () => {
        expect(spaceScale).toEqual({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96, true: 16 });
    });

    it('createTokens.size equals the pre-U0 map', () => {
        expect(sizeScale).toEqual({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96, true: 16 });
    });

    it('createTokens.radius equals the pre-U0 map (0 + sm…full)', () => {
        expect(radiusScale).toEqual({ 0: 0, 1: 6, 2: 12, 3: 20, 4: 28, 5: 9999 });
    });

    it('body createFont size ramp is unchanged', () => {
        expect(bodyFontSize).toEqual({ 1: 14, 2: 16, 3: 18, 4: 18, 5: 20, 6: 24, 7: 28, 8: 36, 9: 48 });
    });

    it('body createFont lineHeight ramp is unchanged (round-1 exact, no float drift)', () => {
        expect(bodyLineHeight).toEqual({ 1: 21, 2: 24, 3: 27, 4: 21.6, 5: 24, 6: 28.8, 7: 33.6, 8: 43.2, 9: 57.6 });
    });

    it('display (Playfair) createFont size ramp is unchanged', () => {
        expect(displayFontSize).toEqual({ 1: 16, 2: 20, 3: 24, 4: 28, 5: 36, 6: 48, 7: 28, 8: 36, 9: 48 });
    });

    it('display (Playfair) createFont lineHeight ramp is unchanged (round-1 exact)', () => {
        expect(displayLineHeight).toEqual({
            1: 19.2,
            2: 24,
            3: 28.8,
            4: 33.6,
            5: 43.2,
            6: 57.6,
            7: 33.6,
            8: 43.2,
            9: 57.6,
        });
    });

    it('shared createFont weight ramp is unchanged', () => {
        expect(fontWeightRamp).toEqual({ 1: '400', 2: '500', 3: '600', 4: '700' });
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

    it('body font sizes select the expected scale ramp steps', () => {
        expect(bodyFontSize).toEqual({
            1: fontSize.bodySm,
            2: fontSize.bodyMd,
            3: fontSize.bodyLg,
            4: fontSize.headingSm,
            5: fontSize.headingMd,
            6: fontSize.headingLg,
            7: fontSize.displayMd,
            8: fontSize.displayLg,
            9: fontSize.displayXl,
        });
    });

    it('body line-heights are round-1 of (size × ratio): body ratio for 1-3, heading for 4-9', () => {
        expect(bodyLineHeight[1]).toBe(round1(fontSize.bodySm * lineHeightRatio.body));
        expect(bodyLineHeight[3]).toBe(round1(fontSize.bodyLg * lineHeightRatio.body));
        expect(bodyLineHeight[4]).toBe(round1(fontSize.headingSm * lineHeightRatio.heading));
        expect(bodyLineHeight[9]).toBe(round1(fontSize.displayXl * lineHeightRatio.heading));
    });

    it('display sizes select the Playfair ramp steps (with 7-9 repeating 4-6)', () => {
        expect(displayFontSize).toEqual({
            1: fontSize.bodyMd,
            2: fontSize.headingMd,
            3: fontSize.headingLg,
            4: fontSize.displayMd,
            5: fontSize.displayLg,
            6: fontSize.displayXl,
            7: fontSize.displayMd,
            8: fontSize.displayLg,
            9: fontSize.displayXl,
        });
    });

    it('display line-heights are round-1 of (size × heading ratio) throughout', () => {
        expect(displayLineHeight[1]).toBe(round1(fontSize.bodyMd * lineHeightRatio.heading));
        expect(displayLineHeight[6]).toBe(round1(fontSize.displayXl * lineHeightRatio.heading));
    });
});
