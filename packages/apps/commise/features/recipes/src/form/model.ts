/**
 * @module @commise/features-recipes — recipe create/edit form model (T067).
 *
 * Pure, platform-agnostic state + helpers for the recipe editor, shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) form leaves and by the app container. Holds the editable form shape, the auto total-time
 * rule, the mapping to the `CreateRecipeInput` wire contract, and validation. No React, no platform APIs.
 */
import { computeRecipeNutrition, toNutritionLine as buildNutritionLine } from '@kitchensink/recipe-core';
import type {
    CreateRecipeInput,
    FoodResolutionStatus,
    IngredientPortion,
    LineCatalogNutrition,
    LineMeasure,
    NutritionLine,
    RecipeDetail,
    RecipeDifficulty,
    RecipeIngredientView,
    RecipeNutrition,
    RecipeStatus,
    RecipeStepView,
    RecipeVisibility,
    UpdateRecipeInput,
} from '@kitchensink/recipe-core';

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

/** Maximum title length (w3/e6) — enforced client-side via `maxLength` and surfaced by a live "N/64" counter. */
export const TITLE_MAX_LENGTH = 64;

/**
 * Maximum description length (w3/e6) — enforced client-side via `maxLength` and surfaced by a live "N/256"
 * counter.
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
 * (`computeRecipeNutrition`/`leadCaloriesPerServing`) consumes (w3/e3 plumbing, feeding step 2's per-row +
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
 * Map form values to the `CreateRecipeInput` wire contract: computes total time, drops unresolved
 * ingredient lines (no `ingredientId`), omits empty optional strings, and carries a step timer only when
 * set. `status` (w3, draft/publish) is a SUBMISSION-time concern, not part of the form's own values — it is
 * threaded as a separate argument and OMITTED when not given, so the plain (non-wizard) save path never
 * touches publication state as a side effect. Pure. (Validate BEFORE submitting — this does not throw on an
 * incomplete form.)
 *
 * @param values - The editor's form values.
 * @param status - The publication status to persist (`draft`/`published`); omit to leave it untouched.
 * @returns The `CreateRecipeInput` payload.
 */
export const toCreateRecipeInput = (values: RecipeFormValues, status?: RecipeStatus): CreateRecipeInput => ({
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
 * Map form values to the body of an `UpdateRecipeInput` (the caller adds the `expectedVersion` optimistic-
 * concurrency token). Identical to {@link toCreateRecipeInput} for every field EXCEPT `difficulty`, which is
 * three-state on update (omit = unchanged, value = set, `null` = clear).
 *
 * The edit form is seeded from the recipe's current difficulty, so the field's presence encodes the user's
 * INTENT: a present value means "set/keep this difficulty", and an ABSENT value means the user chose "not
 * stated" and wants it CLEARED. This maps absent → explicit `null` (not omit): omit would leave a previously
 * set difficulty unchanged, making "not stated" unreachable once set (FR-001b). Sending the current value
 * again, or `null` on an already-unstated recipe, is idempotent — consistent with the form's full-state
 * replacement of every other field on update. Pure. (Validate BEFORE submitting.)
 *
 * @param values - The editor's form values.
 * @param status - The publication status to persist (`draft`/`published`); omit to leave it untouched.
 * @returns The `UpdateRecipeInput` body, without `expectedVersion`.
 */
export const toUpdateRecipeInput = (
    values: RecipeFormValues,
    status?: RecipeStatus,
): Omit<UpdateRecipeInput, 'expectedVersion'> => ({
    ...toCreateRecipeInput(values, status),
    // Present → set that value; absent → explicit null CLEAR (the crux: omit could never clear a set value).
    difficulty: values.difficulty ?? null,
});

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
 * Project the in-progress draft onto a base {@link RecipeDetail} so the concurrent-edit conflict view (T070)
 * can show "mine" (the edit the user was about to save) beside "theirs" (the latest saved recipe). The
 * conflict view renders only aggregate fields — title, servings, prep/cook/total times, and ingredient/step
 * counts — so this overlays exactly those from the draft and keeps every other base field (id, ownerId,
 * timestamps, photos, nutrition) untouched. Ingredient/step lines are mapped to the light view row types and
 * unresolved ingredient lines are dropped, so the counts match what {@link toCreateRecipeInput} will persist.
 * Pure.
 *
 * @param base - The recipe as last loaded (source of the fields the draft does not edit).
 * @param values - The editor's current draft values.
 * @returns A {@link RecipeDetail} whose editable fields reflect the draft.
 */
export const applyDraftToRecipeDetail = (base: RecipeDetail, values: RecipeFormValues): RecipeDetail => {
    // Drop the base difficulty so a draft that CLEARED it ("not stated") is reflected as absent, not the
    // stale server value; the draft's difficulty (when stated) is re-added below.
    const { difficulty: _baseDifficulty, ...rest } = base;

    return {
        ...rest,
        ...(values.difficulty === undefined ? {} : { difficulty: values.difficulty }),
        title: values.title.trim(),
        servings: values.servings,
        prepTimeMinutes: values.prepTimeMinutes,
        cookTimeMinutes: values.cookTimeMinutes,
        totalTimeMinutes: computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes),
        ingredients: values.ingredients
            .filter((line): line is RecipeFormIngredient & { ingredientId: string } => line.ingredientId !== null)
            .map(
                (line): RecipeIngredientView => ({
                    ingredientId: line.ingredientId,
                    name: line.name,
                    quantity: line.quantity,
                    ...(line.unit === undefined || line.unit === '' ? {} : { unit: line.unit }),
                    ...(line.notes === undefined || line.notes === '' ? {} : { notes: line.notes }),
                    // Provenance is not surfaced by the conflict view (counts only); default rather than guess.
                    isUserEntered: false,
                }),
            ),
        steps: values.steps.map(
            (step, index): RecipeStepView => ({
                stepNumber: index + 1,
                instruction: step.instruction,
                ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
            }),
        ),
    };
};

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

/**
 * Validate the form for submission: title present, ≥1 ingredient with EVERY line resolved to a catalog id
 * and a positive quantity, ≥1 step with a non-empty instruction, positive servings, non-negative times.
 * Pure and locale-free — returns error CODES (the leaf resolves copy). Empty object when submittable.
 *
 * @param values - The editor's form values.
 * @returns The {@link RecipeFormErrors} (empty object when the form is submittable).
 */
export const validateRecipeForm = (values: RecipeFormValues): RecipeFormErrors => {
    const errors: RecipeFormErrors = {};

    if (values.title.trim() === '') {
        errors.title = 'titleRequired';
    }

    if (values.ingredients.length === 0) {
        errors.ingredients = 'ingredientsEmpty';
    } else if (values.ingredients.some((line) => line.ingredientId === null || line.quantity <= 0)) {
        errors.ingredients = 'ingredientsUnresolved';
    }

    if (values.steps.length === 0 || values.steps.some((step) => step.instruction.trim() === '')) {
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
