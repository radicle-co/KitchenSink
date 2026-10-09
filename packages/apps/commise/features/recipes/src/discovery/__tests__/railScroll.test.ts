/**
 * The browse rail's scroll arithmetic (`docs/design/uiOverhaul/buildSpec.md` §4.4): where the track stands, how far a
 * card or a page moves it, and the width of a rail card on native. Each rule is asserted on both sides of its edge.
 */
import { describe, expect, it } from 'vitest';

import {
    RAIL_CARD_MAX_PX,
    RAIL_CARD_MIN_PX,
    RAIL_GAP_PX,
    cardStepOf,
    pageStepOf,
    railCardWidthOf,
    railScrollState,
} from '../railScroll.js';

describe('railScrollState', () => {
    it('is at the start at scroll 0 and at neither end in the middle', () => {
        expect(railScrollState({ scrollLeft: 0, clientWidth: 600, scrollWidth: 1400 })).toEqual({
            atStart: true,
            atEnd: false,
        });
        expect(railScrollState({ scrollLeft: 400, clientWidth: 600, scrollWidth: 1400 })).toEqual({
            atStart: false,
            atEnd: false,
        });
    });

    it('is at the end when the view reaches the content, within a pixel of rounding', () => {
        expect(railScrollState({ scrollLeft: 800, clientWidth: 600, scrollWidth: 1400 }).atEnd).toBe(true);
        expect(railScrollState({ scrollLeft: 799.4, clientWidth: 600, scrollWidth: 1400 }).atEnd).toBe(true);
        expect(railScrollState({ scrollLeft: 790, clientWidth: 600, scrollWidth: 1400 }).atEnd).toBe(false);
    });

    it('is at both ends when the rail fits its view', () => {
        expect(railScrollState({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 900 })).toEqual({
            atStart: true,
            atEnd: true,
        });
    });

    it('reads a right-to-left track, whose scrollLeft runs negative, by its distance from the start', () => {
        expect(railScrollState({ scrollLeft: -800, clientWidth: 600, scrollWidth: 1400 })).toEqual({
            atStart: false,
            atEnd: true,
        });
    });
});

describe('the steps', () => {
    it('moves a card and its gap, or most of a view while no card is measured', () => {
        expect(cardStepOf(256, 600)).toBe(256 + RAIL_GAP_PX);
        expect(cardStepOf(0, 600)).toBe(480);
    });

    it('moves a page as one view less one card, and never less than one card', () => {
        expect(pageStepOf(256, 900)).toBe(900 - (256 + RAIL_GAP_PX));
        expect(pageStepOf(256, 300)).toBe(256 + RAIL_GAP_PX);
    });
});

describe('railCardWidthOf', () => {
    it('is 78% of the track, held between 240 and 256', () => {
        expect(railCardWidthOf(310)).toBeCloseTo(241.8);
        expect(railCardWidthOf(300)).toBe(RAIL_CARD_MIN_PX);
        expect(railCardWidthOf(1000)).toBe(RAIL_CARD_MAX_PX);
    });

    it('leaves the next card peeking about 32 at a 320 screen and about 86 at 390 (16 gutters, 16 gap)', () => {
        expect(288 - railCardWidthOf(288) - RAIL_GAP_PX).toBe(32);
        expect(358 - railCardWidthOf(358) - RAIL_GAP_PX).toBe(86);
    });
});
