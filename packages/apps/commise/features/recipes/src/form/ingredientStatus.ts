/**
 * @module @commise/features-recipes/form — an ingredient line's FOOD-RESOLUTION bookkeeping — which lines to poll, and writing a
 * result back.
 *
 * ⚠️ `settleIngredientLine` returns the SAME `values` reference when nothing changes. That is a contract,
 * not a micro-optimisation: a repeated poll reporting an unchanged status must not trigger a render loop.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { IngredientLineKey } from './lineKey.js';
import type { FoodNutritionRef } from './nutritionLookup.js';
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

/** What one status poll observed: the binding the server answered with, and its status. */
export interface ObservedIngredientStatus {
    /**
     * The binding the line should now point at. Equal to the polled id, except when the poll SETTLED a failure the
     * food service has since resolved: the server moved every line on it to the bound binding (plan 002), and the
     * form must follow or its next save would point the line back.
     */
    readonly id: string;
    readonly status: FoodResolutionStatus;
    /**
     * The food the answered binding names (a root binding's `foodId`), absent when it names none. Every catalog figure
     * is read through the line's `foodRef` (plan 002 V1 B5), so a line resolved here must take it on.
     */
    readonly foodId?: string;
}

/**
 * The food ref a line should carry after this answer: the root the answer names; none when the line moved to a
 * binding that names none; otherwise the ref it has. Pure.
 */
const settledFoodRef = (
    line: RecipeFormIngredient,
    observed: ObservedIngredientStatus,
): FoodNutritionRef | undefined => {
    if (observed.foodId !== undefined) {
        return { kind: 'root', id: observed.foodId };
    }

    return line.ingredientId === observed.id ? line.foodRef : undefined;
};

/** Whether two optional food refs name the same food (a root and a variant may share an id). Pure. */
const sameFoodRef = (a: FoodNutritionRef | undefined, b: FoodNutritionRef | undefined): boolean =>
    a?.kind === b?.kind && a?.id === b?.id;

/** The line with this food ref, the key dropped rather than set to `undefined` when there is none. Pure. */
const withFoodRef = (line: RecipeFormIngredient, foodRef: FoodNutritionRef | undefined): RecipeFormIngredient => {
    const { foodRef: _previous, ...rest } = line;

    return foodRef === undefined ? rest : { ...rest, foodRef };
};

/**
 * Apply one poll's answer to EVERY line on the polled binding (a food can appear on more than one line): adopt the
 * binding the server answered with, its status and the food it names, only where any of them differs. Returns the
 * SAME `values` reference when nothing changes, so a repeated poll callback cannot trigger a render loop. Pure.
 *
 * @param values - The editor's current form values.
 * @param polledId - The binding the poll asked about.
 * @param observed - What the poll answered.
 * @returns The next values (or the identical reference when no line changed).
 */
export const settleIngredientLine = (
    values: RecipeFormValues,
    polledId: string,
    observed: ObservedIngredientStatus,
): RecipeFormValues => {
    let changed = false;
    const ingredients = values.ingredients.map((line) => {
        if (line.ingredientId !== polledId) {
            return line;
        }

        const foodRef = settledFoodRef(line, observed);

        if (
            line.ingredientId === observed.id &&
            line.resolutionStatus === observed.status &&
            sameFoodRef(line.foodRef, foodRef)
        ) {
            return line;
        }

        changed = true;

        return { ...withFoodRef(line, foodRef), ingredientId: observed.id, resolutionStatus: observed.status };
    });

    return changed ? { ...values, ingredients } : values;
};

/** One binding's answer, as a host applies it. */
export interface SettledAnswer {
    readonly polledId: string;
    readonly observed: ObservedIngredientStatus;
}

/**
 * Apply several answers as ONE draft transition. Returns the SAME `values` reference when no answer changes
 * anything, like {@link settleIngredientLine}.
 *
 * ⛔ One transition, not one call per answer: a host whose setter takes a value (not an updater) builds every write
 * from the same snapshot, so per-answer writes let the last one win and lose the rest (staff-architect REVIEW F1).
 * Pure.
 *
 * @param values - The editor's current form values.
 * @param answers - The answers to apply, in any order.
 * @returns The next values (or the identical reference when no line changed).
 */
export const settleIngredientLines = (values: RecipeFormValues, answers: readonly SettledAnswer[]): RecipeFormValues =>
    answers.reduce((current, answer) => settleIngredientLine(current, answer.polledId, answer.observed), values);

/**
 * What a host hands the ingredients leaf for a FAILED row's Try again (plan 002 V1): the command, and which bindings
 * have an ask in flight. Implemented by `useLookupRetry` (`../hooks/useLookupRetry.ts`).
 */
export interface LookupRetry {
    /**
     * Ask again for this binding, from the row with this key. Ignored while an ask for the binding is in flight.
     *
     * The ROW is named because the answer may move the line to another binding (a settled failure answers with the
     * bound binding's id), and the announcement must still find it; a settle never changes a line's key.
     */
    readonly retry: (ingredientId: string, lineKey: IngredientLineKey) => void;
    /** The bindings with an ask in flight (the row's glyph reads busy). */
    readonly retrying: ReadonlySet<string>;
    /**
     * The latest answer to a retry the cook started, for the polite announcement; `undefined` before any, and again
     * while a new ask runs — the region empties between two asks, so the same outcome twice is announced twice.
     */
    readonly settled: { readonly lineKey: IngredientLineKey; readonly status: FoodResolutionStatus } | undefined;
}
