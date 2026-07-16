/**
 * @module @commise/features-recipes — recipe create/edit form model (T067).
 *
 * Pure, platform-agnostic state + helpers for the recipe editor, shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) form leaves and by the app container. Holds the editable form shape, the auto total-time
 * rule, the mapping to the `CreateRecipeInput` wire contract, and validation. No React, no platform APIs.
 */
import type {
    CreateRecipeInput,
    FoodResolutionStatus,
    RecipeDetail,
    RecipeDifficulty,
    RecipeIngredientView,
    RecipeStepView,
    RecipeVisibility,
    UpdateRecipeInput,
} from '@kitchensink/recipe-core';

/**
 * One editable ingredient line. `ingredientId` is `null` until the line resolves to a catalog row (via
 * food-service typeahead or a freeform create) — the wire contract REQUIRES an id, so an unresolved line
 * cannot be submitted (validation flags it). `resolutionStatus` drives the row's async nutrition badge.
 */
export interface RecipeFormIngredient {
    readonly ingredientId: string | null;
    readonly name: string;
    readonly quantity: number;
    readonly unit?: string;
    readonly notes?: string;
    readonly resolutionStatus?: FoodResolutionStatus;
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
 * Total time = prep + cook (FR-001 auto-computed; the editor shows it read-only). Pure.
 *
 * @param prepTimeMinutes - Prep minutes.
 * @param cookTimeMinutes - Cook minutes.
 * @returns The summed total minutes.
 */
export const computeTotalTime = (prepTimeMinutes: number, cookTimeMinutes: number): number =>
    prepTimeMinutes + cookTimeMinutes;

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
 * set. Pure. (Validate BEFORE submitting — this does not throw on an incomplete form.)
 *
 * @param values - The editor's form values.
 * @returns The `CreateRecipeInput` payload.
 */
export const toCreateRecipeInput = (values: RecipeFormValues): CreateRecipeInput => ({
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
 * @returns The `UpdateRecipeInput` body, without `expectedVersion`.
 */
export const toUpdateRecipeInput = (values: RecipeFormValues): Omit<UpdateRecipeInput, 'expectedVersion'> => ({
    ...toCreateRecipeInput(values),
    // Present → set that value; absent → explicit null CLEAR (the crux: omit could never clear a set value).
    difficulty: values.difficulty ?? null,
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

/** Field-level validation errors (a message per invalid field; absent when valid). */
export interface RecipeFormErrors {
    title?: string;
    ingredients?: string;
    steps?: string;
    servings?: string;
    times?: string;
}

/**
 * Validate the form for submission: title present, ≥1 ingredient with EVERY line resolved to a catalog id
 * and a positive quantity, ≥1 step with a non-empty instruction, positive servings, non-negative times.
 * Pure — returns an errors object (empty when valid).
 *
 * @param values - The editor's form values.
 * @returns The {@link RecipeFormErrors} (empty object when the form is submittable).
 */
export const validateRecipeForm = (values: RecipeFormValues): RecipeFormErrors => {
    const errors: RecipeFormErrors = {};

    if (values.title.trim() === '') {
        errors.title = 'A title is required.';
    }

    if (values.ingredients.length === 0) {
        errors.ingredients = 'Add at least one ingredient.';
    } else if (values.ingredients.some((line) => line.ingredientId === null || line.quantity <= 0)) {
        errors.ingredients = 'Every ingredient needs a resolved item and a quantity greater than zero.';
    }

    if (values.steps.length === 0 || values.steps.some((step) => step.instruction.trim() === '')) {
        errors.steps = 'Add at least one instruction step.';
    }

    if (values.servings <= 0) {
        errors.servings = 'Servings must be greater than zero.';
    }

    if (values.prepTimeMinutes < 0 || values.cookTimeMinutes < 0) {
        errors.times = 'Times cannot be negative.';
    }

    return errors;
};
