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
 * `storageCapacity.test.ts` checks the assertion against every bounded column mechanically.
 *
 * ⚠️ The character limits below have NO storage floor — the text columns behind them are unbounded `text`,
 * so each is a PRODUCT decision with no column to derive it from.
 */
import { z } from 'zod';

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

/**
 * Max length of an ingredient line's PREPARATION phrase (plan U26) — `finely chopped`, `at room
 * temperature`, `roughly torn`.
 *
 * A PRODUCT bound over an unbounded `text` column, and a SEPARATE constant from
 * {@link MAX_RECIPE_INGREDIENT_NAME_LENGTH} despite sharing its value today: a food's display label and the
 * treatment a cook applies to it change for different reasons, and DRY governs knowledge rather than
 * keystrokes. Merging them would let a later "the catalog needs longer names" edit silently widen what a
 * preparation may say.
 *
 * Sized as a PHRASE rather than prose. `@kitchensink/recipe-import-core`'s `modifierLexicon.ts` is the
 * vocabulary this field is made of — a past participle, optionally qualified (`finely chopped`), or a
 * temperature (`at room temperature`) — and the longest realistic composition of those is a small fraction
 * of 120. Anything longer is a sentence, and a sentence about the ingredient belongs in the step text.
 */
export const MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH = 120;

/**
 * Max length of an ingredient line's GROUP LABEL (plan U27) — `For the marinade`, `Dry ingredients`.
 *
 * Also a product bound over unbounded `text`. Sized as a HEADING, which is what it renders as: the longest
 * of the twelve labels the Figma Make mockup suggests is 16 characters, and a section heading that does not
 * fit on one line above a list has stopped being a heading. Deliberately tighter than a preparation, because
 * the two are read in different places — one sits inline beside an ingredient, the other stands above a run
 * of them.
 */
export const MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH = 60;

/** Max ingredient lines on one recipe (REQ-003a / PRF-REQ-034). */
export const MAX_RECIPE_INGREDIENTS = 100;

/** Max tags on one recipe (REQ-007 / PRF-REQ-035). */
export const MAX_RECIPE_TAGS = 50;

/**
 * Longest raw source line one ingredient line may carry (plan U11/U14).
 *
 * ⛔ A PAYLOAD bound, and deliberately NOT equal to either of the two numbers it sits between. The gate's
 * `MAX_VERIFICATION_SOURCE_LINE_LENGTH` (400) is a TRANSPORT bound protecting ADR-0024's spend reservation,
 * and `PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars` (400 today) is a CALIBRATION bound the bake-off
 * is expected to move. This third number answers a third question: how long a line may a cook's source
 * plausibly have stated?
 *
 * It is LOOSER than both on purpose. Were it 400 as well, two things would follow that neither of the other
 * two numbers intends: the gate's terminal `reject: 'source-line-over-cap'` branch would become unreachable by
 * construction — dead code guarding a case the wire already refused — and an honest 420-character line in a
 * transcribed cookbook would `400` the WHOLE recipe create rather than resolving as unresolved and being
 * surfaced for correction, which is precisely the outcome that branch exists to produce.
 *
 * 1000 is sized off the corpus: the longest line in the 2,432-line public-domain corpus is a small fraction of
 * it, so this refuses prose pasted into an ingredient field without refusing any real ingredient line.
 */
export const MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH = 1000;

/**
 * Longest `sourceUrl` a declared provenance may carry (004-FR-024).
 *
 * The column is `text` and has no ceiling of its own, so this is a PAYLOAD bound rather than a storage one.
 * 2048 is the practical URL ceiling every mainstream browser and proxy enforces; a longer value is not a
 * link anyone can follow, which is the only thing the field is for.
 */
export const MAX_RECIPE_SOURCE_URL_LENGTH = 2048;

/**
 * Longest `sourceAttribution` a declared provenance may carry (004-FR-024).
 *
 * Also a payload bound over a `text` column. It is sized for a credit line — work, author, and where the
 * copy came from — not for a licence text, because the detail view RENDERS this string to the reader.
 */
export const MAX_RECIPE_SOURCE_ATTRIBUTION_LENGTH = 500;

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
 * ASSERTED equal (`src/search/__tests__/pageSizeBound.test.ts`) rather than derived: the clamp is shared
 * defense-in-depth for three endpoints, this is one endpoint's published contract. If they disagree,
 * `search.service.ts` echoes the requested `pageSize` into the envelope while the DAL clamps the `LIMIT`, so
 * the envelope would report a page size the response does not have.
 */
export const MAX_SEARCH_PAGE_SIZE = 50;

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

/**
 * The original source URL of an imported recipe.
 *
 * `.url()` matches what `recipeSchema.sourceUrl` already publishes on the RESPONSE side, so a declared
 * source round-trips through the typed client rather than throwing on read-back.
 */
export const recipeSourceUrlSchema = z.string().url().max(MAX_RECIPE_SOURCE_URL_LENGTH);

/**
 * The human-readable credit shown beside an imported recipe.
 *
 * `.min(1)` is load-bearing twice over: `recipeSchema.sourceAttribution` is `min(1)` (so `''` would be a
 * response no client could read), and an attribution that credits nobody is precisely the unattributed
 * import 004-FR-025 exists to prevent.
 */
