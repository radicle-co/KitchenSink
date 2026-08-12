/**
 * THE RECIPE REQUEST BOUNDS — the single authority for how large a recipe's fields may be.
 *
 * OWNER RULING: these bounds live HERE, in `recipe-core`, not in the service that serves the request. Both
 * apps and the recipe service compose the SAME objects from this module, so an editor's character counter,
 * the request validation, and the published contract cannot disagree about a number — they are one number.
 *
 * DESIGN PATTERN: Value Object. Each export below is a self-contained, immutable constraint on ONE domain
 * value, named for the value rather than for a request field, because the same constraint applies wherever
 * that value appears. The request SHAPES — which fields exist, which are optional, the `visibility` omit,
 * the three-state `difficulty` — remain AUTHORED BY THE SERVICE in
 * `packages/services/recipe-service/src/recipes/recipes.schema.ts` (CODING_STANDARDS §15.2, ADR-0014: the
 * service owns its wire types). This module owns the VALUE constraints; that file owns the ENVELOPE.
 *
 * ── WHY THIS IS NOT A REINSTATEMENT OF THE TRAP THAT WAS REMOVED ──
 *
 * `recipe-core` previously carried `createRecipeInputSchema`/`updateRecipeInputSchema` — whole request
 * bodies that were a strictly LOOSER SECOND representation of what the service enforced (no `title`
 * maximum against the service's 200, no `ingredientId` UUID check, no quantity bounds, no array caps, no
 * upper bound on any int4-backed number). The published OpenAPI document was generated from that looser
 * twin, so it told integrators `title` had no maximum while the service rejected at 201.
 *
 * ⚠️ The trap was DUPLICATION, not location. What is forbidden is a second representation of a rule; what
 * is required is exactly one. So this module holds the bounds ONCE and the service COMPOSES them — there is
 * no twin to drift, and the failure that motivated the removal cannot recur. ⛔ Do NOT add a whole request
 * body schema here: the moment this module describes an ENVELOPE the service also describes, the twin is
 * back.
 *
 * ── THE STORAGE FLOOR, AND WHERE IT DOES AND DOES NOT APPLY ──
 *
 * > The database schema is the MINIMUM level of validation: every input field that writes to a bounded
 * > column must be validated at least as strictly as that column can store.
 *
 * The two ceilings below ({@link INT4_CEILING}, {@link NUMERIC_8_2_CEILING}) are that floor, and they are
 * PHYSICAL facts rather than product choices. They are spelled here as literals ON PURPOSE:
 *
 * ⚠️ This is an ASSERTION, not a DERIVATION. Nothing here imports a drizzle type, and a storage type must
 * never become a wire type — that coupling is precisely what §15.2 removed (`RecipeSearchResponse.facets`
 * used to take its wire type from `dal/search.dal.ts`). `recipe-core` is also a zod-only leaf that both
 * apps bundle, so it must not acquire an ORM dependency. The equality against the REAL columns is checked
 * mechanically, and exhaustively over every bounded column in all three services, by each service's own
 * `storage-capacity.test.ts` — which reads both models and compares them.
 *
 * ⚠️ And note what has NO storage floor: every text column behind the character limits below is unbounded
 * `text`. There is no column to derive `title ≤ 200` from, so each character limit is a PRODUCT decision,
 * and this module is the only place it exists. A reader looking for the column that justifies one will not
 * find it, which is why it is said here.
 */
import { z } from 'zod';

import { MAX_RECIPE_DEVICE_LABEL_LENGTH } from './recipe.types.js';

// ── Storage ceilings: the FLOOR, and physical rather than chosen ───────────────────────────────────

/**
 * The largest value a Postgres `integer` (int4) column accepts.
 *
 * Not a product limit — a PHYSICAL one. Every field below that reaches an int4 column carries it, so an
 * out-of-range value is answered `400` by request validation instead of `500` by the failed statement.
 */
export const INT4_CEILING = 2_147_483_647;

