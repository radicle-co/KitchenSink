/**
 * @module @commise/features-account/erasure — the pure, cross-platform domain logic for GDPR account
 * ERASURE (CR-002 / U4b), DISTINCT from account CLOSURE (`ProfileServiceClient.deleteMe` — recoverable).
 *
 * Erasure is IRREVERSIBLE. This module is the single authority the web and mobile erasure UIs both read, so
 * they cannot drift on (a) the exact confirmation-phrase gate or (b) which recipes the donate election may
 * offer. No React, no platform APIs — total functions over the recipe-domain type only.
 */
import { RecipeStatus, RecipeVisibility, type Recipe } from '@kitchensink/recipe-core';

/**
 * The exact phrase a user MUST type to confirm the irreversible erasure (U7). This is the CLIENT-SIDE
 * canonical copy: the recipe service owns the server-side literal
 * (`ErasureRequestDto.ACCOUNT_ERASURE_CONFIRMATION_PHRASE`) and re-validates every request, but the UI cannot
 * import a backend package across the workspace boundary — so this is the one client-side mirror both
 * platforms render and match against. The two literals are pinned equal by this package's tests and the
 * server's own contract test; changing one without the other would `400` every erasure.
 */
export const ACCOUNT_ERASURE_CONFIRMATION_PHRASE = 'ERASE MY DATA';

/**
 * Whether `input` confirms the erasure — i.e. matches {@link ACCOUNT_ERASURE_CONFIRMATION_PHRASE} after
 * trimming surrounding whitespace. Mirrors the server gate EXACTLY (`phrase.trim() === PHRASE`) so the UI
 * enables "Erase" on precisely the inputs the server will accept: trimming less would block a valid
 * confirmation, trimming more (or lower-casing) would enable one the server then rejects with a `400`.
 * Case-sensitive and inner-whitespace-sensitive, like the server. Pure.
 *
 * @param input - The raw text the user typed into the confirmation field.
 * @returns True iff the trimmed input equals the confirmation phrase.
 */
export function confirmsErasurePhrase(input: string): boolean {
    return input.trim() === ACCOUNT_ERASURE_CONFIRMATION_PHRASE;
}

/** What the erasure election reads of a recipe: its two axes, and whether a line uses a food only its author sees. */
export type ErasureElectionRecipe = Pick<Recipe, 'visibility' | 'status' | 'holdsPrivateFood'>;

/** Whether `recipe` is OWNER-ONLY: publicly visible is both `public` AND `published`, so everything else is owner-only. */
function isOwnerOnly(recipe: Pick<Recipe, 'visibility' | 'status'>): boolean {
    return !(recipe.visibility === RecipeVisibility.PUBLIC && recipe.status === RecipeStatus.PUBLISHED);
}

/**
 * Whether `recipe` is eligible for the erasure DONATE election — i.e. it is currently OWNER-ONLY and would
 * therefore be REMOVED by the erasure unless the owner elects to publish (donate) it. The two axes are orthogonal (a
 * `public` `draft` is still owner-only; a `private` `published` recipe is still owner-only). Offering an
 * already-public recipe would be a lie — donating it is a server no-op and it survives regardless — so those are
 * excluded. So is a recipe that holds a private food (ADR-0029 section 6): the server deletes it whatever the owner
 * elects, so offering it would be the same lie one door over. Pure.
 *
 * @param recipe - The recipe's visibility, publication status and whether it holds a private food.
 * @returns True iff the recipe is owner-only, shareable, and removed unless donated.
 */
export function isErasureDonationEligible(recipe: ErasureElectionRecipe): boolean {
    return isOwnerOnly(recipe) && recipe.holdsPrivateFood !== true;
}

/**
 * Whether the erasure will DELETE `recipe` with no way to keep it: owner-only AND holding a private food. The dialog
 * lists these before the cook types the phrase, so the deletion is stated, never silent (private foods spec F7). Pure.
 */
export function isErasureBlockedByPrivateFood(recipe: ErasureElectionRecipe): boolean {
    return isOwnerOnly(recipe) && recipe.holdsPrivateFood === true;
}

/**
 * The subset of `recipes` the donate election may offer (see {@link isErasureDonationEligible}), order-preserved. Pure.
 *
 * @param recipes - The owner's recipes.
 * @returns The donation-eligible recipes, in input order.
 */
export function selectDonatableRecipes<T extends ErasureElectionRecipe>(recipes: readonly T[]): readonly T[] {
    return recipes.filter(isErasureDonationEligible);
}

/**
 * The subset of `recipes` the erasure deletes because they hold a private food (see
 * {@link isErasureBlockedByPrivateFood}), order-preserved. Pure.
 */
export function selectBlockedRecipes<T extends ErasureElectionRecipe>(recipes: readonly T[]): readonly T[] {
    return recipes.filter(isErasureBlockedByPrivateFood);
}
