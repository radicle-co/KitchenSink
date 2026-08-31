/**
 * AUTHORED WIRE CONTRACT for the recipes vertical (`/api/v1/recipes…`) — the request ENVELOPES this service
 * serves, composed from the recipe domain's own bound Value Objects.
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY `zod`,
 * `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules (allowlist in `contract/config.ts`).
 *
 * DESIGN PATTERN: Composition over Value Objects. Every field is one of `recipe-core`'s bound schemas; this file
 * adds only the ENVELOPE, adapted into Nest through `dto/*.dto.ts` (`createZodDto`) so the shape the pipe
 * enforces and the shape the contract publishes are ONE OBJECT.
 *
 * ⚠️ OWNER RULING — every character limit, numeric ceiling and charset rule lives in `recipe-core`'s
 * `recipeRequestBounds.ts`, NOT here, so an editor's character counter, this service's validation and the
 * published contract are ONE number. ⛔ Do NOT re-declare a bound here to "keep the contract self-contained".
 * `recipe-core` owns the VALUE constraint; THIS FILE owns the ENVELOPE (that a create body has a title at all,
 * and that it is required) — the half that satisfies §15.2 / ADR-0014.
 *
 * ⚠️ Every field reaching a bounded column carries that column's ceiling: `servings`, `prepTimeMinutes`,
 * `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds` and `expectedVersion` → `integer` (int4); the four
 * per-line nutrition overrides → `numeric(8,2)`. Unbounded, `servings: 9999999999` passed validation and failed
 * at the INSERT (Postgres `22003`), which `ApiExceptionFilter` collapses to a generic **500**.
 * `src/database/__tests__/storageCapacity.test.ts` asserts this per column as an ASSERTION, never a derivation:
 * nothing here imports a drizzle type, and no storage type is ever a wire type.
 *
 * Every request body is `z.strictObject` (GR-017 §17-c), INCLUDING the nested line/step shapes — a misspelled
 * `userProteinG` in an ingredient line is the same silent partial write, so top-level-only strictness would be
 * cosmetic. `updateRecipeRequestSchema` inherits it through `.omit().partial().extend()` off the shared base (zod carries the
 * `catchall`). ⚠️ The ONE non-strict shape is {@link listRecipesQuerySchema}, a READ query — see its own note.
 *
 * The `.min(1)`s on `title`, `cuisine`, `steps[].instruction` and `ingredients[].notes` fix a body the server
 * could SEND that no client could READ (`recipe-core`'s response schemas reject `''`, so the typed client threw
 * on reading back what it had just written). `description` deliberately still accepts `''` — see
 * `recipeDescriptionSchema`'s own note.
 */
import { z } from 'zod';

import {
    ingredientQuantitySchema,
    paginatedResponseSchema,
    recipeCuisineSchema,
    recipeDescriptionSchema,
    recipeDetailSchema,
    recipeDifficultySchema,
    recipeMealTypeSchema,
    recipeExpectedVersionSchema,
    recipeIngredientGroupLabelSchema,
    recipeIngredientIdSchema,
    recipeIngredientNameSchema,
    recipeIngredientNotesSchema,
    recipeIngredientPreparationSchema,
    recipeIngredientSourceLineSchema,
    recipeIngredientUnitSchema,
    recipeLineNutritionSchema,
    recipeListMemberSchema,
    recipeMinutesSchema,
    recipeSchema,
    recipeServingsSchema,
    recipeSourceAttributionSchema,
    recipeSourceUrlSchema,
    recipeStatusSchema,
    recipeStepInstructionSchema,
    recipeTimerSecondsSchema,
    recipeTitleSchema,
    recipeVisibilitySchema,
    statedMeasureSchema,
    MAX_RECIPE_INGREDIENTS,
    MAX_RECIPE_LIST_PAGE_SIZE,
    MAX_RECIPE_TAGS,
    RecipeSourceType,
} from '@kitchensink/recipe-core';

// ── Nested request shapes ─────────────────────────────────────────────────────────────────────────

