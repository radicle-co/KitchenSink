/**
 * The headless hook behind the timer dock: it turns the timer list into rows with working controls, starts a timer
 * from the step's offer, and owns every effect of the dock (priming the alarm sound inside the cook's tap, the
 * cancel snackbar with its Undo, and where focus goes next). Run over a real timer store and a real `SnackbarHost`.
 * Mutation lens: a start that skips `prime` fails the order rows; a restore that skips it fails the Undo row; a
 * cancel that shows no snackbar fails the cancel row; an Undo that never times out into `discardUndo` fails the
 * timeout row; a digest taken from the raw index fails the blank-step row; focus left on a gone control fails the
 * focus rows.
 */
import { stepDigestsOf } from '@kitchensink/cooking-core';
import { SnackbarHost } from '@commise/ui/snackbar';
import { act, cleanup, render, renderHook, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../../__fixtures__/makeCookingRecipe.js';
import { AlarmSoundContext, type AlarmSound } from '../alarmSound.js';
import { TimerStoreContext } from '../timerContext.js';
import { timerStepOf } from '../timerStep.js';
import { createTimerStore, type TimerStore } from '../timerStore.js';
import { useCookingTimerDock, type TimerDock, type TimerDockInput } from '../useCookingTimerDock.js';

const MINUTE = 60_000;
const recipe = makeCookingRecipe({
    steps: [
        { stepNumber: 1, instruction: 'Chop.' },
        { stepNumber: 2, instruction: '   ' },
        { stepNumber: 3, instruction: 'Roast 20 minutes.' },
    ],
});

beforeEach(() => {
    vi.useFakeTimers({
        now: Date.parse('2026-11-27T10:00:00.000Z'),
        toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** One store and one spy sound, both logging into the same list so the ORDER of a tap's effects can be read. */
function setup(overrides: Partial<TimerDockInput> = {}) {
    const log: string[] = [];
    const real: TimerStore = createTimerStore();
    const disconnect = real.connect();
    const store: TimerStore = {
        ...real,
        start: (timer) => {
            log.push('start');

            return real.start(timer);
        },
        command: (call) => {
            log.push(call.kind);
            real.command(call);
        },
    };
    const sound: AlarmSound = {
        prime: () => log.push('prime'),
        play: () => log.push('play'),
        stop: () => log.push('stop'),
    };
    const input: TimerDockInput = { recipe, stepIndex: 1, offerMs: 20 * MINUTE, locale: 'en', ...overrides };
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <TimerStoreContext value={store}>
            <AlarmSoundContext value={sound}>
                <SnackbarHost>{children}</SnackbarHost>
            </AlarmSoundContext>
        </TimerStoreContext>
    );
    const hook = renderHook(() => useCookingTimerDock(input), { wrapper });
    const dock = (): TimerDock => hook.result.current;

    return { store, real, log, dock, hook, disconnect };
}

const press = (control: { readonly onPress: () => void }): void => {
    act(() => {
        control.onPress();
    });
};

describe('useCookingTimerDock: the offer', () => {
    it('shows the offer while no timer is live, and hides it once one runs', () => {
        const { dock } = setup();

        expect(dock().offer?.label).toBe('Time 20 min');
        expect(dock().rows).toEqual([]);

        press(dock().offer ?? { onPress: vi.fn() });

        expect(dock().offer).toBeUndefined();
        expect(dock().rows).toHaveLength(1);
    });

    it('shows no offer when the step has no length', () => {
        expect(setup({ offerMs: undefined }).dock().offer).toBeUndefined();
    });

    it('primes the alarm sound inside the tap, BEFORE the timer starts', () => {
        const { dock, log } = setup();

        press(dock().offer ?? { onPress: vi.fn() });

        expect(log).toEqual(['prime', 'start']);
    });

    it('starts the timer on this step with the step length, as an offered timer', () => {
        const { dock, real } = setup();

        press(dock().offer ?? { onPress: vi.fn() });

        expect(real.getSnapshot().timers[0]).toMatchObject({
            kind: 'running',
            recipeId: 'r1',
            stepIndex: 1,
            durationMs: 20 * MINUTE,
            origin: { kind: 'offer', lineIndex: null },
        });
    });

    it('stores the digest of the step it starts on, so a blank step before it cannot shift the match', () => {
        const { dock, real } = setup();

        press(dock().offer ?? { onPress: vi.fn() });
        const timer = real.getSnapshot().timers[0];

        expect(timer?.stepDigest).toBe(stepDigestsOf(recipe.steps)[1]);
        expect(timer && timerStepOf(timer, recipe)).toEqual({ number: 2, lines: ['Roast 20 minutes.'] });
    });

    it('asks for focus on the new row’s primary control, and lowers the request when it is taken', () => {
        const { dock } = setup();

        press(dock().offer ?? { onPress: vi.fn() });

        expect(dock().rows[0]?.primary.focusRequested).toBe(true);

        act(() => {
            dock().rows[0]?.primary.onFocusRequestHandled();
        });

        expect(dock().rows[0]?.primary.focusRequested).toBe(false);
    });
});

describe('useCookingTimerDock: the row controls', () => {
    const started = () => {
        const made = setup();

        press(made.dock().offer ?? { onPress: vi.fn() });
        made.log.length = 0;

        return made;
    };

    it('pauses and resumes the timer, sending only this timer’s id and run, and primes before a resume', () => {
        const { dock, real, log } = started();

        press(dock().rows[0]?.primary ?? { onPress: vi.fn() });

        expect(real.getSnapshot().timers[0]?.kind).toBe('paused');

        press(dock().rows[0]?.primary ?? { onPress: vi.fn() });

        expect(real.getSnapshot().timers[0]?.kind).toBe('running');
        expect(log).toEqual(['pause', 'prime', 'resume']);
    });

    it('Stop ends a ringing timer and takes it out of the list', () => {
        const { dock, real } = started();

        act(() => {
            vi.advanceTimersByTime(21 * MINUTE);
        });

        expect(dock().rows[0]?.kind).toBe('done');

        press(dock().rows[0]?.primary ?? { onPress: vi.fn() });

        expect(real.getSnapshot().timers).toEqual([]);
        expect(dock().rows).toEqual([]);
    });

    it('counts the time left down once a second', () => {
        const { dock } = started();

        expect(dock().rows[0]?.figure).toBe('20:00');

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(dock().rows[0]?.figure).toBe('19:57');
    });
});

describe('useCookingTimerDock: Cancel and Undo', () => {
    const cancelled = () => {
        const made = setup();

        press(made.dock().offer ?? { onPress: vi.fn() });
        made.log.length = 0;
        press(made.dock().rows[0]?.secondary ?? { onPress: vi.fn() });

        return made;
    };

    it('cancels the timer and says so in a snackbar with Undo', () => {
        const { real } = cancelled();

        expect(real.getSnapshot().timers).toEqual([]);
        expect(real.getSnapshot().undo?.kind).toBe('running');
        expect(screen.getByText('Step 2 timer cancelled')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    });

    it('Undo brings the timer back, primes the sound first, and focuses the restored primary control', () => {
        const { real, dock, log } = cancelled();

        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        });

        expect(log).toEqual(['cancel', 'prime', 'restore']);
        expect(real.getSnapshot().timers).toHaveLength(1);
        expect(dock().rows[0]?.primary.focusRequested).toBe(true);
    });

    it('lets the cancel commit when the snackbar times out: the held Undo timer is discarded', () => {
        const { real } = cancelled();

        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect(real.getSnapshot().undo).toBeUndefined();
    });

    it('sends focus to the offer that comes back, never to Undo', () => {
        const { dock } = cancelled();

        expect(dock().offer?.focusRequested).toBe(true);
        expect(dock().forward.requested).toBe(false);

        act(() => {
            dock().offer?.onFocusRequestHandled();
        });

        expect(dock().offer?.focusRequested).toBe(false);
    });

    it('sends focus to the next forward control when there is no offer to return to', () => {
        const { dock, real } = setup({ offerMs: undefined });

        act(() => {
            real.start({
                recipeId: 'r1',
                stepIndex: 1,
                stepDigest: stepDigestsOf(recipe.steps)[1] ?? '',
                label: undefined,
                origin: { kind: 'added' },
                durationMs: 5 * MINUTE,
            });
        });
        press(dock().rows[0]?.secondary ?? { onPress: vi.fn() });

        expect(dock().offer).toBeUndefined();
        expect(dock().forward.requested).toBe(true);

        act(() => {
            dock().forward.onHandled();
        });

        expect(dock().forward.requested).toBe(false);
    });
});

describe('useCookingTimerDock: leaving', () => {
    it('withdraws the Undo snackbar and discards the held timer when the dock unmounts', () => {
        const { dock, hook, real } = setup();

        press(dock().offer ?? { onPress: vi.fn() });
        press(dock().rows[0]?.secondary ?? { onPress: vi.fn() });
        hook.unmount();

        expect(real.getSnapshot().undo).toBeUndefined();
    });
});

describe('useCookingTimerDock: a screen', () => {
    it('renders from the hook’s rows', () => {
        function Probe(): ReactNode {
            const dock = useCookingTimerDock({ recipe, stepIndex: 1, offerMs: 20 * MINUTE, locale: 'en' });

            return <p>{dock.offer?.label ?? 'no offer'}</p>;
        }

        const store = createTimerStore();

        render(
            <TimerStoreContext value={store}>
                <SnackbarHost>
                    <Probe />
                </SnackbarHost>
            </TimerStoreContext>,
        );

        expect(screen.getByText('Time 20 min')).toBeTruthy();
    });
});
