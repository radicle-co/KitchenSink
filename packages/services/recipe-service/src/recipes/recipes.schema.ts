/**
 * AUTHORED WIRE CONTRACT for the recipes vertical (`/api/v1/recipes…`) — the request ENVELOPES this service
 * serves, composed from the recipe domain's own bound Value Objects.
 *
 * SOURCE OF TRUTH for these SHAPES. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: Composition over Value Objects. Every field below is one of `recipe-core`'s bound schemas
 * (`recipeTitleSchema`, `recipeServingsSchema`, …); this file adds only the ENVELOPE — which fields exist,
 * which are optional, what defaults server-side, the `visibility` omit, the three-state `difficulty`. The
 * request halves are adapted into Nest through `dto/*.dto.ts` (`createZodDto`), so the shape the validation
 * pipe enforces and the shape the contract publishes are ONE OBJECT, not two that agree today.
 *
 * ── WHERE THE BOUNDS LIVE, AND WHY NOT HERE (OWNER RULING) ──
 *
 * ⚠️ Every character limit, numeric ceiling and charset rule for a recipe field lives in
 * `@kitchensink/recipe-core`'s `recipeRequestBounds.ts`, NOT in this file. Both apps compose the same
 * objects, so an editor's character counter, this service's validation, and the published contract cannot
 * disagree about a number — they are one number. ⛔ Do NOT re-declare a bound here to "keep the contract
 * self-contained": a second representation of a rule is exactly the defect this seam removed.
 *
 * The division of ownership is deliberate and holds in both directions:
 *   • `recipe-core` owns the VALUE constraints (how large a title may be).
 *   • THIS FILE owns the ENVELOPE (that a create body has a title at all, and that it is required).
 *
 * §15.2 / ADR-0014's "the service owns its wire types" is satisfied by the second half: the request shapes,
 * their optionality and their defaults are authored here and published from here. What `recipe-core` supplies
 * is a domain constraint the apps already depend on, not a wire envelope — and it supplies it ONCE, so
 * composing it cannot reintroduce the looser-twin trap described in that module's own header.
 *
 * ── WHAT THIS FILE REPLACED, AND WHY A NAIVE SWAP WOULD HAVE DELETED VALIDATION ──
 *
 * The create/update bodies were `class-validator` DTOs, and the PUBLISHED contract described them with
 * `recipe-core`'s then-existing `createRecipeInputSchema`/`updateRecipeInputSchema` — a **strictly looser**
 * second representation. The two disagreed on nearly every field, and the document was the weaker one: it
 * said `title` had NO maximum while the DTO rejected at 201. Publishing that zod as the enforcement layer
 * would have started accepting a 50 000-character title with nothing failing. Those whole-body schemas are
 * gone; what `recipe-core` now holds is the SINGLE copy of each bound, which this file composes.
 *
 * ── THE FIVE (PLUS FOUR) FIELDS THAT WERE A 500 AND ARE NOW A 400 ──
 *
 * `servings`, `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes` and `timerSeconds` all land in
 * `integer` (int4) columns and had NO upper bound on either side. `POST /api/v1/recipes` with
 * `servings: 9999999999` passed validation and failed at the INSERT — Postgres `22003 value "9999999999" is
 * out of range for type integer` — which the `ApiExceptionFilter` collapses to a generic **500**. The four
 * per-line nutrition overrides had the identical shape against `numeric(8,2)`. `expectedVersion` had it via
 * a WHERE clause, which fails the same way. Every one of them now carries the ceiling of the column it
 * reaches, and `src/database/__tests__/storage-capacity.test.ts` asserts that mechanically for EVERY bounded
 * column in the service — an assertion, never a derivation: nothing here imports a drizzle type, and no
 * storage type is ever a wire type.
 *
 * ── WHY THE `.min(1)`s EXIST, AND WHY `description` IS THE ONE THAT DOES NOT ──
 *
 * Four of them fix a body the server could SEND that no client could READ: `title`, `cuisine`,
 * `steps[].instruction` and `ingredients[].notes` were storable as `''`, and `recipe-core`'s response
 * schemas (`recipeSchema.title`/`.cuisine`, `recipeStepViewSchema.instruction`,
 * `recipeIngredientViewSchema.notes` — all `min(1)`) reject `''`, so the typed client threw on reading back
 * what it had just written. Two more (`ingredients[].name`, `ingredients[].unit`) make a single
 * representation of "absent" instead of two. `description` deliberately still accepts `''` — see
 * `recipeDescriptionSchema`'s own note for why the reasoning does not transfer.
 */
import { z } from 'zod';

