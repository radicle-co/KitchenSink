/**
 * The pinned bar's back control sits so the CHEVRON'S box starts on the page's content gutter (16), on a phone and on a
 * tablet alike. The bar's start padding and the control's own leading room are derived from the touch floor by two pure
 * functions, so the platform's 44 pt / 48 dp frame cannot push the glyph off the gutter.
 */
import { describe, expect, it } from 'vitest';

import { BACK_GLYPH_PX, CONTENT_GUTTER_PX, backGlyphInset, barStartPadding } from '../barGeometry.js';

describe('the back control’s position', () => {
    it.each([
        [44, 10],
        [48, 12],
    ])('centres the %d-wide frame’s glyph with %d of room before it', (floor, inset) => {
        expect(backGlyphInset(floor)).toBe(inset);
    });

    it.each([44, 48])('puts the glyph’s box on the content gutter for a %d frame', (floor) => {
        expect(barStartPadding(floor) + backGlyphInset(floor)).toBe(CONTENT_GUTTER_PX);
        expect(BACK_GLYPH_PX).toBe(24);
    });

    it('never pads the bar by less than nothing: a frame wider than the gutter allows is clamped', () => {
        expect(barStartPadding(80)).toBe(0);
    });
});
