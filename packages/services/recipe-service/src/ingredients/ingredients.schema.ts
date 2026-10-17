/**
 * AUTHORED WIRE CONTRACT for the ingredients vertical (`/api/v1/ingredients/**`).
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY the modules the
 * allowlist in `contract/config.ts` names: `zod`, `@kitchensink/recipe-core`, `@kitchensink/schema-food` and flat
 * sibling `*.schema.js` modules. ⚠️ Composing food's `foodRefSchema` means a change to it moves THIS contract's hash
 * too.
 *
 * DESIGN PATTERN: single-source schema + inferred type, with a zod DISCRIMINATED UNION for the batch nutrition entry.
 * `z.discriminatedUnion` (not `z.union`) is deliberate: it emits a real `oneOf` + discriminator into the published
 * document instead of flattening to an opaque `object` — §15.2's "a contract that lies" — and gives a `switch` on
 * `outcome` real exhaustiveness.
 *
 * Every request body is a `z.strictObject` (GR-017 §17-c). {@link ingredientSearchQuerySchema} is the
 * READ-query exemption, reasoned once at `recipes.schema.ts`'s `listRecipesQuerySchema`.
 */
import { z } from 'zod';

import {
    foodResolutionStatusSchema,
    ingredientPortionSchema,
    ingredientSchema,
    nutritionFreshnessSchema,
    recipeExpectedVersionSchema,
} from '@kitchensink/recipe-core';
import { foodRefSchema, MAX_FOOD_REFS } from '@kitchensink/schema-food';

export const MAX_FOOD_ID_LENGTH = 64;

export const MAX_INGREDIENT_NAME_LENGTH = 120;

/**
 * Body of `POST /api/v1/ingredients` and `POST /api/v1/ingredients/by-name`.
 *
 * Trimmed before validation, so `'  '` is a `400` rather than an ingredient literally named two spaces.
 */
export const createIngredientRequestSchema = z.strictObject({
    name: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(MAX_INGREDIENT_NAME_LENGTH)),
});

/** Request body for creating or admitting an ingredient by name. */
export type CreateIngredientRequest = z.infer<typeof createIngredientRequestSchema>;

/**
 * Response of `GET /api/v1/ingredients/food-references/{foodId}` (plan U18, R22) — what the food service
 * consults before honouring a voluntary authored-food DELETE (and what its 409 reports back).
 *
 * ⛔ THE CALLER'S OWN RECIPES ONLY are ever listed by id. `total` counts every live referencing recipe —
 * a promoted food is public knowledge and the count says only "people use this" — but another user's
 * recipe id (possibly a PRIVATE recipe's) is never enumerated to the food's author.
 */
export const foodReferencesResponseSchema = z.object({
    /** Live (non-deleted) recipes referencing the food, across ALL users. */
    total: z.number().int().min(0),
    /** The CALLER's own referencing recipe ids — the ones they can act on. */
    ownRecipeIds: z.array(z.uuid()),
});

export type FoodReferencesResponse = z.infer<typeof foodReferencesResponseSchema>;

/**
 * The most refs one batch food nutrition read takes: food's own ref cap, so the refs a curated-U9 gateway forwards to
 * food are always one request. It is above the longest live variant list the details dialog sorts (75, U14 §S8.3).
 * ⛔ Not the recipe ingredient cap: the refs need not belong to any recipe.
 */
export const MAX_FOOD_NUTRITION_REFS = MAX_FOOD_REFS;

/**
 * Body of `POST /api/v1/ingredients/food-nutrition` (plan 002 U9, R31): the foods whose per-100 g nutrition the caller
 * wants. A ref is food's own `foodRefSchema`, so both services share one definition of a root or variant ref.
 *
 * ⚠️ It takes foods no recipe binds: the details dialog sorts a root's variants by calories before the cook picks
 * one. What the caller may read is decided by food, as the caller, and then by this service's concealment rule.
 */
export const ingredientFoodNutritionRequestSchema = z.strictObject({
    refs: z.array(foodRefSchema).min(1).max(MAX_FOOD_NUTRITION_REFS),
});

