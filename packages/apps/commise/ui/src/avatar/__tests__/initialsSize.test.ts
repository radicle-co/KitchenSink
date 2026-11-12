/**
 * Initials are 40% of the disc's diameter, rounded down to an even size, with a floor of 10 (designer ruling c10ecadbf,
 * 2026-11-03, and the 2026-11-11 ruling that `initialsPxOf` is the one authority, so the 24 You glyph answers 10).
 */
import { describe, expect, it } from 'vitest';

import { INITIALS_FLOOR_FROM_PX, INITIALS_MIN_PX, initialsPxOf } from '../initialsSize.js';

describe('initialsPxOf', () => {
    it('answers 10 for the 24 disc, which 40% alone would make 8', () => {
        expect(initialsPxOf(24)).toBe(10);
    });

    it('keeps 40% rounded down to even for the larger discs, which all answer 12 or more', () => {
        expect(initialsPxOf(32)).toBe(12);
        expect(initialsPxOf(36)).toBe(14);
        expect(initialsPxOf(48)).toBe(18);
    });

    // The 20 footer disc (DiscoveryFooter) is below the smallest disc the floor applies to, and its 8 is proven to fit by
    // `discGeometry.fit.test.ts`: a floor of 10 there would draw 10 pt initials in a 20 disc, over the 40% that guarantees fit.
    it('keeps 40% for a disc below 24, the 20 footer disc, so its fit proof still holds', () => {
        expect(INITIALS_FLOOR_FROM_PX).toBe(24);
        expect(initialsPxOf(20)).toBe(8);
    });

    it('never answers below the floor for a disc it applies to', () => {
        expect(INITIALS_MIN_PX).toBe(10);

        for (const disc of [24, 26, 28, 32]) {
            expect(initialsPxOf(disc)).toBeGreaterThanOrEqual(INITIALS_MIN_PX);
        }
    });
});
