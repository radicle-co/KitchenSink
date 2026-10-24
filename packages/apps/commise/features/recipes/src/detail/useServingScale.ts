'use client';

/**
 * @module @commise/features-recipes — serving-scale React binding.
 *
 * Headless hook binding the recipe-detail render to the session-scoped serving-scale store
 * (`./servingScale.ts`) via `useSyncExternalStore` — the same shape as `useCookingProgress`. It exposes the
 * chosen serving count plus a stable setter; the presentational body stays a pure `props → JSX` render,
 * receiving the count and the callback as props.
 *
 * It is consumed by `RecipeDetailView`'s own orchestration shell rather than by the two app containers, so
 * neither platform can ship the detail screen with the scale un-wired.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { getServings, setServings, subscribe } from './servingScale.js';

/** What {@link useServingScale} returns to the detail shell. */
export interface ServingScaleBinding {
    /** The serving count to render at — the recipe's own until the cook chooses another. */
    readonly servings: number;
    /** Choose a serving count (clamped by the store to the recipe's supported range). */
    readonly setServings: (servings: number) => void;
}

/**
 * Subscribe to a recipe's session serving scale.
 *
 * @param recipeId - The recipe whose scale to track.
 * @param baseServings - The recipe's authored serving count — the default, per the product requirement.
 * @returns The chosen serving count and its setter.
 */
export function useServingScale(recipeId: string, baseServings: number): ServingScaleBinding {
    const servings = useSyncExternalStore(
        subscribe,
        () => getServings(recipeId, baseServings),
        () => getServings(recipeId, baseServings),
    );

    return {
        servings,
        setServings: useCallback((next: number) => setServings(recipeId, baseServings, next), [recipeId, baseServings]),
    };
}