export const recipeSourceAttributionSchema = z.string().min(1).max(MAX_RECIPE_SOURCE_ATTRIBUTION_LENGTH);

/** A cuisine label. `.min(1)` for the same round-trip reason as {@link recipeTitleSchema}. */
export const recipeCuisineSchema = z.string().min(1).max(MAX_RECIPE_CUISINE_LENGTH);

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
 *
 * ⛔ NOT A PREPARATION, and U26 RESOLVED that rather than renaming this (plan U26's open question). The
 * docstring above is accurate and the field is not dead — it simply has no EDITOR writer. Its one producer
 * is `@kitchensink/cookbook-import`'s `toImportedIngredientLine`, which writes `notes: parsed.raw`: the
 * whole normalized clause the book printed (`2 cups all-purpose flour, sifted`), kept verbatim beside the
 * structured values for a reader. Retitling this field to "preparation" would therefore relabel every
 * imported line's FULL CLAUSE as a preparation phrase, on a surface that renders it
 * (`RecipeDetailBody.tsx`) — a visible corruption of data at rest, not a docstring fix. So
 * {@link recipeIngredientPreparationSchema} is a genuinely new field, this one is untouched, and no
 * backfill happens.
 */
export const recipeIngredientNotesSchema = z.string().min(1);

/**
 * How a cook prepares this line's food — `finely chopped`, `at room temperature`, `roughly torn` (plan U26).
 *
 * ⛔ NEVER PART OF THE FOOD'S NAME, on read or on write. The name comes from the catalog and is what a
 * `food_id` resolves to; a preparation is what THIS recipe does to it. Folding one into the other is how a
 * name stops matching any catalog row, and it is the shape `versions/model.ts`'s preview deliberately does
 * NOT extend to (see its own note).
 *
 * ⚠️ The VOCABULARY this field holds is `@kitchensink/recipe-import-core`'s `modifierLexicon.ts` — the
 * KTD-11b ruling of 2026-08-23: a past participle is preparation (`chopped`, `grated`, `melted`, `sifted`),
 * an ADJECTIVE is identity and belongs in the name (`sweet`, `brown`, `Italian`, `large`), and a
 * temperature is preparation even though it is an adjective (`hot`, `cold`). This field is the wire's half
 * of that split; nothing here re-derives it, and nothing should — that module records why a part-of-speech
 * tagger cannot implement a definition that is not a claim about English.
 *
 * `.trim()` before the bounds, then `.min(1)`, following {@link recipeIngredientSourceLineSchema} rather
 * than the bare `.min(1)` above: a whitespace-only preparation is a second spelling of absent, and "this
 * line states no preparation" has exactly one representation — omitting the key.
 */
export const recipeIngredientPreparationSchema = z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH));

/**
 * The section an ingredient line belongs to — `For the marinade`, `Dry ingredients` (plan U27).
 *
 * ⛔ FREE TEXT, never an enum, and that is an owner ruling (2026-08-24) rather than a default. Dry/wet as a
 * per-line ATTRIBUTION was dropped — the USDA derives nothing usable for it (`foodCategory` is a taxonomy,
 * and the Water nutrient gets the cooking sense backwards: flour at 12% water is dry, honey at 17% is wet),
 * and more decisively it is a property of the FOOD rather than of a recipe's use of it, so a per-line toggle
 * asks a cook to restate a fact about flour every time they write a recipe. Where it genuinely matters it
 * means MIXING ORDER, which is the same axis as "For the sauce" — one field serves both. `Dry` and `Wet`
 * survive here as two labels among many, which is exactly why a closed set will not do: it could not
 * express "For the crust".
 *
 * ⛔ SCOPED TO ITS RECIPE, structurally. There is no label id, no registry and no cross-recipe entity — a
 * label is a string on a line, and a line belongs to one recipe. Two recipes using "For the sauce" share a
 * word and nothing else.
 *
 * ⛔ `.trim()` is load-bearing here in a way it is not for a preparation: sections are folded from the
 * labels themselves, so an untrimmed `"Dry "` would render a SECOND section under a heading visually
 * identical to `"Dry"`, which no reader could tell apart and no cook could merge.
 */
export const recipeIngredientGroupLabelSchema = z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH));

/**
 * The raw line a cook's SOURCE stated for one ingredient — the transcription, never our rendering of it.
 *
 * ⛔ This is what U11's verification gate checks OUR PARSE AGAINST, which is the only reason it exists. It is
 * therefore never the ingredient's name and never {@link recipeIngredientNotesSchema}: verifying a parse
 * against a string we ourselves produced from that parse is circular and always agrees, which is a gate that
 * reports success by construction. `2 cups all-purpose flour, sifted` is a source line; `Flour` is not.
 *
 * `.trim()` before the bounds, then `.min(1)`, so a whitespace-only line is REFUSED rather than stored as a
 * source line with no content — "this line was authored, not transcribed" has exactly one representation on
 * the wire, and it is omitting the key. `decideVerification` reads an absent line as `skip: 'no-source-text'`,
 * a stated non-conclusion; a blank one would have been read as a line whose source said nothing.
 */
export const recipeIngredientSourceLineSchema = z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH));

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
 * `CHECK (stars BETWEEN 1 AND 5)`, and `storageCapacity.test.ts` asserts the pairing.
 */
export const recipeRatingStarsSchema = z.number().int().min(1).max(5);
