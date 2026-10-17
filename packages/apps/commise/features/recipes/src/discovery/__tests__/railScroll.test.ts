/**
 * The browse rail's scroll arithmetic (`docs/design/uiOverhaul/buildSpec.md` §4.4): how far a card or a page moves it,
 * and the width of a rail card on native. Each rule is asserted on both sides of its edge.
 *
 * ⚠️ The `railScrollState` rows are gone with the function: it had no caller once the track reported its own position
 * (`HorizontalScroller`'s `onPosition`). Its rows — at the start, in the middle, at the end within a pixel, fitting the
 * view, and a right-to-left track read by its distance from the start — moved to
 * `ui/src/horizontalScroller/__tests__/scrollHint.test.ts`, where the one rule lives.
 */
import { describe, expect, it } from 'vitest';

import {
    RAIL_CARD_MAX_PX,
    RAIL_CARD_MIN_PX,
    RAIL_GAP_PX,
    cardStepOf,
    pageStepOf,
    railCardWidthOf,
} from '../railScroll.js';

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
