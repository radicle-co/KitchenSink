/**
 * Recipe request bounds — the single authority for how large a recipe's fields may be. By OWNER RULING they
 * live here, in `recipe-core`, not in the service that serves the request.
 *
 * DESIGN PATTERN: Value Object. Each export is one immutable constraint on ONE domain value, named for the
 * value rather than for a request field. Both apps and the recipe service compose these SAME objects, so an
 * editor's character counter, request validation and the published contract cannot disagree about a number.
 *
 * ⚠️ This module owns VALUE constraints; the request ENVELOPES stay authored by the service in
 * `recipe-service/src/recipes/recipes.schema.ts` (CODING_STANDARDS §15.2, ADR-0014). ⛔ Do NOT add a whole
 * request-body schema here: `recipe-core` used to carry `createRecipeInputSchema`/`updateRecipeInputSchema`,
 * a looser SECOND representation whose generated OpenAPI advertised no `title` maximum while the service
 * rejected at 201. The trap was DUPLICATION, not location — one definition here, composed by the service,
 * has no twin to drift.
 *
 * STORAGE FLOOR: an input field writing to a bounded column must be validated at least as strictly as that
 * column can store. {@link INT4_CEILING} and {@link NUMERIC_8_2_CEILING} are that floor — PHYSICAL facts,
 * spelled as literals because this is an ASSERTION, not a DERIVATION: importing a drizzle type would turn a
 * storage type into a wire type, and `recipe-core` is a zod-only leaf both apps bundle. Each service's
 * `storage-capacity.test.ts` checks the assertion against every bounded column mechanically.
 *
 * ⚠️ The character limits below have NO storage floor — the text columns behind them are unbounded `text`,
 * so each is a PRODUCT decision with no column to derive it from.
 */
import { z } from 'zod';

import { MAX_RECIPE_DEVICE_LABEL_LENGTH } from './recipe.types.js';

// ── Storage ceilings: physical rather than chosen ───────────────────────────────────────────────────

/**
 * The largest value a Postgres `integer` (int4) column accepts.
 *
 * Carried by every field below that reaches an int4 column, so an out-of-range value is answered `400` by
 * request validation instead of `500` by the failed statement.
 */
export const INT4_CEILING = 2_147_483_647;

/**
 * The largest value a `numeric(8, 2)` column accepts — one step below `10^6`, not `10^6` itself.
 *
 * Postgres ROUNDS to the declared scale before range-checking, so `numeric(8,2)` rejects `999999.996` (it
 * rounds to `1000000.00`) while accepting `999999.99`.
 */
export const NUMERIC_8_2_CEILING = 999_999.99;

// ── Product bounds: character/cardinality limits with no storage floor to derive from ───────────────

/** Max length of a recipe title. */
export const MAX_RECIPE_TITLE_LENGTH = 200;

/** Max length of a recipe description. */
export const MAX_RECIPE_DESCRIPTION_LENGTH = 5000;

/** Max length of the free-text cuisine label (deliberately not a closed enum). */
export const MAX_RECIPE_CUISINE_LENGTH = 100;

/** Max length of an ingredient line's display label; the server re-resolves the canonical name (ADV-2). */
export const MAX_RECIPE_INGREDIENT_NAME_LENGTH = 120;

/** Max ingredient lines on one recipe (REQ-003a / PRF-REQ-034). */
export const MAX_RECIPE_INGREDIENTS = 100;

/** Max tags on one recipe (REQ-007 / PRF-REQ-035). */
export const MAX_RECIPE_TAGS = 50;

/**
 * Smallest ingredient quantity that survives the round trip — one step at `quantity numeric(10,3)`'s scale.
 *
 * Anything smaller rounds to `0.000` and then violates the column's `CHECK (quantity > 0)`, an uncaught
 * `500` that aborted the whole recipe transaction.
 */
export const MIN_RECIPE_INGREDIENT_QUANTITY = 0.001;

/** Largest ingredient quantity accepted — a PRODUCT bound, deliberate headroom under `numeric(10,3)`. */
export const MAX_RECIPE_INGREDIENT_QUANTITY = 1_000_000;

