'use client';

/**
 * @module @commise/features-cooking/useCookingSession — the cook's one session, as a hook the web and native screens share.
 *
 * The hook holds NO rule: the steps and their lines, the ticks and the focus, where the cook is and
 * whether they are done all come from cooking-core's reducers and formatters. What it adds is React: a `useReducer` that
 * composes the session reducer with the line-tick reducer, and the screen-on hold from `@commise/ui/keep-awake`. If a rule
 * is missing, it is added to cooking-core, never here.
 *
 * The session lives in memory only: leaving the screen loses the place. The recipe is read ONCE: the steps
 * are split when the session opens, so a background refetch cannot change the steps or lines under the cook.
 *
 * @pattern Headless hook — state and commands for two thin screens
 */
import { useKeepAwake, useKeepAwakeAvailable } from '@commise/ui/keep-awake';
import {
    advance,
    allLinesTicked,
    cookingStepsOf,
    createLineTicks,
    createSession,
    focusLineIndex,
    goBack,
    isLineTicked,
    linePlace,
    sessionStatus,
    stepPlace,
    tickedLineCount,
    tickLine,
    untickLine,
    type CookingSession,
    type CookingStep,
    type LinePlace,
    type LineTicks,
    type SessionStatus,
    type StepPlace,
} from '@kitchensink/cooking-core';
import { useCallback, useReducer } from 'react';

/** The recipe's steps as the hook reads them: the recipe's own step number and text. */
type RecipeSteps = Parameters<typeof cookingStepsOf>[0];

/** What opens a session. */
export interface UseCookingSessionInput {
    /** The recipe being cooked. */
    readonly recipeId: string;
    /** The recipe's steps. Read once, when the session opens. At least one must have text. */
    readonly steps: RecipeSteps;
}

/** What the hook hands a screen. */
export interface UseCookingSessionResult {
    /** The steps the cook walks: only steps with text, each split into lines. */
    readonly steps: readonly CookingStep[];
    /** The current step. */
    readonly step: CookingStep;
    /** Where the cook is: 1-based, with the neighbours Back and Next lead to. `previous` null means Back leaves. */
    readonly place: StepPlace;
    /** `complete` once Next was pressed on the last step: the Done screen. */
    readonly status: SessionStatus;
    /** How many lines the current step has. */
    readonly lineCount: number;
    /** The focus line (the first unticked), or `null` when every line is ticked. */
    readonly focusLine: number | null;
    /** "Line n of m" for the focus line, or `null` when it is not shown. */
    readonly focusPlace: LinePlace | null;
    /** How many lines of the current step are ticked. */
    readonly tickedCount: number;
    /** Whether every line of the current step is ticked (next coming). */
    readonly everyLineTicked: boolean;
    /** Whether one line of the current step is ticked. */
    readonly isTicked: (lineIndex: number) => boolean;
    /** Tick a line of the current step. */
    readonly tick: (lineIndex: number) => void;
    /** Untick a line of the current step. */
    readonly untick: (lineIndex: number) => void;
    /** The next step, or Done from the last. */
    readonly next: () => void;
    /** The previous step. On step 1 it stays: the screen leaves to the recipe when `place.previous` is null. */
    readonly back: () => void;
    /** Start again from step 1 with no line ticked. */
    readonly cookAgain: () => void;
    /** Whether this device can keep the screen on, so no promise is shown where it cannot. */
    readonly keepAwakeAvailable: boolean;
}

interface State {
    readonly recipeId: string;
    readonly steps: readonly CookingStep[];
    readonly session: CookingSession;
    readonly ticks: LineTicks;
}

/** A command names the step it was drawn for, so a tap queued behind another cannot land on a step it never showed. */
type Action =
    | { readonly type: 'next'; readonly stepIndex: number }
    | { readonly type: 'back'; readonly stepIndex: number }
    | { readonly type: 'tick'; readonly stepIndex: number; readonly lineIndex: number }
    | { readonly type: 'untick'; readonly stepIndex: number; readonly lineIndex: number }
    | { readonly type: 'again'; readonly startedAt: string };