/** One ingredient line on a create/update request. Which fields are required is this file's ENVELOPE. */
export const recipeIngredientInputSchema = z.strictObject({
    ingredientId: recipeIngredientIdSchema,
    name: recipeIngredientNameSchema,
    /**
     * What the source states — one value, two bounds, or nothing (U8/KTD-6). ⛔ Not a bare number and not a
     * number plus a loose `quantityHigh`: see `ingredientQuantitySchema`'s own docs for why the union.
     */
    quantity: ingredientQuantitySchema,
    /** Omit for a unitless line; `''` is rejected so "unitless" has ONE representation. */
    unit: recipeIngredientUnitSchema.optional(),
    /**
     * Free-form display override (persisted as `displayText`).
     *
     * ⛔ NOT the preparation, and U26 RESOLVED that rather than renaming it. No EDITOR writes this field —
     * its one producer is `@kitchensink/cookbook-import`, which writes the source's whole normalized clause
     * ("2 cups all-purpose flour, sifted") verbatim for a reader. See `preparation` below and
     * `0030_ingredient_preparation_and_group.sql` for why the two are separate facts.
     */
    notes: recipeIngredientNotesSchema.optional(),
    /**
     * How THIS recipe prepares the food — `finely chopped`, `at room temperature` (plan U26).
     *
     * ⛔ ON THE BASE, and therefore inherited by `PATCH` — the deliberate OPPOSITE of the recipe-level
     * `source`. ADR-0023 keeps `source` off the base because `updateRecipeRequestSchema` derives from it,
     * so a field placed there "would let ANY caller re-classify an existing recipe as `imported_public`
     * after creation, bypassing the policy" — an AUTHORIZATION concern about a field VALUE with a
     * cross-user reputational harm behind it. A preparation classifies nothing, gates nothing and is read
     * by no policy, so that reasoning does not reach it.
     *
     * ⚠️ Nor does the verification gate's: that ADR's `statedMeasure` addendum explicitly refuses to treat
     * the gate as an authorization surface ("a parser-quality control, not an integrity control against a
     * hostile client"). `verificationKey` hashes identity, both quantity bounds, the unit and the stated
     * measure — a preparation is in none of it — so there is nothing here to steer either way.
     *
     * ⛔ And create-only would be ACTIVELY WRONG: `versions.service.ts` restores by rebuilding an UPDATE
     * body, so a create-only field could never be restored at all, and `replaceForRecipe` re-inserts every
     * line on any PATCH that supplies `ingredients` — which both shipped clients always do.
     *
     * Omit when the line states none; `''` and whitespace-only are rejected, so absence has ONE spelling.
     */
    preparation: recipeIngredientPreparationSchema.optional(),
    /**
     * The section this line belongs to — `For the marinade`, `Dry` (plan U27).
     *
     * ⛔ FREE TEXT, never an enum (owner ruling 2026-08-24). Dry/wet as a per-line ATTRIBUTION was dropped:
     * it is a property of the FOOD rather than of a recipe's use of it, and where it matters to a cook it
     * means MIXING ORDER — the same axis as "For the sauce". "Dry" and "Wet" survive as two labels among
     * many, which is why a closed set will not do: it could not express "For the crust".
     *
     * ⛔ PER LINE, and NOT a `(group, lines[])` structure. A structure can represent a group with no lines,
     * which this cannot — so such a group would survive in an editor, vanish on save, and read to the cook
     * as a section that deleted itself. It also makes "move a line to another section" a single-field
     * update rather than a splice, which is where a line's other fields get dropped.
     *
     * Sections are folded from CONSECUTIVE RUNS of equal labels in array order, never grouped by label
     * identity — folding by identity would REORDER the recipe. An ungrouped recipe omits the key on every
     * line and renders as a plain flat list with no section chrome.
     *
     * On the BASE for the same reason as `preparation`: a cook regroups lines while editing.
     */
    groupLabel: recipeIngredientGroupLabelSchema.optional(),
    userCalories: recipeLineNutritionSchema.optional(),
    userProteinG: recipeLineNutritionSchema.optional(),
    userCarbsG: recipeLineNutritionSchema.optional(),
    userFatG: recipeLineNutritionSchema.optional(),
});

/** One ingredient line on a create/update request. */
export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;

/**
 * One ingredient line on a CREATE request — the base line plus the raw source line it was transcribed from
 * (plan U11/U14).
 *
 * ⛔ A SEPARATE ELEMENT SCHEMA, and {@link createRecipeRequestSchema} overrides the base's `ingredients` key
 * with an array of THIS one. It is the same reasoning `recipeSourceInputSchema` states for the recipe-level
 * `source` field, one level down: `updateRecipeRequestSchema` derives from `createRecipeRequestBaseSchema`,
 * so an element field placed on {@link recipeIngredientInputSchema} would be inherited by
 * `PATCH /api/v1/recipes/{id}` — and a source line is a CREATE-time fact for a sharper reason than
 * provenance is.
 *
 * A source line is what U11's gate checks our parse AGAINST, and the gate's verdicts are memoized ACROSS
 * USERS (`ingredient_resolution_memos`, migration 0021). A caller able to re-assert a source line on `PATCH`
 * could therefore steer a judgement: state a line that agrees with a wrong parse, collect an `agree` verdict,
 * and have the resulting memo bind that resolution for everyone else. Create-only keeps the fact the gate
 * judged identical to the fact that was transcribed.
 *
 * ⛔ A CREATE-ONLY WIRE FIELD IS NOT A CREATE-ONLY FACT, and conflating the two was a real defect caught in
 * review. `replaceForRecipe` deletes and re-inserts the whole line set whenever a `PATCH` supplies
 * `ingredients` — and BOTH shipped clients supply it on every save (`toUpdateRecipeInput` spreads
 * `toCreateRecipeInput`, which always emits the array), so there is no metadata-only `PATCH` from any app.
 * Left alone, fixing a typo in an imported recipe's TITLE would silently destroy every source line on it.
 * The transcription is therefore carried forward server-side by the pure
 * `recipes/domain/transcriptionCarryForward.ts`: a line keeps its source line when its identity, both quantity
 * bounds and its unit are unchanged, and loses it when any of them moves — because that tuple is exactly
 * what a verdict about the line is keyed on, so a change to it makes the old transcription describe a
 * different judgement. The wire stays create-only; the FACT survives an edit that did not change it.
 */
