/**
 * @module @commise/features-recipes — recipe create/edit form model (T067).
 *
 * Pure, platform-agnostic state + helpers for the recipe editor, shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) form leaves and by the app container. Holds the editable form shape, the auto total-time
 * rule, the mapping to the recipe service's PUBLISHED request contract, and validation. No React, no
 * platform APIs.
 *
 * ⚠️ THE MAPPERS TARGET `@kitchensink/schema-recipe`, NOT A LOCAL TWIN (§15 rule 4 / ADR-0014). They used to
 * be annotated with `recipe-core`'s `CreateRecipeInput` / `UpdateRecipeInput` — hand-written interfaces that
 * mirrored `createRecipeRequestSchema` / `updateRecipeRequestSchema` field for field with nothing comparing
 * them, which is the silent-drift shape §15.1 measures. Now the editor's output type IS the request type the
 * service authors, so a backend field change fails this package's `typecheck` instead of an emulator run.
 *
 * The swap also surfaced a real defect it had been hiding: `toUpdateRecipeInput` shipped `visibility` on the
 * `PATCH` body, because it spreads the create projection. `UpdateRecipeRequest` has no such key — visibility
 * moves through `PATCH /api/v1/recipes/{id}/visibility`, where the C-004 policy evaluator gates it — and the
 * service silently STRIPPED it. A spread is exempt from excess-property checking, so annotating with the
 * published type would have compiled while still sending the field; it is dropped explicitly below instead.
 */
import {
    computeRecipeNutrition,
    recipeIngredientQuantitySchema,
    recipeStepInstructionSchema,
    recipeTitleSchema,
    toNutritionLine as buildNutritionLine,
} from '@kitchensink/recipe-core';
import type {
    FoodResolutionStatus,
    IngredientPortion,
    LineCatalogNutrition,
    LineMeasure,
    NutritionLine,
    RecipeDetail,
    RecipeDifficulty,
    RecipeNutrition,
    RecipeStatus,
    RecipeVisibility,
} from '@kitchensink/recipe-core';
import type { CreateRecipeRequest, UpdateRecipeRequest } from '@kitchensink/schema-recipe';

/**
 * One editable ingredient line. `ingredientId` is `null` until the line resolves to a catalog row (via
 * food-service typeahead or a freeform create) — the wire contract REQUIRES an id, so an unresolved line
 * cannot be submitted (validation flags it). `resolutionStatus` drives the row's async nutrition badge.
 *
 * The nutrition fields (w3/e3) feed {@link toNutritionLine}'s aggregation for step 2's per-row + running
 * per-serving nutrition (FR-007). `caloriesPer100g`/`proteinGPer100g`/`carbsGPer100g`/`fatGPer100g` +
 * `portions` are the resolved catalog nutrition, carried onto the line by `toIngredientLine`
 * (`hooks/ingredientResolver.model.ts`) once a picked ingredient resolves — absent while `PENDING` or for a
 * freeform ingredient the catalog has no data for. `userCalories`/`userProteinG`/`userCarbsG`/`userFatG` are
 * the FR-007a freeform per-line override a later task's UI sets; when present they take priority over the
 * catalog fields in {@link toNutritionLine}, exactly as the aggregator's own `NutritionLine` prioritizes them.
 */
export interface RecipeFormIngredient {
    readonly ingredientId: string | null;
    readonly name: string;
    readonly quantity: number;
    readonly unit?: string;
    readonly notes?: string;
    readonly resolutionStatus?: FoodResolutionStatus;
    readonly caloriesPer100g?: number;
    readonly proteinGPer100g?: number;
    readonly carbsGPer100g?: number;
    readonly fatGPer100g?: number;
    /** The catalog ingredient's household-measure portions — lets a volumetric/count unit convert to grams. */
    readonly portions?: readonly IngredientPortion[];
    readonly userCalories?: number;
    readonly userProteinG?: number;
    readonly userCarbsG?: number;
    readonly userFatG?: number;
}

/** One editable instruction step (the server assigns `stepNumber` from array order). */
export interface RecipeFormStep {
    readonly instruction: string;
    readonly timerSeconds?: number;
}

