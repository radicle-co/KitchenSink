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
 * The four request bodies are `z.strictObject` (GR-017 §17-c). {@link ingredientSearchQuerySchema} is the
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

/**
 * The scope a principal must hold in its token's SIGNED `public_metadata` to bind an ingredient phrase for
 * EVERY user of the installation on their first correction (plan U10 / R19, R20).
 *
 * ⚠️ PUBLISHED ON THE CONTRACT DELIBERATELY, and MOVED HERE by U14 exactly as `mappingScopePolicy.ts`
 * instructed when it sited the constant temporarily beside the policy. It is not an implementation detail: a
 * caller cannot mint a usable curator token without knowing the string, and the tooling that grants it must
 * READ the value rather than restate it — a second copy of an authorization identifier is the kind of drift
 * that fails OPEN. It sits here rather than on `recipes.schema.ts` (where `CURATOR_IMPORT_SCOPE` lives)
 * because this is the contract file of the route that consumes it; the two are siblings, not one home.
 * `mappingScopePolicy.ts` imports it from here; nothing re-declares it.
 *
 * The GRANT itself is administered out of band, in Clerk, on the signing key's authority — see ADR-0023.
 */
export const CURATOR_MAPPING_SCOPE = 'recipes:mappings:global';

/**
 * WHICH AFFORDANCE produced a correction (R20's "from which surfacing").
 *
 * ⛔ A CLOSED ENUM on the wire even though `ingredient_resolution_mappings.surfacing` is deliberately free
 * text, and the two facts are not in tension. The COLUMN is permissive so that a surface added tomorrow can
 * never fail a user's correction with a constraint violation (migration 0021 states that reason). The
 * CONTRACT is closed so the recorded value MEANS something: an audit dimension whose vocabulary the client
 * invents cannot be aggregated, and R20 asks for it precisely so corrections can be attributed to the
 * affordance that produced them. Adding a member is additive on both sides and needs no migration.
 */
export const CORRECTION_SURFACINGS = ['ingredient_picker', 'recipe_line'] as const;

/** Which affordance produced a correction. */
export const correctionSurfacingSchema = z.enum(CORRECTION_SURFACINGS);

/** Which affordance produced a correction. */
export type CorrectionSurfacing = z.infer<typeof correctionSurfacingSchema>;

/**
 * Body of `POST /api/v1/ingredients/corrections` — "this phrase means this food" (plan U14 / R19, R20).
 *
 * ## ⛔ Why the PHRASE is client-supplied, and why deriving it server-side would break the feature
 *
 * The obvious-looking safer design is to derive the phrase from something the server already holds — the
 * recipe line's stored `source_line`, or the `ingredients` row's name. Both are WRONG, and not marginally:
 *
 *  - **A mapping is only ever consulted under the key the CASCADE looks up**, and that key is
 *    `normalizedIngredientKey(canonicalIngredientName(name))` where `name` is the phrase `addByName`
 *    RECEIVED (`IngredientsService.resolveThroughCascade`). Keying a mapping on a raw source line
 *    (`2 cups all-purpose flour, sifted`) would produce a row the cascade never queries — dead on arrival.
 *  - **The `ingredients` row cannot supply it either.** Plan U3 has food-service's CANONICAL name overwrite
 *    `ingredients.name` the moment a food resolves, and the row does not retain the phrase it was created
 *    from. The search phrase is simply not recoverable server-side.
 *
 * So the phrase must be the caller's, and the residual risk is stated rather than hidden: a grant holder can
 * bind an ARBITRARY phrase globally in one call. That is what the grant IS — it is administered out of band
 * on the signing key's authority (ADR-0023), and `evaluateMappingWrite` already grants global reach on a
 * holder's FIRST correction. Requiring the caller to own an artifact carrying the phrase would not prevent
 * it either (they can post a recipe first) while making the ordinary cook's correction unreachable. The
 * answer this design commits to is `mappingScopePolicy.ts`'s: every global binding is enumerable by
 * `SELECT`, durably, and reviewable after the fact.
 *
 * `z.strictObject` (GR-017 §17-c): a stray or spoofed key is a `400` rather than silently stripped. There is
 * no `scope` field and no `authorId` — reach is DECIDED by the pure policy from the caller's signed grants,
 * never declared, and the author is the verified principal.
 */
export const recordCorrectionRequestSchema = z.strictObject({
    /**
     * The ingredient phrase being corrected — the text the caller searched, NOT a raw recipe line and NOT
     * our rendering of the food. Trimmed before validation, so `'  '` is a `400` rather than a mapping
     * keyed on whitespace.
     */
    phrase: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(MAX_INGREDIENT_NAME_LENGTH)),
    /**
     * The opaque food id the phrase should mean.
     *
     * ⚠️ NOT verified against the food service, deliberately. Migration 0021 requires every reader to treat
     * an unresolvable mapping as a MISS and fall through — U12's reseed mints fresh food ULIDs, so a
     * dangling `food_id` is a certainty rather than a hazard — and a round-trip here would put a
     * cross-service call on a write path whose whole value is that it is cheap.
     */
    foodId: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(MAX_FOOD_ID_LENGTH)),
    /** Which affordance produced this correction (R20). */
    surfacing: correctionSurfacingSchema,
});

/** Request body for recording an ingredient-resolution correction. */
export type RecordCorrectionRequest = z.infer<typeof recordCorrectionRequestSchema>;

/**
 * Response of `POST /api/v1/ingredients/corrections` — what the correction actually did.
 *
 * A DISCRIMINATED UNION rather than `{ recorded, mappingId?, scope? }`, for the reason `MappingWriteDecision`
 * gives one: a member carries no field it does not need, and an optional `scope` would let a client read
 * `undefined` as a default on the path where reach was never decided.
 *
 * ⛔ `scope` IS PUBLISHED, and it is not decoration. A grant holder's correction binds the phrase for EVERY
 * user; an ordinary caller's binds only their own until a second author agrees. Telling the user "saved"
 * without saying WHICH would misreport the reach of an authorization-significant act — and the difference is
 * invisible from the request, because reach is decided from signed grants the client cannot read.
 *
 * ⚠️ `recorded: false` IS NOT AN ERROR and must not be rendered as one. Re-asserting a binding already in
 * force changes nothing, and minting a churn row for it would inflate the very corroboration count that
 * decides promotion — see `evaluateMappingWrite`'s idempotence branch.
 */
export const recordCorrectionResponseSchema = z.discriminatedUnion('recorded', [
    z
        .object({
            recorded: z.literal(true),
            /** The mapping row this correction created. */
            mappingId: z.uuid(),
            /**
             * How far it reaches. `global` covers BOTH ways a correction can bind everyone — a grant
             * holder's own ruling, and a promotion earned by a second independent author agreeing — because
             * from the caller's side the two have the same consequence and the client renders one sentence.
             */
            scope: z.enum(['author', 'global']),
        })
        .strict(),
    z
        .object({
            recorded: z.literal(false),
            /**
             * Why nothing was written. `already_in_force` — the binding that applies to this caller already
             * says exactly this; `superseded` — a concurrent correction for the same phrase committed first,
             * so this one has nothing to add.
             *
             * ⛔ A CLOSED ENUM, never the policy's own `reason` prose: that text is written for a reviewer
             * reading the module, publishing it would freeze internal wording into the contract, and a client
             * cannot branch on a sentence.
             */
            outcome: z.enum(['already_in_force', 'superseded']),
        })
        .strict(),
]);

/** The correction response body. */
export type RecordCorrectionResponse = z.infer<typeof recordCorrectionResponseSchema>;

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
