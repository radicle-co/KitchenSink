/**
 * The arrival reveal's Specification (`docs/design/uiOverhaul/ingredientArrival.md`): where the scroller goes so a new
 * row and the field under it show together, with the smallest scroll. `top` and `bottom` are the area's edges in the
 * visible area (a negative `top` is above its top edge), `offset` is the scroll offset now, and `keep` is the gap held
 * at each edge.
 */
import { describe, expect, it } from 'vitest';

import { spanTarget, startSpanTarget } from '../spanReveal.js';

/** A 300 dp visible area, 8 dp kept at each edge. */
const VIEW = { viewport: 300, keep: 8 } as const;

describe('spanTarget', () => {
    it.each([
        ['the area is inside the visible area', { top: 40, bottom: 140, offset: 200 }],
        ['the area touches both gaps exactly', { top: 8, bottom: 292, offset: 200 }],
    ] as const)('scrolls nothing when %s', (_case, area) => {
        expect(spanTarget({ ...area, ...VIEW })).toBeNull();
    });

    it('row above the top edge: puts the row one gap below the top', () => {
        expect(spanTarget({ top: -30, bottom: 100, offset: 500, ...VIEW })).toBe(500 - 30 - 8);
    });

    it('row wins: scrolls up only as far as the row needs, leaving the field in view', () => {
        const target = spanTarget({ top: -2, bottom: 120, offset: 500, ...VIEW });

        expect(target).toBe(500 - 2 - 8);
        // The field's bottom after the scroll, still inside the area less its gap.
        expect(120 - ((target ?? 0) - 500)).toBeLessThanOrEqual(300 - 8);
    });

    it('field below the bottom edge: puts the field one gap above the bottom', () => {
        expect(spanTarget({ top: 200, bottom: 330, offset: 500, ...VIEW })).toBe(500 + 330 + 8 - 300);
    });

    it('too tall: the field wins and the row shows as far as it fits', () => {
        // 376 dp of area (gaps included) in 300.
        expect(spanTarget({ top: -40, bottom: 320, offset: 500, ...VIEW })).toBe(500 + 320 + 8 - 300);
    });

    it('too tall and the field already one gap above the bottom: nothing moves', () => {
        // 416 dp of area; only the row is out of view, and the field wins.
        expect(spanTarget({ top: -108, bottom: 292, offset: 500, ...VIEW })).toBeNull();
    });

    it('too tall and the field high in the area: scrolls up so more of the row shows', () => {
        // 408 dp of area; the field's bottom is 100 dp short of its place, so the scroller goes up by 100 less the gap.
        expect(spanTarget({ top: -216, bottom: 192, offset: 500, ...VIEW })).toBe(500 + 192 + 8 - 300);
    });

    it('never goes below 0', () => {
        expect(spanTarget({ top: -80, bottom: 60, offset: 20, ...VIEW })).toBe(0);
    });

    it('answers null when the clamp leaves the scroller where it is', () => {
        expect(spanTarget({ top: -80, bottom: 60, offset: 0, ...VIEW })).toBeNull();
    });

    it('fits nothing before the visible area is laid out', () => {
        expect(spanTarget({ top: 0, bottom: 50, offset: 100, viewport: 0, keep: 8 })).toBeNull();
    });
});

/**
 * A deep link to an ingredient row (`ScrollHost.scrollToStart`): the row's TOP goes one gap below the visible area's top,
 * unless the row and its editor's actions do not both fit, when the actions win (Done and Cancel one gap above the
 * bottom edge) and as much of the row as fits shows above them. It is `spanTarget`'s "field wins when too tall" rule,
 * with the top as the first choice. ONE offset from both edges, so there is never a second scroll to chain.
 */
describe('startSpanTarget', () => {
    it('fits: puts the row’s top one gap below the top, whatever its place now', () => {
        // 200 tall: 216 dp with the gaps, inside 300.
        expect(startSpanTarget({ top: 120, bottom: 320, offset: 100, ...VIEW })).toBe(100 + 120 - 8);
        expect(startSpanTarget({ top: -50, bottom: 150, offset: 500, ...VIEW })).toBe(500 - 50 - 8);
    });

    it('fits exactly: the top rule still holds', () => {
        // 284 dp tall, 300 with both gaps.
        expect(startSpanTarget({ top: 100, bottom: 384, offset: 0, ...VIEW })).toBe(92);
    });

    it('too tall: the actions win, one gap above the bottom edge, and the row shows as far as it fits', () => {
        // 340 dp tall: 356 with the gaps, in 300. The bottom edge (440) goes to 292.
        const target = startSpanTarget({ top: 100, bottom: 440, offset: 200, ...VIEW });

        expect(target).toBe(200 + 440 + 8 - 300);
        // After that scroll the actions end one gap above the bottom edge, and the row starts above the top gap.
        expect(440 - ((target ?? 0) - 200)).toBe(300 - 8);
    });

    it('answers null when it is already there', () => {
        expect(startSpanTarget({ top: 8, bottom: 208, offset: 100, ...VIEW })).toBeNull();
        expect(startSpanTarget({ top: -48, bottom: 292, offset: 100, ...VIEW })).toBeNull();
    });

    it('never goes below 0, and answers null when the clamp leaves it where it is', () => {
        expect(startSpanTarget({ top: -30, bottom: 100, offset: 10, ...VIEW })).toBe(0);
        expect(startSpanTarget({ top: 4, bottom: 100, offset: 0, ...VIEW })).toBeNull();
    });

    it('answers null until the visible area is laid out', () => {
        expect(startSpanTarget({ top: 100, bottom: 200, offset: 0, viewport: 0, keep: 8 })).toBeNull();
    });
});
