/**
 * AUTHORED WIRE CONTRACT for the ingredients vertical (`/api/v1/ingredients/**`).
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, with a zod DISCRIMINATED UNION for the typeahead
 * suggestion. `z.discriminatedUnion` (rather than `z.union`) is deliberate: it emits a real `oneOf` with a
 * discriminator into the published document instead of flattening to an opaque `object`, which §15.2's
 * superseded-design note names as "a contract that lies", and it gives a `switch` on `provenance` the same
 * exhaustiveness the hand-written union had.
 *
 * ── THE `CandidateView` OWNERSHIP DECISION (⚠️ FLAGGED FOR THE OWNER) ──
 *
 * `GET /api/v1/ingredients/{id}/candidates` used to be typed `readonly CandidateView[]`, where `CandidateView`
 * is imported from `@kitchensink/food-service-client`. So the RECIPE API's public response shape was defined by
 * ANOTHER SERVICE'S CLIENT LIBRARY — and the recipe client then re-declared it as `IngredientCandidate`
 * specifically to avoid taking that dependency. That is the same inversion `search.schema.ts` records fixing
 * for `RecipeSearchFacets`, where a DAL internal defined a public response: computing a value does not confer
 * ownership of its wire type.
 *
 * RESOLVED HERE as: the recipe API declares its OWN candidate shape, and the service MAPS the food client's
 * view into it at the gateway boundary. Rationale — this is the option with the least coupling that still puts
 * the type where the responsibility is:
 *
 *  - the recipe client depending on `@kitchensink/food-service-client` would drag the food client (and its
 *    transitive graph) into `@commise/web` and `@commise/mobile` for one five-field interface;
 *  - `@kitchensink/schema-recipe` re-exporting from `@kitchensink/schema-food` would make one service's
 *    published contract depend on another's, so a food contract bump would move the recipe contract's hash;
 *  - promoting the shape into a shared package would need a cross-service decision this change cannot make.
 *
 * ACCEPTED CONSEQUENCE, stated rather than hidden: two structurally identical declarations exist, one per
 * service. That is not a DRY violation on the knowledge axis — they change for different reasons (food's is
 * what FOOD serves; this one is what RECIPE promises) — but it does mean a food-side field addition does not
 * automatically appear here, which is the correct behaviour for a contract we own and the wrong one if the
 * intent was a shared type. **The owner should confirm this direction**; if a shared type is wanted, the
 * follow-up is to move the shape into a package both services' contracts may compose, not to reinstate the
 * client-library import.
 */
import { z } from 'zod';

import { foodResolutionStatusSchema, ingredientSchema } from '@kitchensink/recipe-core';

/** Longest accepted opaque food-service id — bounded so a hostile body cannot carry an unbounded string. */
export const MAX_FOOD_ID_LENGTH = 64;

/** Longest accepted user-entered ingredient name. */
export const MAX_INGREDIENT_NAME_LENGTH = 120;

/** Most candidates one `resolve` call may pick. */
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
        /** Candidate display name. */
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
 * A DISCRIMINATED UNION rather than a widened `Ingredient`, because the two kinds are structurally different
 * and only one is pickable without a round-trip: collapsing them would force a fabricated ingredient id onto a
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
            /** The golden display name. */
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
 * Consumers render them as two labeled sections — the fast familiar list never reorders when the catalog
 * section appears or vanishes, which removes the layout-shift class of typeahead jank.
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
export const createIngredientRequestSchema = z.object({
    /** The user-entered ingredient name. */
    name: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(MAX_INGREDIENT_NAME_LENGTH)),
});

/** Request body for creating or admitting an ingredient by name. */
export type CreateIngredientRequest = z.infer<typeof createIngredientRequestSchema>;

/** Body of `POST /api/v1/ingredients/by-food`. */
export const addIngredientByFoodRequestSchema = z.object({
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
export const resolveIngredientRequestSchema = z.object({
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

/** Re-exported so the published contract carries the resolution-status enum a consumer branches on. */
export { foodResolutionStatusSchema };
