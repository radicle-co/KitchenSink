import type { RecipeStepView } from '@kitchensink/recipe-core';

import type { CookingTimer } from './types.js';

/**
 * MOD-006 — countdown timer engine for Cooking Mode (FR-034 / REQ-004, REQ-005, REQ-006).
 *
 * SAFETY INVARIANT: this module has **no reference to yield scaling** and imports no scaling module.
 * Cook time does not scale linearly with yield — doubling a batch does not double bake time — so a
 * scaled timer would emit wrong and potentially unsafe cooking instructions. See spec.md D-002. The
 * invariant is structural, not merely tested: `UTS-006-F1` asserts the import graph.
 *
 * DESIGN: every function is pure and takes the current instant (`nowIso`) as an **input**; the module
 * never reads the ambient clock. Two consequences, both deliberate:
 *
 *  - Remaining time is *derived* from timestamps rather than decremented by a tick. A decrementing
 *    counter drifts, and stops entirely while a mobile app is backgrounded — which is the normal case
 *    for a phone propped up in a kitchen. Deriving it means a timer is correct the instant the app
 *    returns to the foreground, with no catch-up logic.
 *  - Every branch below is deterministic and testable without fake timers.
 *
 * Scheduling the re-render tick, the audible alert (REQ-006) and notification delivery belong to the
 * platform widget (MOD-007), not to this domain engine.
 */

/** Milliseconds in one second. `RecipeStepView.timerSeconds` is in SECONDS; treating it as minutes is 60x wrong. */
const MS_PER_SECOND = 1_000;

/** Raised when a caller builds a timer from a step that carries no `timerSeconds`. */
export class StepHasNoTimerError extends Error {
    public constructor(public readonly stepNumber: number) {
        super(`Step ${stepNumber} has no timer duration`);
        this.name = 'StepHasNoTimerError';
        Object.setPrototypeOf(this, StepHasNoTimerError.prototype);
    }
}

/**
 * Type guard for {@link StepHasNoTimerError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link StepHasNoTimerError}.
 */
export function isStepHasNoTimerError(error: unknown): error is StepHasNoTimerError {
    return error instanceof StepHasNoTimerError;
}

