/**
 * AUTHORED WIRE CONTRACT for the recipes vertical (`/api/v1/recipes…`) — the last vertical to converge on
 * §15.2, and the one that was carrying the most validation.
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed with Value Objects from `recipe-core`. The
 * request halves are adapted into Nest through `dto/*.dto.ts` (`createZodDto`), so the shape the validation
 * pipe enforces and the shape the contract publishes are ONE OBJECT, not two that agree today.
 *
 * ── WHAT THIS FILE REPLACED, AND WHY A NAIVE SWAP WOULD HAVE DELETED VALIDATION ──
 *
 * The create/update bodies were `class-validator` DTOs, and the PUBLISHED contract described them with
 * `recipe-core`'s `createRecipeInputSchema`/`updateRecipeInputSchema` — a **strictly looser** second
 * representation. The two disagreed on nearly every field, and the document was the weaker one: it said
 * `title` had NO maximum while the DTO rejected at 201. Publishing `recipe-core`'s zod as the enforcement
 * layer would therefore have started accepting a 50 000-character title with nothing failing. So the bounds
 * are authored HERE, where the request is served, and `recipe-core`'s request zod is gone — a looser twin of
 * a validation rule is not a convenience, it is a trap that the next reader falls into.
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
 * ── WHY THE `.min(1)`s ARE HERE, AND WHY `description` IS THE ONE THAT IS NOT ──
 *
 * Four of them fix a body the server could SEND that no client could READ: `title`, `cuisine`,
 * `steps[].instruction` and `ingredients[].notes` were storable as `''`, and `recipe-core`'s response
 * schemas (`recipeSchema.title`/`.cuisine`, `recipeStepViewSchema.instruction`,
 * `recipeIngredientViewSchema.notes` — all `min(1)`) reject `''`, so the typed client threw on reading back
 * what it had just written. Two more (`ingredients[].name`, `ingredients[].unit`) make a single
 * representation of "absent" instead of two.
 *
 * `description` deliberately still accepts `''`, and the reasoning does NOT transfer from the collections
 * vertical (where `''` WAS rejected): `recipeSchema.description` is `z.string().default('')`, so `''` is a
 * legal readable value here — there is no read/write disagreement to fix — and `''` is the ONLY way any
 * caller can CLEAR a previously-set description, since an omitted field means "leave unchanged". Rejecting
 * it would make a set description permanently unclearable. See the field's own note.
 */
import { z } from 'zod';

import {
    MAX_RECIPE_DEVICE_LABEL_LENGTH,
    recipeDifficultySchema,
    recipeStatusSchema,
    recipeVisibilitySchema,
} from '@kitchensink/recipe-core';

// ── Storage ceilings ──────────────────────────────────────────────────────────────────────────────

/**
 * The largest value a Postgres `integer` (int4) column accepts.
 *
 * Not a product limit — a PHYSICAL one. Every wire field below that reaches an int4 column carries it, so an
 * out-of-range value is answered `400` by request validation instead of `500` by the failed statement. It is
 * spelled as a literal because this file may import only `zod` and `recipe-core`; the equality against the
 * real column is asserted (never derived) in `src/database/__tests__/storage-capacity.test.ts`.
 */
const INT4_CEILING = 2_147_483_647;

/**
 * The largest value a `numeric(8, 2)` column accepts — `10^6 - 0.01`.
 *
 * One step below the power of ten, not the power of ten itself: Postgres ROUNDS to the declared scale before
 * range-checking, so `numeric(8,2)` rejects `999999.996` (it rounds to `1000000.00`) while accepting
 * `999999.99`. Verified against a live PostgreSQL 16. Backs the four per-line nutrition overrides.
 */
const NUMERIC_8_2_CEILING = 999_999.99;

// ── Product bounds ────────────────────────────────────────────────────────────────────────────────
//
// The columns behind these are unbounded `text`, so there is nothing to derive them from: each is a PRODUCT
// decision, and this file is the only place it exists. They are exported so a client can render a live
// character counter against the SAME number the server enforces.

/** Max length of a recipe title. */
export const MAX_RECIPE_TITLE_LENGTH = 200;

/** Max length of a recipe description. */
export const MAX_RECIPE_DESCRIPTION_LENGTH = 5000;

/** Max length of the free-text cuisine label (deliberately not a closed enum — see `recipe-core`'s `CUISINES`). */
export const MAX_RECIPE_CUISINE_LENGTH = 100;

/**
 * Max length of an ingredient line's display label.
 *
 * The server RE-RESOLVES the canonical name from the catalog (ADV-2), so this bounds a value that is
 * ultimately discarded — which is exactly why it is a cheap bound to keep rather than one to drop.
 */
export const MAX_RECIPE_INGREDIENT_NAME_LENGTH = 120;

