import type { CookingSession } from './types.js';

/**
 * MOD-004 — cooking session state machine and step navigation (FR-032, FR-033 / REQ-001..003,
 * REQ-008..010).
 *
 * Every transition is a pure reducer: it takes a {@link CookingSession} and returns a **new** one,
 * never mutating its input. The session carries no `totalSteps` of its own — the step count belongs
 * to the recipe (`RecipeStep[]` from `@kitchensink/recipe-core`), which may legitimately differ from
 * the count in force when a persisted session was created, so callers pass the *current* count into
 * every transition that needs a boundary. That is also why the transitions repair rather than trust
 * `currentStepIndex`: a session restored against a recipe that has since lost steps must land inside
 * the new range instead of rendering an out-of-range step.
 *
 * Unchanged arrays are shared with the input session (structural sharing). Treat every session as
 * immutable; mutating one in place would be visible through every value derived from it.
 *
 * The MOD-004 design sketched a stateful class with `onStepChange` subscribers. That shape is not
 * used: subscription is the consuming React layer's job (`useCookingSession` re-renders on the new
 * value), and a mutable singleton cannot be persisted, restored or unit-tested per transition.
 */

/**
 * The statechart position of a cooking session (plan.md §4 "Pattern register").
 *
 * Derived, never stored: a stored copy would be a second representation of state the session already
 * carries and could drift from it.
 */
export type SessionStatus = 'idle' | 'cooking' | 'paused' | 'complete';

/** Everything needed to open a cooking session for one recipe. */
export interface CreateSessionInput {
    recipeId: string;
    /** Number of steps the recipe currently has. Must be a positive integer. */
    totalSteps: number;
    /** ISO 8601 timestamp — never a `Date`, never epoch millis. */
    startedAt: string;
}

/** Raised when a step count is not a positive integer, so no valid step index could exist. */
export class InvalidTotalStepsError extends Error {
    public constructor(public readonly totalSteps: number) {
        super(`Invalid total step count: ${totalSteps}`);
        this.name = 'InvalidTotalStepsError';
        Object.setPrototypeOf(this, InvalidTotalStepsError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTotalStepsError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTotalStepsError}.
 */
export function isInvalidTotalStepsError(error: unknown): error is InvalidTotalStepsError {
    return error instanceof InvalidTotalStepsError;
}

/** Raised when a caller jumps to a step index the recipe does not contain. */
export class InvalidStepIndexError extends Error {
    public constructor(
        public readonly index: number,
        public readonly totalSteps: number,
    ) {
        super(`Step index ${index} is outside the range [0, ${totalSteps - 1}]`);
        this.name = 'InvalidStepIndexError';
        Object.setPrototypeOf(this, InvalidStepIndexError.prototype);
    }
}

/**
 * Type guard for {@link InvalidStepIndexError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidStepIndexError}.
 */
export function isInvalidStepIndexError(error: unknown): error is InvalidStepIndexError {
    return error instanceof InvalidStepIndexError;
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
 * @param index - The index to repair, typically from a restored session.
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
    // Membership of every required index, rather than a count: a session restored against a recipe
    // that gained or lost steps can hold ghost indices, and counting them would report a half-cooked
    // recipe as finished.
    return Array.from({ length: totalSteps }, (_unused, index) => index).every((index) =>
        completedSteps.includes(index),
    );
}

/**
 * Opens a cooking session at the recipe's first step (REQ-008).
 *
 * @param input - The recipe, its current step count, and the session's start time.
 * @returns A session at step 0 with no progress, no checked ingredients and no timers.
 * @throws {InvalidTotalStepsError} When `input.totalSteps` is not a positive integer.
 */
export function createSession(input: CreateSessionInput): CookingSession {
    assertTotalSteps(input.totalSteps);

    // `pausedAt` is omitted rather than set to `undefined`: `JSON.stringify` drops undefined values,
    // so an explicit key would make a persisted session differ from its restored copy.
    return {
        recipeId: input.recipeId,
        startedAt: input.startedAt,
        currentStepIndex: 0,
        completedSteps: [],
        checkedIngredientIds: [],
        scaleFactor: 1,
        activeTimers: [],
    };
}

/**
 * Moves to the next step, recording the step just left as completed (REQ-002).
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
 * Moves back one step, clamped at the first step (REQ-003).
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
 * Jumps directly to a step, for step-dot navigation and session restore.
 *
 * Unlike {@link advance}, this records nothing as completed: skipping over steps is not the same as
 * cooking them.
 *
 * @param session - The current session.
 * @param index - The step to jump to.
 * @param totalSteps - The recipe's current step count.
 * @returns A new session at `index`.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 * @throws {InvalidStepIndexError} When `index` is not an integer in `[0, totalSteps - 1]`.
 */
export function goToStep(session: CookingSession, index: number, totalSteps: number): CookingSession {
    assertTotalSteps(totalSteps);

    // Rejected rather than clamped, the opposite of the restore-repair above: an explicit jump to a
    // step that does not exist is a caller bug, and silently landing somewhere else would hide it.
    if (!Number.isInteger(index) || index < 0 || index > totalSteps - 1) {
        throw new InvalidStepIndexError(index, totalSteps);
    }

    return {
        ...session,
        currentStepIndex: index,
    };
}

/**
 * Marks the session as left mid-cook so it can be offered for resume.
 *
 * @param session - The current session.
 * @param pausedAtIso - ISO 8601 timestamp of the moment the user left.
 * @returns A new session carrying `pausedAt`.
 */
export function pause(session: CookingSession, pausedAtIso: string): CookingSession {
    return {
        ...session,
        pausedAt: pausedAtIso,
    };
}

/**
 * Returns a paused session to active cooking, leaving its position untouched (FR-033).
 *
 * @param session - The paused session.
 * @returns A new session with no `pausedAt`. Safe on a session that was never paused.
 */
export function resume(session: CookingSession): CookingSession {
    const resumed: CookingSession = { ...session };

    // `delete` on the local copy, not `pausedAt: undefined`: the latter survives in memory but is
    // dropped by `JSON.stringify`, so a resumed session would stop being deep-equal to its own
    // persisted-and-restored copy.
    delete resumed.pausedAt;

    return resumed;
}

/**
 * Derives the session's statechart position.
 *
 * `paused` outranks the other states because it is the only one backed by explicit state the user
 * set, and `resume` must stay reachable from it; the remaining states are read off progress.
 *
 * @param session - The session to classify.
 * @param totalSteps - The recipe's current step count.
 * @returns The current {@link SessionStatus}.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 */
export function sessionStatus(session: CookingSession, totalSteps: number): SessionStatus {
    assertTotalSteps(totalSteps);

    if (session.pausedAt !== undefined) {
        return 'paused';
    }

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
