/**
 * The iOS line-height workaround for react/react-native#58970 (Yoga rounds a text box in float, so a box straddling
 * y=2048 at 3x is 55.9998779 tall instead of 56, and TextKit then draws only one of two lines). The leading is set a
 * hair above the pixel grid on iOS ONLY: `ceil(lh * scale - 1e-6) / scale + 0.001`. Android rounds a line height to
 * whole pixels, so there the extra 0.001 could add a whole pixel, and it stays exact.
 */
import { describe, expect, it } from 'vitest';

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { snapLineHeight } from '../iosLineHeight.js';

const SCALES = [1, 2, 2.625, 3, 3.5] as const;
const LEADINGS = [16, 18.7, 20, 20.2, 24, 28, 33.333, 42] as const;

describe('snapLineHeight (native)', () => {
    it('puts 28 at scale 3 one thousandth above the grid line', () => {
        expect(withPlatformOs('ios', () => snapLineHeight(28, 3))).toBeCloseTo(28.001, 9);
    });

    it('rounds a fractional scaled leading UP to the pixel grid, then adds 0.001', () => {
        // 20.2 * 3 = 60.6 px, which the grid takes to 61 px = 20.3333... pt.
        expect(withPlatformOs('ios', () => snapLineHeight(20.2, 3))).toBeCloseTo(61 / 3 + 0.001, 9);
        // 24 * 2.625 = 63 px exactly, so the grid does not move it.
        expect(withPlatformOs('ios', () => snapLineHeight(24, 2.625))).toBeCloseTo(24.001, 9);
    });

    it('is a whole number of pixels plus 0.001 pt, and never below the input', () => {
        for (const scale of SCALES) {
            for (const leading of LEADINGS) {
                const snapped = withPlatformOs('ios', () => snapLineHeight(leading, scale));
                const pixels = (snapped - 0.001) * scale;

                expect(snapped).toBeGreaterThanOrEqual(leading);
                expect(Math.abs(pixels - Math.round(pixels))).toBeLessThan(1e-6);
                expect(snapped - leading).toBeLessThan(1 / scale + 0.002);
            }
        }
    });

    it.each(['android'] as const)('leaves the leading exact on %s', (os) => {
        for (const scale of SCALES) {
            for (const leading of LEADINGS) {
                expect(withPlatformOs(os, () => snapLineHeight(leading, scale))).toBe(leading);
            }
        }
    });

    it('leaves the leading exact where Platform.OS is web', () => {
        expect(snapLineHeight(28, 3)).toBe(28);
    });
});
