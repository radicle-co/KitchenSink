/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/ingredients/ingredients.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the ingredients vertical (`/api/v1/ingredients/**`).
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY `zod`,
 * `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules (allowlist in `contract/config.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, with a zod DISCRIMINATED UNION for the typeahead
 * suggestion. `z.discriminatedUnion` (not `z.union`) is deliberate: it emits a real `oneOf` + discriminator into
 * the published document instead of flattening to an opaque `object` — §15.2's "a contract that lies" — and gives
 * a `switch` on `provenance` real exhaustiveness.
 *
 * ── THE `CandidateView` OWNERSHIP DECISION (⚠️ FLAGGED FOR THE OWNER) ──
 *
 * `GET /api/v1/ingredients/{id}/candidates` used to be typed with `@kitchensink/food-service-client`'s
 * `CandidateView` — ANOTHER SERVICE'S CLIENT LIBRARY defining the RECIPE API's public response shape. RESOLVED:
 * this API declares its OWN candidate shape and the service MAPS the food client's view into it at the gateway.
 * Rejected — the recipe client depending on the food client (drags its transitive graph into `@commise/web` and
 * `@commise/mobile` for one five-field interface); `schema-recipe` re-exporting `schema-food` (a food contract
 * bump would move the recipe hash); promoting it into a shared package (needs a cross-service decision this
 * change cannot make).
 *
 * ACCEPTED CONSEQUENCE: two structurally identical declarations, one per service. Not a DRY violation on the
 * knowledge axis (they change for different reasons — food's is what FOOD serves, this is what RECIPE promises),
 * but a food-side field addition does NOT appear here automatically. **The owner should confirm this direction**;
 * if a shared type is wanted, move the shape into a package both contracts may compose, NOT back to the
 * client-library import.
 *
 * The three request bodies are `z.strictObject` (GR-017 §17-c). {@link ingredientSearchQuerySchema} is the
 * READ-query exemption, reasoned once at `recipes.schema.ts`'s `listRecipesQuerySchema`; it is also the one bag
 * SHARED by two routes (`/search`, `/suggest`), so a parameter meaningful to one must not `400` the other.
 */
import { z } from 'zod';

import { foodResolutionStatusSchema, ingredientSchema } from '@kitchensink/recipe-core';

export const MAX_FOOD_ID_LENGTH = 64;

export const MAX_INGREDIENT_NAME_LENGTH = 120;

export const MAX_CANDIDATE_IDS = 20;

/**
 * A single cross-source disambiguation candidate for an `UNRESOLVED` ingredient (response item of
 * `GET /api/v1/ingredients/{id}/candidates`).
 *
 * Source-agnostic on purpose: keyed by the candidate's own opaque handle, never a USDA `fdcId`, so adding a
 * second source is not a wire change. See the file docstring for the ownership decision behind this shape.
 */
export const ingredientCandidateSchema = z
    .object({
        /** The candidate row id — the handle passed back to `resolve`. */
        candidateId: z.string().min(1),
        /** The source the candidate came from (e.g. `usda`). */
        source: z.string().min(1),
        /** That source's opaque key for the item (NOT a user-facing identifier). */
        externalKey: z.string().min(1),
        name: z.string().min(1),
        /** One-line disambiguation hint, or `null` when the source offers none. */
        summary: z.string().nullable(),
    })
    .readonly();

/** One cross-source disambiguation candidate. */
export type IngredientCandidate = z.infer<typeof ingredientCandidateSchema>;

/** The `GET /api/v1/ingredients/{id}/candidates` response body: the candidate list, best-first. */
export const ingredientCandidatesResponseSchema = z.array(ingredientCandidateSchema).readonly();

/** The candidate-list response body. */
export type IngredientCandidatesResponse = z.infer<typeof ingredientCandidatesResponseSchema>;

/**
 * Whether the food catalog contributed to a blend (F2).
 *
 * Three states, not a boolean, because a consumer renders each differently: `unavailable` is a transient
 * degradation worth telling the user about, whereas `disabled` is an operator switching the blend off and must
 * NEVER surface as an error.
 */
export const catalogAvailabilitySchema = z.enum(['ok', 'unavailable', 'disabled']);

/** Whether the food catalog contributed to a blend. */
export type CatalogAvailability = z.infer<typeof catalogAvailabilitySchema>;

/**
 * One blended ingredient-typeahead suggestion (item of `GET /api/v1/ingredients/suggest`).
 *
 * A DISCRIMINATED UNION rather than a widened `Ingredient`, because the two kinds are structurally different and
 * only one is pickable without a round-trip: collapsing them would force a fabricated ingredient id onto a
 * catalog hit, which ends as a foreign-key violation or a nutrition-less recipe line. Narrow on `provenance`
 * before using a suggestion.
 */
export const ingredientSuggestionSchema = z.discriminatedUnion('provenance', [
    z
        .object({
            /** A real `ingredients` row — pickable as-is. */
            provenance: z.literal('local'),
            /** The catalog row, with any nutrition it already carries. */
            ingredient: ingredientSchema,
        })
        .readonly(),
    z
        .object({
            /** A food-catalog golden record with no `ingredients` row yet — must be admitted on pick. */
            provenance: z.literal('catalog'),
            /** The opaque food id to admit via `POST /api/v1/ingredients/by-food`. Never a source-native key. */
            foodId: z.string().min(1),
            name: z.string().min(1),
            /** Relevance score from the food catalog (higher is better). */
            score: z.number(),
        })
        .readonly(),
]);

/** One blended ingredient-typeahead suggestion. */
export type IngredientSuggestion = z.infer<typeof ingredientSuggestionSchema>;

/**
 * Response envelope of `GET /api/v1/ingredients/suggest`.
 *
 * Sectioned, not interleaved: every `local` suggestion precedes every `catalog` one, and that order is stable.
 * Consumers render them as two labeled sections — the fast familiar list never reorders when the catalog section
 * appears or vanishes, which removes the layout-shift class of typeahead jank.
 */
export const ingredientSuggestionsResponseSchema = z
    .object({
        /** The blended, deduped suggestions — local section first. */
        suggestions: z.array(ingredientSuggestionSchema).readonly(),
        /** Whether the food catalog contributed; drives the picker's degraded-catalog notice. */
        catalogAvailability: catalogAvailabilitySchema,
    })
    .readonly();

/** The blended-suggestions response body. */
export type IngredientSuggestionsResponse = z.infer<typeof ingredientSuggestionsResponseSchema>;

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

/** Body of `POST /api/v1/ingredients/by-food`. */
export const addIngredientByFoodRequestSchema = z.strictObject({
    /** The opaque food id taken from a `catalog` suggestion. */
    foodId: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(MAX_FOOD_ID_LENGTH)),
});

