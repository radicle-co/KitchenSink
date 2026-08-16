/**
 * Unit tests for {@link useCookingSession} — the headless half of Cooking Mode's orchestration
 * (FR-032, FR-032a, FR-033, FR-034, FR-034a, FR-035 / REQ-006, REQ-007, REQ-013, REQ-CN-001).
 *
 * This is the integration point of the feature, so these tests assert the WIRING: which pure reducer runs
 * on which intent, what reaches the injected storage and wake-lock ports, and — the case the whole
 * `alertedAt` field exists for — that a completion alert fires exactly ONCE and never re-announces after
 * a resume. Every assertion is written to fail if the wiring is wrong: specific ids, specific persisted
 * payloads, specific call counts. "It rendered" is never the assertion.
 *
 * The clock is the real one (the orchestration layer is where a real clock belongs); tests that need to
 * move it use Vitest's fake timers, which fake `Date` alongside `setInterval`. RTL's `waitFor` is
 * deliberately NOT used with fake timers — it cannot detect Vitest's clock and would hang on a faked
 * `setInterval` — so pending work is flushed explicitly through {@link settle}.
 */
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
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCookingSession, type CookingRecipeState, type UseCookingSessionOptions } from '../useCookingSession';
import type { CookingVoiceControlPort, VoiceControlStatus } from '../voiceControlPolicy';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const RECIPE_ID = '01JQ0000000000000000000001';
const HOUR_MS = 60 * 60 * 1000;

/** A recipe step. `stepNumber` is 1-based, matching the wire projection. */
const makeStep = (overrides: Partial<RecipeStepView> = {}): RecipeStepView => ({
    stepNumber: 1,
    instruction: 'Chop the onion',
    ...overrides,
});

