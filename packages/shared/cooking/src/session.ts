import { InvalidTotalStepsError } from './errors.js';
import type { CookingSession } from './types.js';

/**
 * The cooking session's step navigation (FR-032, FR-033).
 *
 * @pattern State — a statechart whose position {@link sessionStatus} derives; every transition is a pure reducer
 *
 * Every transition takes a {@link CookingSession} and returns a **new** one, never mutating its input. The session
 * carries no `totalSteps` of its own: the step count belongs to the recipe, so callers pass the current count into
 * every transition that needs a boundary. That is also why the transitions repair rather than trust
 * `currentStepIndex`: a session held against a recipe that has since lost steps must land inside the new range
 * instead of rendering an out-of-range step.
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
 * Forces a possibly untrusted step index into the recipe's current range.
 *
 * @param index - The index to repair.
 * @param lastIndex - The highest index the current recipe has.
 * @returns An integer in `[0, lastIndex]`.
 */
function clampIndex(index: number, lastIndex: number): number {
    // A non-finite index cannot be clamped by comparison (`Math.max(NaN, 0)` is NaN), so it falls
    // back to the first step — the same place a fresh session starts.
    if (!Number.isFinite(index)) {
        return 0;
    }

    return Math.min(Math.max(Math.trunc(index), 0), lastIndex);
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
    // Membership of every required index, rather than a count: a session held against a recipe that
    // gained or lost steps can hold ghost indices, and counting them would report a half-cooked recipe
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
 */
export function advance(session: CookingSession, totalSteps: number): CookingSession {
    assertTotalSteps(totalSteps);

    const lastIndex = totalSteps - 1;
    const departingIndex = clampIndex(session.currentStepIndex, lastIndex);

    return {
        ...session,
        currentStepIndex: Math.min(departingIndex + 1, lastIndex),
        completedSteps: withStepRecorded(session.completedSteps, departingIndex),
    };
}

/**
 * Moves back one step, clamped at the first step.
 *
 * `completedSteps` is deliberately left intact: FR-033 requires reviewing an earlier step "without
 * losing their place", so going back reveals progress rather than undoing it.
 *
 * @param session - The current session.
 * @returns A new session one step earlier, or at step 0 when already there.
 */
export function goBack(session: CookingSession): CookingSession {
    // No `totalSteps` is needed — moving backwards can only approach 0 — but a corrupt negative or
    // non-finite index is still repaired, because `Math.max(NaN - 1, 0)` would otherwise be NaN.
    const currentIndex = Number.isFinite(session.currentStepIndex) ? Math.trunc(session.currentStepIndex) : 0;

    return {
        ...session,
        currentStepIndex: Math.max(currentIndex - 1, 0),
    };
}

/**
 * Derives the session's statechart position.
 *
 * @param session - The session to classify.
 * @param totalSteps - The recipe's current step count.
 * @returns The current {@link SessionStatus}.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 */
export function sessionStatus(session: CookingSession, totalSteps: number): SessionStatus {
    assertTotalSteps(totalSteps);

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