/**
 * Max ingredient lines on one recipe (REQ-003a / PRF-REQ-034: "between 1 and 100 ingredients"). Bounds the
 * request body and the downstream ingredient-composition write.
 */
export const MAX_RECIPE_INGREDIENTS = 100;

/** Max tags on one recipe (REQ-007 / PRF-REQ-035: "between 0 and 50 tags"). */
export const MAX_RECIPE_TAGS = 50;

/**
 * Smallest ingredient quantity that survives the round trip.
 *
 * One representable step at the `recipe_ingredients.quantity numeric(10,3)` column's scale: a smaller value
 * rounds to `0.000` and then violates the column's `CHECK (quantity > 0)`, which was an uncaught `500` that
 * aborted the whole recipe transaction.
 */
export const MIN_RECIPE_INGREDIENT_QUANTITY = 0.001;

/**
 * Largest ingredient quantity accepted.
 *
 * Well under the column's own `numeric(10,3)` ceiling of `9999999.999`, so it is a PRODUCT bound rather than
 * a storage one — a recipe line calling for more than a million of anything is a typo, and the gap to the
 * physical ceiling is deliberate headroom.
 */
export const MAX_RECIPE_INGREDIENT_QUANTITY = 1_000_000;

/**
 * Allowed device-label charset (W8-a.6): letters, digits, spaces, and a small set of name punctuation
 * (`. , ' ( ) -`). Excludes control characters and markup delimiters — DEFENSE IN DEPTH over the render-time
 * escaping that is the actual XSS control, not a replacement for it. Covers real device names
 * ("Brandon's iPhone", "MacBook Pro (Work)").
 */