/** An ingredient line. */
const makeIngredient = (overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView => ({
    ingredientId: '01JQ00000000000000000000I1',
    name: 'Onion',
    quantity: 2,
    isUserEntered: false,
    ...overrides,
});

/** Three steps, the second of which declares a one-minute timer. */
const makeSteps = (): readonly RecipeStepView[] =>
    Object.freeze([
        Object.freeze(makeStep({ stepNumber: 1, instruction: 'Chop the onion' })),
        Object.freeze(makeStep({ stepNumber: 2, instruction: 'Sweat the onion', timerSeconds: 60 })),
        Object.freeze(makeStep({ stepNumber: 3, instruction: 'Serve' })),
    ]);

/** Two ingredient lines. */
const makeIngredients = (): readonly RecipeIngredientView[] =>
    Object.freeze([
        Object.freeze(makeIngredient({ ingredientId: '01JQ00000000000000000000I1', name: 'Onion', quantity: 2 })),
        Object.freeze(
            makeIngredient({ ingredientId: '01JQ00000000000000000000I2', name: 'Butter', quantity: 30, unit: 'g' }),
        ),
    ]);

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

/** A running timer, by default one that finished an hour ago. */
const makeTimer = (overrides: Partial<CookingTimer> = {}): CookingTimer => ({
    id: 'step-2',
    label: 'Sweat the onion',
    stepNumber: 2,
    durationMs: 60_000,
    startedAt: new Date(Date.now() - HOUR_MS).toISOString(),
    isPaused: false,
    ...overrides,
});

/** An in-memory {@link CookingSessionStore} that records every call. */
const makeStore = (seeded?: CookingSession) => {
    const entries = new Map<string, string>();

    if (seeded !== undefined) {
        entries.set(seeded.recipeId, serializeSession(seeded));
    }

    const store = {
        entries,
        read: vi.fn(async (recipeId: string): Promise<string | null> => entries.get(recipeId) ?? null),
        write: vi.fn(async (recipeId: string, serialized: string): Promise<void> => {
            entries.set(recipeId, serialized);
        }),
        remove: vi.fn(async (recipeId: string): Promise<void> => {
            entries.delete(recipeId);
        }),
    };

    return store;
};

/** A {@link WakeLockPort} whose acquire/release calls are countable. */
const makeWakeLock = () => {
    const release = vi.fn(async (): Promise<void> => undefined);
    const acquire = vi.fn(async (): Promise<WakeLockDisposer> => release);

    return { port: acquire as WakeLockPort, acquire, release };
};

/**
 * A voice-control port that records its lifetime and hands the test the recogniser's two callbacks.
 *
 * The real adapters are proven against their own platform fakes in `voiceControl(.native).test.tsx`;
 * what the hook owes is the WIRING — that nothing starts before the cook asks, that every command
 * reaches the right session action, and that the session is disposed exactly once per stop.
 */
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

/**
 * Flushes the pending microtask queue (the async restore chain) and every effect it schedules.
 *
 * Ten turns is comfortably more than the restore's `read → deserialize → setState → persist` chain, and
 * costs nothing when the queue is already empty.
 */
const settle = async (): Promise<void> => {
    await act(async () => {
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
    });
};

/** Advances the fake clock (and therefore the tick interval), then settles the resulting work. */
const tick = async (ms: number): Promise<void> => {
    await act(() => {
        vi.advanceTimersByTime(ms);
    });
    await settle();
};

/** Mounts the hook. The options object is rebuilt on every render on purpose — a churning `recipe`
 * identity must not restart the restore, which is what the stable-key wiring exists to guarantee. */
const renderSession = (overrides: Partial<UseCookingSessionOptions> = {}) => {
    const store = overrides.store ?? makeStore();
    const wakeLock = overrides.wakeLock ?? makeWakeLock().port;
    const onExit = overrides.onExit ?? vi.fn();
    const onFinish = overrides.onFinish ?? vi.fn();
    const recipe: CookingRecipeState = overrides.recipe ?? {
        status: 'ready',
        steps: makeSteps(),
        ingredients: makeIngredients(),
    };

    const voiceControl = overrides.voiceControl;

    return renderHook(() =>
        useCookingSession({
            recipeId: overrides.recipeId ?? RECIPE_ID,
            // Spread fresh each render so a host that re-creates the object cannot restart the session.
            recipe: { ...recipe },
            store,
            wakeLock,
            voiceControl,
            onExit,
            onFinish,
        }),
    );
};

describe('useCookingSession — opening a session (FR-032 / REQ-008)', () => {
    it('mounts at the FIRST step of the recipe', async () => {
        const { result } = renderSession();
        await settle();

        expect(result.current.surface).toEqual({
            kind: 'step',
            step: makeStep({ stepNumber: 1, instruction: 'Chop the onion' }),
            stepIndex: 0,
            stepCount: 3,
        });
    });

    it('shows the LOADING surface while the recipe is arriving, and asks storage nothing', async () => {
        const store = makeStore();
        const { result } = renderSession({ recipe: { status: 'loading' }, store });
        await settle();

        expect(result.current.surface.kind).toBe('loading');
        expect(store.read).not.toHaveBeenCalled();
    });

    it('shows the ERROR surface when the recipe could not be loaded', async () => {
        const { result } = renderSession({ recipe: { status: 'error' } });
        await settle();

        expect(result.current.surface.kind).toBe('error');
    });

    it('shows the EMPTY surface for a recipe with no steps, and opens NO session for it', async () => {
        const store = makeStore();
        const { result } = renderSession({ recipe: { status: 'ready', steps: [], ingredients: [] }, store });
        await settle();

        expect(result.current.surface.kind).toBe('empty');
        // `createSession` rejects a zero step count; opening one anyway would throw mid-render.
        expect(store.read).not.toHaveBeenCalled();
        expect(store.write).not.toHaveBeenCalled();
    });

    it('stays on the LOADING surface until the device has answered about a resumable session', () => {
        const { result } = renderSession();

        // Not settled: the restore promise is still in flight.
        expect(result.current.surface.kind).toBe('loading');
    });
});

describe('useCookingSession — step navigation (FR-033 / REQ-002, REQ-003)', () => {
    it('advances to the next step and records the step just left', async () => {
        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.goToNextStep();
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 1 });
        expect(persistedSession(store).completedSteps).toEqual([0]);
    });

    it('goes back WITHOUT discarding the progress already recorded', async () => {
        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.goToNextStep();
        });
        await settle();
        await act(async () => {
            result.current.goToPreviousStep();
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
        expect(persistedSession(store).completedSteps).toEqual([0]);
    });

    it('clamps at the first step rather than producing a negative index', async () => {
        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.goToPreviousStep();
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
    });

    it('persists the position on EVERY move, so a resume lands where the cook left', async () => {
        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.goToNextStep();
        });
        await settle();
        await act(async () => {
            result.current.goToNextStep();
        });
        await settle();

        expect(persistedSession(store).currentStepIndex).toBe(2);
    });
});

