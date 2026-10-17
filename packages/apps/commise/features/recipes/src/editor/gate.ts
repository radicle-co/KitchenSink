/**
 * @module @commise/features-recipes/editor — what Publish (or Save changes) decided before anything is sent.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Policy — one pure decision over the validator's output
 */
import { recipeStepInstructionSchema } from '@kitchensink/recipe-core';

import {
    cuisineFieldId,
    descriptionFieldId,
    ingredientAddFieldId,
    stepFieldId,
    titleFieldId,
} from '../form/fieldIds.js';
import { validateRecipeForm, type RecipeFormErrors } from '../form/validate.js';
import type { RecipeFormValues } from '../form/values.js';
import { firstSectionWithErrors, type EditorSectionId } from './sections.js';

/**
 * What a gate decided: go ahead, refuse, or wait for a rebind command in flight (`useRecipeEditor`). A refusal carries
 * its errors and the first section, in page order, holding one — where the cook is taken (build spec §7.8).
 */
export type GateOutcome =
    | { readonly kind: 'send' }
    | { readonly kind: 'refused'; readonly errors: RecipeFormErrors; readonly section: EditorSectionId | undefined }
    | { readonly kind: 'busy' };

/**
 * The gate's decision over the errors it found. Every present code refuses, whether or not a section owns it, so a
 * code the field map does not list can never let a publish through; a key present with no code is no error.
 *
 * @param errors - The errors the gate's validator found.
 * @returns `send`, or `refused` with the section to land on. Pure.
 */
export function gateOutcomeOf(errors: RecipeFormErrors): Exclude<GateOutcome, { readonly kind: 'busy' }> {
    const refused = Object.values(errors).some((code) => code !== undefined);

    return refused ? { kind: 'refused', errors, section: firstSectionWithErrors(errors) } : { kind: 'send' };
}

/** A field of the form a refused Publish can name. */
export type RefusedField = keyof RecipeFormErrors;

/**
 * Which fields a refused Publish named. A SET of fields and not the errors: the code a field fails with is a fact about
 * the draft as it is NOW ({@link errorsStillHolding}), so storing the press's codes stored a second, stale copy of it.
 *
 * @param errors - What the gate's validator found at the press.
 * @returns The fields holding a code. Pure.
 */
export function refusedFieldsOf(errors: RecipeFormErrors): ReadonlySet<RefusedField> {
    return new Set((Object.keys(errors) as RefusedField[]).filter((field) => errors[field] !== undefined));
}

/**
 * The fields a refused Publish named that the draft still fails, each with the reason it fails now. A field the cook has
 * since fixed loses its error; one that was never refused never gains one before the next press (the section badges read
 * the draft live and need no help).
 *
 * ⛔ THE ENTRY TEXT IS THE ENTRY'S AS IT IS NOW, passed in by the view that owns the entry. The editor hears it only at a
 * press, so a code read from the press's text kept `ingredientsPendingText` on screen after the cook cleared or
 * committed the entry.
 *
 * @param refused - The fields the last refused Publish or Save changes named.
 * @param draft - The draft as it is now.
 * @param pendingEntryText - The text the ingredient entry holds uncommitted now; `''` when none does.
 * @returns The refused fields still failing, with their live codes. Pure.
 */
export function errorsStillHolding(
    refused: ReadonlySet<RefusedField>,
    draft: RecipeFormValues,
    pendingEntryText: string,
): RecipeFormErrors {
    if (refused.size === 0) {
        return {};
    }

    const live = validateRecipeForm(draft, pendingEntryText);

    return Object.fromEntries(
        Object.entries(live).filter(([field, code]) => code !== undefined && refused.has(field as RefusedField)),
    );
}

/**
 * The field a refused Publish takes focus to (build spec §7.8, WCAG 3.3.1): the first, in page order, that the validator
 * refused and that has ONE control to land on. An error with no single control — a line not matched yet, a bad amount in
 * one of many rows, servings, times — has none, and the section's heading takes the cook, as it always did.
 *
 * @param errors - The errors the gate refused with.
 * @param values - The draft they were found in (a step's id is its index).
 * @returns The field's element id, or `undefined` when no refused error has a field. Pure.
 */
export function firstInvalidFieldOf(errors: RecipeFormErrors, values: RecipeFormValues): string | undefined {
    if (errors.title !== undefined) {
        return titleFieldId;
    }

    if (errors.description !== undefined) {
        return descriptionFieldId;
    }

    // Page order: the cuisine sits in Details after the description, and servings and times have no single control.
    if (errors.cuisine !== undefined) {
        return cuisineFieldId;
    }

    if (errors.ingredients === 'ingredientsEmpty' || errors.ingredients === 'ingredientsPendingText') {
        return ingredientAddFieldId;
    }

    if (errors.steps !== undefined) {
        // The rule is the validator's own: the same Value Object, so the two cannot disagree about which step is bad.
        const index = values.steps.findIndex(
            (step) => !recipeStepInstructionSchema.safeParse(step.instruction.trim()).success,
        );

        return index === -1 ? undefined : stepFieldId(index);
    }

    return undefined;
}