/**
 * The largest value a `numeric(8, 2)` column accepts — `10^6 - 0.01`.
 *
 * One step below the power of ten, not the power of ten itself: Postgres ROUNDS to the declared scale
 * before range-checking, so `numeric(8,2)` rejects `999999.996` (it rounds to `1000000.00`) while accepting
 * `999999.99`. Verified against a live PostgreSQL 16. Backs the four per-line nutrition overrides.
 */
export const NUMERIC_8_2_CEILING = 999_999.99;

// ── Product bounds: character/cardinality limits with NO storage floor to derive from ──────────────

/** Max length of a recipe title. */
export const MAX_RECIPE_TITLE_LENGTH = 200;

/** Max length of a recipe description. */
export const MAX_RECIPE_DESCRIPTION_LENGTH = 5000;

/** Max length of the free-text cuisine label (deliberately not a closed enum — see {@link CUISINES}). */
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
 * Well under the column's own `numeric(10,3)` ceiling of `9999999.999`, so it is a PRODUCT bound rather
 * than a storage one — a recipe line calling for more than a million of anything is a typo, and the gap to
 * the physical ceiling is deliberate headroom.
 */
export const MAX_RECIPE_INGREDIENT_QUANTITY = 1_000_000;

/** Max page size on the recipe list. */
export const MAX_RECIPE_LIST_PAGE_SIZE = 100;

/**
 * Allowed device-label charset (W8-a.6): letters, digits, spaces, and a small set of name punctuation
 * (`. , ' ( ) -`). Excludes control characters and markup delimiters — DEFENSE IN DEPTH over the
 * render-time escaping that is the actual XSS control, not a replacement for it. Covers real device names
 * ("Brandon's iPhone", "MacBook Pro (Work)").
 *
 * ANCHORED at both ends deliberately: an unanchored pattern would admit `<script>` for merely containing
 * letters.
 */