/** The full editable form state (create or edit). `totalTimeMinutes` is derived, never edited directly. */
export interface RecipeFormValues {
    readonly title: string;
    readonly description: string;
    readonly cuisine: string;
    /**
     * Author-stated difficulty (FR-001b). ABSENT means "not stated" — a real, first-class state, never a
     * substituted default. On an EDIT form this field is seeded from the recipe's current difficulty, so the
     * user removing it (choosing "not stated") makes the field absent, which {@link toUpdateRecipeInput}
     * turns into an explicit `null` clear on the wire (as opposed to an omit, which would leave it unchanged).
     */
    readonly difficulty?: RecipeDifficulty;
    readonly tags: readonly string[];
    readonly dietaryFlags: readonly string[];
    readonly servings: number;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
    readonly visibility: RecipeVisibility;
    readonly ingredients: readonly RecipeFormIngredient[];
    readonly steps: readonly RecipeFormStep[];
}

/**
 * Maximum title length (w3/e6) — enforced client-side via `maxLength` and surfaced by a live "N/64" counter.
 *
 * ⚠️ This is the EDITOR's display cap and it is deliberately TIGHTER than the wire's
 * `MAX_RECIPE_TITLE_LENGTH` (200, from `@kitchensink/recipe-core`): a title has to fit a recipe card. The
 * relationship is the invariant —
 * the editor may be stricter than the server, NEVER looser, or the user types something the API then rejects on
 * submit. `__tests__/model.test.ts` asserts it, so raising this above the wire cap fails the build rather than
 * shipping a form that can compose an invalid body. Which of the two numbers is RIGHT for the product is an
 * open question (they were set independently and differ 3×); the invariant holds either way.
 */
export const TITLE_MAX_LENGTH = 64;

/**
 * Maximum description length (w3/e6) — enforced client-side via `maxLength` and surfaced by a live "N/256"
 * counter. Tighter than the wire's `MAX_RECIPE_DESCRIPTION_LENGTH` (5000) for the same reason, and under the
 * same asserted invariant, as {@link TITLE_MAX_LENGTH}.
 */
export const DESCRIPTION_MAX_LENGTH = 256;

/**
 * Total time = prep + cook (FR-001 auto-computed; the editor shows it read-only). Pure.
 *
 * @param prepTimeMinutes - Prep minutes.
 * @param cookTimeMinutes - Cook minutes.
 * @returns The summed total minutes.
 */
export const computeTotalTime = (prepTimeMinutes: number, cookTimeMinutes: number): number =>
    prepTimeMinutes + cookTimeMinutes;

/**
 * Map a form ingredient line to the recipe-core {@link NutritionLine} the aggregator
 * (`computeRecipeNutrition`) consumes (w3/e3 plumbing, feeding step 2's per-row +
 * running per-serving nutrition, FR-007/FR-007a). Delegates the actual merge to recipe-core's own
 * `toNutritionLine(measure, catalog)` — the single place a line's nutrition inputs are combined (module doc,
 * `recipe-core/src/nutrition.ts`) — by splitting this line into its {@link LineMeasure} (quantity/unit + any
 * freeform user override) and its {@link LineCatalogNutrition} (resolved per-100g macros + household
 * portions), omitted entirely when the line carries none of it (still resolving, or a freeform line with no
 * catalog match). A missing `unit` degrades to `''` rather than a guess: the aggregator's own `unitToGrams`
 * cannot convert an empty unit, so the line is correctly excluded (`isComplete: false`) instead of silently
 * assuming a unit. Pure.
 *
 * @param line - The form's ingredient line.
 * @returns The {@link NutritionLine} for the recipe-core nutrition aggregator.
 */
