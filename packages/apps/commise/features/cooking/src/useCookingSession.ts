/**
 * @module @commise/features-cooking/useCookingSession — the HEADLESS hook behind Cooking Mode
 * (FR-032, FR-032a, FR-033, FR-034, FR-034a, FR-035).
 *
 * **Pattern register.** This is the *headless hook* half of the Humble Object split plan.md §4
 * prescribes: `CookingModeScreen` is the single orchestrational component, this hook is where its
 * state, effects and wiring live, and every child of the screen stays a pure `props → JSX` leaf. Inside
 * the hook three further patterns compose:
 *
 *  - a **statechart** over `restoring → cooking → ended`, kept as one discriminated union so "there is a
 *    session" and "we are still restoring one" cannot disagree (illegal states are unrepresentable, and
 *    every effect gates on the phase rather than on a nullable session);
 *  - **ports and adapters** — the wake lock arrives as a {@link WakeLockPort} and device storage as a
 *    {@link CookingSessionStore}, so nothing platform-specific is imported here. The web screen injects
 *    `acquireWebWakeLock`, the native screen `acquireNativeWakeLock`, and a test a fake. Importing an
 *    adapter here would make one platform silently run the other's implementation;
 *  - **Command**-shaped timer intents (`start` / `pause` / `resume` / `cancel`, addressed by timer id),
 *    each delegating to the pure reducers in `@kitchensink/cooking-core`.
 *
 * **The clock is ambient here, and only here.** The domain engine takes `nowIso` as an input and never
 * reads a clock, which is what makes it deterministic; *something* has to read the real one, and the
 * orchestration layer is that something. Remaining time is therefore DERIVED from timestamps on every
 * tick rather than decremented, so a backgrounded phone — the normal case for a device propped up in a
 * kitchen — shows the correct countdown the instant it returns, with no catch-up logic. The tick exists
 * only to re-render; it is not the source of truth, and it does not run when nothing is counting down.
 *
 * **Cooking Mode never writes to the recipe** (REQ-CN-001). This module issues no request of any kind:
 * its only I/O is the injected session store (device-local) and the injected wake lock. The steps and
 * ingredients it is handed are read and never mutated.
 */
import {
    advance,
    cancelTimer,
    clearSession,
    createSession,
    createTimerFromStep,
    createWakeLockController,
    goBack,
    goToStep,
    isComplete,
    isDuplicateTimerIdError,
    isInvalidTimerDurationError,
    isStepHasNoTimerError,
    isUnknownTimerError,
    pause,
    pauseTimer,
    persistSession,
    reconcile,
    remainingMs,
    restoreSession,
    resume,
    resumeTimer,
    setScaleFactor,
    startTimer,
    toggleIngredient,
    type CookingSession,
    type CookingSessionStore,
    type CookingTimer,
    type ScaleFactor,
    type WakeLockPort,
} from '@kitchensink/cooking-core';
import type { RecipeIngredientView, RecipeStepView } from '@kitchensink/recipe-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ActiveTimerView } from './timerModel';

/**
 * How often the countdown re-renders while at least one timer is running.
 *
 * Exported so tests advance by exactly one tick rather than guessing. One second is the finest
 * granularity the readout has (`{minutes}:{seconds}`), so a shorter interval would re-render for no
 * visible change.
 */
export const TIMER_TICK_INTERVAL_MS = 1_000;

/**
 * Separator used to fold the recipe's ingredient ids into ONE stable dependency key.
 *
 * The ingredient array's identity churns whenever the host re-renders, which would restart every effect
 * that depends on it. Ids are ULIDs, so an ASCII unit separator cannot occur inside one.
 */
const INGREDIENT_KEY_SEPARATOR = '\u001F';

/** The current instant as an ISO 8601 string — the ONE place this layer reads the wall clock. */
function currentIso(): string {
    return new Date().toISOString();
}

/**
 * The recipe as Cooking Mode receives it, as a discriminated union rather than a status flag beside
 * nullable data.
 *
 * The union is what lets the screen SELECT a surface (loading / empty / error / populated) instead of
 * passing a mode into one component, and it makes "loading, but here are the steps" unrepresentable.
 */
export type CookingRecipeState =
    | { readonly status: 'loading' }
    | { readonly status: 'error' }
    | {
          readonly status: 'ready';
          /** The recipe's steps in display order. Read-only — Cooking Mode never writes them (REQ-CN-001). */
          readonly steps: readonly RecipeStepView[];
          /** The recipe's ingredient lines. Empty is legitimate; the checklist renders its own empty copy. */
          readonly ingredients: readonly RecipeIngredientView[];
      };