/** Request body for the batch food nutrition read. */
export type IngredientFoodNutritionRequest = z.infer<typeof ingredientFoodNutritionRequestSchema>;

/** A ref as the response echoes it: the request shape, open, so a widened ref never crashes an older client. */
const foodNutritionRefViewSchema = z.object(foodRefSchema.shape);

/**
 * One distinct ref's answer (plan 002 U9).
 *
 * - `found`: food answered, and the caller may read the food. A number food does not report stays missing, never 0.
 * - `absent`: food answered with nothing the caller may read: an unknown id, or another user's private food. The two
 *   are the same answer on purpose (R46, R50). A variant is answered from food's reading of its id, like a root.
 * - `unavailable`: food could not be asked, and nothing was cached.
 *
 * A `found` ROOT entry carries `hasVariants`, whether the root has a live variant, as food's batch stated it (served
 * stale with the numbers). It is absent when not known: on every variant ref, and on a food food never marks (an
 * authored one). Only `true` means a live variant exists (`docs/design/rowEditorBlueprint.md` decision 4).
 *
 * ⛔ No `status` field: the recipe detail's line view already states a line's status.
 */
export const ingredientFoodNutritionEntrySchema = z.discriminatedUnion('outcome', [
    z.object({
        outcome: z.literal('found'),
        ref: foodNutritionRefViewSchema,
        freshness: nutritionFreshnessSchema,
        ...ingredientSchema.pick({
            caloriesPer100g: true,
            proteinGPer100g: true,
            carbsGPer100g: true,
            fatGPer100g: true,
        }).shape,
        portions: z.array(ingredientPortionSchema),
        hasVariants: z.boolean().optional(),
    }),
    z.object({ outcome: z.literal('absent'), ref: foodNutritionRefViewSchema }),
    z.object({ outcome: z.literal('unavailable'), ref: foodNutritionRefViewSchema }),
]);

/** One ref's answer from the batch food nutrition read. */
export type IngredientFoodNutritionEntry = z.infer<typeof ingredientFoodNutritionEntrySchema>;

/** Response of `POST /api/v1/ingredients/food-nutrition`: one entry per distinct ref, in order of first appearance. */
export const ingredientFoodNutritionResponseSchema = z.object({
    entries: z.array(ingredientFoodNutritionEntrySchema),
});

/** Response body of the batch food nutrition read. */
export type IngredientFoodNutritionResponse = z.infer<typeof ingredientFoodNutritionResponseSchema>;

/** Body of `POST /api/v1/ingredients/by-food`. */
export const addIngredientByFoodRequestSchema = z.strictObject({
    /** The opaque food id of the food the cook picked from food's search. */
    foodId: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(MAX_FOOD_ID_LENGTH)),
});

/** Request body for admitting a food-catalog record as a local ingredient. */
export type AddIngredientByFoodRequest = z.infer<typeof addIngredientByFoodRequestSchema>;

/**
 * Body of `POST /api/v1/ingredients/by-food-variant` (curated U9, R20, R22): bind a VARIANT the cook picked in the
 * details dialog. The id is food's opaque variant id, bounded as a root's is; the response is the bound `Ingredient`,
 * whose `foodId` is the variant's live root and whose `variant` carries its parts.
 */
export const addIngredientByFoodVariantRequestSchema = z.strictObject({
    /** The opaque variant id the dialog listed (food's `GET /api/v1/foods/{rootId}` `variants[].id`). */
    foodVariantId: addIngredientByFoodRequestSchema.shape.foodId,
});

/** Request body for binding a variant. */
export type AddIngredientByFoodVariantRequest = z.infer<typeof addIngredientByFoodVariantRequestSchema>;

