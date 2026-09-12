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
 * {@link stepErrorsFor} is its only reader; {@link canAdvanceFromStep} reaches it TRANSITIVELY, through
 * that one filter, rather than consulting the map itself — which is the stronger property, since it
 * means the association has exactly one consumer and cannot be re-derived anywhere.
 */
const STEP_ERROR_FIELDS: Readonly<Record<RecipeWizardStep, readonly (keyof RecipeFormErrors)[]>> = {
    1: ['title', 'servings', 'times'],
    2: ['ingredients'],
    3: ['steps'],
    4: [],
};

/**
 * The subset of {@link validateRecipeForm}'s errors that belong to `step` — filters the ONE validator's
 * output by the field->step map ({@link STEP_ERROR_FIELDS}) rather than forking a step-scoped validator.
 * Pure.
 *
 * @param values - The editor's form values.
 * @param step - The wizard step whose errors to isolate.
 * @returns The {@link RecipeFormErrors} subset belonging to `step` (empty when that step is valid).
 */
export const stepErrorsFor = (values: RecipeFormValues, step: RecipeWizardStep): RecipeFormErrors => {
    const allErrors = validateRecipeForm(values);
    const errors: RecipeFormErrors = {};

    for (const field of STEP_ERROR_FIELDS[step]) {
        const code = allErrors[field];

        if (code !== undefined) {
            errors[field] = code;
        }
    }

    return errors;
};

/**
 * Whether `step` is valid enough to advance past (the wizard's `[Next: …]` gate) — `true` exactly when
 * {@link stepErrorsFor} returns no errors for that step. Pure.
 *
 * @param values - The editor's form values.
 * @param step - The wizard step to check.
 * @returns Whether the step has no validation errors.
 */
export const canAdvanceFromStep = (values: RecipeFormValues, step: RecipeWizardStep): boolean =>
    Object.keys(stepErrorsFor(values, step)).length === 0;
