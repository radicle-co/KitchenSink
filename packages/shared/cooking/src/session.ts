import { InvalidStepIndexError, InvalidTotalStepsError } from './errors.js';
import type { CookingSession } from './types.js';

/**
 * The cooking session's step navigation (FR-032, FR-033).
 *
 * @pattern State — a statechart whose position {@link sessionStatus} derives; every transition is a pure reducer
 *
 * Every transition takes a {@link CookingSession} and returns a **new** one, never mutating its input. The session
 * carries no `totalSteps` of its own: the step count belongs to the recipe, so callers pass the current count into
 * every transition. Each one rejects a `currentStepIndex` outside that count, as `stepPlace` and the line ticks do:
 * nothing stores a session, so a bad index is a caller bug, and repairing it would record a step never cooked.
 *
 * Unchanged arrays are shared with the input session (structural sharing). Treat every session as immutable.
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
    /** Number of steps the recipe currently has. Must be a positive integer. */
    totalSteps: number;
    /** ISO 8601 timestamp — never a `Date`, never epoch millis. */
    startedAt: string;
}

/**
 * Guards a step count before it is used to derive any boundary.
 *
 * @param totalSteps - The recipe's current step count.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 */
function assertTotalSteps(totalSteps: number): void {
    // `Number.isInteger` rejects NaN, Infinity and fractions in one predicate, so no non-integer can
    // reach the arithmetic below and silently produce a fractional or NaN index.
    if (!Number.isInteger(totalSteps) || totalSteps < 1) {
        throw new InvalidTotalStepsError(totalSteps);
    }
}

/**
 * Guards the session's step index against the recipe's current count.
 *
 * @param index - The session's `currentStepIndex`.
 * @param totalSteps - The recipe's current step count, already checked.
 * @throws {InvalidStepIndexError} When `index` is not an integer in `[0, totalSteps - 1]`.
 */
function assertStepIndex(index: number, totalSteps: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= totalSteps) {
        throw new InvalidStepIndexError(index, totalSteps);
    }
}

/**
 * Records one step as completed, returning a new array.
 *
 * @param completedSteps - The steps completed so far.
 * @param stepIndex - The step to record.
 * @returns A new array containing `stepIndex` exactly once.
 */
function withStepRecorded(completedSteps: readonly number[], stepIndex: number): number[] {
    // Always a fresh array, even when nothing is added: the returned session must never share a
    // mutable array whose contents differ from the one the caller still holds.
    return completedSteps.includes(stepIndex) ? [...completedSteps] : [...completedSteps, stepIndex];
}

/**
 * Reports whether every step of the current recipe has been completed.
 *
 * @param completedSteps - The steps completed so far.
 * @param totalSteps - The recipe's current step count.
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
 * @param input - The recipe, its current step count, and the session's start time.
 * @returns A session at step 0 with no progress.
 * @throws {InvalidTotalStepsError} When `input.totalSteps` is not a positive integer.
 */
export function createSession(input: CreateSessionInput): CookingSession {
    assertTotalSteps(input.totalSteps);

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
 * @param totalSteps - The recipe's current step count.
 * @returns A new session at the next step.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 * @throws {InvalidStepIndexError} When the session's step is not one of the recipe's.
 */
export function advance(session: CookingSession, totalSteps: number): CookingSession {
    assertTotalSteps(totalSteps);
    assertStepIndex(session.currentStepIndex, totalSteps);

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
 * @param totalSteps - The recipe's current step count.
 * @returns A new session one step earlier, or at step 0 when already there.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 * @throws {InvalidStepIndexError} When the session's step is not one of the recipe's.
 */
export function goBack(session: CookingSession, totalSteps: number): CookingSession {
    assertTotalSteps(totalSteps);
    assertStepIndex(session.currentStepIndex, totalSteps);

    return {
        ...session,
        currentStepIndex: Math.max(session.currentStepIndex - 1, 0),
    };
}

/**
 * Derives the session's statechart position.
 *
 * @param session - The session to classify.
 * @param totalSteps - The recipe's current step count.
 * @returns The current {@link SessionStatus}.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 * @throws {InvalidStepIndexError} When the session's step is not one of the recipe's.
 */
export function sessionStatus(session: CookingSession, totalSteps: number): SessionStatus {
    assertTotalSteps(totalSteps);
    assertStepIndex(session.currentStepIndex, totalSteps);

    if (isEveryStepCompleted(session.completedSteps, totalSteps)) {
        return 'complete';
    }

    // Position alone cannot distinguish a fresh session from one that navigated back to step 0, so
    // `idle` additionally requires that no step has been completed.
    if (session.currentStepIndex === 0 && session.completedSteps.length === 0) {
        return 'idle';
    }

    return 'cooking';
}
