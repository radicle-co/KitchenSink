import { LocaleProvider } from '@commise/i18n/react';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeKeptStore } from '../../src/__fixtures__/makeKeptStore.js';
import { makeCookingRecipe } from '../../src/__fixtures__/makeCookingRecipe.js';
import type { CookingRecipe } from '../../src/cookingViewProps.js';
import { DONE_SETTLE_MS } from '../../src/doneSettle.js';
import { TimerProvider } from '../../src/timer/TimerProvider.js';
import { useCookingTimers } from '../../src/timer/useCookingTimers.js';
import { useCookingSessionScreen } from '../../src/useCookingSessionScreen.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/**
 * The session screen model over everything real: the locale provider and the resolved cooking messages, the session
 * hook over cooking-core's real reducers and splitter, the step view model, and the real keep-awake adapter. Only the
 * browser's wake lock is stood in for. Steps 1, 2 and 4 have text; step 3 is blank and skipped, so the cook walks three
 * steps and step 1 has two lines.
 */
const RECIPE: CookingRecipe = makeCookingRecipe({
    id: 'rec_1',
    title: 'Weeknight roast',
    status: RecipeStatus.PUBLISHED,
    steps: [
        { stepNumber: 1, instruction: 'Heat the oil. Add the onion.' },
        { stepNumber: 2, instruction: 'Stir until golden.' },
        { stepNumber: 3, instruction: '   ' },
        { stepNumber: 4, instruction: 'Serve it hot.' },
    ],
});

const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <LocaleProvider locale="en">{children}</LocaleProvider>
);

const mount = (recipe = RECIPE, onLeave = vi.fn()) => ({
    onLeave,
    ...renderHook(() => useCookingSessionScreen({ recipe, onLeave }), { wrapper }),
});

describe('useCookingSessionScreen over the real session, copy and wake lock', () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ released: false, release }));

    beforeEach(() => {
        release.mockClear();
        request.mockClear();
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
        // The adapter needs a secure context; jsdom's default page is not one.
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'wakeLock');
        Reflect.deleteProperty(window, 'isSecureContext');
    });

    it('opens on step 1 of 3 with nothing announced, and Back on step 1 leaves', () => {
        const { result, onLeave } = mount();

        expect(result.current.place).toBe('Step 1 of 3');
        expect(result.current.announcement).toBe('');
        expect(result.current.nav.back.a11yName).toBe('Back to the recipe');

        act(() => result.current.goBack());

        expect(onLeave).toHaveBeenCalledTimes(1);
        expect(result.current.moves).toBe(0);
    });

    it('announces a move once, and a tick afterwards changes nothing it says', () => {
        const { result } = mount();

        act(() => result.current.goForward());
        expect(result.current.announcement).toBe('Step 2 of 3. Stir until golden.');

        act(() => result.current.step.focus?.onToggle());

        expect(result.current.step.ticked?.summary).toBe('You ticked 1 line');
        expect(result.current.announcement).toBe('Step 2 of 3. Stir until golden.');
        expect(result.current.moves).toBe(1);
    });

    // Done ignores a press for DONE_SETTLE_MS after it appears (S24, D15), so this test steps a fake clock past it: a
    // press before then is ignored, which the first assertion below proves.
    it('holds the wake lock while cooking, lets go on Done with the plural title, and holds again on Cook again', async () => {
        vi.useFakeTimers();
        const { result } = mount();
        await act(async () => undefined);
        expect(request).toHaveBeenCalledTimes(1);

        act(() => result.current.goForward());
        act(() => result.current.goForward());
        act(() => result.current.goForward());
        await act(async () => undefined);

        expect(result.current.done?.title).toBe('All 3 steps done');
        expect(result.current.done?.enjoy).toBe('Weeknight roast. Enjoy it.');
        expect(result.current.done?.screenOff).toBe('The screen can turn off again.');
        expect(release).toHaveBeenCalledTimes(1);

        act(() => result.current.done?.cookAgain.onPress());
        expect(result.current.done, 'a press inside the settle is ignored').not.toBeNull();

        await act(async () => vi.advanceTimersByTimeAsync(DONE_SETTLE_MS));
        act(() => result.current.done?.cookAgain.onPress());
        await act(async () => undefined);

        expect(result.current.done).toBeNull();
        expect(result.current.announcement).toBe('Step 1 of 3. Heat the oil.');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('titles a one-step recipe "All done"', () => {
        const { result } = mount({ ...RECIPE, steps: [{ stepNumber: 1, instruction: 'Simmer the soup.' }] });

        act(() => result.current.goForward());

        expect(result.current.done?.title).toBe('All done');
    });
});

/**
 * S3a.U3 case 9 (R12a): a timer belongs to the cook's device session, not to the cooking screen. Finish and
 * "Cook it again" leave a running, a paused and a ringing timer as they were, during the Done settle and after it.
 */
describe('a timer across Finish and Cook it again', () => {
    const { kept } = makeKeptStore();
    const timerWrapper = ({ children }: { readonly children: ReactNode }) => (
        <LocaleProvider locale="en">
            <TimerProvider subject="user_1" kept={kept}>
                {children}
            </TimerProvider>
        </LocaleProvider>
    );
    const STEP = {
        recipeId: 'rec_1',
        stepIndex: 0,
        stepDigest: 's1:0000000d',
        label: undefined,
        origin: 'added',
    } as const;

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'wakeLock');
    });

    it.each([
        [
            'running',
            (timers: ReturnType<typeof useCookingTimers>) => timers.start({ ...STEP, durationMs: 90 * 60_000 }),
        ],
        [
            'paused',
            (timers: ReturnType<typeof useCookingTimers>) => {
                const id = timers.start({ ...STEP, durationMs: 90 * 60_000 }) ?? '';

                timers.command({ kind: 'pause', id, run: 1 });
            },
        ],
        ['ringing', (timers: ReturnType<typeof useCookingTimers>) => timers.start({ ...STEP, durationMs: 5_000 })],
    ])('leaves a %s timer as it was, in the settle window and after it', async (kind, begin) => {
        vi.useFakeTimers();
        const { result } = renderHook(
            () => ({
                screen: useCookingSessionScreen({ recipe: RECIPE, onLeave: vi.fn() }),
                timers: useCookingTimers(),
            }),
            { wrapper: timerWrapper },
        );

        act(() => {
            begin(result.current.timers);
        });

        if (kind === 'ringing') {
            await act(async () => vi.advanceTimersByTimeAsync(5_000));
        }

        const before = result.current.timers.order;

        expect(before).toHaveLength(1);
        act(() => {
            result.current.screen.goForward();
        });
        act(() => {
            result.current.screen.goForward();
        });
        act(() => {
            result.current.screen.goForward();
        });
        act(() => {
            result.current.screen.done?.cookAgain.onPress();
        });

        expect(result.current.timers.order, 'inside the settle').toEqual(before);

        await act(async () => vi.advanceTimersByTimeAsync(DONE_SETTLE_MS));
        act(() => {
            result.current.screen.done?.cookAgain.onPress();
        });

        expect(result.current.screen.done).toBeNull();
        expect(result.current.timers.order, 'after the settle').toEqual(before);
    });
});