describe('useCookingSession — ending the session', () => {
    it('finish() CLEARS the stored session and reports upward', async () => {
        const store = makeStore();
        const onFinish = vi.fn();
        const { result } = renderSession({ store, onFinish });
        await settle();

        await act(async () => {
            result.current.finish();
        });
        await settle();

        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
        expect(store.entries.has(RECIPE_ID)).toBe(false);
    });

    it('finish() clears AFTER every pending write, so no in-flight persist resurrects the session', async () => {
        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.goToNextStep();
            result.current.finish();
        });
        await settle();

        expect(store.entries.has(RECIPE_ID)).toBe(false);
    });

    it('exit() PERSISTS a paused session, so it stays resumable, and reports upward', async () => {
        const store = makeStore();
        const onExit = vi.fn();
        const { result } = renderSession({ store, onExit });
        await settle();

        await act(async () => {
            result.current.goToNextStep();
        });
        await settle();
        await act(async () => {
            result.current.exit();
        });
        await settle();

        expect(onExit).toHaveBeenCalledTimes(1);
        expect(store.remove).not.toHaveBeenCalled();
        expect(persistedSession(store)).toMatchObject({ currentStepIndex: 1 });
        expect(typeof persistedSession(store).pausedAt).toBe('string');
    });

    it('is inert after the session ended — a late press writes nothing and moves nothing', async () => {
        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.finish();
        });
        await settle();

        const writesAfterFinish = store.write.mock.calls.length;

        await act(async () => {
            result.current.goToNextStep();
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
            result.current.changeScaleFactor(2);
        });
        await settle();

        expect(result.current.surface).toMatchObject({ stepIndex: 0 });
        expect(store.write.mock.calls).toHaveLength(writesAfterFinish);
    });
});

describe('useCookingSession — screen wake lock (FR-035 / REQ-007, REQ-CN-002)', () => {
    it('acquires the lock ONCE the session is live, through the INJECTED port', async () => {
        const wakeLock = makeWakeLock();
        renderSession({ wakeLock: wakeLock.port });

        // Nothing is held while the session is still being restored.
        expect(wakeLock.acquire).not.toHaveBeenCalled();

        await settle();

        expect(wakeLock.acquire).toHaveBeenCalledTimes(1);
        expect(wakeLock.release).not.toHaveBeenCalled();
    });

    it('releases the lock on unmount', async () => {
        const wakeLock = makeWakeLock();
        const { unmount } = renderSession({ wakeLock: wakeLock.port });
        await settle();

        await act(async () => {
            unmount();
        });
        await settle();

        expect(wakeLock.release).toHaveBeenCalledTimes(1);
    });

    it('releases the lock when the cook finishes, without waiting for an unmount', async () => {
        const wakeLock = makeWakeLock();
        const { result } = renderSession({ wakeLock: wakeLock.port });
        await settle();

        await act(async () => {
            result.current.finish();
        });
        await settle();

        expect(wakeLock.release).toHaveBeenCalledTimes(1);
    });

    it('never acquires a lock for a recipe that has no session to keep awake', async () => {
        const wakeLock = makeWakeLock();
        renderSession({ recipe: { status: 'ready', steps: [], ingredients: [] }, wakeLock: wakeLock.port });
        await settle();

        expect(wakeLock.acquire).not.toHaveBeenCalled();
    });
});

describe('useCookingSession — resume within the 24h window (FR-033 / REQ-013)', () => {
    it('restores a resumable session to the step it was left on', async () => {
        const store = makeStore(
            makeSession({
                currentStepIndex: 2,
                completedSteps: [0, 1],
                pausedAt: new Date(Date.now() - HOUR_MS).toISOString(),
            }),
        );
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 2 });
        expect(store.remove).not.toHaveBeenCalled();
    });

    it('restores the checked ingredients and the yield factor along with the position', async () => {
        const store = makeStore(makeSession({ checkedIngredientIds: ['01JQ00000000000000000000I2'], scaleFactor: 2 }));
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.checkedIngredientIds).toEqual(['01JQ00000000000000000000I2']);
        expect(result.current.scaleFactor).toBe(2);
    });

    it('starts FRESH — and evicts — a session older than the window', async () => {
        const store = makeStore(
            makeSession({
                currentStepIndex: 2,
                startedAt: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
                pausedAt: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
            }),
        );
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
    });

    it('starts fresh when device storage FAILS, rather than refusing to open Cooking Mode', async () => {
        const store = makeStore();
        store.read.mockRejectedValueOnce(new Error('IndexedDB is unavailable'));
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
    });

    it('repairs a restored position the recipe can no longer hold', async () => {
        const store = makeStore(makeSession({ currentStepIndex: 7 }));
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 2, stepCount: 3 });
    });

    it('drops a checked id the recipe no longer contains, so no ghost survives the resume', async () => {
        const store = makeStore(
            makeSession({ checkedIngredientIds: ['01JQ00000000000000000000I1', '01JQ0000000000000000000GHO'] }),
        );
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.checkedIngredientIds).toEqual(['01JQ00000000000000000000I1']);
        expect(persistedSession(store).checkedIngredientIds).toEqual(['01JQ00000000000000000000I1']);
    });
});

