'use client';

/**
 * @module @commise/features-recipes — cooking-progress React binding (W2 Task 2.4, D4/D5).
 *
 * Headless hook binding the recipe-detail orchestration layer to the session-scoped
 * {@link import('./cookingProgress.js') cooking-progress store} via `useSyncExternalStore`. It exposes the
 * checked ingredient/step sets plus stable toggle callbacks; the presentational detail view stays a pure
 * `props → JSX` render, receiving the sets + callbacks as props (the interaction/state lives here, per the
 * container/presentational split). Shared by both platform containers — the store and this hook are pure
 * React/TS with no platform coupling.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { getProgress, subscribe, toggleIngredient, toggleStep } from './cookingProgress.js';

/** What {@link useCookingProgress} returns to a detail container. */
export interface CookingProgressBinding {
    /** Ids of ingredients the cook has checked off. */
    readonly checkedIngredients: ReadonlySet<string>;
    /** 1-based step numbers the cook has marked done. */
    readonly checkedSteps: ReadonlySet<number>;
    /** Toggle an ingredient's gathered state. */
    readonly toggleIngredient: (ingredientId: string) => void;
    /** Toggle a step's completed state. */
    readonly toggleStep: (stepNumber: number) => void;
}

/**
 * Subscribe to a recipe's session cooking progress.
 *
 * @param recipeId - The recipe whose progress to track.
 * @returns The checked sets and toggle callbacks for {@link recipeId}.
 */
export function useCookingProgress(recipeId: string): CookingProgressBinding {
    const progress = useSyncExternalStore(
        subscribe,
        () => getProgress(recipeId),
        () => getProgress(recipeId),
    );

    return {
        checkedIngredients: progress.ingredients,
        checkedSteps: progress.steps,
        toggleIngredient: useCallback((ingredientId: string) => toggleIngredient(recipeId, ingredientId), [recipeId]),
        toggleStep: useCallback((stepNumber: number) => toggleStep(recipeId, stepNumber), [recipeId]),
    };
}
