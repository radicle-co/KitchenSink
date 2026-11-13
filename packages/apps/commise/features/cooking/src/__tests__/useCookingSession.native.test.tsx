import { heldKeepAwakeTags } from '@commise/ui/testing/expo-keep-awake';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCookingSession } from '../useCookingSession.js';

afterEach(cleanup);

/**
 * The same hook on the native lane, over cooking-core's real reducers: the walk is shared, and the one native fact is the
 * keep-awake adapter (`expo-keep-awake`, here its recording stand-in): held while cooking, released on Done and on leaving.
 */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat the oil. Add the onion.' },
    { stepNumber: 2, instruction: 'Stir until golden.' },
];

const mount = () => renderHook(() => useCookingSession({ recipeId: 'rec_1', steps: STEPS }));

describe('useCookingSession on the native lane', () => {
    beforeEach(() => heldKeepAwakeTags.clear());

    it('walks the steps and ticks lines as on web', () => {
        const { result } = mount();

        act(() => result.current.tick(0));
        expect(result.current.focusLine).toBe(1);

        act(() => result.current.next());
        expect(result.current.place).toEqual({ position: 2, total: 2, previous: 1, next: null });

        act(() => result.current.next());
        expect(result.current.status).toBe('complete');
    });

    it('holds the screen awake while cooking, lets go on Done, and holds again on Cook it again', async () => {
        const { result } = mount();

        await act(async () => undefined);
        expect(heldKeepAwakeTags.size).toBe(1);

        act(() => result.current.next());
        act(() => result.current.next());
        await act(async () => undefined);
        expect(heldKeepAwakeTags.size).toBe(0);

        act(() => result.current.cookAgain());
        await act(async () => undefined);
        expect(heldKeepAwakeTags.size).toBe(1);
    });

    it('lets go when the cook leaves, and says the device can keep the screen on', async () => {
        const { result, unmount } = mount();

        await act(async () => undefined);
        expect(result.current.keepAwakeAvailable).toBe(true);
        expect(heldKeepAwakeTags.size).toBe(1);

        unmount();
        await act(async () => undefined);
        expect(heldKeepAwakeTags.size).toBe(0);
    });
});
