/**
 * The duration boxes' least width (`../boxWidth.ts`): two of the body face's widest digit, plus the box's padding and
 * edges, so a box never narrows below two digits at any text size.
 */
import { describe, expect, it } from 'vitest';

import { DURATION_BOX_DIGITS, WIDEST_DIGIT_EM, durationBoxMinWidth } from '../boxWidth.js';

describe('the duration box width', () => {
    // Inter's digit advances, read from `Inter_400Regular.ttf` (2,048 units to the em): the widest is "4" at 1,323,
    // 0.646 em. A narrower figure would clip "44" by part of a glyph.
    it('allows for the widest digit of the body face', () => {
        expect(WIDEST_DIGIT_EM).toBeGreaterThanOrEqual(1323 / 2048);
        expect(WIDEST_DIGIT_EM).toBeLessThan(0.7);
    });

    it('holds at least two digits: minutes go to 59, and hours to two', () => {
        expect(DURATION_BOX_DIGITS).toBe(2);
    });

    it('is the digits at the scaled font size plus both paddings and both edges', () => {
        expect(durationBoxMinWidth({ fontSize: 16, padding: 8, edge: 1 })).toBeCloseTo(2 * 0.65 * 16 + 16 + 2, 5);
        expect(durationBoxMinWidth({ fontSize: 32, padding: 8, edge: 1 })).toBeCloseTo(2 * 0.65 * 32 + 16 + 2, 5);
    });
});