export const createRecipeIngredientInputSchema = recipeIngredientInputSchema.extend({
    /**
     * What the cook's source LINE said, verbatim. Omit for an authored line — there is no source for our
     * parse to disagree with, which is a stated non-conclusion rather than a gap.
     */
    sourceLine: recipeIngredientSourceLineSchema.optional(),
    /**
     * What the source PRINTED, when `quantity`/`unit` above are a RESTATEMENT of it (plan U7 R35 / U11).
     *
     * ⛔ THE FIELD THAT STOPS THE GATE MANUFACTURING A FALSE DISAGREE. The importer restates a historical
     * measure at parse time — `one gill of milk` becomes `quantity: 0.5, unit: 'cup'`, because the USDA
     * household-portion table carries `cup` and has never heard of a gill — and until this field existed the
     * gill survived only as prose in `notes` and `sourceLine`. U11's gate builds its question from
     * `quantity`/`unit`, so the model was shown `one gill of milk` beside `0.5 cup` and asked whether they
     * agree. They do not, and it is right to say so about a line we parsed CORRECTLY. U11 ranks a wrong
     * DISAGREE as the unacceptable direction, because it withholds nutrition from a correct line.
     *
     * Omit it whenever `quantity`/`unit` are what the source itself said — which is every authored line and
     * every line stating a modern unit. Its PRESENCE is the disclosure that a restatement happened, exactly
     * as `RecipeNutrition.rangeDerivedBound`'s is; there is no "not applicable" value.
     *
     * ⛔ CREATE-ONLY, on this element schema and never on {@link recipeIngredientInputSchema} — the same
     * ADR-0023 shape `sourceLine` rides, for a SHARPER version of the same reason. A source line is what the
     * gate checks our parse AGAINST, so a lie in it is visible to the model; a stated measure IS the parse
     * the model is shown, so a lie in it is invisible. Letting `PATCH` re-assert one would hand any caller a
     * way to steer a verdict that `ingredient_resolution_memos` then memoizes ACROSS USERS. The FACT survives
     * an edit through `recipes/domain/transcriptionCarryForward.ts`, which carries it forward beside the
     * source line and drops it on exactly the same condition.
     */
    statedMeasure: statedMeasureSchema.optional(),
});

/** One ingredient line on a create request. */
export type CreateRecipeIngredientInput = z.infer<typeof createRecipeIngredientInputSchema>;

/** One instruction step on a create/update request. The server assigns `stepNumber` from array order. */
export const recipeStepInputSchema = z.strictObject({
    instruction: recipeStepInstructionSchema,
    /** Omitted means "no timer" — the only thing the read projection can produce; the bound is strictly positive. */
    timerSeconds: recipeTimerSecondsSchema.optional(),
});

/** One instruction step on a create/update request. */
export type RecipeStepInput = z.infer<typeof recipeStepInputSchema>;

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The scope a principal must hold in its token's SIGNED `public_metadata` to declare a curated public-domain
 * import (`imported_public`).
 *
 * ⚠️ PUBLISHED ON THE CONTRACT DELIBERATELY. It is not an implementation detail: a caller cannot mint a
 * usable curator token without knowing the string, and the import tooling that does so must read the value
 * rather than restate it — a second copy of an authorization identifier is the kind of drift that fails
 * OPEN. `provenancePolicy.ts` imports it from here; nothing re-declares it.
 *
 * The GRANT itself is administered out of band, in Clerk, on the signing key's authority — see ADR-0023.
 */
export const CURATOR_IMPORT_SCOPE = 'recipes:import:public';

