/**
 * @module @commise/features-recipes/wizard — pure step-rail + dirty-comparison state for the 4-step
 * recipe-edit wizard shell (w3/e1,e2). No React, no platform APIs — `Wizard.tsx`/`Wizard.native.tsx` thread
 * these through `useState`/context; this module is the ONE place the rail's completed/current/invalid rule
 * and the "unsaved edits" structural comparison are DEFINED, so the two platform leaves cannot drift.
 */
import type { RecipeFormErrorCode, RecipeFormErrors, RecipeFormValues, RecipeWizardStep } from '../form/model.js';

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
 * The distinct validation codes that are BLOCKING the author from leaving a step — what the footer surfaces
 * when `Next` was pressed and the wizard refused to advance.
 *
 * Why this exists: `Next` is always enabled and `requestGoNext` marks the step attempted then calls a
 * `goNext` that no-ops while the step is invalid. Before this, the only feedback was the rail marker
 * flipping to `invalid` — so on a step whose body is a single empty list (step 2 with no ingredients) the
 * primary control simply did nothing, with nothing said. An enabled control that silently refuses is a
 * defect; DISABLING it instead would be worse, because the attempt is what flags the rail in the first
 * place (see {@link deriveRailStepState}).
 *
 * `attempted` gates it for the same reason the rail's `invalid` flag is gated: an author who has merely
 * ARRIVED at an incomplete step must not be shouted at. Deduped, because two fields of one step can carry
 * the same code and the notice must not repeat a sentence. Pure.
 *
 * NOTE — after a failed Publish the container ALSO populates its own `errors` prop (whole-form validation),
 * so returning to an invalid step can show the same sentence both inline and here. That overlap is
 * deliberate and bounded: the two have different triggers (a field's own state vs. a refused navigation),
 * and suppressing either would put one of them back to failing silently.
 *
 * @param attempted - Whether the author has already tried to advance past (or publish through) this step.
 * @param errors - That step's validation errors ({@link import('../form/model.js').stepErrorsFor}'s output).
 * @returns The distinct blocking codes, in field order; empty when unattempted or valid.
 */
export function blockedAdvanceErrors(attempted: boolean, errors: RecipeFormErrors): readonly RecipeFormErrorCode[] {
    if (!attempted) {
        return [];
    }

    return [...new Set(Object.values(errors).filter((code): code is RecipeFormErrorCode => code !== undefined))];
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
