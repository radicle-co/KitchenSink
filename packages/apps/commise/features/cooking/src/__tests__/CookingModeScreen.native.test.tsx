/**
 * Component tests for the NATIVE {@link CookingModeScreen}, rendered through react-native-web under jsdom.
 *
 * Mirrors the web suite behaviour-for-behaviour, because the cross-platform rule is that a session fix on
 * one platform cannot silently miss the other. What differs is only the host idiom (a labelled `View`
 * rather than a `<section>`, `accessibilityLabel` rather than `aria-label` at the source) — the session
 * itself is the SAME `useCookingSession`, which is exactly the claim these tests exist to keep true.
 *
 * The `.native` specifier is explicit so `tsc` and the native Vitest resolver both land on the native
 * leaf; every relative import inside that leaf is redirected to its own `.native` sibling by the config's
 * Metro-style resolver, so the native components — and the Expo wake-lock adapter — are the ones composed
 * here. Real OS keep-awake behaviour stays a device/Maestro concern; the port is injected as a fake.
 */
import { LocaleProvider } from '@commise/i18n/react';
import {
    noopVoiceControl,
    serializeSession,
    type CookingSession,
    type CookingTimer,
    type CookingVoiceCommand,
    type VoiceCommandListener,
    type WakeLockDisposer,
    type WakeLockPort,
} from '@kitchensink/cooking-core';
import type { RecipeIngredientView, RecipeStepView } from '@kitchensink/recipe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingModeScreen } from '../CookingModeScreen.native';
import type { CookingModeScreenProps, CookingRecipeState } from '../useCookingSession';
import type { CookingVoiceControlPort, VoiceControlStatus } from '../voiceControlPolicy';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const RECIPE_ID = '01JQ0000000000000000000001';
const ONION_ID = '01JQ00000000000000000000I1';
const BUTTER_ID = '01JQ00000000000000000000I2';
const HOUR_MS = 60 * 60 * 1000;

/** Three steps, the second of which declares a one-minute timer. */
const makeSteps = (): readonly RecipeStepView[] => [
    { stepNumber: 1, instruction: 'Chop the onion' },
    { stepNumber: 2, instruction: 'Sweat the onion', timerSeconds: 60 },
    { stepNumber: 3, instruction: 'Serve' },
];

/** Two ingredient lines. */
const makeIngredients = (): readonly RecipeIngredientView[] => [
    { ingredientId: ONION_ID, name: 'Onion', quantity: 2, isUserEntered: false },
    { ingredientId: BUTTER_ID, name: 'Butter', quantity: 30, unit: 'g', isUserEntered: false },
];

/** A cooking session as device storage would hold it. */
const makeSession = (overrides: Partial<CookingSession> = {}): CookingSession => ({
    recipeId: RECIPE_ID,
    startedAt: new Date(Date.now() - HOUR_MS).toISOString(),
    currentStepIndex: 0,
    completedSteps: [],
    checkedIngredientIds: [],
    scaleFactor: 1,
    activeTimers: [],
    ...overrides,
});

/** A timer that finished an hour ago. */
const makeFinishedTimer = (overrides: Partial<CookingTimer> = {}): CookingTimer => ({
    id: 'step-2',
    label: 'Sweat the onion',
    stepNumber: 2,
    durationMs: 60_000,
    startedAt: new Date(Date.now() - HOUR_MS).toISOString(),
    isPaused: false,
    ...overrides,
});

/** An in-memory session store that records every call. */
const makeStore = (seeded?: CookingSession) => {
    const entries = new Map<string, string>();

    if (seeded !== undefined) {
        entries.set(seeded.recipeId, serializeSession(seeded));
    }

    return {
        entries,
        read: vi.fn(async (recipeId: string): Promise<string | null> => entries.get(recipeId) ?? null),
        write: vi.fn(async (recipeId: string, serialized: string): Promise<void> => {
            entries.set(recipeId, serialized);
        }),
        remove: vi.fn(async (recipeId: string): Promise<void> => {
            entries.delete(recipeId);
        }),
    };
};