describe('useCookingSession — timers (FR-034 / REQ-004, REQ-005)', () => {
    it('starts a step timer and surfaces it in the active list with its full duration', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(
                makeStep({ stepNumber: 2, instruction: 'Sweat the onion', timerSeconds: 60 }),
            );
        });
        await settle();

        expect(result.current.activeTimers).toHaveLength(1);
        expect(result.current.activeTimers[0]).toMatchObject({
            timer: { id: 'step-2', label: 'Sweat the onion', durationMs: 60_000, isPaused: false },
            remainingMs: 60_000,
        });
    });

    it('counts DOWN as the clock advances, derived from timestamps rather than decremented', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await tick(20_000);

        expect(result.current.activeTimers[0]?.remainingMs).toBe(40_000);
    });

    it('runs several timers CONCURRENTLY, each with its own remainder', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await tick(10_000);
        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 3, timerSeconds: 120 }));
        });
        await settle();

        expect(result.current.activeTimers.map((view) => [view.timer.id, view.remainingMs])).toEqual([
            ['step-2', 50_000],
            ['step-3', 120_000],
        ]);
    });

    it('does NOT start a second timer for a step that is already counting, and does not throw', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const step = makeStep({ stepNumber: 2, timerSeconds: 60 });
        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(step);
        });
        await settle();
        await tick(10_000);

        expect(() => {
            act(() => {
                result.current.startStepTimer(step);
            });
        }).not.toThrow();
        await settle();

        expect(result.current.activeTimers).toHaveLength(1);
        // The ORIGINAL countdown survived; a silent replace would have reset it to 60s.
        expect(result.current.activeTimers[0]?.remainingMs).toBe(50_000);
    });

    it('ignores a start for a step that declares no timer', async () => {
        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 1 }));
        });
        await settle();

        expect(result.current.activeTimers).toHaveLength(0);
    });

    it('pauses and resumes one timer without shortening or extending it', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await tick(20_000);
        await act(async () => {
            result.current.pauseStepTimer('step-2');
        });
        await settle();
        await tick(30_000);

        expect(result.current.activeTimers[0]?.timer.isPaused).toBe(true);
        expect(result.current.activeTimers[0]?.remainingMs).toBe(40_000);

        await act(async () => {
            result.current.resumeStepTimer('step-2');
        });
        await settle();
        await tick(10_000);

        expect(result.current.activeTimers[0]?.timer.isPaused).toBe(false);
        expect(result.current.activeTimers[0]?.remainingMs).toBe(30_000);
    });

    it('cancels one timer and leaves the others running', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
            result.current.startStepTimer(makeStep({ stepNumber: 3, timerSeconds: 120 }));
        });
        await settle();
        await act(async () => {
            result.current.cancelStepTimer('step-2');
        });
        await settle();

        expect(result.current.activeTimers.map((view) => view.timer.id)).toEqual(['step-3']);
    });

    it('tolerates cancelling a timer that is already gone', async () => {
        const { result } = renderSession();
        await settle();

        expect(() => {
            act(() => {
                result.current.cancelStepTimer('step-9');
            });
        }).not.toThrow();
    });
});