/**
 * The provenance a caller may DECLARE on `POST /api/v1/recipes` (004-FR-024 / 004-FR-025, ADR-0023).
 *
 * ⚠️ A DISCRIMINATED UNION, not an object with optional fields, and that choice is the requirement rather
 * than a style preference. `imported_public` asserts "this content came from somewhere else, and here is
 * where"; a declaration carrying that claim with no URL and no attribution is the false-attribution hazard
 * 004-FR-025 exists to prevent. Making the two fields REQUIRED on that member — and UNREPRESENTABLE on
 * `user_created`, where they would mean nothing — turns "an import must be attributed" from a rule the
 * service enforces into a state the wire cannot express.
 *
 * ⛔ `imported_physical` and `imported_paid` are DELIBERATELY absent, which NARROWS 004-FR-025 rather than
 * implementing it. Both are private-only classes under C-004, and `evaluateVisibility` admits either to
 * `private` with NO premium check — so admitting them here would hand a free-tier caller exactly the private
 * recipe 004-FR-028 says must be gated on an entitlement, and 004-FR-014a's attestation + citation
 * machinery that is supposed to travel with them does not exist. They join this union when 004 builds that
 * gate, and adding a member is additive.
 *
 * ⛔ It is also NOT on {@link createRecipeRequestBaseSchema}. `updateRecipeRequestSchema` derives from that
 * base through `.omit().partial()`, so a field placed there is inherited by `PATCH /api/v1/recipes/{id}` —
 * which would let ANY caller re-classify an existing recipe as `imported_public` after creation, bypassing
 * the provenance policy entirely (it runs only on create). `recipes.schema.test.ts` pins the absence.
 *
 * WHO may declare what is NOT decided here. This schema owns the legal SHAPE; the grant rule lives in the
 * pure `evaluateProvenance` policy, so a denial is a `403` about the caller rather than a `400` about the
 * body.
 */
export const recipeSourceInputSchema = z.discriminatedUnion('sourceType', [
    z.strictObject({ sourceType: z.literal(RecipeSourceType.USER_CREATED) }),
    z.strictObject({
        sourceType: z.literal(RecipeSourceType.IMPORTED_PUBLIC),
        sourceUrl: recipeSourceUrlSchema,
        sourceAttribution: recipeSourceAttributionSchema,
    }),
]);

/** The provenance a caller declared on a create request, if any. */
export type RecipeSourceInput = z.infer<typeof recipeSourceInputSchema>;

/**
 * Body of `POST /api/v1/recipes`.
 *
 * `ownerId` is deliberately absent and unaccepted: ownership comes from the verified principal, so there is no
 * field for a caller to smuggle one through, and the STRICT object answers `400` if one is sent.
 *
 * ⚠️ `deviceLabel` USED TO SIT HERE, and its removal is a RULING rather than an oversight. The owner ruled
 * on **2026-08-26** that device attribution comes out entirely — *"I don't care what device they were on
 * when they edited something."* Nothing ever sent the field (no writer existed in either app or in the
 * typed client), so every persisted value was NULL and the attribution it fed never rendered. Because this
 * object is STRICT, a body that still carries it is now REJECTED with a `400` rather than silently
 * stripped; that is the intended behaviour, and `recipes.schema.test.ts` pins it.
 *
 * ⚠️ `steps` and `dietaryFlags` carry no upper CARDINALITY bound, matching what the DTO enforced; both are bounded
 * in practice only by the 100 kB JSON body limit. The asymmetry with `ingredients` (100) and `tags` (50) is
 * flagged for a product decision rather than resolved by guessing a number here.
 */
const createRecipeRequestBaseSchema = z.strictObject({
    title: recipeTitleSchema,
    description: recipeDescriptionSchema.optional(),
    cuisine: recipeCuisineSchema.optional(),
    /**
     * Author-stated difficulty (FR-001b). `.optional()` and NOT `.nullable()`: on create there is nothing to
     * clear, so an omit is "the author stated none" and an explicit `null` is rejected.
     */
    difficulty: recipeDifficultySchema.optional(),
    /**
     * Author-stated meal type (plan U34). On the BASE, deliberately — unlike `source`, which sits on the
     * CREATE extension so a PATCH can never re-classify a recipe's PROVENANCE (ADR-0023), meal type is an
     * ordinary editorial field a cook changes their mind about, so it must be editable by PATCH.
     *
     * `.optional()` and NOT `.nullable()` here, exactly as for `difficulty` above: on create there is nothing
     * to clear. The UPDATE schema adds the `null` clear sentinel.
     */
    mealType: recipeMealTypeSchema.optional(),
    /** Defaults to `public` SERVER-side, so an omitted field stays distinguishable from an explicit choice. */
    visibility: recipeVisibilitySchema.optional(),
    /** Publication status (W8-a.3). Defaults to `published` server-side; the wizard's Save-Draft sends `draft`. */
    status: recipeStatusSchema.optional(),
    ingredients: z.array(recipeIngredientInputSchema).max(MAX_RECIPE_INGREDIENTS),
    steps: z.array(recipeStepInputSchema),
    servings: recipeServingsSchema,
    prepTimeMinutes: recipeMinutesSchema,
    cookTimeMinutes: recipeMinutesSchema,
    /** Independent of prep + cook: a recipe may have inactive time (rest, marinate, chill) in neither. */
    totalTimeMinutes: recipeMinutesSchema,
    tags: z.array(recipeListMemberSchema).max(MAX_RECIPE_TAGS).optional(),
    dietaryFlags: z.array(recipeListMemberSchema).optional(),
});

