/**
 * @module @commise/features-recipes/form — the 4-step editor wizard's STEP VOCABULARY and the field↔step map.
 *
 * ⚠️ This owns the step vocabulary, NOT the wizard shell — `src/wizard/` owns that. And a wizard step is
 * orthogonal, presentational-navigation state: it is not a variant of the edit lifecycle's `EditorState`,
 * and a step change never touches that machine.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import { type RecipeFormValues } from './values.js';
import { type RecipeFormErrors, validateRecipeForm } from './validate.js';

/**
 * The 4-step recipe-edit wizard (w3): `1` Basic Info, `2` Ingredients, `3` Instructions, `4` Review. This is
 * orthogonal, presentational-navigation state — it is NOT a variant of the edit lifecycle's `EditorState`
 * (`useRecipeEditor.ts`'s `loading/editing/submitting/conflict/saved` statechart); a step change never
 * affects that machine (no reseed, no `saved`-latch reset).
 */
export type RecipeWizardStep = 1 | 2 | 3 | 4;

/**
 * The field->step map (w3): which {@link RecipeFormErrors} keys belong to which wizard step. Step 4
 * (Review — it was `Photos` until U33 renamed it) has NO validation-error key at all — photo upload is decoupled from form validation (the
 * wireframe: "Metadata saves immediately; photos upload independently") — so it maps to an empty field list
 * and is therefore always advanceable. ⚠️ That empty list is STILL correct after the U33 rename: Review
 * summarises the other steps and owns no field of its own, so there is nothing here to "fix". This is the ONE place the field<->step association is stated.
 * {@link errorsInStep} is its only reader; every other step question ({@link stepErrorsFor},
 * {@link canAdvanceFromStep}, the wizard's `firstStepWithErrors`) reaches it TRANSITIVELY, through that one filter,
 * so the association has exactly one consumer and cannot be re-derived anywhere.
 */
const STEP_ERROR_FIELDS: Readonly<Record<RecipeWizardStep, readonly (keyof RecipeFormErrors)[]>> = {
    1: ['title', 'servings', 'times'],
    2: ['ingredients'],
    3: ['steps'],
    4: [],
};

/**
 * The subset of `errors` that belongs to `step`, by the field->step map ({@link STEP_ERROR_FIELDS}), which this is the
 * one reader of. A key present with no code is no error. Pure.
 *
 * @param errors - Errors a gate already has.
 * @param step - The wizard step whose errors to isolate.
 * @returns The {@link RecipeFormErrors} subset belonging to `step` (empty when that step holds none).
 */
export const errorsInStep = (errors: RecipeFormErrors, step: RecipeWizardStep): RecipeFormErrors => {
    const inStep: RecipeFormErrors = Object.create(null) as RecipeFormErrors;

    for (const field of STEP_ERROR_FIELDS[step]) {
        const code = errors[field];

        if (code !== undefined) {
            inStep[field] = code;
        }
    }

    return inStep;
};

/**
 * The subset of {@link validateRecipeForm}'s errors that belong to `step`: the ONE validator's output filtered by
 * {@link errorsInStep}, rather than a forked step-scoped validator. Pure.
 *
 * @param values - The editor's form values.
 * @param step - The wizard step whose errors to isolate.
 * @param pendingEntryText - The text an ingredient entry holds and has not committed (`validateRecipeForm`).
 * @returns The {@link RecipeFormErrors} subset belonging to `step` (empty when that step is valid).
 */
export const stepErrorsFor = (
    values: RecipeFormValues,
    step: RecipeWizardStep,
    pendingEntryText: string,
): RecipeFormErrors => errorsInStep(validateRecipeForm(values, pendingEntryText), step);

/**
 * Whether `step` is valid enough to advance past (the wizard's `[Next: …]` gate) — `true` exactly when
 * {@link stepErrorsFor} returns no errors for that step. Pure.
 *
 * @param values - The editor's form values.
 * @param step - The wizard step to check.
 * @param pendingEntryText - The text an ingredient entry holds and has not committed (`validateRecipeForm`).
 * @returns Whether the step has no validation errors.
 */
export const canAdvanceFromStep = (
    values: RecipeFormValues,
    step: RecipeWizardStep,
    pendingEntryText: string,
): boolean => Object.keys(stepErrorsFor(values, step, pendingEntryText)).length === 0;

/**
 * The floor a DRAFT save checks: step 1's fields, the only ones the wire refuses outright (`useRecipeEditor`'s module
 * doc), and text an ingredient entry holds, because a draft save leaves the editor and the text would go with it
 * (`docs/design/ingredientStatusExplanation.md` §4b). Pure.
 *
 * @param values - The editor's form values.
 * @param pendingEntryText - The text an ingredient entry holds and has not committed (`validateRecipeForm`).
 * @returns The errors that refuse a draft save (empty when one may go ahead).
 */
export const draftFloorErrors = (values: RecipeFormValues, pendingEntryText: string): RecipeFormErrors => {
    const { ingredients } = validateRecipeForm(values, pendingEntryText);

    return {
        ...stepErrorsFor(values, 1, pendingEntryText),
        ...(ingredients === 'ingredientsPendingText' ? { ingredients } : {}),
    };
};
