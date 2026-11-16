/**
 * `@kitchensink/cooking-core` — platform-free domain logic for Cooking Mode (feature 008).
 *
 * Contains no UI and no platform SDK. Recipe-shaped types come from `@kitchensink/recipe-core`
 * (GR-007).
 */

// ── Cookability: which steps count, and whether a recipe can be cooked ─────────
export { countCookableSteps, hasStepText, isCookable } from './cookability.js';
export type { CookabilityInput } from './cookability.js';

// ── Errors ───────────────────────────────────────────────────────────────────
export {
    InvalidLineIndexError,
    InvalidStepIndexError,
    InvalidTimerDurationError,
    InvalidTotalStepsError,
    TimerAlreadyActiveError,
    isInvalidLineIndexError,
    isInvalidStepIndexError,
    isInvalidTimerDurationError,
    isInvalidTotalStepsError,
    isTimerAlreadyActiveError,
} from './errors.js';

// ── Steps as the cook walks them: lines and place (FR-032, FR-033, FR-033a) ──
export { STEP_LINE_ABBREVIATIONS, splitStepLines } from './stepLines.js';
export { STEP_DIGEST_VERSION, matchStep, matchStepStrict, normalizeStepText, stepDigest } from './stepDigest.js';
export type { StepRef } from './stepDigest.js';
export { cookingStepsOf } from './cookingSteps.js';
export type { CookingStep } from './cookingSteps.js';
export { linePlace, stepPlace } from './place.js';
export type { LinePlace, StepPlace } from './place.js';
export { cookLinkOutcome } from './cookLinkOutcome.js';
export type { CookLinkInput, CookLinkOutcome } from './cookLinkOutcome.js';

// ── The session: step navigation and line ticks (FR-032, FR-033) ─────────────
export { advance, createSession, goBack, sessionStatus } from './session.js';
export type { CreateSessionInput, SessionStatus } from './session.js';
export type { CookingSession } from './types.js';
export {
    allLinesTicked,
    createLineTicks,
    focusLineIndex,
    isLineTicked,
    tickedLineCount,
    tickLine,
    untickLine,
} from './lineTicks.js';
export type { LineKey, LineTicks } from './lineTicks.js';

// ── The timer: one reducer over commands, and the reader of a step's duration ──
export { MAX_TIMER_MS, MIN_TIMER_MS, NO_TIMER, isValidTimerMs, reduceTimer, timeLeftMs } from './timer.js';
export type {
    ActiveTimer,
    HeldTimer,
    PausedTimer,
    RingingTimer,
    RunningTimer,
    TimerBase,
    TimerCommand,
    TimerEvent,
    TimerResult,
    TimerState,
} from './timer.js';
export { durationParts, elapsedParts, offerSecondsOf, readDuration } from './duration.js';
export type { DurationParts, DurationReading, ElapsedParts, OfferInput } from './duration.js';
