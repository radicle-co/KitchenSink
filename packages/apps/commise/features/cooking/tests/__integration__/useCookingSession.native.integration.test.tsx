import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useCookingSession } from '@commise/features-cooking';

afterEach(cleanup);

/**
 * The same hook on the native lane, over cooking-core's real reducers: the walk is shared with web.
 */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat the oil. Add the onion.' },
    { stepNumber: 2, instruction: 'Stir until golden.' },
];

const mount = () => renderHook(() => useCookingSession({ recipeId: 'rec_1', steps: STEPS }));

describe('useCookingSession on the native lane', () => {
    it('walks the steps and ticks lines as on web', () => {
        const { result } = mount();

        act(() => result.current.tick(0));
        expect(result.current.focusLine).toBe(1);

        act(() => result.current.next());
        expect(result.current.place).toEqual({ position: 2, total: 2, previous: 1, next: null });

        act(() => result.current.next());
        expect(result.current.status).toBe('complete');
    });
});
