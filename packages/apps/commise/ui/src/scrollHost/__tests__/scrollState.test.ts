/**
 * The scroll state both ScrollHost leaves derive (A7): condensed once the heading's bottom scrolls past the top, the
 * direction with a dead zone so a bounce does not flicker the floating button, the top, and the current section. An
 * unchanged state returns the SAME object, which is what keeps a scroll from re-rendering every frame.
 */
import { describe, expect, it } from 'vitest';

import { DIRECTION_DEAD_ZONE_PX } from '../props.js';
import { INITIAL_SCROLL_STATE, nextScrollState } from '../scrollState.js';

const sample = (y: number, previousY: number, headingBottom: number | undefined = 100) => ({
    y,
    previousY,
    headingBottom,
    atEnd: false,
    viewportHeight: 800,
    contentHeight: 8000,
});

describe('nextScrollState', () => {
    it('condenses once the heading has fully scrolled under the top', () => {
        expect(nextScrollState(INITIAL_SCROLL_STATE, sample(99, 90), [], 0).condensed).toBe(false);
        expect(nextScrollState(INITIAL_SCROLL_STATE, sample(100, 90), [], 0).condensed).toBe(true);
    });

    it('never condenses before the heading reports its layout', () => {
        expect(
            nextScrollState(INITIAL_SCROLL_STATE, { ...sample(5000, 4000), headingBottom: undefined }, [], 0).condensed,
        ).toBe(false);
    });

    it('reads the direction from the change in position', () => {
        expect(nextScrollState(INITIAL_SCROLL_STATE, sample(300, 200), [], 0).scrollingDown).toBe(true);
        const down = { ...INITIAL_SCROLL_STATE, scrollingDown: true };
        expect(nextScrollState(down, sample(200, 300), [], 0).scrollingDown).toBe(false);
    });

    it('holds the direction inside the dead zone (a bounce or a jitter)', () => {
        const down = { ...INITIAL_SCROLL_STATE, scrollingDown: true };
        const jitter = DIRECTION_DEAD_ZONE_PX - 1;

        expect(nextScrollState(down, sample(500, 500 + jitter), [], 0).scrollingDown).toBe(true);
        expect(nextScrollState(down, sample(500, 500 + DIRECTION_DEAD_ZONE_PX), [], 0).scrollingDown).toBe(false);
    });

    it('is at the top at zero and above it (an iOS overscroll), not below', () => {
        expect(nextScrollState(INITIAL_SCROLL_STATE, sample(-20, 0), [], 0).atTop).toBe(true);
        expect(nextScrollState(INITIAL_SCROLL_STATE, sample(1, 0), [], 0).atTop).toBe(false);
    });

    it('reports the current section through the one algorithm', () => {
        const tops = [
            { id: 'a', top: 0 },
            { id: 'b', top: 400 },
        ];

        expect(nextScrollState(INITIAL_SCROLL_STATE, sample(350, 300), tops, 60).current).toBe('b');
    });

    it('reports depth in viewports, to the quarter, so a scroll re-renders at most four times a screen', () => {
        const state = nextScrollState(INITIAL_SCROLL_STATE, sample(3300, 3200), [], 0);

        expect(state.viewportsDown).toBe(4);
        expect(state.pageViewports).toBe(10);
        expect(nextScrollState(state, sample(3400, 3300), [], 0).viewportsDown).toBe(4.25);
    });

    it('reports no depth before the viewport is measured', () => {
        expect(
            nextScrollState(INITIAL_SCROLL_STATE, { ...sample(900, 800), viewportHeight: 0 }, [], 0).pageViewports,
        ).toBe(0);
    });

    it('returns the same object when nothing changed, so React bails out', () => {
        const state = nextScrollState(INITIAL_SCROLL_STATE, sample(300, 200), [], 0);

        expect(nextScrollState(state, sample(320, 300), [], 0)).toBe(state);
    });
});