describe('useCookingSession — the completion alert fires exactly ONCE (FR-034 / REQ-006)', () => {
    it('raises the alert when the countdown reaches zero, naming the finished timer', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(
                makeStep({ stepNumber: 2, instruction: 'Sweat the onion', timerSeconds: 60 }),
            );
        });
        await settle();

        expect(result.current.completedTimer).toBeUndefined();

        await tick(61_000);

        expect(result.current.completedTimer?.id).toBe('step-2');
    });

    it('does NOT re-raise it on any later tick once dismissed — across a full minute of ticks', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await tick(61_000);
        await act(async () => {
            result.current.dismissTimerAlert('step-2');
        });
        await settle();

        expect(result.current.completedTimer).toBeUndefined();

        // 60 further ticks, on every one of which the timer is still (derivedly) complete.
        for (let minute = 0; minute < 6; minute += 1) {
            await tick(10_000);
            expect(result.current.completedTimer).toBeUndefined();
        }

        // The timer is deliberately still in the list — dismissal acknowledges, it does not cancel. If
        // dismissal removed it, `alertedAt` would be dead code and this suite could not falsify it.
        expect(result.current.activeTimers.map((view) => view.timer.id)).toEqual(['step-2']);
    });

    it('records the acknowledgement in the PERSISTED session, not only in memory', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await tick(61_000);

        expect(persistedSession(store).activeTimers[0]?.alertedAt).toBe('2026-08-09T12:01:01.000Z');
    });

    it('does NOT re-announce a timer that had already been acknowledged before the interruption', async () => {
        const store = makeStore(
            makeSession({ activeTimers: [makeTimer({ alertedAt: new Date(Date.now() - HOUR_MS).toISOString() })] }),
        );
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.activeTimers).toHaveLength(1);
        expect(result.current.completedTimer).toBeUndefined();
    });

    it('DOES announce a restored timer that finished but was never acknowledged (the control case)', async () => {
        const store = makeStore(makeSession({ activeTimers: [makeTimer()] }));
        const { result } = renderSession({ store });
        await settle();

        expect(result.current.completedTimer?.id).toBe('step-2');
    });

    it('queues the next completion rather than losing it, once the first is dismissed', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
            result.current.startStepTimer(makeStep({ stepNumber: 3, timerSeconds: 30 }));
        });
        await settle();
        await tick(61_000);

        const firstAlerted = result.current.completedTimer?.id;

        await act(async () => {
            result.current.dismissTimerAlert(firstAlerted ?? '');
        });
        await settle();

        expect([firstAlerted, result.current.completedTimer?.id].sort()).toEqual(['step-2', 'step-3']);
    });

    it('drops the alert when the alerted timer is cancelled', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { result } = renderSession();
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await tick(61_000);
        await act(async () => {
            result.current.cancelStepTimer('step-2');
        });
        await settle();

        expect(result.current.completedTimer).toBeUndefined();
    });
});

describe('useCookingSession — ingredient checkoff and yield scaling (FR-032a, FR-034a)', () => {
    it('round-trips a checkoff through the pure reducer and device storage', async () => {
        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.toggleIngredient('01JQ00000000000000000000I2');
        });
        await settle();

        expect(result.current.checkedIngredientIds).toEqual(['01JQ00000000000000000000I2']);
        expect(persistedSession(store).checkedIngredientIds).toEqual(['01JQ00000000000000000000I2']);

        await act(async () => {
            result.current.toggleIngredient('01JQ00000000000000000000I2');
        });
        await settle();

        expect(result.current.checkedIngredientIds).toEqual([]);
        expect(persistedSession(store).checkedIngredientIds).toEqual([]);
    });

    it('round-trips a yield change, and never touches a running countdown (spec D-002)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const store = makeStore();
        const { result } = renderSession({ store });
        await settle();

        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
        });
        await settle();
        await act(async () => {
            result.current.changeScaleFactor(2);
        });
        await settle();

        expect(result.current.scaleFactor).toBe(2);
        expect(persistedSession(store).scaleFactor).toBe(2);
        // Doubling the batch does not double the cook time.
        expect(result.current.activeTimers[0]?.timer.durationMs).toBe(60_000);
        expect(result.current.activeTimers[0]?.remainingMs).toBe(60_000);
    });

    it('rejects a yield factor outside the supported set', async () => {
        const { result } = renderSession();
        await settle();

        expect(() => {
            act(() => {
                // Cast at the boundary only: the point of the test is that a value crossing the component
                // boundary is validated by the domain rather than trusted.
                result.current.changeScaleFactor(5 as never);
            });
        }).toThrow();
    });
});

