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
    InvalidTotalStepsError,
    isInvalidLineIndexError,
    isInvalidStepIndexError,
    isInvalidTotalStepsError,
} from './errors.js';

// ── Steps as the cook walks them: lines and place (FR-032, FR-033, FR-033a) ──
export { STEP_LINE_ABBREVIATIONS, splitStepLines } from './stepLines.js';
export { cookingStepsOf } from './cookingSteps.js';
export type { CookingStep } from './cookingSteps.js';
export { linePlace, stepPlace } from './place.js';
export type { LinePlace, StepPlace } from './place.js';
export { cookLinkOutcome } from './cookLinkOutcome.js';
export type { CookLinkInput, CookLinkOutcome } from './cookLinkOutcome.js';