/**
 * Body of `POST /api/v1/recipes`.
 *
 * `ingredients` and `steps` carry no `.min(1)` on the base object; the floor is conditional and lives in the two
 * refinements below, because it is a property of PUBLISHING rather than of existing. A `draft` is allowed to be
 * empty — that is precisely what makes the wizard's Save-Draft-from-step-1 a legal request, and it was NOT legal
 * before: the flat `.min(1)` meant the app built `{ ingredients: [], steps: [] }`, this service answered `400`,
 * and the only reason no test caught it is that the web e2e mock validated nothing.
 *
 * An ABSENT `status` still requires content, because it defaults to `published` — so the exemption is keyed on
 * the explicit literal, and every body that does not say `draft` behaves exactly as it did before.
 *
 * ⚠️ This condition does NOT survive into `openapi.yaml`: JSON Schema cannot express "required only when a
 * sibling equals a literal" through `z.toJSONSchema`, so the document shows both arrays as merely arrays. The
 * zod here is the contract; the document is a projection of it (ADR-0014).
 */
export const createRecipeRequestSchema = createRecipeRequestBaseSchema
    // ⚠️ `.extend()` on the CREATE schema, never on the BASE — see `recipeSourceInputSchema`'s note. The base
    // is what `updateRecipeRequestSchema` derives from, so a provenance field placed there becomes a
    // provenance field on `PATCH`, and provenance is a create-time fact.
    .extend({
        source: recipeSourceInputSchema.optional(),
        // ⚠️ OVERRIDES the base's `ingredients` key with the widened element — see
        // `createRecipeIngredientInputSchema`. The cardinality bound is restated because `.extend()` replaces
        // the whole field; `ingredientArrayCap.test.ts`-style identity is preserved by composing the SAME
        // `MAX_RECIPE_INGREDIENTS` constant rather than a second number.
        ingredients: z.array(createRecipeIngredientInputSchema).max(MAX_RECIPE_INGREDIENTS),
    })
    .refine((value) => value.status === 'draft' || value.ingredients.length > 0, {
        message: 'A published recipe needs at least one ingredient.',
        path: ['ingredients'],
    })
    .refine((value) => value.status === 'draft' || value.steps.length > 0, {
        message: 'A published recipe needs at least one step.',
        path: ['steps'],
    });

/** Request body for creating a recipe. */
export type CreateRecipeRequest = z.infer<typeof createRecipeRequestSchema>;

/**
 * Body of `PATCH /api/v1/recipes/{id}` — a partial update carrying the optimistic-concurrency token.
 *
 * ⚠️ `visibility` is deliberately ABSENT: it is set through `PATCH /api/v1/recipes/{id}/visibility`, where the
 * C-004 policy evaluator decides whether the transition is allowed. The document used to advertise it here (it
 * came free with `.partial()`) while the service STRIPPED it — a field the contract offered and the server
 * ignored, which is what let the app-side `toUpdateRecipeInput` projection keep sending it. Omitting it makes the
 * document true, and because this body is STRICT a caller that still sends one now gets a `400`.
 *
 * `difficulty` is the three-state field (FR-001b), and the states are NOT interchangeable: ABSENT = leave
 * unchanged, a VALUE = set it, explicit `null` = CLEAR it back to "not stated". Without the `null` sentinel,
 * `Partial<>`'s omitted-means-unchanged rule would make "not stated" reachable only at create time, so a user who
 * ever set a difficulty could never remove it.
 */
export const updateRecipeRequestSchema = createRecipeRequestBaseSchema
    .omit({ visibility: true })
    .partial()
    .extend({
        expectedVersion: recipeExpectedVersionSchema,
        difficulty: recipeDifficultySchema.nullable().optional(),
        // Three-state for the SAME reason as `difficulty` above: `Partial<>` makes an omit mean "unchanged",
        // so clearing a stated meal type needs its own spelling on the wire, and an explicit `null` is it.
        // Without this line a cook who ever chose "dinner" could never get back to "not stated".
        mealType: recipeMealTypeSchema.nullable().optional(),
    })
    // Derived from the BASE, not from `createRecipeRequestSchema`: `.omit()` throws on an object carrying
    // refinements. The publish floor is restated here rather than inherited, and its predicate is deliberately
    // NOT create's — an absent `status` means "leave unchanged" on a PATCH, so only the explicit `published`
    // literal triggers it, and only for an array the body actually supplies.
    //
    // A body that publishes WITHOUT resending the arrays cannot be judged here at all, since the wire does not
    // carry what is already stored. `RecipesService.update` re-checks the persisted recipe on the publish
    // transition; this pair is the fast, local half of that guarantee, not the whole of it.
    .refine(
        (value) => value.status !== 'published' || value.ingredients === undefined || value.ingredients.length > 0,
        {
            message: 'A published recipe needs at least one ingredient.',
            path: ['ingredients'],
        },
    )
    .refine((value) => value.status !== 'published' || value.steps === undefined || value.steps.length > 0, {
        message: 'A published recipe needs at least one step.',
        path: ['steps'],
    });

