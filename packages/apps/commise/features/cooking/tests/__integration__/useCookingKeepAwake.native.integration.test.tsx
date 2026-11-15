import { heldKeepAwakeTags } from '@commise/ui/testing/expo-keep-awake';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCookingKeepAwake } from '../../src/useCookingKeepAwake.js';
import { useCookingSession } from '../../src/useCookingSession.js';

afterEach(cleanup);

/**
 * The keep-awake hold on the native lane, over cooking-core's real reducers: the one native fact is the keep-awake
 * adapter (`expo-keep-awake`, here its recording stand-in): held while cooking, released on Done and on leaving.
 */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat the oil. Add the onion.' },
    { stepNumber: 2, instruction: 'Stir until golden.' },
];

const mount = () =>
    renderHook(() => {
        const session = useCookingSession({ recipeId: 'rec_1', steps: STEPS });

        return { ...session, ...useCookingKeepAwake(session.status) };
    });

describe('useCookingKeepAwake on the native lane', () => {
    beforeEach(() => heldKeepAwakeTags.clear());

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