describe('useCookingSession — Cooking Mode is READ-ONLY on the recipe (REQ-CN-001)', () => {
    it('issues no request of any kind, and never mutates the steps or ingredients it was handed', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const steps = makeSteps();
        const ingredients = makeIngredients();
        const stepsSnapshot = structuredClone(steps) as RecipeStepView[];
        const ingredientsSnapshot = structuredClone(ingredients) as RecipeIngredientView[];
        const { result } = renderSession({ recipe: { status: 'ready', steps, ingredients } });
        await settle();

        // A full pass over every intent the screen can raise.
        await act(async () => {
            result.current.goToNextStep();
        });
        await settle();
        await act(async () => {
            result.current.startStepTimer(makeStep({ stepNumber: 2, timerSeconds: 60 }));
            result.current.toggleIngredient('01JQ00000000000000000000I1');
            result.current.changeScaleFactor(3);
        });
        await settle();
        await tick(61_000);
        await act(async () => {
            result.current.dismissTimerAlert('step-2');
            result.current.goToPreviousStep();
            result.current.exit();
        });
        await settle();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(steps).toEqual(stepsSnapshot);
        expect(ingredients).toEqual(ingredientsSnapshot);
    });
});

describe('useCookingSession — voice control is OPT-IN (US-006 / D-004)', () => {
    it('does NOT open the microphone on mount — only an explicit toggle starts recognition', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });
        await settle();

        expect(voice.start).not.toHaveBeenCalled();
        expect(result.current.voiceState).toBe('idle');

        act(() => {
            result.current.toggleVoice();
        });
        await settle();

        expect(voice.start).toHaveBeenCalledTimes(1);
        expect(result.current.voiceState).toBe('listening');
    });

    it('waits for the session to be live before listening, so a toggle during restore is not lost', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });

        act(() => {
            result.current.toggleVoice();
        });

        expect(voice.start).not.toHaveBeenCalled();

        await settle();

        expect(voice.start).toHaveBeenCalledTimes(1);
    });

    it('stops and DISPOSES the recogniser when the cook toggles voice back off', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });
        await settle();

        act(() => {
            result.current.toggleVoice();
        });
        await settle();
        act(() => {
            result.current.toggleVoice();
        });
        await settle();

        expect(voice.dispose).toHaveBeenCalledTimes(1);
        expect(voice.start).toHaveBeenCalledTimes(1);
        expect(result.current.voiceState).toBe('idle');
    });

    it('disposes the recogniser on UNMOUNT, so the microphone cannot outlive the screen', async () => {
        const voice = makeVoiceControl();
        const { result, unmount } = renderSession({ voiceControl: voice.port });
        await settle();

        act(() => {
            result.current.toggleVoice();
        });
        await settle();

        expect(voice.dispose).not.toHaveBeenCalled();

        act(() => {
            unmount();
        });

        expect(voice.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the recogniser when the session ENDS', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });
        await settle();

        act(() => {
            result.current.toggleVoice();
        });
        await settle();
        act(() => {
            result.current.finish();
        });
        await settle();

        expect(voice.dispose).toHaveBeenCalledTimes(1);
        expect(result.current.voiceState).toBe('idle');
    });

    it('ignores a command the platform had already queued when the session was disposed', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });
        await settle();

        act(() => {
            result.current.toggleVoice();
        });
        await settle();
        act(() => {
            result.current.toggleVoice();
        });
        await settle();

        act(() => {
            voice.say('next');
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
    });
});

