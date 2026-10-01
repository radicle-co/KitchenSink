/**
 * When a downward drag on the native sheet's title row dismisses it: 96 dp of travel, or a flick of 0.8 dp/ms,
 * downward only.
 */
import { describe, expect, it } from 'vitest';

import { SWIPE_DISMISS_DISTANCE_DP, SWIPE_DISMISS_VELOCITY, isDismissingSwipe } from '../swipeDismiss.js';

describe('isDismissingSwipe', () => {
    it('dismisses at 96 dp of travel and not at 95', () => {
        expect(SWIPE_DISMISS_DISTANCE_DP).toBe(96);
        expect(isDismissingSwipe(95, 0)).toBe(false);
        expect(isDismissingSwipe(96, 0)).toBe(true);
    });

    it('dismisses a short flick at 0.8 dp/ms and not at 0.79', () => {
        expect(SWIPE_DISMISS_VELOCITY).toBe(0.8);
        expect(isDismissingSwipe(20, 0.79)).toBe(false);
        expect(isDismissingSwipe(20, 0.8)).toBe(true);
    });

    it('never dismisses an upward drag, however far or fast', () => {
        expect(isDismissingSwipe(-200, 0)).toBe(false);
        expect(isDismissingSwipe(-10, 2)).toBe(false);
        expect(isDismissingSwipe(0, 2)).toBe(false);
    });
});
