import { describe, expect, it } from 'vitest';

import { CAP_BAND_DROP_EM, letterLiftOf, letterLineHeightOf } from '../letterMetrics.js';

/**
 * The cover letter is centred by its cap band (designer ruling, 2026-11-03). The figures are Manrope Bold's own, read from
 * `Manrope_700Bold.ttf` (2000 units per em): ascent 2132, descent 600, cap height 1440 (hhea, typo and win agree).
 */
describe('letterMetrics — the cap band of the cover letter', () => {
    it('drops the cap band 0.023 em below the middle of the font’s own line (ascent − descent − cap height, halved)', () => {
        expect(CAP_BAND_DROP_EM).toBeCloseTo((2132 - 600 - 1440) / 2 / 2000, 10);
    });

    it('gives the letter a line exactly the font’s own height, so no platform adds leading above or below it', () => {
        expect(letterLineHeightOf(48)).toBe(66);
        expect(letterLineHeightOf(100)).toBe(137);
    });

    it('lifts the letter by that drop, so the cap band, not the line, is what sits in the middle', () => {
        expect(letterLiftOf(100)).toBeCloseTo(2.3, 5);
        expect(letterLiftOf(48)).toBeCloseTo(1.104, 3);
    });

    it('never moves a letter of no size', () => {
        expect(letterLiftOf(0)).toBe(0);
    });

    // iOS (UI Designer ruling 2026-11-03, qa-ios on 087051a43): a true H on a 277.5 pt cover (letter 111 pt) sat 2.4 pt HIGH
    // with the 2.55 pt lift, so on iOS the cap band is already in the middle of the font's own line (0.15 pt low, 0.0014 em);
    // Android measured within 0.4 pt with the lift. The lift is therefore platform-specific.
    it('lifts nothing on iOS, where the cap band already sits in the middle of the font’s own line', () => {
        expect(letterLiftOf(111, 'ios')).toBe(0);
        expect(letterLiftOf(48, 'ios')).toBe(0);
    });

    it('keeps the lift everywhere else', () => {
        expect(letterLiftOf(111, 'other')).toBeCloseTo(2.553, 3);
        expect(letterLiftOf(111)).toBe(letterLiftOf(111, 'other'));
    });
});