describe('useCookingSession — voice commands reach the SAME actions as the tap controls (FR-033/FR-034)', () => {
    /** Mounts a live session with voice already listening. */
    const listeningSession = async (overrides: Partial<UseCookingSessionOptions> = {}) => {
        const voice = makeVoiceControl();
        const rendered = renderSession({ ...overrides, voiceControl: voice.port });
        await settle();

        act(() => {
            rendered.result.current.toggleVoice();
        });
        await settle();

        return { voice, ...rendered };
    };

    it('advances one step on "next"', async () => {
        const { voice, result } = await listeningSession();

        act(() => {
            voice.say('next');
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 1 });
    });

    it('goes back one step on "back", and stays put at the FIRST step', async () => {
        const { voice, result } = await listeningSession();

        act(() => {
            voice.say('next');
        });
        await settle();
        act(() => {
            voice.say('back');
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });

        act(() => {
            voice.say('back');
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
    });

    it('does NOT finish the session when "next" is spoken on the LAST step (HAZ-006)', async () => {
        const store = makeStore();
        const onFinish = vi.fn();
        const { voice, result } = await listeningSession({ store, onFinish });

        act(() => {
            result.current.goToNextStep();
        });
        await settle();
        act(() => {
            result.current.goToNextStep();
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 2 });

        act(() => {
            voice.say('next');
        });
        await settle();

        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 2 });
        expect(onFinish).not.toHaveBeenCalled();
        expect(store.remove).not.toHaveBeenCalled();
        // `advance` records the step it LEAVES as completed, so a spoken "next" that slipped past the
        // boundary would mark the final step cooked — the state the session's `complete` status reads.
        expect(persistedSession(store).completedSteps).toEqual([0, 1]);
    });

    it('starts the current step timer on "start-timer", and does nothing on a step with none', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { voice, result } = await listeningSession();

        act(() => {
            voice.say('start-timer');
        });
        await settle();

        // Step 1 declares no duration: nothing starts, and nothing throws.
        expect(result.current.activeTimers).toHaveLength(0);

        act(() => {
            voice.say('next');
        });
        await settle();
        act(() => {
            voice.say('start-timer');
        });
        await settle();

        expect(result.current.activeTimers).toHaveLength(1);
        expect(result.current.activeTimers[0]?.timer.label).toBe('Sweat the onion');
        expect(result.current.activeTimers[0]?.remainingMs).toBe(60_000);
    });

    it('pauses the running timer on "pause-timer", and is a no-op when nothing is running', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

        const { voice, result } = await listeningSession();

        act(() => {
            voice.say('pause-timer');
        });
        await settle();

        expect(result.current.activeTimers).toHaveLength(0);

        act(() => {
            voice.say('next');
        });
        await settle();
        act(() => {
            voice.say('start-timer');
        });
        await settle();
        await tick(20_000);
        act(() => {
            voice.say('pause-timer');
        });
        await settle();

        expect(result.current.activeTimers[0]?.timer.isPaused).toBe(true);
        expect(result.current.activeTimers[0]?.remainingMs).toBe(40_000);

        // A paused timer stays paused; the countdown does not resume behind the cook's back.
        await tick(30_000);

        expect(result.current.activeTimers[0]?.remainingMs).toBe(40_000);
    });

    it('re-announces the current step on "repeat", without moving or changing anything else', async () => {
        const { voice, result } = await listeningSession();

        expect(result.current.repeatAnnouncementId).toBe(0);

        act(() => {
            voice.say('repeat');
        });
        await settle();

        expect(result.current.repeatAnnouncementId).toBe(1);

        // Each request is its own announcement — a screen reader must not swallow the second one.
        act(() => {
            voice.say('repeat');
        });
        await settle();

        expect(result.current.repeatAnnouncementId).toBe(2);
        expect(result.current.surface).toMatchObject({ kind: 'step', stepIndex: 0 });
        expect(result.current.activeTimers).toHaveLength(0);
    });
});

describe('useCookingSession — voice degrades honestly when it cannot listen (US-006 is Should Have)', () => {
    it('reports DENIED when the platform refuses the microphone, and never re-asks', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });
        await settle();

        act(() => {
            result.current.toggleVoice();
        });
        await settle();

        expect(() => {
            act(() => {
                voice.announce('denied');
            });
        }).not.toThrow();
        await settle();

        expect(result.current.voiceState).toBe('denied');

        // A settled denial is not retried: pressing again must not open a second session.
        act(() => {
            result.current.toggleVoice();
        });
        await settle();

        expect(voice.start).toHaveBeenCalledTimes(1);
        expect(result.current.voiceState).toBe('denied');
    });

    it('reports UNSUPPORTED when the adapter finds no recogniser at all', async () => {
        const voice = makeVoiceControl();
        const { result } = renderSession({ voiceControl: voice.port });
        await settle();

        act(() => {
            result.current.toggleVoice();
        });
        await settle();
        act(() => {
            voice.announce('unsupported');
        });
        await settle();

        expect(result.current.voiceState).toBe('unsupported');
    });

    it('states UNSUPPORTED up front when the host injects no voice port', async () => {
        const { result } = renderSession();
        await settle();

        expect(result.current.voiceState).toBe('unsupported');

        expect(() => {
            act(() => {
                result.current.toggleVoice();
            });
        }).not.toThrow();
        await settle();

        expect(result.current.voiceState).toBe('unsupported');
    });

    it('states UNSUPPORTED for the core no-op port, which MEANS "this platform has no recogniser"', async () => {
        const { result } = renderSession({ voiceControl: noopVoiceControl });
        await settle();

        expect(result.current.voiceState).toBe('unsupported');
    });
});