import {
    recipeCuisineSchema,
    recipeDescriptionSchema,
    recipeDeviceLabelSchema,
    recipeDifficultySchema,
    recipeExpectedVersionSchema,
    recipeIngredientIdSchema,
    recipeIngredientNameSchema,
    recipeIngredientNotesSchema,
    recipeIngredientQuantitySchema,
    recipeIngredientUnitSchema,
    recipeLineNutritionSchema,
    recipeListMemberSchema,
    recipeMinutesSchema,
    recipeServingsSchema,
    recipeStatusSchema,
    recipeStepInstructionSchema,
    recipeTimerSecondsSchema,
    recipeTitleSchema,
    recipeVisibilitySchema,
    MAX_RECIPE_INGREDIENTS,
    MAX_RECIPE_LIST_PAGE_SIZE,
    MAX_RECIPE_TAGS,
} from '@kitchensink/recipe-core';

// ── Nested request shapes ─────────────────────────────────────────────────────────────────────────

/**
 * One ingredient line on a create/update request.
 *
 * Every field is a `recipe-core` Value Object; the ENVELOPE — which of them are required, and that the four
 * nutrition overrides are optional — is this file's.
 */
export const recipeIngredientInputSchema = z.object({
    ingredientId: recipeIngredientIdSchema,
    name: recipeIngredientNameSchema,
    quantity: recipeIngredientQuantitySchema,
    /** Omit for a unitless line; `''` is rejected so "unitless" has ONE representation. */
    unit: recipeIngredientUnitSchema.optional(),
    /** Free-form display override (persisted as `displayText`). */
    notes: recipeIngredientNotesSchema.optional(),
    userCalories: recipeLineNutritionSchema.optional(),
    userProteinG: recipeLineNutritionSchema.optional(),
    userCarbsG: recipeLineNutritionSchema.optional(),
    userFatG: recipeLineNutritionSchema.optional(),
});

/** One ingredient line on a create/update request. */
export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;

/**
 * One instruction step on a create/update request. The server assigns `stepNumber` from array order.
 *
 * `timerSeconds` is OPTIONAL and strictly positive (see `recipeTimerSecondsSchema`): "no timer" is expressed
 * by omitting the key, which is also the only thing the read projection can produce.
 */
export const recipeStepInputSchema = z.object({
    instruction: recipeStepInstructionSchema,
    timerSeconds: recipeTimerSecondsSchema.optional(),
});

