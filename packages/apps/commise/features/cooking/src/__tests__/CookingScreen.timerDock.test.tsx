import { RecipeStatus } from '@kitchensink/recipe-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';
import { makeCookingWrapper } from '../__fixtures__/makeCookingWrapper.js';
import { CookingScreen } from '../CookingScreen.js';
import { DONE_SETTLE_MS } from '../doneSettle.js';

/**
 * The timer dock on the web cooking screen: the offer under a step that has a length, the row it starts, the controls
 * that keep and move the cook's place, and what is left after Cancel and Stop. Real store, real snackbar, real copy.
 * Mutation lens: an offer that shows under a step with no length, a Start that does not move focus to Pause, a Cancel
 * that moves focus to Undo or leaves it on a gone control, and a ring that does not put Stop under the cook's focus
 * each fail a row here.
 */
const MINUTE = 60_000;
const STEPS = [
    { stepNumber: 1, instruction: 'Chop the onion.' },
    { stepNumber: 2, instruction: 'Roast for 20 min.', timerSeconds: 1200 },
    { stepNumber: 3, instruction: 'Serve.' },
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

const goToRoast = (): void => {
    press(/^Next step, step 2/u);
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CookingScreen: the timer dock', () => {
    it('offers no timer on a step with no length', () => {
        setup();

        expect(screen.queryByRole('button', { name: /^Time / })).toBeNull();
    });

    it('offers the step length, starts it on a press, and puts focus on its Pause control', () => {
        setup();
        goToRoast();

        press('Time 20 min');

        const pause = screen.getByRole('button', { name: /^Pause / });

        expect(document.activeElement).toBe(pause);
        expect(screen.queryByRole('button', { name: /^Time / })).toBeNull();
    });

    it('keeps the cook’s place when Pause becomes Resume', () => {
        setup();
        goToRoast();
        press('Time 20 min');
        press(/^Pause /);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Resume / }));
    });

    it('Cancel says so with Undo, returns the offer, and puts focus on the offer, never on Undo', () => {
        setup();
        goToRoast();
        press('Time 20 min');
        press(/^Cancel /);

        expect(screen.getByText(/timer cancelled/)).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Time 20 min' }));
        expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Undo' }));
    });

    it('Undo brings the timer back with focus on its primary control', () => {
        setup();
        goToRoast();
        press('Time 20 min');
        press(/^Cancel /);
        press('Undo');

        expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Pause / }));
    });

    it('a ring shows a Done row with Stop, and Stop takes the row away', () => {
        const { store } = setup();
        const disconnect = store.connect();
        goToRoast();
        press('Time 20 min');
        act(() => {
            vi.advanceTimersByTime(21 * MINUTE);
        });

        expect(screen.getByText('Done')).toBeTruthy();

        press(/^Stop /);

        expect(store.getSnapshot().timers).toEqual([]);
        disconnect();
    });
});

describe('CookingScreen: focus on Done', () => {
    /** Starts the Roast timer and finishes the recipe, so Done shows with the timer's row in the dock. */
    const timeThenFinish = (): void => {
        goToRoast();
        press('Time 20 min');
        press(/^Next step, step 3/u);
        press(/^Finish/u);
    };

    const title = () => screen.getByRole('heading', { name: /steps? done/iu });

    it('puts focus on the title when Cancel takes the last row away on Done', () => {
        setup();
        timeThenFinish();
        screen.getByRole('button', { name: /^Cancel / }).focus();

        press(/^Cancel /);

        expect(document.activeElement).toBe(title());
    });

    it('puts focus on the title when Stop takes the last row away on Done', () => {
        const { store } = setup();
        const disconnect = store.connect();
        timeThenFinish();
        act(() => {
            vi.advanceTimersByTime(21 * MINUTE);
        });
        screen.getByRole('button', { name: /^Stop / }).focus();

        press(/^Stop /);

        expect(document.activeElement).toBe(title());
        disconnect();
    });

    it('leaves no request behind: Cook again opens step 1 with no title to take focus', () => {
        setup();
        timeThenFinish();
        press(/^Cancel /);
        act(() => {
            vi.advanceTimersByTime(DONE_SETTLE_MS);
        });
        press(/^Cook it again/u);

        expect(screen.queryByRole('heading', { name: /steps? done/iu })).toBeNull();
        expect(document.activeElement).not.toBe(document.body.querySelector('h1'));
    });
});
