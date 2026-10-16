/**
 * @module @commise/features-recipes/widget — the Home widget's deferred calorie lookup (ADR-0021 §6).
 */
import { useMemo } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';

import { MAX_RECENT_RECIPES } from '../components/props.js';
import { useRecipeNutritionBatches } from '../hooks/useRecipeNutritionBatches.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import { nutritionSlotRenderer } from '../nutrition/nutritionSlotRenderer.js';

/**
 * Start the deferred calorie batch for the recent recipes the widget is about to paint, and hand back the render prop
 * that mounts one `RecipeNutritionSlot` per card. One request covers every card.
 *
 * It asks about the first {@link MAX_RECENT_RECIPES} only: the widget paints no more, so an answer for a wider page is
 * invisible on screen and costs an endpoint priced by its id count.
 *
 * The caller owns the read of `recipes` (web resolves a promise, mobile a suspense query); this starts where the
 * recipes are known. `null` from the lookup means no batch covers the recipe (never asked), which renders nothing:
 * never a boundary with no promise to settle.
 *
 * @param recipes - The recent recipes the page returned, in render order.
 * @returns The widget's `renderNutrition` prop.
 * @sideEffect Starts (or joins) the nutrition request and seeds the query cache during render, as
 *   `useRecipeNutritionBatches` does.
 */
export function useRecentRecipesNutrition(recipes: readonly Recipe[]): RenderRecipeNutrition {
    const nutritionFor = useRecipeNutritionBatches([recipes.slice(0, MAX_RECENT_RECIPES).map((recipe) => recipe.id)]);

    return useMemo(() => nutritionSlotRenderer(nutritionFor), [nutritionFor]);
}