/** Request body for admitting a food-catalog record as a local ingredient. */
export type AddIngredientByFoodRequest = z.infer<typeof addIngredientByFoodRequestSchema>;

/**
 * Body of `POST /api/v1/ingredients/{id}/resolve`.
 *
 * Bounded at {@link MAX_CANDIDATE_IDS}: the handler fans out per candidate, so an unbounded array is an
 * amplification vector rather than a generous API.
 */
export const resolveIngredientRequestSchema = z.strictObject({
    /** The candidate handles to resolve against, from `GET …/candidates`. */
    candidateIds: z
        .array(
            z
                .string()
                .transform((value) => value.trim())
                .pipe(z.string().min(1)),
        )
        .min(1)
        .max(MAX_CANDIDATE_IDS),
});

/** Request body for resolving an ingredient against picked candidates. */
export type ResolveIngredientRequest = z.infer<typeof resolveIngredientRequestSchema>;

/** Query parameters shared by `GET …/ingredients/search` and `GET …/ingredients/suggest`. */
export const ingredientSearchQuerySchema = z.object({
    /** The search term. */
    q: z.string().min(1),
    /** Maximum results (per section, for `suggest`). */
    limit: z.coerce.number().int().positive().optional(),
});

/** Query parameters for the ingredient search/typeahead routes. */
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
    /** The `Ingredient` component — the `ingredients/search` item and every `local` suggestion's payload. */
    ingredientSchema,
};