/**
 * Body of `POST /api/v1/recipes/{id}/ingredients/{position}/rebind` (plan 002 U5): move ONE line to a food the cook
 * picked, or to what a name resolves to. The line keeps its amount, unit, notes, preparation and section (AE11).
 *
 * ⚠️ Authored HERE, beside the food-id and name shapes it composes, although the route is a recipes route: a
 * `*.schema.ts` may import only flat siblings, so this is the one file that can compose them without re-declaring
 * their bounds.
 *
 * ⛔ There is no "create a food" target. Food's `POST /api/v1/foods/authored` creates the cook's own food and answers a
 * duplicate name with the existing food's id; a `catalogFood` rebind with that id then reaches the same end state
 * (plan 002 U5, decided 2026-09-30).
 *
 * `catalogVariant` (curated U9, R22) moves the line to a variant the cook picked in the details dialog. Removing a
 * line's variant needs no arm of its own: it is a `catalogFood` rebind to the line's `foodId`, its live root.
 */
export const rebindIngredientLineRequestSchema = z.strictObject({
    /** The recipe version the cook is editing — the same compare-and-swap token every recipe write takes. */
    expectedVersion: recipeExpectedVersionSchema,
    target: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('catalogFood'),
            /** A food id from the picker: a shared food, or the cook's own. */
            foodId: addIngredientByFoodRequestSchema.shape.foodId,
        }),
        z.strictObject({
            kind: z.literal('catalogVariant'),
            /** A variant id from the details dialog. */
            foodVariantId: addIngredientByFoodVariantRequestSchema.shape.foodVariantId,
        }),
        z.strictObject({
            kind: z.literal('name'),
            /** A name to resolve, exactly as the picker's by-name path resolves one. */
            name: createIngredientRequestSchema.shape.name,
        }),
    ]),
});

/** Request body for rebinding one recipe line. */
export type RebindIngredientLineRequest = z.infer<typeof rebindIngredientLineRequestSchema>;

/**
 * The scope a principal must hold in its token's SIGNED `public_metadata` to bind an ingredient phrase for
 * EVERY user of the installation on their first correction (plan U10 / R19, R20).
 *
 * ⚠️ PUBLISHED ON THE CONTRACT DELIBERATELY, and MOVED HERE by U14 exactly as `mappingScopePolicy.ts`
 * instructed when it sited the constant temporarily beside the policy. It is not an implementation detail: a
 * caller cannot mint a usable curator token without knowing the string, and the tooling that grants it must
 * READ the value rather than restate it — a second copy of an authorization identifier is the kind of drift
 * that fails OPEN. It sits here rather than on `recipes.schema.ts` (where `CURATOR_IMPORT_SCOPE` lives)
 * because this file authors the rebind body, the route whose correction it widens; the two are siblings, not one
 * home. `mappingScopePolicy.ts` imports it from here; nothing re-declares it.
 *
 * The GRANT itself is administered out of band, in Clerk, on the signing key's authority — see ADR-0023.
 */
export const CURATOR_MAPPING_SCOPE = 'recipes:mappings:global';

/** Query parameters of `GET …/ingredients/search`. */
export const ingredientSearchQuerySchema = z.object({
    /** The search term. */
    q: z.string().min(1),
    /** Maximum results. */
    limit: z.coerce.number().int().positive().optional(),
});

/** Query parameters for the ingredient search route. */
export type IngredientSearchQuery = z.infer<typeof ingredientSearchQuerySchema>;

/** The `GET /api/v1/ingredients/search` response body: matching catalog rows. */
export const ingredientListResponseSchema = z.array(ingredientSchema).readonly();

/** The ingredient-list response body. */
export type IngredientListResponse = z.infer<typeof ingredientListResponseSchema>;

// ── Re-exported wire shapes: the resolution enum and the ingredient entity body ───────────────────

/*
 * ⚠️ RE-EXPORT, NOT RE-DECLARATION. `recipe-core` remains the sole AUTHOR; this makes the shape reachable from
 * `@kitchensink/schema-recipe`, which is authoritative for everything on the recipe wire. Full reasoning is
 * stated ONCE, in `recipes.schema.ts`. ⛔ Do not re-declare it here to make this file self-contained.
 */
export {
    /** The resolution-status enum a consumer branches on. */
    foodResolutionStatusSchema,
    /** The `Ingredient` component — the `ingredients/search` item. */
    ingredientSchema,
};
