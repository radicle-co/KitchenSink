import { describe, expect, it } from 'vitest';

import { cookingFocusTargetOf } from '../cookingFocusTarget.js';

/**
 * Where the cook's next action is after a tick, written once for both platforms: the focus line while some line is still
 * unticked after one was ticked, and otherwise the forward control (Next step, Start step or Finish).
 */
describe('cookingFocusTargetOf', () => {
    it.each([
        [1, false, 'focusLine'],
        [3, false, 'focusLine'],
        [2, true, 'forward'],
        [0, false, 'forward'],
        [0, true, 'forward'],
    ] as const)(
        'with %i ticked and every line ticked = %s, the next action is the %s',
        (tickedCount, every, target) => {
            expect(cookingFocusTargetOf({ tickedCount, everyLineTicked: every })).toBe(target);
        },
    );
});