export const toNutritionLine = (line: RecipeFormIngredient): NutritionLine => {
    const measure: LineMeasure = {
        quantity: line.quantity,
        unit: line.unit ?? '',
        ...(line.userCalories === undefined ? {} : { userCalories: line.userCalories }),
        ...(line.userProteinG === undefined ? {} : { userProteinG: line.userProteinG }),
        ...(line.userCarbsG === undefined ? {} : { userCarbsG: line.userCarbsG }),
        ...(line.userFatG === undefined ? {} : { userFatG: line.userFatG }),
    };

    const hasCatalogNutrition =
        line.caloriesPer100g !== undefined ||
        line.proteinGPer100g !== undefined ||
        line.carbsGPer100g !== undefined ||
        line.fatGPer100g !== undefined ||
        line.portions !== undefined;

    const catalog: LineCatalogNutrition | undefined = hasCatalogNutrition
        ? {
              ...(line.caloriesPer100g === undefined ? {} : { caloriesPer100g: line.caloriesPer100g }),
              ...(line.proteinGPer100g === undefined ? {} : { proteinGPer100g: line.proteinGPer100g }),
              ...(line.carbsGPer100g === undefined ? {} : { carbsGPer100g: line.carbsGPer100g }),
              ...(line.fatGPer100g === undefined ? {} : { fatGPer100g: line.fatGPer100g }),
              ...(line.portions === undefined ? {} : { portions: line.portions }),
          }
        : undefined;

    return buildNutritionLine(measure, catalog);
};

/**
 * One ingredient line's own calories (w3/e3, step 2's per-row figure, FR-007) — the SAME aggregator
 * {@link recipeNutritionTotal} uses, run over just this one line at `servings=1` so its per-serving division
 * is a no-op and the result is the line's whole contribution. Returns `undefined` — never a fake `0` — when
 * the line has no computable nutrition: still resolving (no catalog per-100g yet), a freeform line with no
 * user-entered calories, a catalog line whose unit the aggregator cannot convert to grams (no mass factor,
 * no matching portion), or an edit-mode line seeded from `RecipeIngredientView` (which carries no per-100g
 * data at all until the user re-searches it — see {@link toRecipeFormValues}). A freeform line's explicit
 * `userCalories: 0` (e.g. water) correctly returns `0`, not `undefined` — the user stated it. Pure.
 *
 * @param line - The form's ingredient line.
 * @returns The line's calories, or `undefined` when it cannot be computed.
 */
export const lineCalories = (line: RecipeFormIngredient): number | undefined => {
    const { calories, isComplete } = computeRecipeNutrition([toNutritionLine(line)], 1);

    return isComplete ? calories : undefined;
};

/**
 * The running per-serving nutrition total for the form's CURRENT ingredient set (w3/e3, step 2's "Total
 * nutrition (per serving)" line, FR-007) — the SAME aggregator {@link lineCalories} uses, run over every
 * line at once at the form's current `servings`. A pure derivation of `values`, not local state: the caller
 * recomputes it on every render, so it stays exact across ingredient add/remove/quantity/unit changes and
 * servings edits, with no risk of a stale cached total. `isComplete` is `false` when any line could not be
 * accounted for; the UI MUST render the honest partial affordance in that case rather than a false-precise
 * number (never hide the exclusion behind a total that looks whole). Pure.
 *
 * @param values - The editor's current form values.
 * @returns The per-serving {@link RecipeNutrition} total.
 */
export const recipeNutritionTotal = (values: RecipeFormValues): RecipeNutrition =>
    computeRecipeNutrition(values.ingredients.map(toNutritionLine), values.servings);

/**
 * An empty create form: no ingredients/steps, public visibility (free-tier default), zeroed numerics.
 *
 * @returns A blank {@link RecipeFormValues}.
 */
export const defaultRecipeFormValues = (): RecipeFormValues => ({
    title: '',
    description: '',
    cuisine: '',
    tags: [],
    dietaryFlags: [],
    servings: 1,
    prepTimeMinutes: 0,
    cookTimeMinutes: 0,
    visibility: 'public',
    ingredients: [],
    steps: [],
});

/**
 * Map form values to the service's published `CreateRecipeRequest` body: computes total time, drops
 * unresolved ingredient lines (no `ingredientId`), omits empty optional strings, and carries a step timer
 * only when set. `status` (w3, draft/publish) is a SUBMISSION-time concern, not part of the form's own values
 * — it is threaded as a separate argument and OMITTED when not given, so the plain (non-wizard) save path
 * never touches publication state as a side effect. Pure. (Validate BEFORE submitting — this does not throw
 * on an incomplete form.)
 *
 * @param values - The editor's form values.
 * @param status - The publication status to persist (`draft`/`published`); omit to leave it untouched.
 * @returns The `POST /api/v1/recipes` body.
 */
