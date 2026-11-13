import { stepAt } from './cookingSteps.js';
import type { CookingStep } from './cookingSteps.js';
import type { CookingSession } from './types.js';

/**
 * The cooking session's step navigation (FR-032, FR-033).
 *
 * @pattern State — a statechart whose position {@link sessionStatus} derives; every transition is a pure reducer
 *
 * Every transition takes a {@link CookingSession} and returns a **new** one, never mutating its input. The session
 * carries no steps of its own: they belong to the recipe, so callers pass the parsed steps (`cookingStepsOf`) into
 * every transition. Each one reads the step through `stepAt`, so a `currentStepIndex` outside the recipe throws:
 * nothing stores a session, so a bad index is a caller bug, and repairing it would record a step never cooked.
 */

/**
 * The statechart position of a cooking session.
 *
 * Derived, never stored: a stored copy would be a second representation of state the session already carries.
 */
export type SessionStatus = 'idle' | 'cooking' | 'complete';

/** Everything needed to open a cooking session for one recipe. */
export interface CreateSessionInput {
    recipeId: string;
    /** The recipe's cooking steps (`cookingStepsOf`). Must not be empty. */
    steps: readonly CookingStep[];
    /** ISO 8601 timestamp — never a `Date`, never epoch millis. */
    startedAt: string;
}

/**
 * Records one step as completed.
 *
 * @param completedSteps - The steps completed so far.
 * @param stepIndex - The step to record.
 * @returns The steps with `stepIndex` present exactly once.
 */
function withStepRecorded(completedSteps: readonly number[], stepIndex: number): readonly number[] {
    return completedSteps.includes(stepIndex) ? completedSteps : [...completedSteps, stepIndex];
}

/**
 * Reports whether every step of the current recipe has been completed.
 *
 * @param completedSteps - The steps completed so far.
 * @param totalSteps - The recipe's step count.
 * @returns `true` when each index in `[0, totalSteps - 1]` is present.
 */
function isEveryStepCompleted(completedSteps: readonly number[], totalSteps: number): boolean {
    // Membership of every required index, rather than a count: a caller passing a smaller count than
    // the session walked would leave ghost indices, and counting them would report a half-cooked recipe
    // as finished.
    return Array.from({ length: totalSteps }, (_unused, index) => index).every((index) =>
        completedSteps.includes(index),
    );
}

/**
 * Opens a cooking session at the recipe's first step.
 *
 * @param input - The recipe, its steps, and the session's start time.
 * @returns A session at step 0 with no progress.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 */
export function createSession(input: CreateSessionInput): CookingSession {
    stepAt(input.steps, 0);

    return {
        recipeId: input.recipeId,
        startedAt: input.startedAt,
        currentStepIndex: 0,
        completedSteps: [],
    };
}

/**
 * Moves to the next step, recording the step just left as completed.
 *
 * At the last step the index is clamped — advancing can never produce an out-of-range index — but
 * the final step is still recorded, which is what makes {@link SessionStatus} `complete` reachable:
 * pressing "next" on the last step means the cook finished it. Repeating the terminal advance is
 * therefore idempotent rather than a growing list of duplicates.
 *
 * @param session - The current session.
 * @param steps - The recipe's cooking steps.
 * @returns A new session at the next step.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When the session's step is not one of the recipe's.
 */
export function advance(session: CookingSession, steps: readonly CookingStep[]): CookingSession {
    stepAt(steps, session.currentStepIndex);

    const totalSteps = steps.length;

    return {
        ...session,
        currentStepIndex: Math.min(session.currentStepIndex + 1, totalSteps - 1),
        completedSteps: withStepRecorded(session.completedSteps, session.currentStepIndex),
    };
}

/**
 * Moves back one step, clamped at the first step.
 *
 * `completedSteps` is deliberately left intact: FR-033 requires reviewing an earlier step "without
 * losing their place", so going back reveals progress rather than undoing it.
 *
 * @param session - The current session.
 * @param steps - The recipe's cooking steps.
 * @returns A new session one step earlier, or at step 0 when already there.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When the session's step is not one of the recipe's.
 */
export function goBack(session: CookingSession, steps: readonly CookingStep[]): CookingSession {
    stepAt(steps, session.currentStepIndex);

    return {
        ...session,
        currentStepIndex: Math.max(session.currentStepIndex - 1, 0),
    };
}

/**
 * Derives the session's statechart position.
 *
 * @param session - The session to classify.
 * @param steps - The recipe's cooking steps.
 * @returns The current {@link SessionStatus}.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When the session's step is not one of the recipe's.
 */
export function sessionStatus(session: CookingSession, steps: readonly CookingStep[]): SessionStatus {
    stepAt(steps, session.currentStepIndex);

    if (isEveryStepCompleted(session.completedSteps, steps.length)) {
        return 'complete';
    }

    // Position alone cannot distinguish a fresh session from one that navigated back to step 0, so
    // `idle` additionally requires that no step has been completed.
    if (session.currentStepIndex === 0 && session.completedSteps.length === 0) {
        return 'idle';
    }

    return 'cooking';
}