/** Raised when a step's `timerSeconds` is present but is not a whole, positive, finite number of seconds. */
export class InvalidTimerDurationError extends Error {
    public constructor(public readonly timerSeconds: number) {
        super(`Invalid timer duration: ${timerSeconds} seconds`);
        this.name = 'InvalidTimerDurationError';
        Object.setPrototypeOf(this, InvalidTimerDurationError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTimerDurationError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTimerDurationError}.
 */
export function isInvalidTimerDurationError(error: unknown): error is InvalidTimerDurationError {
    return error instanceof InvalidTimerDurationError;
}

/** Raised when a timestamp argument or stored timestamp is not a parseable ISO 8601 instant. */
export class InvalidTimestampError extends Error {
    public constructor(public readonly value: string) {
        super(`Invalid ISO 8601 timestamp: ${value}`);
        this.name = 'InvalidTimestampError';
        Object.setPrototypeOf(this, InvalidTimestampError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTimestampError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTimestampError}.
 */
export function isInvalidTimestampError(error: unknown): error is InvalidTimestampError {
    return error instanceof InvalidTimestampError;
}

/** Raised when a timer's own fields are internally inconsistent — typically a corrupted restore from storage. */
export class InvalidTimerStateError extends Error {
    public constructor(
        public readonly timerId: string,
        public readonly reason: string,
    ) {
        super(`Timer ${timerId} is in an invalid state: ${reason}`);
        this.name = 'InvalidTimerStateError';
        Object.setPrototypeOf(this, InvalidTimerStateError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTimerStateError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTimerStateError}.
 */
export function isInvalidTimerStateError(error: unknown): error is InvalidTimerStateError {
    return error instanceof InvalidTimerStateError;
}

/** Raised when a timer is started whose id is already running. */
export class DuplicateTimerIdError extends Error {
    public constructor(public readonly timerId: string) {
        super(`A timer with id ${timerId} is already running`);
        this.name = 'DuplicateTimerIdError';
        Object.setPrototypeOf(this, DuplicateTimerIdError.prototype);
    }
}

/**
 * Type guard for {@link DuplicateTimerIdError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link DuplicateTimerIdError}.
 */
export function isDuplicateTimerIdError(error: unknown): error is DuplicateTimerIdError {
    return error instanceof DuplicateTimerIdError;
}

/** Raised when a caller addresses a timer id that is not in the active list. */
export class UnknownTimerError extends Error {
    public constructor(public readonly timerId: string) {
        super(`Unknown timer: ${timerId}`);
        this.name = 'UnknownTimerError';
        Object.setPrototypeOf(this, UnknownTimerError.prototype);
    }
}

/**
 * Type guard for {@link UnknownTimerError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link UnknownTimerError}.
 */
export function isUnknownTimerError(error: unknown): error is UnknownTimerError {
    return error instanceof UnknownTimerError;
}

/**
 * Parses an ISO 8601 timestamp to epoch milliseconds.
 *
 * `Date.parse` is the platform's own ISO 8601 reader; a hand-rolled or library parser would buy nothing
 * here, since any string it accepts is normalised back to a canonical instant by {@link toIsoString}.
 * Timestamps are validated on the way in because a session is restored from device storage, where a
 * corrupt value would otherwise propagate silently as `NaN` through the whole countdown.
 *
 * @param value - The timestamp to parse.
 * @returns Epoch milliseconds.
 * @throws {InvalidTimestampError} When `value` is not a parseable timestamp.
 */
function parseTimestamp(value: string): number {
    const epochMs = Date.parse(value);

    if (Number.isNaN(epochMs)) {
        throw new InvalidTimestampError(value);
    }

    return epochMs;
}

/**
 * Renders epoch milliseconds as a canonical UTC ISO 8601 string.
 *
 * @param epochMs - Epoch milliseconds.
 * @returns The canonical ISO 8601 representation — never a `Date`, so the value stays JSON-round-trippable.
 */
function toIsoString(epochMs: number): string {
    return new Date(epochMs).toISOString();
}

/**
 * Reads a timer's captured paused remaining time.
 *
 * @param timer - A timer whose `isPaused` is `true`.
 * @returns The captured remaining milliseconds, clamped into `[0, durationMs]`.
 * @throws {InvalidTimerStateError} When the timer is paused but carries no usable `pausedRemainingMs`.
 */
function pausedRemainingOf(timer: CookingTimer): number {
    const captured = timer.pausedRemainingMs;

    if (captured === undefined || !Number.isFinite(captured)) {
        // A paused timer without a captured remaining is unrepresentable through this module's own
        // constructors, so reaching here means storage (or a hand-built object) lied. Resuming the
        // countdown from `startedAt` instead would silently burn the paused interval off the clock.
        throw new InvalidTimerStateError(timer.id, 'paused with no captured remaining time');
    }

    return clampToDuration(captured, timer);
}

/**
 * Clamps a remaining-time value into the only range a countdown can legitimately report.
 *
 * @param value - The raw remaining milliseconds.
 * @param timer - The timer the value belongs to.
 * @returns `value` bounded by `[0, timer.durationMs]`.
 * @throws {InvalidTimerStateError} When the timer's `durationMs` is not a finite, non-negative number.
 */
function clampToDuration(value: number, timer: CookingTimer): number {
    if (!Number.isFinite(timer.durationMs) || timer.durationMs < 0) {
        throw new InvalidTimerStateError(timer.id, `durationMs is ${timer.durationMs}`);
    }

    // The upper bound is not cosmetic: a device clock corrected backwards mid-cook puts `now` before
    // `startedAt`, which would otherwise display more time remaining than the timer was ever set for.
    return Math.min(Math.max(value, 0), timer.durationMs);
}

/**
 * Builds a timer from a recipe step's inline duration (REQ-004).
 *
 * The step's id becomes the timer's id, so a step can only have one timer running at a time and a
 * double-start is caught by {@link startTimer} rather than producing two competing countdowns.
 *
 * @param step - The recipe step, whose `timerSeconds` is in **seconds**.
 * @param nowIso - The current instant, ISO 8601.
 * @returns A running timer. The step is never mutated (REQ-CN-001).
 * @throws {StepHasNoTimerError} When the step carries no `timerSeconds` — the common, expected case.
 * @throws {InvalidTimerDurationError} When `timerSeconds` is present but not a whole, positive, finite number.
 * @throws {InvalidTimestampError} When `nowIso` is not a parseable timestamp.
 */
/**
 * The session-scoped id of the timer belonging to a step.
 *
 * Derived from `stepNumber` rather than a persistence id because the client holds `RecipeStepView`
 * (the wire projection on `RecipeDetail.steps`), which carries no `id`. There is at most one timer per
 * step, so the step number is a stable unique key for the life of the session.
 *
 * @param stepNumber - The step's 1-based display order.
 * @returns The timer id for that step.
 */
export function timerIdForStep(stepNumber: number): string {
    return `step-${stepNumber}`;
}

export function createTimerFromStep(step: RecipeStepView, nowIso: string): CookingTimer {
    const startedAt = toIsoString(parseTimestamp(nowIso));
    const seconds = step.timerSeconds;

    if (seconds === undefined) {
        throw new StepHasNoTimerError(step.stepNumber);
    }

    if (!Number.isInteger(seconds) || seconds <= 0) {
        // `Number.isInteger` rejects NaN, Infinity and fractional seconds in one check. A zero-second
        // timer is rejected rather than started-and-instantly-complete, which would fire an alert for
        // a step that has no wait at all.
        throw new InvalidTimerDurationError(seconds);
    }

    return {
        // Derived from `stepNumber`, NOT a persistence id: the client holds `RecipeStepView` (the wire
        // projection on `RecipeDetail.steps`), which carries no `id` at all. `stepNumber` is unique
        // within a recipe and there is at most one timer per step, so it is a stable session-scoped key.
        id: timerIdForStep(step.stepNumber),
        // The step's own instruction text — recipe content, so it needs no localization. Truncating it
        // for a compact timer chip is the render layer's decision, not the engine's.
        label: step.instruction,
        stepNumber: step.stepNumber,
        // The ONE place seconds become milliseconds (FR-034 / D-002: never touched by a scale factor).
        durationMs: seconds * MS_PER_SECOND,
        startedAt,
        isPaused: false,
    };
}

/**
 * Reports how much time is left on a timer at a given instant (REQ-005).
 *
 * @param timer - The timer to read.
 * @param nowIso - The current instant, ISO 8601. Validated even for a paused timer, so the contract
 *   does not silently accept a bad clock value on one branch and reject it on another.
 * @returns Milliseconds remaining, always within `[0, timer.durationMs]` — never negative.
 * @throws {InvalidTimestampError} When `nowIso` or the timer's `startedAt` is not parseable.
 * @throws {InvalidTimerStateError} When the timer's duration or paused state is inconsistent.
 */
export function remainingMs(timer: CookingTimer, nowIso: string): number {
    const nowMs = parseTimestamp(nowIso);

    if (timer.isPaused) {
        return pausedRemainingOf(timer);
    }

    const elapsedMs = nowMs - parseTimestamp(timer.startedAt);

    return clampToDuration(timer.durationMs - elapsedMs, timer);
}

/**
 * Reports whether a timer has finished counting down (REQ-006 — the alert trigger).
 *
 * @param timer - The timer to read.
 * @param nowIso - The current instant, ISO 8601.
 * @returns `true` from the exact instant the full duration has elapsed onwards.
 * @throws {InvalidTimestampError} When `nowIso` or the timer's `startedAt` is not parseable.
 * @throws {InvalidTimerStateError} When the timer's duration or paused state is inconsistent.
 */
export function isComplete(timer: CookingTimer, nowIso: string): boolean {
    return remainingMs(timer, nowIso) === 0;
}

/**
 * Pauses a timer, capturing the time remaining at that instant.
 *
 * @param timer - The timer to pause.
 * @param nowIso - The instant the user paused, ISO 8601.
 * @returns A paused copy. Pausing an already-paused timer returns it unchanged, so a repeated tap
 *   cannot re-capture (and therefore cannot alter) the frozen remaining time.
 * @throws {InvalidTimestampError} When `nowIso` or the timer's `startedAt` is not parseable.
 * @throws {InvalidTimerStateError} When the timer's duration is inconsistent.
 */
export function pauseTimer(timer: CookingTimer, nowIso: string): CookingTimer {
    const capturedRemainingMs = remainingMs(timer, nowIso);

    if (timer.isPaused) {
        return timer;
    }

    return { ...timer, isPaused: true, pausedRemainingMs: capturedRemainingMs };
}

/**
 * Resumes a paused timer with exactly the remaining time captured at pause.
 *
 * `startedAt` is rewound so that `nowIso` minus the already-elapsed portion lands on it. That keeps the
 * countdown a pure function of two timestamps — no accumulated-pause bookkeeping to drift — and it is
 * why a pause/resume cycle can neither shorten nor extend the timer (`UTS-006-D5`, `UTS-006-D6`).
 *
 * @param timer - The timer to resume.
 * @param nowIso - The instant the user resumed, ISO 8601.
 * @returns A running copy, with the paused marker dropped rather than left stale. Resuming a timer that
 *   is not paused returns it unchanged.
 * @throws {InvalidTimestampError} When `nowIso` is not parseable.
 * @throws {InvalidTimerStateError} When the timer is paused with no usable captured remaining time.
 */
export function resumeTimer(timer: CookingTimer, nowIso: string): CookingTimer {
    const nowMs = parseTimestamp(nowIso);

    if (!timer.isPaused) {
        return timer;
    }

    const elapsedMs = timer.durationMs - pausedRemainingOf(timer);
    const resumed = { ...timer, startedAt: toIsoString(nowMs - elapsedMs), isPaused: false };
    // Deleted rather than omitted field-by-field: a copy built from an explicit field list would
    // silently drop any field later added to `CookingTimer`.
    delete resumed.pausedRemainingMs;

    return resumed;
}

/**
 * Adds a timer to the set of concurrently running timers.
 *
 * @param timers - The currently running timers.
 * @param timer - The timer to start.
 * @returns A new array with `timer` appended. Never mutates `timers`.
 * @throws {DuplicateTimerIdError} When a timer with the same id is already running. Rejected rather
 *   than deduped: silently keeping the first would leave the caller believing it started a new
 *   countdown, and silently replacing it would discard a running one.
 */
export function startTimer(timers: readonly CookingTimer[], timer: CookingTimer): CookingTimer[] {
    if (timers.some((running) => running.id === timer.id)) {
        throw new DuplicateTimerIdError(timer.id);
    }

    return [...timers, timer];
}

/**
 * Cancels one running timer.
 *
 * @param timers - The currently running timers.
 * @param id - The id to cancel.
 * @returns A new array without that timer. Never mutates `timers`.
 * @throws {UnknownTimerError} When no timer has that id. Fails loudly rather than no-opping: a cancel
 *   that silently does nothing leaves a timer the user believes they stopped still running to an alert.
 */
export function cancelTimer(timers: readonly CookingTimer[], id: string): CookingTimer[] {
    if (!timers.some((running) => running.id === id)) {
        throw new UnknownTimerError(id);
    }

    return timers.filter((running) => running.id !== id);
}

/**
 * Selects the timers that have finished, so the caller can raise one alert per completion (REQ-006).
 *
 * @param timers - The currently running timers.
 * @param nowIso - The current instant, ISO 8601.
 * @returns The finished timers, in the order they appear in `timers`. Never mutates `timers`.
 * @throws {InvalidTimestampError} When `nowIso` or any timer's `startedAt` is not parseable.
 * @throws {InvalidTimerStateError} When any timer's duration or paused state is inconsistent.
 */
export function completedTimers(timers: readonly CookingTimer[], nowIso: string): CookingTimer[] {
    return timers.filter((timer) => isComplete(timer, nowIso));
}