/**
 * Which step surface the screen must render, carrying exactly the data that surface needs.
 *
 * A discriminated union rather than a `'loading' | 'step' | …` tag plus optional fields: on the `step`
 * arm the step is present *by construction*, so the screen cannot render a populated surface with no
 * step, and its `switch` is total.
 */
export type CookingStepSurface =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error' }
    | { readonly kind: 'empty' }
    | {
          readonly kind: 'step';
          /** The step to render. */
          readonly step: RecipeStepView;
          /** Zero-based position of {@link step}, already inside the recipe's current range. */
          readonly stepIndex: number;
          /** How many steps the recipe currently has. */
          readonly stepCount: number;
      };

/** Everything {@link useCookingSession} needs to run one recipe's cooking session. */
export interface UseCookingSessionOptions {
    /** The recipe being cooked. A change re-restores against the new recipe. */
    readonly recipeId: string;
    /** The recipe's load state and, once ready, its steps and ingredients. */
    readonly recipe: CookingRecipeState;
    /**
     * Device-storage port for session resume (FR-033). MUST be referentially stable across renders — a
     * new object each render would restart the restore and persist effects on every frame.
     */
    readonly store: CookingSessionStore;
    /**
     * Screen wake-lock port (FR-035), injected so this hook stays platform-free. MUST be referentially
     * stable, for the same reason as {@link store}.
     */
    readonly wakeLock: WakeLockPort;
    /** Invoked after the cook leaves mid-session; the session stays resumable for 24h. */
    readonly onExit: () => void;
    /** Invoked after the cook finishes the recipe; the stored session is cleared. */
    readonly onFinish: () => void;
}

/**
 * Everything the host route hands the Cooking Mode surface.
 *
 * Declared HERE, in the platform-neutral half of the orchestrator, and imported by both
 * `CookingModeScreen.tsx` and `CookingModeScreen.native.tsx` — the same rule the package already applies
 * to `stepDisplayModel` / `timerModel` / `sessionExtras` (§14.4). Re-declaring it per platform is exactly
 * how the two screens would drift on what the host must supply, and neither screen can import the
 * other's file: under Metro (and the native Vitest resolver) `./CookingModeScreen` resolves to the
 * `.native` sibling, so the native screen importing it would import itself.
 */
export interface CookingModeScreenProps {
    /** The recipe being cooked. Its session is keyed by this id. */
    readonly recipeId: string;
    /** The recipe's load state and, once ready, its steps and ingredients. */
    readonly recipe: CookingRecipeState;
    /**
     * Device-storage port for the 24h resume window (FR-033). MUST be referentially stable — see
     * {@link UseCookingSessionOptions.store}.
     */
    readonly sessionStore: CookingSessionStore;
    /** Retries the failed recipe load. Cooking Mode fetches nothing itself, so the host owns the retry. */
    readonly onRetry: () => void;
    /** Invoked after the cook leaves mid-cook. The session has already been persisted for resume. */
    readonly onExit: () => void;
    /** Invoked after the cook finishes. The stored session has already been cleared. */
    readonly onFinish: () => void;
    /**
     * Screen wake-lock adapter (FR-035). Each platform screen defaults it to its own adapter; injected so
     * tests — and any host on a platform without one — can supply their own.
     */
    readonly wakeLock?: WakeLockPort;
}