export const RECIPE_DEVICE_LABEL_PATTERN = /^[\p{L}\p{N} .,'()-]+$/u;

// ── Text value objects ────────────────────────────────────────────────────────────────────────────

/**
 * A recipe title.
 *
 * ⚠️ `.min(1)` is load-bearing, not tidiness: {@link recipeSchema}'s `title` is `min(1)` and every
 * recipe-returning client method parses its response with it, so a server that accepted `''` stored a title
 * it could then send in a body no client could read.
 */
export const recipeTitleSchema = z.string().min(1).max(MAX_RECIPE_TITLE_LENGTH);

/**
 * A recipe description.
 *
 * ⚠️ NO `.min(1)`, and that is a DECISION rather than an omission. `''` is a legal value of
 * {@link recipeSchema}'s `description` (`z.string().default('')`), so unlike `title`/`cuisine` there is no
 * body-the-client-cannot-read to fix; and `''` is the only way to CLEAR a description on update, because an
 * omitted field means "leave unchanged". Rejecting it would make a set description permanently unclearable.
 *
 * The RESPONSE still OMITS the key for a `NULL` column, so this does not make `Recipe.description` emit
 * `''` — a client that receives no key still reads `''` via `recipeSchema`'s default, exactly as before.
 */
export const recipeDescriptionSchema = z.string().max(MAX_RECIPE_DESCRIPTION_LENGTH);

/** A cuisine label. `.min(1)` for the same round-trip reason as {@link recipeTitleSchema}. */
export const recipeCuisineSchema = z.string().min(1).max(MAX_RECIPE_CUISINE_LENGTH);

/**
 * The device that authored a version (W8-a.6 / FR-007b) — bounded free text recorded on the version
 * snapshot.
 *
 * The LENGTH comes from {@link MAX_RECIPE_DEVICE_LABEL_LENGTH}, the same constant the `RecipeVersion`
 * RESPONSE uses, so the two cannot disagree. The CHARSET is request-only on purpose: a response must be
 * able to carry a label persisted before the charset rule existed.
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
 * deliberately and unchanged: none has ever existed, the column is unbounded `text`, and inventing one here
 * would silently start rejecting long steps that work today. Flagged for a product decision rather than
 * guessed at.
 */
export const recipeStepInstructionSchema = z.string().min(1);

/** A non-empty free-text list member (tag / dietary flag), matching the `min(1)` the read schemas enforce. */
export const recipeListMemberSchema = z.string().min(1);

// ── Ingredient-line value objects ─────────────────────────────────────────────────────────────────

/**
 * The catalog `ingredients` row an ingredient line references.
 *
 * A real UUID, matching the `recipe_ingredients.ingredient_id uuid` column.
 *
 * ⚠️ Deliberately NOT {@link idSchema}, which is `z.string().min(1)` because it must also describe app-user
 * ULIDs — composing that here would QUIETLY WIDEN this field from "a UUID" to "any non-empty string".
 */
export const recipeIngredientIdSchema = z.uuid();

/** An ingredient line's display label. `.min(1)`: the server re-resolves the canonical name, and `''` says nothing. */
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

/**
 * A per-line nutrition override (FR-007a) — absolute for the line's quantity, bounded by its
 * `numeric(8, 2)` column.
 */
export const recipeLineNutritionSchema = z.number().nonnegative().max(NUMERIC_8_2_CEILING);

// ── Whole-number value objects, each bounded by the int4 column it reaches ─────────────────────────
//
// The three below are constructed identically, and they are deliberately THREE named exports rather than
// one shared alias: a serving count, a timer duration and a concurrency token change for different reasons,
// and DRY governs knowledge, not keystrokes. Merging them would invite a later "tighten servings" edit to
// silently retune the optimistic-concurrency token.

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
 * STRICTLY positive, not non-negative, and that is a `500` → `400` fix rather than a tightening for
 * tidiness: the column carries `CHECK (timer_seconds IS NULL OR timer_seconds > 0)` and the service
 * persists `step.timerSeconds ?? null`, so a literal `0` reached the INSERT and violated the check. "No
 * timer" is expressed by OMITTING the key, which is also the only thing the read projection can produce.
 */
export const recipeTimerSecondsSchema = positiveInt4();

/**
 * The client's last-known `currentVersion`, for the optimistic-concurrency check.
 *
 * Bounded because it reaches `WHERE current_version = $1`, and an out-of-range parameter fails that
 * comparison with the same `22003` an INSERT would — a `500` for what is plainly a bad request.
 */
export const recipeExpectedVersionSchema = positiveInt4();

/**
 * A non-negative whole number of minutes (prep / cook / total), bounded by the `integer` column it lands
 * in.
 *
 * `0` is legal here and is NOT for {@link recipeServingsSchema}: a no-cook recipe genuinely has 0 cook
 * minutes, whereas a 0-serving recipe is meaningless.
 */
export const recipeMinutesSchema = z.number().int().nonnegative().max(INT4_CEILING);

/**
 * A star rating: a whole number of stars, 1–5 inclusive.
 *
 * The VALUE constraint only. The ENVELOPE that carries it (`{ stars }`, the body of
 * `PUT /api/v1/recipes/{id}/rating`) is authored by the service in
 * `packages/services/recipe-service/src/ratings/ratings.schema.ts`, as this module's header requires — it used
 * to be `setRecipeRatingInputSchema` HERE, which was exactly the "whole request body in recipe-core" that the
 * header's ⛔ forbids, and it is the reason the rating body could not be made `z.strictObject` without editing a
 * shared domain package.
 *
 * `.max(5)` is the product rule and `.int()` the column's; both are stricter than the `integer` column, so
 * {@link INT4_CEILING} is not additionally applied — a value that fails `≤ 5` never reaches the INSERT. The DB
 * agrees independently via `CHECK (stars BETWEEN 1 AND 5)`, and `storage-capacity.test.ts` asserts the pairing.
 */
export const recipeRatingStarsSchema = z.number().int().min(1).max(5);