export const RECIPE_DEVICE_LABEL_PATTERN = /^[\p{L}\p{N} .,'()-]+$/u;

// ── Field schemas ─────────────────────────────────────────────────────────────────────────────────

/**
 * A recipe title as a request accepts it.
 *
 * ⚠️ `.min(1)` is load-bearing, not tidiness: `recipe-core`'s `recipeSchema.title` is `min(1)` and every
 * recipe-returning client method parses its response with it, so a server that accepted `''` stored a title
 * it could then send in a body no client could read.
 */
const recipeTitleSchema = z.string().min(1).max(MAX_RECIPE_TITLE_LENGTH);

/**
 * A recipe description as a request accepts it.
 *
 * ⚠️ NO `.min(1)`, and that is a decision rather than an omission — see the module docstring. `''` is a legal
 * value of `recipeSchema.description` (`z.string().default('')`), so unlike `title`/`cuisine` there is no
 * body-the-client-cannot-read to fix; and `''` is the only way to CLEAR a description on update, because an
 * omitted field means "leave unchanged". The RESPONSE still OMITS the key for a `NULL` column, so this does
 * not make `Recipe.description` start emitting `''` — a client that receives no key still reads `''` via
 * `recipeSchema`'s default, exactly as before.
 */
const recipeDescriptionSchema = z.string().max(MAX_RECIPE_DESCRIPTION_LENGTH);

/** A cuisine label as a request accepts it. `.min(1)` for the same reason as {@link recipeTitleSchema}. */
const recipeCuisineSchema = z.string().min(1).max(MAX_RECIPE_CUISINE_LENGTH);

/**
 * The device that authored a version (W8-a.6 / FR-007b) — OPTIONAL bounded free text recorded on the version
 * snapshot.
 *
 * ⚠️ THIS IS PUBLISHED ON THE REQUEST SIDE, and it previously was not. The server has always accepted and
 * persisted it, while the document listed it only on `RecipeVersion` (a RESPONSE) and marked both request
 * bodies `additionalProperties: false` — so the contract forbade a field the service relies on. The length
 * bound comes from `recipe-core` so the request and the `RecipeVersion` response cannot disagree about it;
 * the charset is request-only on purpose, because a response must be able to carry a label persisted before
 * the charset rule existed.
 */
const recipeDeviceLabelSchema = z
    .string()
    .min(1)
    .max(MAX_RECIPE_DEVICE_LABEL_LENGTH)
    .regex(RECIPE_DEVICE_LABEL_PATTERN, {
        message: "Device label may contain only letters, digits, spaces and . , ' ( ) -",
    });

/**
 * A non-negative whole number of minutes, bounded by the `integer` column it lands in.
 *
 * @returns The schema. Pure.
 */
const minutesSchema = (): z.ZodNumber => z.number().int().nonnegative().max(INT4_CEILING);

/**
 * A per-line nutrition override (FR-007a) — absolute for the line's quantity, bounded by its
 * `numeric(8, 2)` column.
 *
 * @returns The schema. Pure.
 */
const lineNutritionSchema = (): z.ZodNumber => z.number().nonnegative().max(NUMERIC_8_2_CEILING);

/** A non-empty free-text list member (tag / dietary flag), matching the `min(1)` the read schemas enforce. */
const listMemberSchema = z.string().min(1);

// ── Nested request shapes ─────────────────────────────────────────────────────────────────────────

/**
 * One ingredient line on a create/update request.
 *
 * `ingredientId` is a real UUID, matching the `recipe_ingredients.ingredient_id uuid` column and the
 * `@IsUUID()` this replaced. `recipe-core`'s `idSchema` is `z.string().min(1)` (it must also describe the
 * app-user ULIDs), so composing it here would have QUIETLY WIDENED the field from "a UUID" to "any non-empty
 * string" — a naive convergence deleting a real check.
 */
export const recipeIngredientInputSchema = z.object({
    ingredientId: z.uuid(),
    /** Display label. `.min(1)`: the server re-resolves the canonical name, and `''` says nothing. */
    name: z.string().min(1).max(MAX_RECIPE_INGREDIENT_NAME_LENGTH),
    quantity: z.number().min(MIN_RECIPE_INGREDIENT_QUANTITY).max(MAX_RECIPE_INGREDIENT_QUANTITY),
    /**
     * Unit of measure. `.min(1)` so "unitless" has ONE representation (omit the key): the column is NOT NULL
     * with `''` as its unitless value and the read projection omits the field when it is `''`, so a
     * request-side `''` and an absent key were already indistinguishable in every response.
     */
    unit: z.string().min(1).optional(),
    /**
     * Free-form display override (persisted as `displayText`). `.min(1)` fixes a real round-trip break:
     * `''` persisted non-NULL and the read projection emitted `notes: ''`, which
     * `recipeIngredientViewSchema.notes` (`min(1)`) rejects.
     */
    notes: z.string().min(1).optional(),
    userCalories: lineNutritionSchema().optional(),
    userProteinG: lineNutritionSchema().optional(),
    userCarbsG: lineNutritionSchema().optional(),
    userFatG: lineNutritionSchema().optional(),
});

/** One ingredient line on a create/update request. */
export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;

/**
 * One instruction step on a create/update request. The server assigns `stepNumber` from array order.
 *
 * `timerSeconds` is `.positive()`, NOT non-negative, and that is a `500` → `400` fix rather than a
 * tightening for tidiness: the column carries
 * `CHECK (timer_seconds IS NULL OR timer_seconds > 0)`, and the service persists `step.timerSeconds ?? null`
 * — so a literal `0` (which both the old DTO's `@Min(0)` and `recipe-core`'s `nonNegativeIntSchema` admitted)
 * reached the INSERT and violated the check. "No timer" is expressed by OMITTING the key, which is also the
 * only thing the read projection can produce.
 *
 * `instruction` has NO maximum, deliberately and unchanged: none has ever existed, the column is unbounded
 * `text`, and inventing one here would silently start rejecting long steps that work today. Flagged for a
 * product decision rather than guessed at.
 */
export const recipeStepInputSchema = z.object({
    instruction: z.string().min(1),
    timerSeconds: z.number().int().positive().max(INT4_CEILING).optional(),
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
    servings: z.number().int().positive().max(INT4_CEILING),
    prepTimeMinutes: minutesSchema(),
    cookTimeMinutes: minutesSchema(),
    /** Independent of prep + cook: a recipe may have inactive time (rest, marinate, chill) in neither. */
    totalTimeMinutes: minutesSchema(),
    tags: z.array(listMemberSchema).max(MAX_RECIPE_TAGS).optional(),
    dietaryFlags: z.array(listMemberSchema).optional(),
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
 *
 * `expectedVersion` is bounded by `INT4_CEILING` because it reaches `WHERE current_version = $1`, and an
 * out-of-range parameter fails that comparison with the same `22003` an INSERT would — a `500` for what is
 * plainly a bad request.
 */
export const updateRecipeRequestSchema = createRecipeRequestSchema
    .omit({ visibility: true })
    .partial()
    .extend({
        expectedVersion: z.number().int().positive().max(INT4_CEILING),
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

/** Max page size on the recipe list. */
export const MAX_RECIPE_LIST_PAGE_SIZE = 100;

/**
 * Query of `GET /api/v1/recipes`.
 *
 * Coerced, because a query bag is strings on the wire. `.int()` rejects `2.5` rather than truncating it — a
 * silently-truncated page size is a contract that lies about what it did. The defaults are applied HERE
 * rather than in the service, exactly as the class-validator property initializers did, so the parsed query
 * is always complete.
 */
export const listRecipesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_RECIPE_LIST_PAGE_SIZE).default(20),
    sortBy: z.enum(RECIPE_LIST_SORT_BY).default('updatedAt'),
});

/** Parsed pagination + sort query for listing recipes. */
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
