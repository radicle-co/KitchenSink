/**
 * @module @commise/features-recipes/wizard — pure step-rail + dirty-comparison state for the 4-step
 * recipe-edit wizard shell (w3/e1,e2). No React, no platform APIs — `Wizard.tsx`/`Wizard.native.tsx` thread
 * these through `useState`/context; this module is the ONE place the rail's completed/current/invalid rule
 * and the "unsaved edits" structural comparison are DEFINED, so the two platform leaves cannot drift.
 */
import type { RecipeFormValues, RecipeWizardStep } from '../form/model.js';

/** The wizard's 4 steps, in order — `[1] Basic → [2] Ingredients → [3] Instructions → [4] Photos`. */
export const WIZARD_STEPS: readonly RecipeWizardStep[] = [1, 2, 3, 4];

export const WIZARD_TOTAL_STEPS = WIZARD_STEPS.length;

/**
 * A step rail marker's visual/semantic state:
 * - `invalid` — the step was ATTEMPTED (the user tried to advance past it, or attempted Publish) and still
 *   has validation errors; takes priority even over the current step, so a bad current step is flagged too.
 * - `current` — the active step, not (yet) flagged invalid.
 * - `completed` — an earlier step than the active one, not flagged invalid.
 * - `upcoming` — a later step than the active one, not yet visited/attempted.
 */
export type WizardRailStepState = 'completed' | 'current' | 'invalid' | 'upcoming';

/**
 * Derive one rail marker's state (FR-044's numbered/filled/invalid circle). `attempted` gates the invalid
 * flag deliberately — an untouched step 3 must not show as "invalid" just because its instructions are still
 * empty; only a step the user actually tried to leave (via Next) or tried to Publish through earns the flag.
 * Pure.
 *
 * @param params - The step being rendered, the wizard's current step, whether `step` was attempted, and
 *   whether `step` currently has validation errors.
 * @returns The rail marker's state for `step`.
 */
export function deriveRailStepState(params: {
    readonly step: RecipeWizardStep;
    readonly currentStep: RecipeWizardStep;
    readonly attempted: boolean;
    readonly hasErrors: boolean;
}): WizardRailStepState {
    const { step, currentStep, attempted, hasErrors } = params;

    if (attempted && hasErrors) {
        return 'invalid';
    }

    if (step === currentStep) {
        return 'current';
    }

    return step < currentStep ? 'completed' : 'upcoming';
}

/**
 * Structural equality over {@link RecipeFormValues} — the discard guard's "are there unsaved edits" test.
 * Every real caller builds both sides from this package's own pure builders (`defaultRecipeFormValues`,
 * `toRecipeFormValues`, and the `props.ts` line/step transitions), which never store an explicit `undefined`
 * (optional fields are OMITTED, per the repo's `exactOptionalPropertyTypes` discipline) and construct object
 * keys in a stable, repeatable order — so a `JSON.stringify` comparison is EXACT here, not an approximation:
 * two values compare equal iff they carry the same data. Pure.
 *
 * @param a - One draft.
 * @param b - The other draft.
 * @returns Whether `a` and `b` carry the same data.
 */
export function recipeFormValuesEqual(a: RecipeFormValues, b: RecipeFormValues): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
