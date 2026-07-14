/**
 * @module @commise/features-recipes — recipe create/edit form model (T067).
 *
 * Pure, platform-agnostic state + helpers for the recipe editor, shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) form leaves and by the app container. Holds the editable form shape, the auto total-time
 * rule, the mapping to the `CreateRecipeInput` wire contract, and validation. No React, no platform APIs.
 */
import type { CreateRecipeInput, FoodResolutionStatus, RecipeVisibility } from '@kitchensink/recipe-core';

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