/** The session surface a Cooking Mode screen drives. Every field is derived; nothing here is a setter. */
export interface CookingSessionApi {
    /** Which step surface to render, and the data it needs. */
    readonly surface: CookingStepSurface;
    /** Ingredient ids checked off in this session (FR-032a). */
    readonly checkedIngredientIds: readonly string[];
    /** The active yield factor (FR-034a). Display-only — it never touches a countdown (spec D-002). */
    readonly scaleFactor: ScaleFactor;
    /** Every running timer paired with the remainder computed for this frame. */
    readonly activeTimers: readonly ActiveTimerView[];
    /** The finished timer whose alert is currently showing, if any (REQ-006). */
    readonly completedTimer?: CookingTimer;
    /** Advances one step, recording the step just left as completed. */
    readonly goToNextStep: () => void;
    /** Returns to the previous step without losing progress (FR-033). */
    readonly goToPreviousStep: () => void;
    /** Ends the cook: clears the stored session, releases the wake lock, reports `onFinish`. */
    readonly finish: () => void;
    /** Leaves mid-cook: persists a paused session for resume, releases the wake lock, reports `onExit`. */
    readonly exit: () => void;
    /** Starts the step's timer. A step with no duration, or one already running, is a no-op. */
    readonly startStepTimer: (step: RecipeStepView) => void;
    /** Pauses one running timer. */
    readonly pauseStepTimer: (timerId: string) => void;
    /** Resumes one paused timer with exactly the time it was paused holding. */
    readonly resumeStepTimer: (timerId: string) => void;
    /** Cancels one timer outright. */
    readonly cancelStepTimer: (timerId: string) => void;
    /** Acknowledges a completion alert. The timer stays in the list; it simply never alerts again. */
    readonly dismissTimerAlert: (timerId: string) => void;
    /** Toggles one ingredient's checked state (FR-032a). */
    readonly toggleIngredient: (ingredientId: string) => void;
    /** Changes the yield factor (FR-034a). */
    readonly changeScaleFactor: (factor: ScaleFactor) => void;
}

/**
 * The session statechart. `ended` keeps its session so the last step stays on screen until the host
 * navigates away, while every write and the wake lock stop — a blank frame between "finish" and the
 * host's navigation would be a worse ending than the step the cook just completed.
 */
type SessionState =
    | { readonly phase: 'restoring' }
    | { readonly phase: 'cooking'; readonly session: CookingSession }
    | { readonly phase: 'ended'; readonly session: CookingSession };

/** Steps for a recipe that has not loaded. A module constant, so its identity never churns. */
const NO_STEPS: readonly RecipeStepView[] = [];

/** Ingredients for a recipe that has not loaded. */
const NO_INGREDIENTS: readonly RecipeIngredientView[] = [];

/**
 * Reports whether a restored timer can still be read against the clock.
 *
 * A session comes back from device storage, where a timer can be structurally valid yet internally
 * inconsistent (paused with no captured remaining time, a corrupt duration). Reading it during render
 * would throw and take down Cooking Mode mid-cook, so unreadable timers are dropped at the restore
 * boundary instead — the cook loses a countdown, not the session.
 *
 * @param timer - The restored timer.
 * @param nowIso - The current instant, ISO 8601.
 * @returns `true` when the timer's remaining time is computable.
 */
function isReadableTimer(timer: CookingTimer, nowIso: string): boolean {
    try {
        remainingMs(timer, nowIso);

        return true;
    } catch {
        return false;
    }
}

/**
 * Prepares a restored session for the recipe as it stands NOW.
 *
 * The recipe may have changed since the session was written: it can have lost steps (so the stored index
 * is out of range) and its timers can have become unreadable. Both are repaired here rather than left to
 * fail at render time. `resume` clears `pausedAt`, because the cook is back.
 *
 * @param restored - The session read from device storage.
 * @param totalSteps - The recipe's CURRENT step count.
 * @param nowIso - The current instant, ISO 8601.
 * @returns A session valid against the current recipe.
 */
function adoptRestoredSession(restored: CookingSession, totalSteps: number, nowIso: string): CookingSession {
    const lastIndex = totalSteps - 1;
    const positioned = restored.currentStepIndex > lastIndex ? goToStep(restored, lastIndex, totalSteps) : restored;

    return {
        ...resume(positioned),
        activeTimers: positioned.activeTimers.filter((timer) => isReadableTimer(timer, nowIso)),
    };
}

/**
 * Drives one Cooking Mode session: step navigation, timers, ingredient checkoff, yield scaling, screen
 * wake lock and 24h resume.
 *
 * @param options - The recipe, the storage and wake-lock ports, and the exit/finish callbacks.
 * @returns The derived session surface plus the commands the screen's leaves report intent through.
 * @sideEffect Reads and writes the injected session store, holds the injected wake lock while the
 * session is live, and runs a one-second interval while at least one timer is counting down.
 */