export const toCreateRecipeInput = (values: RecipeFormValues, status?: RecipeStatus): CreateRecipeRequest => ({
    title: values.title.trim(),
    ...(values.description.trim() === '' ? {} : { description: values.description.trim() }),
    ...(values.cuisine.trim() === '' ? {} : { cuisine: values.cuisine.trim() }),
    // Difficulty is optional on create with NO clear sentinel: carry it only when stated, omit otherwise.
    ...(values.difficulty === undefined ? {} : { difficulty: values.difficulty }),
    ingredients: values.ingredients
        .filter((line): line is RecipeFormIngredient & { ingredientId: string } => line.ingredientId !== null)
        .map((line) => ({
            ingredientId: line.ingredientId,
            name: line.name,
            quantity: line.quantity,
            ...(line.unit === undefined || line.unit === '' ? {} : { unit: line.unit }),
            ...(line.notes === undefined || line.notes === '' ? {} : { notes: line.notes }),
        })),
    steps: values.steps.map((step) => ({
        instruction: step.instruction,
        ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
    })),
    servings: values.servings,
    prepTimeMinutes: values.prepTimeMinutes,
    cookTimeMinutes: values.cookTimeMinutes,
    totalTimeMinutes: computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes),
    dietaryFlags: [...values.dietaryFlags],
    tags: [...values.tags],
    visibility: values.visibility,
    ...(status === undefined ? {} : { status }),
});

/**
 * Map form values to the service's published `UpdateRecipeRequest` body, minus the `expectedVersion`
 * optimistic-concurrency token the caller adds. Identical to {@link toCreateRecipeInput} for every field
 * EXCEPT two, and both exceptions are the contract's, not this function's.
 *
 * `difficulty` is three-state on update (omit = unchanged, value = set, `null` = clear). The edit form is
 * seeded from the recipe's current difficulty, so the field's presence encodes the user's INTENT: a present
 * value means "set/keep this difficulty", and an ABSENT value means the user chose "not stated" and wants it
 * CLEARED. This maps absent → explicit `null` (not omit): omit would leave a previously set difficulty
 * unchanged, making "not stated" unreachable once set (FR-001b). Sending the current value again, or `null` on
 * an already-unstated recipe, is idempotent — consistent with the form's full-state replacement of every other
 * field on update.
 *
 * ⚠️ `visibility` IS DROPPED, and that is a fix rather than a restriction. `PATCH /api/v1/recipes/{id}` does
 * not accept it — `updateRecipeRequestSchema` omits the key, because visibility transitions go through
 * `PATCH /api/v1/recipes/{id}/visibility` where the C-004 policy evaluator decides whether the transition is
 * allowed at all. This function nevertheless SENT it for as long as it existed, inheriting it from the create
 * projection it spreads, and the service silently stripped it: a field the client believed it was setting and
 * the server discarded. Deleting it here means the body this produces is one the published contract describes.
 * Pure. (Validate BEFORE submitting.)
 *
 * @param values - The editor's form values.
 * @param status - The publication status to persist (`draft`/`published`); omit to leave it untouched.
 * @returns The `PATCH /api/v1/recipes/{id}` body, without `expectedVersion`.
 */
export const toUpdateRecipeInput = (
    values: RecipeFormValues,
    status?: RecipeStatus,
): Omit<UpdateRecipeRequest, 'expectedVersion'> => {
    // Destructured out, not `delete`d: the key must be ABSENT from the returned object, and a spread of the
    // create projection would otherwise reintroduce it past the type system's excess-property check.
    const { visibility: _visibility, ...rest } = toCreateRecipeInput(values, status);

    return {
        ...rest,
        // Present → set that value; absent → explicit null CLEAR (the crux: omit could never clear a set value).
        difficulty: values.difficulty ?? null,
    };
};

/**
 * Project a loaded {@link RecipeDetail} onto the editor's {@link RecipeFormValues} seed shape (T067, unified
 * B2 — the ONE seed adapter both platforms and the `useRecipeEditor` headless hook use; a web-local and a
 * mobile-local copy of this exact mapping existed before this change and have been collapsed into this
 * single, package-level export). Persisted ingredient lines already reference a catalog id, so each is
 * marked `RESOLVED` — a saved recipe's lines are, by definition, resolved, and marking them explicitly
 * (rather than leaving `resolutionStatus` absent) lets the form's "Resolved" badge render for them exactly
 * as it does for a freshly-resolved line, instead of showing no badge at all. Optional fields (`unit`,
 * `notes`, `timerSeconds`, `difficulty`) are OMITTED rather than set to `undefined`, so the result stays
 * valid under `exactOptionalPropertyTypes`. Pure.
 *
 * @param detail - The loaded recipe detail (from `useRecipe`).
 * @returns The seeded form values.
 */