/** Max page size on the recipe list. */
export const MAX_RECIPE_LIST_PAGE_SIZE = 100;

/**
 * Max page size on recipe SEARCH — tighter than the list's, because a search page also carries facet
 * aggregations over the match sample. A WIRE bound: `recipeSearchQuerySchema` publishes it and rejects above
 * it, so it belongs here rather than re-exported from `search/dal/search.dal.ts`, which made a data-access
 * module the source of a published constraint.
 *
 * ⚠️ Must stay equal to the internal `MAX_PAGE_SIZE` clamp in the service's `common/pagination.ts`. The two are
 * ASSERTED equal (`src/search/__tests__/page-size-bound.test.ts`) rather than derived: the clamp is shared
 * defense-in-depth for three endpoints, this is one endpoint's published contract. If they disagree,
 * `search.service.ts` echoes the requested `pageSize` into the envelope while the DAL clamps the `LIMIT`, so
 * the envelope would report a page size the response does not have.
 */
export const MAX_SEARCH_PAGE_SIZE = 50;

/**
 * Allowed device-label charset (W8-a.6): letters, digits, spaces and `. , ' ( ) -`.
 *
 * DEFENSE IN DEPTH over the render-time escaping that is the actual XSS control, not a replacement for it.
 * ANCHORED at both ends deliberately — unanchored, it would admit `<script>` for merely containing letters.
 */