/**
 * Open a session on a recipe.
 *
 * @param input - The recipe and its steps.
 * @returns The first state: step 1, nothing ticked.
 * @sideEffect Reads the clock for the session's start time.
 * @throws {InvalidTotalStepsError} When no step has text.
 */
function open(input: UseCookingSessionInput): State {
    const steps = cookingStepsOf(input.steps);

    return {
        recipeId: input.recipeId,
        steps,
        session: createSession({
            recipeId: input.recipeId,
            steps,
            startedAt: new Date().toISOString(),
        }),
        ticks: createLineTicks(),
    };
}

/**
 * Compose the two core reducers. It routes a command to the reducer that owns it, and answers the same state to a
 * command drawn for a step the cook has already left.
 *
 * @param state - The current state.
 * @param action - The command.
 * @returns The next state. Pure.
 */
function reduce(state: State, action: Action): State {
    if (action.type === 'again') {
        return {
            ...state,
            session: createSession({
                recipeId: state.recipeId,
                steps: state.steps,
                startedAt: action.startedAt,
            }),
            ticks: createLineTicks(),
        };
    }

    const { stepIndex } = action;

    if (stepIndex !== state.session.currentStepIndex) {
        return state;
    }

    switch (action.type) {
        case 'next':
            return { ...state, session: advance(state.session, state.steps) };
        case 'back':
            return { ...state, session: goBack(state.session, state.steps) };
        case 'tick':
            return { ...state, ticks: tickLine(state.ticks, { stepIndex, lineIndex: action.lineIndex }, state.steps) };
        case 'untick':
            return { ...state, ticks: untickLine(state.ticks, { stepIndex, lineIndex: action.lineIndex }) };
    }
}

/**
 * The cook's session over a recipe's steps.
 *
 * @param input - The recipe and its steps.
 * @returns The state to draw and the commands behind it.
 * @sideEffect Holds the screen awake while cooking; reads the clock when a session opens and when it restarts.
 * @throws {InvalidTotalStepsError} When no step has text. The screen decides `noSteps` before it mounts this.
 */
export function useCookingSession(input: UseCookingSessionInput): UseCookingSessionResult {
    const [state, dispatch] = useReducer(reduce, input, open);
    const { steps, session, ticks } = state;
    const stepIndex = session.currentStepIndex;
    // `advance` and `goBack` keep the index inside the steps, so this is always a step.
    const step = steps[stepIndex];
    const status = sessionStatus(session, steps);
    const lineCount = step.lines.length;
    const focusLine = focusLineIndex(ticks, stepIndex, steps);

    const isTicked = useCallback(
        (lineIndex: number) => isLineTicked(ticks, { stepIndex, lineIndex }),
        [ticks, stepIndex],
    );

    const tick = useCallback((lineIndex: number) => dispatch({ type: 'tick', stepIndex, lineIndex }), [stepIndex]);
    const untick = useCallback((lineIndex: number) => dispatch({ type: 'untick', stepIndex, lineIndex }), [stepIndex]);
    const next = useCallback(() => dispatch({ type: 'next', stepIndex }), [stepIndex]);
    const back = useCallback(() => dispatch({ type: 'back', stepIndex }), [stepIndex]);
    const cookAgain = useCallback(() => dispatch({ type: 'again', startedAt: new Date().toISOString() }), []);
    const keepAwakeAvailable = useKeepAwakeAvailable();

    // On while cooking; off on Done, and on leaving, which unmounts the screen and so this hook.
    useKeepAwake(status !== 'complete');

    return {
        steps,
        step,
        place: stepPlace(stepIndex, steps),
        status,
        lineCount,
        focusLine,
        focusPlace: focusLine === null ? null : linePlace(focusLine, step),
        tickedCount: tickedLineCount(ticks, stepIndex),
        everyLineTicked: allLinesTicked(ticks, stepIndex, steps),
        isTicked,
        tick,
        untick,
        next,
        back,
        cookAgain,
        keepAwakeAvailable,
    };
}
