/**
 * @module @commise/features-recipes/editor — what Publish (or Save changes) decided before anything is sent.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Policy — one pure decision over the validator's output
 */
import type { RecipeFormErrors } from '../form/validate.js';
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
