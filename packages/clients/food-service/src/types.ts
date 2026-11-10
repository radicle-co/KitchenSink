/**
 * The types this client OWNS: the results of its own methods, named over the contract the food (ingredient) service
 * publishes. The service's wire types are not re-declared or re-exported here: `index.ts` re-exports them from
 * `@kitchensink/schema-food`, the one list of them (`docs/CODING_STANDARDS.md` §15, rules 1 and 4), and modules in this
 * package import them from there.
 */
import type {
    CorroboratedResponse,
    CreateAuthoredFoodRequest,
    FoodNutritionBatchResponse,
    FoodResponse,
    UpdateAuthoredFoodRequest,
} from '@kitchensink/schema-food';

/** `GET /api/v1/foods/nutrition` — batch per-100g nutrition + normalized portions (plan U8). */
export type FoodNutritionBatchResult = FoodNutritionBatchResponse;

/** Input to `createAuthoredFood` — the service-published request type, re-exported under the client's name. */
export type CreateAuthoredFoodInput = CreateAuthoredFoodRequest;

/**
 * Outcome of `createAuthoredFood`: created, or the caller's per-author dedup collision carrying the
 * EXISTING food's id (the U16 reuse affordance's whole input).
 */
export type CreateAuthoredFoodResult =
    | { readonly kind: 'created'; readonly food: FoodResponse }
    | { readonly kind: 'duplicate'; readonly existingId: string };

/** Outcome of `corroborateFood` (plan U19) — the food's (possibly unchanged) status after the trigger. */
export type CorroboratedResult = CorroboratedResponse;

/** Input to `updateAuthoredFood`: the service-published request type. */
export type UpdateAuthoredFoodInput = UpdateAuthoredFoodRequest;

/**
 * Outcome of `updateAuthoredFood`: a private food's edit APPLIED at once (`200`), or a public food's edit was saved as a
 * version that waits for staff (`202 editPending`, ADR-0029 section 7). Readers keep the approved version until then.
 */
export type UpdateAuthoredFoodResult =
    | { readonly kind: 'applied'; readonly food: FoodResponse }
    | { readonly kind: 'editPending'; readonly versionNumber: number };