export const toRecipeFormValues = (detail: RecipeDetail): RecipeFormValues => ({
    title: detail.title,
    description: detail.description,
    cuisine: detail.cuisine ?? '',
    // Seed the current difficulty so the edit form shows it; absence stays "not stated" (FR-001b).
    ...(detail.difficulty === undefined ? {} : { difficulty: detail.difficulty }),
    tags: [...detail.tags],
    dietaryFlags: [...detail.dietaryFlags],
    servings: detail.servings,
    prepTimeMinutes: detail.prepTimeMinutes,
    cookTimeMinutes: detail.cookTimeMinutes,
    visibility: detail.visibility,
    ingredients: detail.ingredients.map((line) => ({
        ingredientId: line.ingredientId,
        name: line.name,
        quantity: line.quantity,
        resolutionStatus: 'RESOLVED',
        ...(line.unit === undefined ? {} : { unit: line.unit }),
        ...(line.notes === undefined ? {} : { notes: line.notes }),
    })),
    steps: detail.steps.map((step) => ({
        instruction: step.instruction,
        ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
    })),
});

/**
 * The catalog ids of every ingredient line still resolving nutrition (`PENDING`) — de-duplicated, so a food
 * added twice is polled once. The composing create/edit container renders one status poller per id to drive
 * a `PENDING` line to `RESOLVED` (poll-after-add, data-model R5 / FR-007). A line with no catalog id (blank
 * or freeform-in-progress) is never polled. Pure.
 *
 * @param values - The editor's current form values.
 * @returns The unique catalog ids of the `PENDING` food-backed lines.
 */
export const pendingIngredientIds = (values: RecipeFormValues): string[] => {
    const ids = values.ingredients
        .filter(
            (line): line is RecipeFormIngredient & { ingredientId: string } =>
                line.ingredientId !== null && line.resolutionStatus === 'PENDING',
        )
        .map((line) => line.ingredientId);

    return [...new Set(ids)];
};

/**
 * Set the resolution status of EVERY ingredient line linked to `ingredientId` (a food can appear on more than
 * one line), but only where it actually differs. Returns the SAME `values` reference when nothing changes, so
 * a repeated poll callback reporting an unchanged status cannot trigger a render loop. Pure.
 *
 * @param values - The editor's current form values.
 * @param ingredientId - The catalog id of the line(s) whose status resolved.
 * @param status - The newly observed resolution status.
 * @returns The next values (or the identical reference when no line changed).
 */
export const setIngredientStatusById = (
    values: RecipeFormValues,
    ingredientId: string,
    status: FoodResolutionStatus,
): RecipeFormValues => {
    let changed = false;
    const ingredients = values.ingredients.map((line) => {
        if (line.ingredientId === ingredientId && line.resolutionStatus !== status) {
            changed = true;

            return { ...line, resolutionStatus: status };
        }

        return line;
    });

    return changed ? { ...values, ingredients } : values;
};

/**
 * A validation-error CODE (not user copy) — the discriminant a leaf resolves to localized text via
 * `recipeFormMessages.errors` (B20). Returning codes keeps `validateRecipeForm` pure and locale-free; the
 * form components own the copy, mirroring the rating model's discriminant pattern.
 */
export type RecipeFormErrorCode =
    | 'titleRequired'
    | 'ingredientsEmpty'
    | 'ingredientsUnresolved'
    | 'stepsRequired'
    | 'servingsPositive'
    | 'timesNonNegative';

/** Field-level validation errors (an error CODE per invalid field; absent when valid). */
export interface RecipeFormErrors {
    title?: RecipeFormErrorCode;
    ingredients?: RecipeFormErrorCode;
    steps?: RecipeFormErrorCode;
    servings?: RecipeFormErrorCode;
    times?: RecipeFormErrorCode;
}

