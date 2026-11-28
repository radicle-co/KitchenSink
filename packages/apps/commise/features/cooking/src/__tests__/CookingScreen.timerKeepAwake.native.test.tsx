import { RecipeStatus } from '@kitchensink/recipe-core';
import { render } from '@commise/ui/testing/tamagui';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';
import { makeCookingWrapper } from '../__fixtures__/makeCookingWrapper.native.js';
import { CookingScreen } from '../CookingScreen.native.js';

/**
 * Keep awake and Done's line while a timer runs (R12a). The screen stays on while the session is open OR a timer
 * counts down or rings, and is released when the timers are paused or gone. Done says which: "stays on until your
 * ... timer ends" while a timer holds it, "can turn off again" when none does, and nothing where the device cannot hold
 * the screen on. Only the keep-awake hooks are doubled, to read what the screen asks for.
 * Mutation lens: a hold that ignores timers, one that counts a paused timer, and a line that names the wrong case each
 * fail a row here.
 */
const keepAwake = vi.hoisted((): { available: boolean; calls: boolean[] } => ({ available: true, calls: [] }));

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

const MINUTE = 60_000;
const STEPS = [
    { stepNumber: 1, instruction: 'Chop the onion.' },
    { stepNumber: 2, instruction: 'Roast for 20 min.', timerSeconds: 1200 },
];

function setup() {
    const { Wrapper, store } = makeCookingWrapper();
    const read = {
        kind: 'ready' as const,
        recipe: makeCookingRecipe({ id: 'r1', status: RecipeStatus.PUBLISHED, steps: STEPS }),
        viewerIsOwner: true,
    };

    render(<CookingScreen read={read} recipeId="r1" onLeave={vi.fn()} onEdit={vi.fn()} onHome={vi.fn()} />, {
        wrapper: Wrapper,
    });

    return { store };
}

const press = (name: string | RegExp): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

/** Starts the Roast timer and finishes the recipe, so Done is showing. */
const timeThenFinish = (): void => {
    press(/^Next step, step 2/u);
    press('Time 20 min');
    press(/^Finish/u);
};

const lastHold = (): boolean | undefined => keepAwake.calls.at(-1);

beforeEach(() => {
    keepAwake.available = true;
    keepAwake.calls = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CookingScreen (native): keep awake with a timer', () => {
    it('keeps the screen on at Done while a timer runs, and says so', () => {
        setup();
        timeThenFinish();

        expect(lastHold()).toBe(true);
        expect(screen.getByText(/The screen stays on until your .+ timer ends\./)).toBeTruthy();
        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });

    it('lets the screen go at Done when no timer runs', () => {
        setup();
        press(/^Next step, step 2/u);
        press(/^Finish/u);

        expect(lastHold()).toBe(false);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();
    });

    it('lets the screen go when the only timer is paused', () => {
        setup();
        press(/^Next step, step 2/u);
        press('Time 20 min');
        press(/^Pause /);
        press(/^Finish/u);

        expect(lastHold()).toBe(false);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();
    });

    it('lets the screen go once a ringing timer is stopped', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const { store } = setup();
        const disconnect = store.connect();

        timeThenFinish();
        act(() => {
            vi.advanceTimersByTime(21 * MINUTE);
        });

        expect(lastHold()).toBe(true);

        press(/^Stop /);

        expect(lastHold()).toBe(false);
        disconnect();
    });

    it('says nothing about the screen where the device cannot hold it on', () => {
        keepAwake.available = false;
        setup();
        timeThenFinish();

        expect(screen.queryByText(/The screen stays on/)).toBeNull();
        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });
});
