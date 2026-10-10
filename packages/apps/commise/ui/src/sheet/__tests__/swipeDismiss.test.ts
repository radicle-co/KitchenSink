/**
 * When a downward drag on the native sheet's title row dismisses it: 96 dp of travel, or a flick of 0.8 dp/ms,
 * downward only.
 */
import { describe, expect, it } from 'vitest';

import {
    SWIPE_DISMISS_DISTANCE_DP,
    SWIPE_DISMISS_VELOCITY,
    isDismissingSwipe,
    isDownwardDrag,
} from '../swipeDismiss.js';

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

// §S8.1 (`docs/design/ingredientSpecialization.md`): the sheet follows a drag, and a drag dismisses it, only while the drag
// is downward and goes down further than it goes to either side.
describe('isDownwardDrag', () => {
    it.each([
        ['straight down', 0, 40, true],
        ['the least downward travel', 0, 1, true],
        ['down, a little to the right', 10, 40, true],
        ['down, a little to the left', -10, 40, true],
        ['just more down than right', 40, 41, true],
        ['just more down than left', -40, 41, true],
        ['as far right as down', 40, 40, false],
        ['as far left as down', -40, 40, false],
        ['mostly right', 30, 12, false],
        ['mostly left', -30, 12, false],
        ['sideways only', 50, 0, false],
        ['not moved', 0, 0, false],
        ['up', 0, -40, false],
        ['up and to the side', -5, -40, false],
    ])('%s (dx %d, dy %d) → %s', (_shape, dx, dy, downward) => {
        expect(isDownwardDrag(dx, dy)).toBe(downward);
    });
});