// Field-level validators COMPOSED from `@kitchensink/recipe-core`'s bound Value Objects (parse-don't-validate,
// DA5) — the single authoritative source for the rules the form and the create contract genuinely SHARE, so
// the form can never hand-restate (and drift from) what the wire already encodes:
//   - `recipeTitleSchema`: a non-empty, ≤200-character title.
//   - `recipeIngredientQuantitySchema`: a quantity inside the 0.001 .. 1 000 000 window the column can store.
//   - `recipeStepInstructionSchema`: a non-empty step instruction.
//
// ⚠️ THESE ARE THE SAME OBJECTS THE SERVER VALIDATES WITH — not copies, and not the same rule written twice.
// Per the owner's ruling the recipe bounds live in `recipe-core`, and `recipe-service`'s
// `recipes.schema.ts` composes these very exports into `CreateRecipeRequest` (asserted by reference identity
// in that service's `recipes.schema.test.ts`). So the editor inherits a server-side bound change with no
// second edit here, in EITHER direction — which is the whole point of moving them, and is what makes the
// "stricter, never looser" invariant below checkable rather than aspirational.
//
// Importing them from `recipe-core` rather than reaching into `@kitchensink/schema-recipe`'s `.shape` is also
// what stops a wire-envelope reshape (renaming a field, making one optional) from silently breaking a
// field-level rule the form depends on: a named Value Object survives that, `shape.title` does not.
const titleSchema = recipeTitleSchema;
const quantitySchema = recipeIngredientQuantitySchema;
const instructionSchema = recipeStepInstructionSchema;

/**
 * Whether an ingredient line has been RESOLVED to a catalog row.
 *
 * ⚠️ Deliberately NOT `recipeIngredientInputSchema.shape.ingredientId`, even though the wire field is a
 * `z.uuid()` and composing it would look more DRY. The two are different questions, and merging them makes the
 * editor lie: the form's `ingredientsUnresolved` code means "you have not picked this ingredient yet", which is
 * the `null` sentinel (`RecipeFormIngredient.ingredientId: string | null`) — a malformed-but-present id is a
 * different failure that deserves different copy, and reporting it as "unresolved" would send the user back to
 * a picker that is already showing a selection. The FORMAT rule is the wire's, is enforced server-side, and is
 * unreachable from this surface anyway: every id here comes from the catalog API, which returns real UUIDs.
 *
 * @param ingredientId - The line's raw id, or `null` while unresolved.
 * @returns True when the line references a catalog row. Pure.
 */
const isResolvedIngredientId = (ingredientId: string | null): boolean =>
    ingredientId !== null && ingredientId.length > 0;

/**
 * Validate the form for submission: title present, ≥1 ingredient with EVERY line resolved to a catalog id
 * and a positive quantity, ≥1 step with a non-empty instruction, positive servings, non-negative times.
 * Pure and locale-free — returns error CODES (the leaf resolves copy). Empty object when submittable.
 *
 * COMPOSES the published `createRecipeRequestSchema`'s field bounds (DA5, parse-don't-validate) for the
 * rules it and the form
 * genuinely share — title, ingredient id/quantity, step instruction — via the field schemas above, each
 * `.safeParse`d against the (trimmed, for strings) form value and mapped to the SAME `RecipeFormErrorCode`s
 * this validator has always returned. Two kinds of rule stay hand-written rather than schema-derived:
 *   - `ingredientsEmpty` / the empty-`steps`-array half of `stepsRequired` state the same rule the wire now
 *     carries (`ingredients`/`steps` are `min(1)` on the request), kept as explicit comparisons so the form can
 *     attribute the failure to a FIELD and return its own error code rather than a parse failure of the whole
 *     body. Line-level resolution is {@link isResolvedIngredientId}, which is the form's own question.
 *   - `servingsPositive` / `timesNonNegative` are deliberately NOT parsed through the wire's
 *     `servings`/`prepTimeMinutes`/`cookTimeMinutes` fields, which additionally require an INTEGER
 *     (`positiveIntSchema`/`nonNegativeIntSchema`). The form has never enforced integer-ness (its numeric
 *     inputs parse via `parseNumericInput`, which accepts fractional text), so composing those fields would
 *     newly reject a fractional-but-positive value — a validation-behavior drift the DA5 acceptance bar
 *     (identical codes for every case) forbids. Only the genuinely shared "positive"/"non-negative" rule is
 *     kept, as an explicit comparison.
 *
 * @param values - The editor's form values.
 * @returns The {@link RecipeFormErrors} (empty object when the form is submittable).
 */
