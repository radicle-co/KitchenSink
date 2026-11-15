import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeStatus } from '@kitchensink/recipe-core';

import type { CookingRecipe } from '../cookingViewProps.js';
import { useCookingSessionScreen } from '../useCookingSessionScreen.js';

/**
 * The session screen's shared model, over the real cooking-core reducers (through `useCookingSession`), the real copy and
 * the real step view model. Only the keep-awake hooks are wrapped in spies over their real implementations, so the hold
 * can be observed: the seam is spied on, never replaced.
 */
const keepAwake = vi.hoisted((): { available: boolean; calls: boolean[] } => ({ available: false, calls: [] }));

vi.mock('@commise/ui/keep-awake', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/keep-awake')>();

    return {
        ...actual,
        useKeepAwake: (on: boolean) => {
            keepAwake.calls.push(on);
            actual.useKeepAwake(on);
        },
        useKeepAwakeAvailable: () => keepAwake.available,
    };
});

const recipeOf = (instructions: readonly string[]): CookingRecipe => ({
    id: 'r1',
    title: 'Weeknight roast',
    status: RecipeStatus.PUBLISHED,
    steps: instructions.map((instruction, index) => ({ stepNumber: index + 1, instruction })),
});

const SIX = recipeOf(['Heat the oil. Add the onion.', 'Add the butter.', 'Roast.', 'Rest.', 'Carve.', 'Serve.']);

const mount = (recipe = SIX, onLeave = vi.fn()) => ({
    onLeave,
    ...renderHook(() => useCookingSessionScreen({ recipe, onLeave })),
});

const forwardTimes = (result: { current: { goForward: () => void } }, times: number) => {
    for (let move = 0; move < times; move++) {
        act(() => result.current.goForward());
    }
};

beforeEach(() => {
    keepAwake.available = false;
    keepAwake.calls = [];
});

describe('useCookingSessionScreen: a step', () => {
    it('opens on step 1 with the place, the forward name, no move yet and no Done', () => {
        const { result } = mount();

        expect(result.current.place).toBe('Step 1 of 6');
        expect(result.current.nav.back.a11yName).toBe('Back to the recipe');
        expect(result.current.nav.forward.a11yName).toBe('Next step, step 2');
        expect(result.current.moves).toBe(0);
        expect(result.current.hasPrevious).toBe(false);
        expect(result.current.hasNext).toBe(true);
        expect(result.current.done).toBeNull();
    });

    it('moves forward, counts the move, and announces the place with the focus line', () => {
        const { result } = mount();

        act(() => result.current.goForward());

        expect(result.current.place).toBe('Step 2 of 6');
        expect(result.current.moves).toBe(1);
        expect(result.current.hasPrevious).toBe(true);
        expect(result.current.nav.back.a11yName).toBe('Back to step 1');
        expect(result.current.announcement).toBe('Step 2 of 6. Add the butter.');
    });

    it('goes back a step and counts the move', () => {
        const { result } = mount();
        forwardTimes(result, 2);

        act(() => result.current.goBack());

        expect(result.current.place).toBe('Step 2 of 6');
        expect(result.current.moves).toBe(3);
    });

    it('leaves through onLeave on step 1 and moves nothing', () => {
        const { result, onLeave } = mount();

        act(() => result.current.goBack());

        expect(onLeave).toHaveBeenCalledTimes(1);
        expect(result.current.place).toBe('Step 1 of 6');
        expect(result.current.moves).toBe(0);
    });

    it('hands the foot a preview of the next step while a line is unticked, and none on the last step', () => {
        const { result } = mount();

        expect(result.current.preview?.overline).toBe('Next · step 2');
        expect(result.current.preview?.line).toBe('Add the butter.');

        forwardTimes(result, 5);

        expect(result.current.hasNext).toBe(false);
        expect(result.current.preview).toBeUndefined();
    });
});

describe('useCookingSessionScreen: Done', () => {
    it('titles Done "All 6 steps done" for six steps and "All done" for one', () => {
        const six = mount();
        forwardTimes(six.result, 6);
        expect(six.result.current.done?.title).toBe('All 6 steps done');

        const one = mount(recipeOf(['Simmer the soup.']));
        forwardTimes(one.result, 1);
        expect(one.result.current.done?.title).toBe('All done');
    });

    it('names the recipe in the enjoy line and says the screen can turn off only where it was kept on', () => {
        keepAwake.available = true;
        const kept = mount();
        forwardTimes(kept.result, 6);
        expect(kept.result.current.done?.enjoy).toBe('Weeknight roast. Enjoy it.');
        expect(kept.result.current.done?.screenOff).toBe('The screen can turn off again.');

        keepAwake.available = false;
        const unkept = mount();
        forwardTimes(unkept.result, 6);
        expect(unkept.result.current.done?.screenOff).toBeUndefined();
    });

    it('returns to the recipe with the first action and starts over with the second', () => {
        const { result, onLeave } = mount();
        forwardTimes(result, 6);

        act(() => result.current.done?.backToRecipe.onPress());
        expect(onLeave).toHaveBeenCalledTimes(1);

        act(() => result.current.done?.cookAgain.onPress());
        expect(result.current.done).toBeNull();
        expect(result.current.place).toBe('Step 1 of 6');
    });
});

describe('useCookingSessionScreen: the screen-on hold', () => {
    it('holds while cooking and lets go on Done, through the session status', () => {
        const { result } = mount();
        expect(keepAwake.calls.at(-1)).toBe(true);

        forwardTimes(result, 6);

        expect(keepAwake.calls.at(-1)).toBe(false);
    });
});