/** A wake-lock port whose acquire/release calls are countable. */
const makeWakeLock = () => {
    const release = vi.fn(async (): Promise<void> => undefined);
    const acquire = vi.fn(async (): Promise<WakeLockDisposer> => release);

    return { port: acquire as WakeLockPort, acquire, release };
};

/** A voice-control port that records its lifetime and hands the test the recogniser's two callbacks. */
const makeVoiceControl = () => {
    const dispose = vi.fn();
    let emit: VoiceCommandListener | null = null;
    let report: ((status: VoiceControlStatus) => void) | null = null;

    const start = vi.fn((onCommand: VoiceCommandListener, onStatus?: (status: VoiceControlStatus) => void) => {
        emit = onCommand;
        report = onStatus ?? null;

        return dispose;
    });

    return {
        port: start as CookingVoiceControlPort,
        start,
        dispose,
        /** Delivers one recognised command, as the recogniser would. */
        say(command: CookingVoiceCommand): void {
            if (emit === null) {
                throw new Error('no voice session is listening');
            }

            emit(command);
        },
        /** Reports a session status, as the adapter does on denial or on an absent recogniser. */
        announce(status: VoiceControlStatus): void {
            if (report === null) {
                throw new Error('no voice session is listening');
            }

            report(status);
        },
    };
};

/** The session as it was last written to storage. */
const persistedSession = (store: ReturnType<typeof makeStore>): CookingSession => {
    const raw = store.entries.get(RECIPE_ID);

    if (raw === undefined) {
        throw new Error('no session was persisted');
    }

    return (JSON.parse(raw) as { session: CookingSession }).session;
};

/** Flushes the async restore chain and every effect it schedules. */
const settle = async (): Promise<void> => {
    await act(async () => {
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
    });
};

/** Advances the fake clock (and the countdown tick), then settles the resulting work. */
const tick = async (ms: number): Promise<void> => {
    await act(() => {
        vi.advanceTimersByTime(ms);
    });
    await settle();
};

const renderScreen = (overrides: Partial<CookingModeScreenProps> = {}) => {
    const recipe: CookingRecipeState = overrides.recipe ?? {
        status: 'ready',
        steps: makeSteps(),
        ingredients: makeIngredients(),
    };
    const props: CookingModeScreenProps = {
        recipeId: RECIPE_ID,
        recipe,
        sessionStore: overrides.sessionStore ?? makeStore(),
        onRetry: overrides.onRetry ?? vi.fn(),
        onExit: overrides.onExit ?? vi.fn(),
        onFinish: overrides.onFinish ?? vi.fn(),
        wakeLock: overrides.wakeLock ?? makeWakeLock().port,
        voiceControl: overrides.voiceControl,
    };

    return render(
        <LocaleProvider locale="en">
            <CookingModeScreen {...props} />
        </LocaleProvider>,
    );
};

/** The instruction currently on screen, read through its accessible name. */
const shownInstruction = (): string => screen.getByLabelText('Current step instruction').textContent ?? '';