export const RECIPE_DEVICE_LABEL_PATTERN = /^[\p{L}\p{N} .,'()-]+$/u;

// ── Text value objects ─────────────────────────────────────────────────────────────────────────────

/**
 * A recipe title.
 *
 * ⚠️ `.min(1)` is load-bearing: `recipeSchema.title` is `min(1)` and every recipe-returning client method
 * parses its response with it, so a server that accepted `''` stored a title no client could read back.
 */
export const recipeTitleSchema = z.string().min(1).max(MAX_RECIPE_TITLE_LENGTH);

/**
 * A recipe description.
 *
 * ⚠️ NO `.min(1)`, and that is a DECISION rather than an omission: `''` is the only way to CLEAR a
 * description on update (an omitted field means "leave unchanged"), and it is already legal in
 * `recipeSchema` (`z.string().default('')`), so unlike `title` there is no unreadable response to fix. The
 * response still OMITS the key for a `NULL` column, so nothing starts emitting `''`.
 */
export const recipeDescriptionSchema = z.string().max(MAX_RECIPE_DESCRIPTION_LENGTH);

/** A cuisine label. `.min(1)` for the same round-trip reason as {@link recipeTitleSchema}. */
export const recipeCuisineSchema = z.string().min(1).max(MAX_RECIPE_CUISINE_LENGTH);

/**
 * The device that authored a version (W8-a.6 / FR-007b).
 *
 * The LENGTH comes from {@link MAX_RECIPE_DEVICE_LABEL_LENGTH}, the constant the `RecipeVersion` RESPONSE
 * also uses, so the two cannot disagree. The CHARSET is request-only on purpose: a response must be able to
 * carry a label persisted before the charset rule existed.
 */
export const recipeDeviceLabelSchema = z
    .string()
    .min(1)
    .max(MAX_RECIPE_DEVICE_LABEL_LENGTH)
    .regex(RECIPE_DEVICE_LABEL_PATTERN, {
        message: "Device label may contain only letters, digits, spaces and . , ' ( ) -",
    });

/**
 * One instruction step's text.
 *
 * `.min(1)` because `recipeStepViewSchema.instruction` rejects `''` on the way back out. NO maximum,
 * deliberately: the column is unbounded `text`, and inventing one here would silently start rejecting long
 * steps that work today — flagged for a product decision rather than guessed at.
 */
export const recipeStepInstructionSchema = z.string().min(1);

/** A non-empty free-text list member (tag / dietary flag), matching the `min(1)` the read schemas enforce. */
export const recipeListMemberSchema = z.string().min(1);

// ── Ingredient-line value objects ───────────────────────────────────────────────────────────────────

/**
 * The catalog `ingredients` row an ingredient line references — a real UUID, matching the
 * `recipe_ingredients.ingredient_id uuid` column.
 *
 * ⚠️ Deliberately NOT `idSchema`, which is `z.string().min(1)` because it must also describe app-user ULIDs
 * — composing that here would QUIETLY WIDEN this field from "a UUID" to "any non-empty string".
 */
export const recipeIngredientIdSchema = z.uuid();

/** An ingredient line's display label. `.min(1)`: the server re-resolves the canonical name, so `''` says nothing. */
export const recipeIngredientNameSchema = z.string().min(1).max(MAX_RECIPE_INGREDIENT_NAME_LENGTH);

/** An ingredient line's quantity, inside the window its `numeric(10,3)` column can actually store. */
export const recipeIngredientQuantitySchema = z
    .number()
    .min(MIN_RECIPE_INGREDIENT_QUANTITY)
    .max(MAX_RECIPE_INGREDIENT_QUANTITY);

/**
 * An ingredient line's unit of measure.
 *
 * `.min(1)` so "unitless" has ONE representation (omit the key): the column is NOT NULL with `''` as its
 * unitless value and the read projection omits the field when it is `''`, so a request-side `''` and an
 * absent key were already indistinguishable in every response.
 */
export const recipeIngredientUnitSchema = z.string().min(1);

/**
 * An ingredient line's free-form display override (persisted as `displayText`).
 *
 * `.min(1)` fixes a real round-trip break: `''` persisted non-NULL and the read projection emitted
 * `notes: ''`, which `recipeIngredientViewSchema.notes` (`min(1)`) rejects.
 */
export const recipeIngredientNotesSchema = z.string().min(1);

/** A per-line nutrition override (FR-007a) — absolute for the line's quantity, bounded by `numeric(8, 2)`. */
export const recipeLineNutritionSchema = z.number().nonnegative().max(NUMERIC_8_2_CEILING);

// ── Whole-number value objects, each bounded by the int4 column it reaches ──────────────────────────
//
// The three below are deliberately THREE named exports rather than one shared alias: a serving count, a
// timer duration and a concurrency token change for different reasons, and DRY governs knowledge, not
// keystrokes. Merging them would invite a later "tighten servings" edit to silently retune the
// optimistic-concurrency token.

/**
 * A positive whole number that lands in an `integer` column.
 *
 * @returns The schema. Pure.
 */
const positiveInt4 = (): z.ZodNumber => z.number().int().positive().max(INT4_CEILING);

/** A recipe's serving count — at least one serving. */
export const recipeServingsSchema = positiveInt4();

/**
 * An inline step timer, in seconds.
 *
 * STRICTLY positive, not non-negative, and that is a `500` → `400` fix: the column carries
 * `CHECK (timer_seconds IS NULL OR timer_seconds > 0)` and the service persists `step.timerSeconds ?? null`,
 * so a literal `0` reached the INSERT and violated the check. "No timer" is expressed by OMITTING the key.
 */
export const recipeTimerSecondsSchema = positiveInt4();

/**
 * The client's last-known `currentVersion`, for the optimistic-concurrency check.
 *
 * Bounded because it reaches `WHERE current_version = $1`, where an out-of-range parameter fails with the
 * same `22003` an INSERT would — a `500` for what is plainly a bad request.
 */
export const recipeExpectedVersionSchema = positiveInt4();

/**
 * A non-negative whole number of minutes (prep / cook / total), bounded by the `integer` column it lands in.
 *
 * `0` is legal here and is NOT for {@link recipeServingsSchema}: a no-cook recipe genuinely has 0 cook
 * minutes, whereas a 0-serving recipe is meaningless.
 */
export const recipeMinutesSchema = z.number().int().nonnegative().max(INT4_CEILING);

/**
 * A star rating: a whole number of stars, 1–5 inclusive — the VALUE constraint only, the `{ stars }` envelope
 * being the service's (⛔ above).
 *
 * `.max(5)` is the product rule and `.int()` the column's; both are stricter than the `integer` column, so
 * {@link INT4_CEILING} is not additionally applied. The DB agrees independently via
 * `CHECK (stars BETWEEN 1 AND 5)`, and `storage-capacity.test.ts` asserts the pairing.
 */
export const recipeRatingStarsSchema = z.number().int().min(1).max(5);
