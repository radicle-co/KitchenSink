/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/recipes/recipes.schema.ts

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
    paginatedResponseSchema,
    recipeCuisineSchema,
    recipeDescriptionSchema,
    recipeDetailSchema,
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
    recipeSchema,
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

/** One ingredient line on a create/update request. Which fields are required is this file's ENVELOPE. */
export const recipeIngredientInputSchema = z.strictObject({
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
 * Body of `POST /api/v1/recipes`.
 *
 * `ownerId` is deliberately absent and unaccepted: ownership comes from the verified principal, so there is no
 * field for a caller to smuggle one through, and the STRICT object answers `400` if one is sent.
 *
 * `deviceLabel` IS PUBLISHED ON THE REQUEST SIDE. The server has always accepted and persisted it while the
 * document listed it only on `RecipeVersion` (a RESPONSE) and marked both request bodies
 * `additionalProperties: false` — so the contract forbade a field the service relies on.
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
    /** Defaults to `public` SERVER-side, so an omitted field stays distinguishable from an explicit choice. */
    visibility: recipeVisibilitySchema.optional(),
    /** Publication status (W8-a.3). Defaults to `published` server-side; the wizard's Save-Draft sends `draft`. */
    status: recipeStatusSchema.optional(),
    deviceLabel: recipeDeviceLabelSchema.optional(),
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

export {
    /** `GET /api/v1/recipes` item + `Recipe` component — the recipe list/summary body. */
    recipeSchema,
    /** `GET /api/v1/recipes/{id}` + `RecipeDetail` component — the full recipe body. */
    recipeDetailSchema,
    /** The `PaginatedRecipes` envelope factory, shared by every paginated endpoint in this API. */
    paginatedResponseSchema,
};