/** Request body for updating a recipe. */
export type UpdateRecipeRequest = z.infer<typeof updateRecipeRequestSchema>;

/**
 * Body of `PATCH /api/v1/recipes/{id}/visibility`.
 *
 * This schema only bounds the literal. The C-004 policy evaluator in `RecipesService` still decides whether the
 * requested transition is ALLOWED for the recipe's `(sourceType, isPremium, hasSubstantiveEdit)`, so a rejected
 * transition stays a policy answer rather than becoming a validation `400`.
 */
export const setRecipeVisibilityRequestSchema = z.strictObject({
    visibility: recipeVisibilitySchema,
});

/** Request body for setting a recipe's visibility. */
export type SetRecipeVisibilityRequest = z.infer<typeof setRecipeVisibilityRequestSchema>;

/**
 * Body of `POST /api/v1/recipes/{id}/clone` — no client-controlled fields, so the BODY is optional.
 *
 * A clone deterministically copies the source's content and attribution and derives its visibility from the C-004
 * clone-default rule, so there is nothing for a caller to supply. `.default({})` is what makes a bodyless `POST`
 * legal, and it still does under `strictObject`, because a DEFAULT applies to an ABSENT body while the catchall
 * only judges the keys of a body that is present. A stray field is therefore a `400` — the honest answer to a
 * caller who believes this endpoint takes parameters.
 */
export const cloneRecipeRequestSchema = z.strictObject({}).default({});

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
 * silently-truncated page size is a contract that lies about what it did. Defaults are applied HERE rather than in
 * the service, so the parsed query is always complete. `page`/`pageSize` are deliberately not `recipe-core` Value
 * Objects: the COERCION and the DEFAULTS are properties of this endpoint's query bag, not of the domain values,
 * and the only actual bound (`MAX_RECIPE_LIST_PAGE_SIZE`) is composed like every other.
 *
 * ⚠️ FORWARD-COMPATIBILITY EXEMPTION from GR-017 §17-c's `z.strictObject()` default, documented at the schema as
 * that rule requires. This is a READ query — the exemption's named case — for two concrete reasons:
 *
 *  1. **The bag is not the client's alone.** Nest hands the pipe the WHOLE parsed query string, so a strict object
 *     would `400` on anything riding along: a cache-buster, an analytics parameter, a pasted tracking tag. None
 *     changes what the endpoint returns, and refusing to list a caller's recipes over one is a pure regression.
 *  2. **A read has no silent-partial-write to prevent.** §17-c's argument is that stripping a mutating body turns
 *     a caller's mistake into a `200` and data that is not what they sent. A stripped query parameter changes
 *     nothing that persists — the caller gets the documented default and the page they would have got by omitting
 *     it — so the failure the rule makes visible does not exist here.
 *
 * The same reasoning covers `listCollectionsQuerySchema` and `ingredientSearchQuerySchema`, and
 * `contract/__tests__/contract.test.ts` pins the exempt set so a MUTATING body cannot join it by accident.
 */
export const listRecipesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_RECIPE_LIST_PAGE_SIZE).default(20),
    sortBy: z.enum(RECIPE_LIST_SORT_BY).default('updatedAt'),
});

/** Parsed pagination + sort query for listing recipes. */
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;

// ── Re-exported wire shapes: the recipe entity bodies this vertical serves ──────────────────────────────────────────────