export const validateRecipeForm = (values: RecipeFormValues): RecipeFormErrors => {
    const errors: RecipeFormErrors = {};

    if (!titleSchema.safeParse(values.title.trim()).success) {
        errors.title = 'titleRequired';
    }

    if (values.ingredients.length === 0) {
        // Caught HERE so the user gets a field-level message instead of a 400: `createRecipeRequestSchema`
        // also rejects an empty `ingredients` array (`.min(1)`), so this is the same rule stated where it can
        // be shown, not a form-only extra. (It said "the wire schema allows an empty array" until the
        // published contract gained the bound; keeping that claim would have invited deleting the check.)
        errors.ingredients = 'ingredientsEmpty';
    } else if (
        values.ingredients.some(
            (line) => !isResolvedIngredientId(line.ingredientId) || !quantitySchema.safeParse(line.quantity).success,
        )
    ) {
        errors.ingredients = 'ingredientsUnresolved';
    }

    if (
        // Same as `ingredients` above: `createRecipeRequestSchema.steps` carries `.min(1)`, so this surfaces
        // the contract's own bound as a field message rather than adding a form-only rule.
        values.steps.length === 0 ||
        values.steps.some((step) => !instructionSchema.safeParse(step.instruction.trim()).success)
    ) {
        errors.steps = 'stepsRequired';
    }

    if (values.servings <= 0) {
        errors.servings = 'servingsPositive';
    }

    if (values.prepTimeMinutes < 0 || values.cookTimeMinutes < 0) {
        errors.times = 'timesNonNegative';
    }

    return errors;
};

/**
 * The 4-step recipe-edit wizard (w3): `1` Basic Info, `2` Ingredients, `3` Instructions, `4` Photos. This is
 * orthogonal, presentational-navigation state — it is NOT a variant of the edit lifecycle's `EditorState`
 * (`useRecipeEditor.ts`'s `loading/editing/submitting/conflict/saved` statechart); a step change never
 * affects that machine (no reseed, no `saved`-latch reset).
 */
export type RecipeWizardStep = 1 | 2 | 3 | 4;

/**
 * The field->step map (w3): which {@link RecipeFormErrors} keys belong to which wizard step. Step 4
 * (photos) has NO validation-error key at all — photo upload is decoupled from form validation (the
 * wireframe: "Metadata saves immediately; photos upload independently") — so it maps to an empty field list
 * and is therefore always advanceable. This is the ONE place the field<->step association is stated; both
 * {@link stepErrorsFor} and {@link canAdvanceFromStep} read it rather than re-deriving it.
 */
const STEP_ERROR_FIELDS: Readonly<Record<RecipeWizardStep, readonly (keyof RecipeFormErrors)[]>> = {
    1: ['title', 'servings', 'times'],
    2: ['ingredients'],
    3: ['steps'],
    4: [],
};

/**
 * The subset of {@link validateRecipeForm}'s errors that belong to `step` — filters the ONE validator's
 * output by the field->step map ({@link STEP_ERROR_FIELDS}) rather than forking a step-scoped validator.
 * Pure.
 *
 * @param values - The editor's form values.
 * @param step - The wizard step whose errors to isolate.
 * @returns The {@link RecipeFormErrors} subset belonging to `step` (empty when that step is valid).
 */
export const stepErrorsFor = (values: RecipeFormValues, step: RecipeWizardStep): RecipeFormErrors => {
    const allErrors = validateRecipeForm(values);
    const errors: RecipeFormErrors = {};

    for (const field of STEP_ERROR_FIELDS[step]) {
        const code = allErrors[field];

        if (code !== undefined) {
            errors[field] = code;
        }
    }

    return errors;
};

/**
 * Whether `step` is valid enough to advance past (the wizard's `[Next: …]` gate) — `true` exactly when
 * {@link stepErrorsFor} returns no errors for that step. Pure.
 *
 * @param values - The editor's form values.
 * @param step - The wizard step to check.
 * @returns Whether the step has no validation errors.
 */
export const canAdvanceFromStep = (values: RecipeFormValues, step: RecipeWizardStep): boolean =>
    Object.keys(stepErrorsFor(values, step)).length === 0;