/** One instruction step on a create/update request. */
export type RecipeStepInput = z.infer<typeof recipeStepInputSchema>;

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/v1/recipes`.
 *
 * `ownerId` is deliberately absent and unaccepted: ownership comes from the verified principal, so there is
 * no field for a caller to smuggle one through, and zod strips the key if one is sent.
 *
 * `difficulty` is `.optional()` and NOT `.nullable()`: on create there is nothing to clear, so an explicit
 * `null` is rejected while a genuine omit passes. That distinction is the whole of FR-001b's "the author
 * stated none" state, and the update body below is where `null` becomes meaningful.
 *
 * `deviceLabel` IS PUBLISHED ON THE REQUEST SIDE, and it previously was not. The server has always accepted
 * and persisted it, while the document listed it only on `RecipeVersion` (a RESPONSE) and marked both request
 * bodies `additionalProperties: false` — so the contract forbade a field the service relies on.
 *
 * `steps` and `dietaryFlags` carry no upper CARDINALITY bound, matching what the DTO enforced. Both are
 * bounded in practice only by the 100 kB JSON body limit; the asymmetry with `ingredients` (100) and `tags`
 * (50) is flagged for a product decision rather than resolved by guessing a number here.
 */
export const createRecipeRequestSchema = z.object({
    title: recipeTitleSchema,
    description: recipeDescriptionSchema.optional(),
    cuisine: recipeCuisineSchema.optional(),
    /** Author-stated difficulty (FR-001b). Omit when the author states none — there is no default. */
    difficulty: recipeDifficultySchema.optional(),
    /** Defaults to `public` SERVER-side, so an omitted field stays distinguishable from an explicit choice. */
    visibility: recipeVisibilitySchema.optional(),
    /** Publication status (W8-a.3). Defaults to `published` server-side; the wizard's Save-Draft sends `draft`. */
    status: recipeStatusSchema.optional(),
    deviceLabel: recipeDeviceLabelSchema.optional(),
    ingredients: z.array(recipeIngredientInputSchema).min(1).max(MAX_RECIPE_INGREDIENTS),
    steps: z.array(recipeStepInputSchema).min(1),
    servings: recipeServingsSchema,
    prepTimeMinutes: recipeMinutesSchema,
    cookTimeMinutes: recipeMinutesSchema,
    /** Independent of prep + cook: a recipe may have inactive time (rest, marinate, chill) in neither. */
    totalTimeMinutes: recipeMinutesSchema,
    tags: z.array(recipeListMemberSchema).max(MAX_RECIPE_TAGS).optional(),
    dietaryFlags: z.array(recipeListMemberSchema).optional(),
});

/** Request body for creating a recipe. */
export type CreateRecipeRequest = z.infer<typeof createRecipeRequestSchema>;

/**
 * Body of `PATCH /api/v1/recipes/{id}` — a partial update carrying the optimistic-concurrency token.
 *
 * `visibility` is deliberately ABSENT: it is set through the dedicated
 * `PATCH /api/v1/recipes/{id}/visibility` endpoint, where the C-004 policy evaluator decides whether the
 * transition is allowed. The document used to advertise it here (it came free with
 * `createRecipeInputSchema.partial()`) while the service STRIPPED it — a field the contract offered and the
 * server ignored. Omitting it makes the document true; a caller that still sends one is unaffected, because
 * the key is dropped exactly as it was before.
 *
 * `difficulty` is the three-state field (FR-001b), and the three states are NOT interchangeable:
 * ABSENT = leave unchanged, a VALUE = set it, explicit `null` = CLEAR it back to "not stated". Without the
 * `null` sentinel, `Partial<>`'s omitted-means-unchanged rule would make "not stated" reachable only at
 * create time, so a user who ever set a difficulty could never remove it.
 */
export const updateRecipeRequestSchema = createRecipeRequestSchema.omit({ visibility: true }).partial().extend({
    expectedVersion: recipeExpectedVersionSchema,
    difficulty: recipeDifficultySchema.nullable().optional(),
});

/** Request body for updating a recipe. */
export type UpdateRecipeRequest = z.infer<typeof updateRecipeRequestSchema>;

/**
 * Body of `PATCH /api/v1/recipes/{id}/visibility`.
 *
 * Newly PUBLISHED: the document previously described this operation's response but stated outright that its
 * request body was undescribed, because no authored schema existed for it and inventing one in the OpenAPI
 * route table would have been a third authority. The C-004 policy evaluator in `RecipesService` still decides
 * whether the requested transition is ALLOWED for the recipe's `(sourceType, isPremium, hasSubstantiveEdit)`
 * — this schema only bounds the literal, so a rejected transition stays a policy answer rather than becoming
 * a validation `400`.
 */
export const setRecipeVisibilityRequestSchema = z.object({
    visibility: recipeVisibilitySchema,
});

/** Request body for setting a recipe's visibility. */
export type SetRecipeVisibilityRequest = z.infer<typeof setRecipeVisibilityRequestSchema>;

/**
 * Body of `POST /api/v1/recipes/{id}/clone` — no client-controlled fields, so the BODY is optional.
 *
 * A clone deterministically copies the source's content and attribution and derives its visibility from the
 * C-004 clone-default rule, so there is nothing for a caller to supply. `.default({})` is what makes a
 * bodyless `POST` legal (same reasoning as `cloneCollectionRequestSchema`), and zod's key-stripping is what
 * makes a stray field harmless rather than trusted.
 */
export const cloneRecipeRequestSchema = z.object({}).default({});

/** Request body for cloning a recipe (no fields). */
export type CloneRecipeRequest = z.infer<typeof cloneRecipeRequestSchema>;

/** The list sort keys `GET /api/v1/recipes` accepts. */
export const RECIPE_LIST_SORT_BY = ['updatedAt', 'createdAt', 'title'] as const;

/** A recipe-list sort key. */
export type RecipeListSortBy = (typeof RECIPE_LIST_SORT_BY)[number];

/**
 * Query of `GET /api/v1/recipes`.
 *
 * Coerced, because a query bag is strings on the wire. `.int()` rejects `2.5` rather than truncating it — a
 * silently-truncated page size is a contract that lies about what it did. The defaults are applied HERE
 * rather than in the service, exactly as the class-validator property initializers did, so the parsed query
 * is always complete.
 *
 * These two are NOT `recipe-core` Value Objects, deliberately: the COERCION and the DEFAULTS are properties
 * of this endpoint's query bag rather than of the domain values, and `MAX_RECIPE_LIST_PAGE_SIZE` — the only
 * actual bound here — is composed from `recipe-core` like every other.
 */
export const listRecipesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_RECIPE_LIST_PAGE_SIZE).default(20),
    sortBy: z.enum(RECIPE_LIST_SORT_BY).default('updatedAt'),
});

/** Parsed pagination + sort query for listing recipes. */
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