/*
 * ⚠️ RE-EXPORT, NOT RE-DECLARATION — the mechanism of a ruling, not a convenience.
 *
 * RULING: `@kitchensink/schema-recipe` is AUTHORITATIVE for every shape on the recipe wire, INCLUDING the bodies
 * that are `recipe-core` domain entities — reached by re-export from the authored schema of the vertical that
 * SERVES them, never by re-declaration. Three reasons, rather than leaving a consumer to import entity zod from
 * `recipe-core` and envelope zod from the schema package:
 *
 *  1. **It was two sources for one question.** `getRecipeById` validated its response against `recipe-core` while
 *     the collections and account reads used `@kitchensink/schema-recipe`, so "where does this endpoint's shape
 *     live?" had a per-endpoint answer. GR-017 §17-b.2 requires a client to import its wire types AND its runtime
 *     zod from the schema package, which was not even possible while nine published components' zod was unexported.
 *  2. **A parser-based guard cannot tell the two cases apart.** §17-b.1 forbids a client DECLARING a wire shape,
 *     and with entity zod legitimately arriving from `recipe-core`, an import from that package is not evidence
 *     either way. One import site makes the rule mechanically checkable.
 *  3. **The document already claims these components.** `contract/openapi.ts` publishes them, so a schema package
 *     that does not export their zod is a documented-but-unreachable contract.
 *
 * ⛔ Do NOT convert these into local declarations to make the file "self-contained": `recipe-core` remains the sole
 * AUTHOR of every entity below, and re-declaring one would manufacture exactly the drift ADR-0014 removes. The
 * GR-007 axis is untouched — every non-wire consumer keeps importing these from `recipe-core`.
 */

// ── Deferred nutrition (`POST /api/v1/recipes/nutrition-batch`) ───────────────────────────────────

/**
 * The most recipes one deferred-nutrition request may name.
 *
 * A cap is REQUIRED, not defensive, and it takes food's `MAX_NUTRITION_IDS` posture for the same reason: an
 * uncapped list turns ONE request into an unbounded `IN (…)` read plus an unbounded fan-out to the food
 * service. It is a payload / fan-out guard, not a product limit.
 *
 * ⚠️ THE NUMBER IS 500 BECAUSE 006 RULED IT, and the reason is load-bearing rather than round: REQ-IF-008
 * fixes the cap at 500 because a 90-day × 4-slot meal plan holds at most 360 entries, which is precisely
 * what makes its "exactly one request" reachable. A tighter cap here (food's 100, say) would silently make
 * that requirement unsatisfiable in a service 006 does not own.
 *
 * Exported because the CLIENT needs it: a caller with more ids than this must chunk, and it should read the
 * rule rather than reimplement it.
 */
export const MAX_NUTRITION_RECIPE_IDS = 500;

/**
 * Body of `POST /api/v1/recipes/nutrition-batch` — the recipes whose nutrition the caller wants.
 *
 * ⚠️ The CAP LIVES IN THE SCHEMA, so the rejection is the boundary parser's `VALIDATION_FAILED` `400`
 * carrying `details.fields` — the shape `recipeApiErrorSchema` publishes for it. Enforcing the cap in the
 * controller with a hand-thrown message instead would produce a `400` whose body a client validating against
 * the published contract cannot parse: the service's own error would be unreadable by the service's own
 * published schema. Food publishes `details.maxNames`/`details.fields` for exactly this reason.
 *
 * `.min(1)`: an empty list is a caller bug, and answering it with `{}` would be indistinguishable from
 * "none of the recipes you named have nutrition" — a different fact, silently substituted.
 *
 * `z.uuid()` rather than a loose string: `recipes.id` is a `uuid` column, and an unbounded string reaching
 * the `IN (…)` predicate is a `22P02` (an INSERT/SELECT-time fault surfacing as a `500`) rather than the
 * `400` it should be. It matches `addRecipeToCollectionRequestSchema.recipeId`, this API's other recipe-id
 * request field.
 *
 * ⛔ There is no `ownerId` field and the object is STRICT: the reader is the verified principal, and a
 * recipe that principal may not read is OMITTED from the response — see {@link recipeNutritionResponseSchema}.
 */
export const recipeNutritionRequestSchema = z.strictObject({
    recipeIds: z.array(z.uuid()).min(1).max(MAX_NUTRITION_RECIPE_IDS).readonly(),
});

/** Request body for the deferred nutrition lookup. */
export type RecipeNutritionRequest = z.infer<typeof recipeNutritionRequestSchema>;

/**
 * A recipe's per-serving nutrition as the wire carries it — a THREE-state fact of which exactly TWO
 * states may cross the boundary (plan: deferred calorie lookup).
 *
 * ## Why `pending` is deliberately absent
 *
 * A card is in one of three conditions: pending (the request is in flight), known, or unaccounted (we
 * asked and there is no answer). `pending` lives ONLY on the client, as the Suspense fallback while the
 * promise is unsettled, and its absence here is the enforcement: the moment a server can emit `pending`,
 * a skeleton can become permanent — a spinner rendering forever because an origin said so, with nothing
 * to retry and nothing to time out. `unaccounted` is terminal by contrast; it is the answer, not the
 * absence of one, so it can never render a spinner.
 *
 * ## Why a discriminated union replaces `hasPartialNutrition`
 *
 * That boolean was a two-valued encoding of a three-valued fact, and three call sites pinned it `true` to
 * mean "not looked up" — a meaning its own docstring does not carry ("some line could not be accounted
 * for"). One field, two meanings, no discriminant, so a reader could not tell genuinely-partial nutrition
 * from nobody-asked, and the UI could not choose between a figure, a caveat, and nothing.
 *
 * ## The KTD-3b invariant, made structural
 *
 * `calories: 0` is a factual claim that a dish contains no energy, and an outage is not evidence for it.
 * So `known` REQUIRES a number — a zero there is a real measured zero, which water and black coffee
 * genuinely have — and every failure path lands in `unaccounted`, which carries no figure for a client to
 * render by accident.
 *
 * `freshness` reaches the wire here for the first time. `FoodNutritionGateway` has computed it since plan
 * U10 and nothing ever read it, so a reader served a cached number during a food outage was never told —
 * KTD-3b says "serve stale, MARKED", and only the first half was implemented.
 */
