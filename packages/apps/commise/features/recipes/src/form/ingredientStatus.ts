/**
 * @module @commise/features-recipes/form — an ingredient line's FOOD-RESOLUTION bookkeeping — which lines to poll, and writing a
 * result back.
 *
 * ⚠️ `setIngredientStatusById` returns the SAME `values` reference when nothing changes. That is a contract,
 * not a micro-optimisation: a repeated poll reporting an unchanged status must not trigger a render loop.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { type RecipeFormIngredient, type RecipeFormValues } from './values.js';

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