describe('CookingModeScreen (native) — surface selection', () => {
    it('mounts at the FIRST step, inside a named Cooking Mode surface', async () => {
        renderScreen();
        await settle();

        expect(screen.getByLabelText('Cooking mode')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Step 1 of 3' })).toBeTruthy();
        expect(shownInstruction()).toContain('Chop the onion');
    });

    it('selects the LOADING surface while the recipe is arriving, and offers no navigation', async () => {
        renderScreen({ recipe: { status: 'loading' } });
        await settle();

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Ingredients' })).toBeNull();
    });

    it('selects the ERROR surface, and its retry reports upward', async () => {
        const onRetry = vi.fn();
        renderScreen({ recipe: { status: 'error' }, onRetry });
        await settle();

        expect(screen.getByRole('alert').textContent).toContain("We couldn't load this recipe.");

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('selects the EMPTY surface for a recipe with no steps', async () => {
        renderScreen({ recipe: { status: 'ready', steps: [], ingredients: [] } });
        await settle();

        expect(screen.getByRole('heading', { name: 'This recipe has no steps yet' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('keeps the exit affordance on EVERY surface, so a cook is never trapped', async () => {
        renderScreen({ recipe: { status: 'error' } });
        await settle();

        expect(screen.getByRole('button', { name: 'Exit cooking mode' })).toBeTruthy();
    });
});

describe('CookingModeScreen (native) — navigation wiring (FR-033)', () => {
    it('advances the RENDERED step when the next zone is pressed', async () => {
        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();

        expect(screen.getByRole('heading', { name: 'Step 2 of 3' })).toBeTruthy();
        expect(shownInstruction()).toContain('Sweat the onion');
    });

    it('goes back to the previous step', async () => {
        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
        await settle();

        expect(screen.getByRole('heading', { name: 'Step 1 of 3' })).toBeTruthy();
    });

    it('does not move on the first step, where the previous zone refuses the press', async () => {
        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
        await settle();

        expect(screen.getByRole('heading', { name: 'Step 1 of 3' })).toBeTruthy();
    });

    it('replaces the next zone with the FINISH affordance on the last step, which ends the session', async () => {
        const store = makeStore();
        const onFinish = vi.fn();
        renderScreen({ sessionStore: store, onFinish });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();

        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Finish cooking' }));
        await settle();

        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
        expect(store.entries.has(RECIPE_ID)).toBe(false);
    });

    it('exits mid-cook by PERSISTING a paused session rather than discarding it', async () => {
        const store = makeStore();
        const onExit = vi.fn();
        renderScreen({ sessionStore: store, onExit });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Exit cooking mode' }));
        await settle();

        expect(onExit).toHaveBeenCalledTimes(1);
        expect(store.remove).not.toHaveBeenCalled();
        expect(persistedSession(store).currentStepIndex).toBe(1);
        expect(typeof persistedSession(store).pausedAt).toBe('string');
    });
});

describe('CookingModeScreen (native) — screen wake lock (FR-035)', () => {
    it('acquires the INJECTED lock once the session is live, and releases it on unmount', async () => {
        const wakeLock = makeWakeLock();
        const { unmount } = renderScreen({ wakeLock: wakeLock.port });
        await settle();

        expect(wakeLock.acquire).toHaveBeenCalledTimes(1);
        expect(wakeLock.release).not.toHaveBeenCalled();

        await act(async () => {
            unmount();
        });
        await settle();

        expect(wakeLock.release).toHaveBeenCalledTimes(1);
    });
});

describe('CookingModeScreen (native) — session resume (FR-033 / REQ-013)', () => {
    it('opens on the step a resumable session was left on', async () => {
        const store = makeStore(makeSession({ currentStepIndex: 2, completedSteps: [0, 1] }));
        renderScreen({ sessionStore: store });
        await settle();

        expect(screen.getByRole('heading', { name: 'Step 3 of 3' })).toBeTruthy();
        expect(store.remove).not.toHaveBeenCalled();
    });

    it('starts fresh at step 1 when the stored session has aged out of the window', async () => {
        const expired = new Date(Date.now() - 25 * HOUR_MS).toISOString();
        const store = makeStore(makeSession({ currentStepIndex: 2, startedAt: expired, pausedAt: expired }));
        renderScreen({ sessionStore: store });
        await settle();

        expect(screen.getByRole('heading', { name: 'Step 1 of 3' })).toBeTruthy();
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
    });
});

describe('CookingModeScreen (native) — timers (FR-034)', () => {
    it('offers no timer control on a step that declares none', async () => {
        renderScreen();
        await settle();

        expect(screen.queryByRole('button', { name: 'Start timer' })).toBeNull();
    });

    it('starts a step timer and shows it in the ACTIVE TIMERS list, counting down', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();

        expect(screen.getByRole('list', { name: 'Active timers' })).toBeTruthy();
        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('1:00');

        await tick(20_000);

        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('0:40');
    });

    it('does NOT start a second countdown for the same step, and does not surface an error', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();
        await tick(10_000);
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();

        expect(screen.getAllByRole('timer')).toHaveLength(1);
        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('0:50');
    });

    it('pauses, resumes and cancels the timer through the list controls', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();
        await tick(20_000);

        fireEvent.click(screen.getByRole('button', { name: 'Pause timer' }));
        await settle();
        await tick(30_000);

        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('0:40');

        fireEvent.click(screen.getByRole('button', { name: 'Resume timer' }));
        await settle();
        await tick(10_000);

        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('0:30');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel timer' }));
        await settle();

        expect(screen.queryByRole('list', { name: 'Active timers' })).toBeNull();
    });
});

describe('CookingModeScreen (native) — the completion alert fires exactly ONCE (REQ-006)', () => {
    it('announces the finished timer, then never announces it again however long the cook waits', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();

        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();

        await tick(61_000);

        expect(screen.getByRole('alert').textContent).toContain('Sweat the onion timer finished');

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        await settle();

        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();

        for (let pass = 0; pass < 6; pass += 1) {
            await tick(10_000);
            expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
        }

        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('0:00');
    });

    it('does NOT re-announce a timer that was already acknowledged before the interruption', async () => {
        const store = makeStore(
            makeSession({
                activeTimers: [makeFinishedTimer({ alertedAt: new Date(Date.now() - HOUR_MS).toISOString() })],
            }),
        );
        renderScreen({ sessionStore: store });
        await settle();

        expect(screen.getByRole('timer', { name: 'Sweat the onion' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });

    it('DOES announce a restored timer that finished but was never acknowledged (the control case)', async () => {
        const store = makeStore(makeSession({ activeTimers: [makeFinishedTimer()] }));
        renderScreen({ sessionStore: store });
        await settle();

        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    });
});

describe('CookingModeScreen (native) — ingredient checkoff and yield scaling (FR-032a, FR-034a)', () => {
    it('opens the checklist, round-trips a checkoff, and closes without leaving the step', async () => {
        const store = makeStore();
        renderScreen({ sessionStore: store });
        await settle();

        expect(screen.queryByLabelText('Ingredient checklist')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
        await settle();

        expect(screen.getByLabelText('Ingredient checklist')).toBeTruthy();
        expect(screen.getByLabelText('0 of 2 checked')).toBeTruthy();

        fireEvent.click(screen.getByRole('checkbox', { name: '2 Onion' }));
        await settle();

        expect(screen.getByRole('checkbox', { name: '2 Onion' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByLabelText('1 of 2 checked')).toBeTruthy();
        expect(persistedSession(store).checkedIngredientIds).toEqual([ONION_ID]);

        fireEvent.click(screen.getByRole('checkbox', { name: '2 Onion' }));
        await settle();

        expect(screen.getByRole('checkbox', { name: '2 Onion' }).getAttribute('aria-checked')).toBe('false');
        expect(persistedSession(store).checkedIngredientIds).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Close ingredients' }));
        await settle();

        expect(screen.queryByLabelText('Ingredient checklist')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Step 1 of 3' })).toBeTruthy();
    });

    it('scales the DISPLAYED quantities, leaving cook times alone (D-002)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const store = makeStore();
        renderScreen({ sessionStore: store });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
        await settle();

        expect(screen.getByRole('checkbox', { name: '2 Onion' })).toBeTruthy();

        fireEvent.click(screen.getByRole('radio', { name: '2x' }));
        await settle();

        expect(screen.getByRole('checkbox', { name: '4 Onion' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '60 g Butter' })).toBeTruthy();
        expect(persistedSession(store).scaleFactor).toBe(2);
        expect(screen.getByRole('timer', { name: 'Sweat the onion' }).textContent).toBe('1:00');
    });
});

describe('CookingModeScreen (native) — voice control (US-006 / D-004)', () => {
    it('offers voice as an explicit OPT-IN: the toggle is off, and nothing is listening on arrival', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        expect(screen.getByRole('button', { name: 'Voice control Off' })).toBeTruthy();
        expect(voice.start).not.toHaveBeenCalled();
    });

    it('starts listening only when the cook presses the toggle — the press IS the consent', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Voice control Off' }));
        await settle();

        expect(voice.start).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Voice control Listening' }).getAttribute('aria-pressed')).toBe(
            'true',
        );
    });

    it('stops listening when the toggle is pressed again', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Voice control Off' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Voice control Listening' }));
        await settle();

        expect(voice.dispose).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Voice control Off' })).toBeTruthy();
    });

    it('advances the RENDERED step on a spoken "next", exactly as the tap zone does', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Voice control Off' }));
        await settle();

        await act(async () => {
            voice.say('next');
        });
        await settle();

        expect(shownInstruction()).toContain('Sweat the onion');
    });

    it('re-announces the current step ASSERTIVELY on "repeat", and announces nothing before it is asked', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Voice control Off' }));
        await settle();

        expect(screen.queryByText('Step 1 of 3. Chop the onion')).toBeNull();

        await act(async () => {
            voice.say('repeat');
        });
        await settle();

        const announcement = screen.getByText('Step 1 of 3. Chop the onion');

        expect(announcement.closest('[aria-live]')?.getAttribute('aria-live')).toBe('assertive');
    });

    it('shows a DENIED microphone in words and refuses to re-ask (US-006 degrades, it never breaks)', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Voice control Off' }));
        await settle();

        await act(async () => {
            voice.announce('denied');
        });
        await settle();

        const control = screen.getByRole('button', { name: 'Voice control Microphone blocked' });

        expect(control.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(control);
        await settle();

        expect(voice.start).toHaveBeenCalledTimes(1);
        // Tap navigation is untouched by a failed microphone.
        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();

        expect(shownInstruction()).toContain('Sweat the onion');
    });

    it('renders the toggle as UNAVAILABLE — never absent — where the platform has no recogniser', async () => {
        renderScreen({ voiceControl: noopVoiceControl });
        await settle();

        expect(screen.getByRole('button', { name: 'Voice control Not available' }).getAttribute('aria-disabled')).toBe(
            'true',
        );
    });

    it('disposes the recogniser when the cook leaves cooking mode', async () => {
        const voice = makeVoiceControl();
        renderScreen({ voiceControl: voice.port });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Voice control Off' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Exit cooking mode' }));
        await settle();

        expect(voice.dispose).toHaveBeenCalledTimes(1);
    });
});

describe('CookingModeScreen (native) — Cooking Mode is READ-ONLY on the recipe (REQ-CN-001)', () => {
    it('issues no request, and never mutates the steps or ingredients it was handed', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const steps = makeSteps();
        const ingredients = makeIngredients();
        const stepsSnapshot = structuredClone(steps) as RecipeStepView[];
        const ingredientsSnapshot = structuredClone(ingredients) as RecipeIngredientView[];
        renderScreen({ recipe: { status: 'ready', steps, ingredients } });
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
        await settle();
        fireEvent.click(screen.getByRole('checkbox', { name: '2 Onion' }));
        await settle();
        fireEvent.click(screen.getByRole('radio', { name: '3x' }));
        await settle();
        await tick(61_000);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Exit cooking mode' }));
        await settle();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(steps).toEqual(stepsSnapshot);
        expect(ingredients).toEqual(ingredientsSnapshot);
    });
});