export const recipeNutritionStateSchema = z.discriminatedUnion('state', [
    z
        .object({
            state: z.literal('known'),
            /** Per serving. A real measured zero is legal; an outage never reaches this member. */
            caloriesPerServing: z.number().nonnegative(),
            proteinG: z.number().nonnegative(),
            carbsG: z.number().nonnegative(),
            fatG: z.number().nonnegative(),
            /** `false` when some LINE could not be accounted for — the original, narrow meaning. */
            isComplete: z.boolean(),
            /** Whether the underlying food data is current, or served from cache during an outage. */
            freshness: z.enum(['fresh', 'stale']),
            /**
             * Which bound a collapsed range's figure was taken from, when one was (R38).
             *
             * ⛔ ABSENT IS A STATEMENT, not a gap: the figure was not derived from a range at all. Publishing
             * a low-bound figure with no provenance is what R38 exists to stop — the detail view discloses it
             * and this batch, which feeds EVERY recipe card, silently did not, so one page carried two
             * opposite honesty postures about the same number.
             */
            rangeDerivedBound: z.enum(['low', 'high']).optional(),
        })
        .strict(),
    z
        .object({
            state: z.literal('unaccounted'),
            /**
             * Why there is no figure. `no_resolved_ingredients` — nothing in the recipe maps to a food yet;
             * `no_nutrient_data` — foods resolved but carry no qualifying per-100g rows; `food_unavailable`
             * — the lookup itself failed and nothing was cached; `verification_disagreement` — the U11
             * verification gate read a line's raw source text against the food we resolved it to, disagreed,
             * and this recipe's figure was WITHHELD as a result (plan U14 / R15).
             *
             * ⛔ THE FOURTH REASON IS NOT A SPELLING OF THE THIRD, and collapsing it is the conflation it
             * exists to prevent. `food_unavailable` says "come back later"; a withheld figure will not change
             * on a retry, because nothing is broken — we read the cook's own words and doubted our own match.
             * `no_nutrient_data` would be worse still: it blames the catalog for data the catalog HAD.
             *
             * ⚠️ WIRE COMPATIBILITY, decided rather than assumed. This member is `.strict()`, so it is closed
             * to EVERY additive change — a new sibling field breaks an older reader exactly as a new enum
             * member does, and there is no cheaper additive shape available here. What was checked instead is
             * the DIRECTION of the break: a client carrying the three-member enum REFUSES the value, so it
             * can never render a withheld figure as an outage, a zero, or a number. It fails closed and shows
             * nothing, which is the only safe answer it can give. Asserted in
             * `__tests__/recipeNutritionState.test.ts`.
             */
            reason: z.enum([
                'no_resolved_ingredients',
                'no_nutrient_data',
                'food_unavailable',
                'verification_disagreement',
                'verification_pending',
            ]),
        })
        .strict(),
]);

/** One recipe's nutrition state. */
export type RecipeNutritionState = z.infer<typeof recipeNutritionStateSchema>;

/**
 * The deferred-nutrition response: recipe id → state.
 *
 * ⛔ A recipe the caller may not read is OMITTED, never given a state. Emitting `unaccounted` for another
 * owner's recipe would confirm the id exists, and emitting `known` would leak the figure — so absence is
 * the authorization signal, and clients must treat a missing key as "not for you", not as an error.
 */
export const recipeNutritionResponseSchema = z
    .object({
        nutrition: z.record(z.string(), recipeNutritionStateSchema),
    })
    .strict();

/** The deferred-nutrition response body. */
export type RecipeNutritionResponse = z.infer<typeof recipeNutritionResponseSchema>;

export {
    /** `GET /api/v1/recipes` item + `Recipe` component — the recipe list/summary body. */
    recipeSchema,
    /** `GET /api/v1/recipes/{id}` + `RecipeDetail` component — the full recipe body. */
    recipeDetailSchema,
    /** The `PaginatedRecipes` envelope factory, shared by every paginated endpoint in this API. */
    paginatedResponseSchema,
};