export function useCookingSession(options: UseCookingSessionOptions): CookingSessionApi {
    const { recipeId, recipe, store, wakeLock, onExit, onFinish } = options;

    const [state, setState] = useState<SessionState>({ phase: 'restoring' });
    const [nowIso, setNowIso] = useState<string>(currentIso);
    const [alertedTimerId, setAlertedTimerId] = useState<string | null>(null);

    const isRecipeReady = recipe.status === 'ready';
    const steps = recipe.status === 'ready' ? recipe.steps : NO_STEPS;
    const ingredients = recipe.status === 'ready' ? recipe.ingredients : NO_INGREDIENTS;
    const stepCount = steps.length;

    // Folded to a string and re-split, so the array below has a STABLE identity whenever the recipe's
    // ingredient ids are unchanged — even though `recipe` itself is a fresh object on every host render.
    const ingredientKey = ingredients.map((ingredient) => ingredient.ingredientId).join(INGREDIENT_KEY_SEPARATOR);
    const ingredientIds = useMemo(
        () => (ingredientKey === '' ? [] : ingredientKey.split(INGREDIENT_KEY_SEPARATOR)),
        [ingredientKey],
    );

    // ── Device-storage writes ────────────────────────────────────────────────
    // Ref, deliberately: storage is an external, non-declarative system whose WRITE ORDER matters and is
    // not expressible as state. Without a queue, two writes issued a frame apart can land in either
    // order and the older session wins — silently rewinding a cook's progress on the next resume.
    const persistQueue = useRef<Promise<void>>(Promise.resolve());
    const enqueueWrite = useCallback((work: () => Promise<void>): void => {
        // The same handler on both settle paths: one failed write must not stall every later one. The
        // trailing handler returns the chain to a fulfilled state, so no rejection escapes unhandled.
        persistQueue.current = persistQueue.current.then(work, work).then(undefined, () => undefined);
    }, []);

    // ── Restore, or start fresh (FR-033 / REQ-013) ───────────────────────────
    // Also covers a recipeId change under a mounted screen: a session belonging to another recipe is
    // never adopted, which is the one mistake here that would drop a cook into the wrong step list.
    const hasSessionForRecipe = state.phase !== 'restoring' && state.session.recipeId === recipeId;

    useEffect(() => {
        if (!isRecipeReady || stepCount === 0 || hasSessionForRecipe) {
            return undefined;
        }

        let cancelled = false;

        const open = async (): Promise<void> => {
            let session: CookingSession;

            try {
                const outcome = await restoreSession(store, recipeId, currentIso());

                session =
                    outcome.status === 'resumable'
                        ? adoptRestoredSession(outcome.session, stepCount, currentIso())
                        : createSession({ recipeId, totalSteps: stepCount, startedAt: currentIso() });
            } catch {
                // A storage fault is NOT "there is nothing to resume" — the domain deliberately refuses
                // to conflate them, leaving the choice here. Starting fresh costs the cook their place;
                // refusing to open Cooking Mode at all would cost them the recipe. Cooking wins.
                session = createSession({ recipeId, totalSteps: stepCount, startedAt: currentIso() });
            }

            if (cancelled) {
                return;
            }

            setAlertedTimerId(null);
            setState({ phase: 'cooking', session });
        };

        void open();

        return () => {
            cancelled = true;
        };
    }, [hasSessionForRecipe, isRecipeReady, recipeId, stepCount, store]);

    // ── Persist every meaningful change ──────────────────────────────────────
    // Keyed on the session VALUE: every transition produces a new object and exactly one write, and a
    // tick (which changes no session state) produces none.
    useEffect(() => {
        if (state.phase !== 'cooking') {
            return;
        }

        const { session } = state;

        enqueueWrite(() => persistSession(store, session));
    }, [enqueueWrite, state, store]);

    // ── Drop checked ids the recipe no longer contains (FR-032a) ─────────────
    // Runs on restore AND whenever the recipe's ingredients change mid-session, so a ghost id can never
    // linger. Gated on `ready`: a refetch that briefly reports no ingredients must not wipe the checkoff.
    useEffect(() => {
        if (state.phase !== 'cooking' || !isRecipeReady) {
            return;
        }

        if (
            reconcile(state.session.checkedIngredientIds, ingredientIds).length ===
            state.session.checkedIngredientIds.length
        ) {
            return;
        }

        setState((current) =>
            current.phase === 'cooking'
                ? {
                      phase: 'cooking',
                      session: {
                          ...current.session,
                          checkedIngredientIds: reconcile(current.session.checkedIngredientIds, ingredientIds),
                      },
                  }
                : current,
        );
    }, [ingredientIds, isRecipeReady, state]);

    // ── Screen wake lock (FR-035 / REQ-007, REQ-CN-002) ──────────────────────
    // The controller keeps acquire/release balanced under StrictMode's double-invoked effects; the phase
    // gate is what releases the lock on finish and on exit without a second, drift-prone release path.
    const controller = useMemo(() => createWakeLockController(wakeLock), [wakeLock]);

    useEffect(() => {
        if (state.phase !== 'cooking') {
            return undefined;
        }

        void controller.acquire().catch(() => undefined);

        return () => {
            void controller.release().catch(() => undefined);
        };
    }, [controller, state.phase]);

    // ── Countdown tick ───────────────────────────────────────────────────────
    // Only while something is actually counting down: a paused timer's readout cannot change, and a
    // session with no timers has no reason to re-render once a second for the length of a braise.
    const isCounting = state.phase === 'cooking' && state.session.activeTimers.some((timer) => !timer.isPaused);

    useEffect(() => {
        if (!isCounting) {
            return undefined;
        }

        // Immediately, then on the interval: the first frame after a timer starts must not show a
        // remainder computed against a clock reading up to a second old.
        setNowIso(currentIso());

        const handle = setInterval(() => setNowIso(currentIso()), TIMER_TICK_INTERVAL_MS);

        return () => clearInterval(handle);
    }, [isCounting]);

    // ── The completion alert, exactly once per timer (REQ-006) ───────────────
    // Completion is DERIVED from the clock, so it stays true on every subsequent tick. `alertedAt` is
    // the acknowledgement that makes "once" real, and persisting it is what stops a session restored
    // after an interruption from re-announcing a timer that finished before it.
    useEffect(() => {
        if (state.phase !== 'cooking' || alertedTimerId !== null) {
            return;
        }

        const due = state.session.activeTimers.find(
            (timer) => timer.alertedAt === undefined && isComplete(timer, nowIso),
        );

        if (due === undefined) {
            return;
        }

        const acknowledgedAt = currentIso();

        setState((current) =>
            current.phase === 'cooking'
                ? {
                      phase: 'cooking',
                      session: {
                          ...current.session,
                          activeTimers: current.session.activeTimers.map((timer) =>
                              timer.id === due.id ? { ...timer, alertedAt: acknowledgedAt } : timer,
                          ),
                      },
                  }
                : current,
        );
        setAlertedTimerId(due.id);
    }, [alertedTimerId, nowIso, state]);

    // ── Derived view ─────────────────────────────────────────────────────────
    const session = state.phase === 'restoring' ? null : state.session;

    const surface = ((): CookingStepSurface => {
        if (recipe.status === 'error') {
            return { kind: 'error' };
        }

        if (recipe.status === 'loading') {
            return { kind: 'loading' };
        }

        if (stepCount === 0) {
            return { kind: 'empty' };
        }

        if (session === null) {
            // The recipe is here but the device is still being asked whether a session can be resumed.
            return { kind: 'loading' };
        }

        // Clamped for render: a recipe that lost steps since the session was written must not be asked
        // for an index it no longer has, even for the single frame before the repair lands.
        const stepIndex = Math.min(Math.max(session.currentStepIndex, 0), stepCount - 1);

        return { kind: 'step', step: steps[stepIndex], stepIndex, stepCount };
    })();

    const activeTimers: readonly ActiveTimerView[] =
        session === null
            ? []
            : session.activeTimers.map((timer) => ({ timer, remainingMs: remainingMs(timer, nowIso) }));

    const completedTimer =
        alertedTimerId === null ? undefined : session?.activeTimers.find((timer) => timer.id === alertedTimerId);

    // ── Commands ─────────────────────────────────────────────────────────────
    // Every command is inert unless the session is live, so a control pressed after the cook finished
    // (or during the restore) cannot resurrect a session or write to storage.
    const isLive = state.phase === 'cooking';

    /**
     * Applies a pure session reducer under the phase guard.
     *
     * @param reducer - The transition to apply.
     */
    const updateSession = (reducer: (session: CookingSession) => CookingSession): void => {
        setState((current) =>
            current.phase === 'cooking' ? { phase: 'cooking', session: reducer(current.session) } : current,
        );
    };

    const goToNextStep = (): void => {
        if (!isLive) {
            return;
        }

        updateSession((current) => advance(current, stepCount));
    };

    const goToPreviousStep = (): void => {
        if (!isLive) {
            return;
        }

        updateSession(goBack);
    };

    const finish = (): void => {
        if (!isLive) {
            return;
        }

        setState((current) => (current.phase === 'cooking' ? { phase: 'ended', session: current.session } : current));
        // Enqueued on the SAME chain as every persist, so the clear can never be overtaken by an
        // in-flight write and resurrect the session the cook just finished.
        enqueueWrite(() => clearSession(store, recipeId));
        onFinish();
    };

    const exit = (): void => {
        if (!isLive) {
            return;
        }

        const paused = pause(state.session, currentIso());

        setState({ phase: 'ended', session: paused });
        // Written HERE rather than left to the persist effect: the host commonly unmounts this screen
        // from `onExit`, and an effect that never runs is a session the cook cannot resume.
        enqueueWrite(() => persistSession(store, paused));
        onExit();
    };

    const startStepTimer = (step: RecipeStepView): void => {
        if (!isLive) {
            return;
        }

        let timer: CookingTimer;

        try {
            timer = createTimerFromStep(step, currentIso());
        } catch (error: unknown) {
            // A step with no duration renders no badge, so this is unreachable from the UI; a recipe
            // carrying a malformed duration is a data defect, and neither is worth interrupting a cook.
            if (isStepHasNoTimerError(error) || isInvalidTimerDurationError(error)) {
                return;
            }

            throw error;
        }

        setState((current) => {
            if (current.phase !== 'cooking') {
                return current;
            }

            try {
                return {
                    phase: 'cooking',
                    session: { ...current.session, activeTimers: startTimer(current.session.activeTimers, timer) },
                };
            } catch (error: unknown) {
                // A second press on a step whose timer already runs. The engine is right to refuse it —
                // but to the cook it is a repeated tap, not an error, so the state is simply unchanged.
                if (isDuplicateTimerIdError(error)) {
                    return current;
                }

                throw error;
            }
        });
    };

    /**
     * Applies a pure timer reducer to one addressed timer.
     *
     * @param timerId - The timer to act on.
     * @param reducer - The transition to apply to it.
     */
    const updateTimer = (timerId: string, reducer: (timer: CookingTimer) => CookingTimer): void => {
        if (!isLive) {
            return;
        }

        updateSession((current) => ({
            ...current,
            activeTimers: current.activeTimers.map((timer) => (timer.id === timerId ? reducer(timer) : timer)),
        }));
    };

    const pauseStepTimer = (timerId: string): void => {
        // Read outside the updater: React may invoke an updater more than once, and a clock read inside
        // one would capture a different instant on each invocation.
        const pausedAt = currentIso();

        updateTimer(timerId, (timer) => pauseTimer(timer, pausedAt));
    };

    const resumeStepTimer = (timerId: string): void => {
        const resumedAt = currentIso();

        updateTimer(timerId, (timer) => resumeTimer(timer, resumedAt));
    };

    const cancelStepTimer = (timerId: string): void => {
        if (!isLive) {
            return;
        }

        updateSession((current) => {
            try {
                return { ...current, activeTimers: cancelTimer(current.activeTimers, timerId) };
            } catch (error: unknown) {
                // A repeated cancel on a timer that is already gone.
                if (isUnknownTimerError(error)) {
                    return current;
                }

                throw error;
            }
        });
        setAlertedTimerId((current) => (current === timerId ? null : current));
    };

    const dismissTimerAlert = (timerId: string): void => {
        // The timer is deliberately NOT removed: dismissing acknowledges the alert, and the cook decides
        // when the finished timer leaves the list. `alertedAt` is what stops it announcing again.
        setAlertedTimerId((current) => (current === timerId ? null : current));
    };

    const toggle = (ingredientId: string): void => {
        if (!isLive) {
            return;
        }

        updateSession((current) => ({
            ...current,
            checkedIngredientIds: toggleIngredient(current.checkedIngredientIds, ingredientId, ingredientIds),
        }));
    };

    const changeScaleFactor = (factor: ScaleFactor): void => {
        if (!isLive) {
            return;
        }

        // Validated through the domain rather than trusted: the factor crossed a component boundary.
        const validated = setScaleFactor(factor);

        updateSession((current) => ({ ...current, scaleFactor: validated }));
    };

    return {
        surface,
        checkedIngredientIds: session?.checkedIngredientIds ?? [],
        scaleFactor: session?.scaleFactor ?? 1,
        activeTimers,
        completedTimer,
        goToNextStep,
        goToPreviousStep,
        finish,
        exit,
        startStepTimer,
        pauseStepTimer,
        resumeStepTimer,
        cancelStepTimer,
        dismissTimerAlert,
        toggleIngredient: toggle,
        changeScaleFactor,
    };
}
