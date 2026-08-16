'use client';

/**
 * @module @commise/features-recipes/nutrition — web per-card nutrition slot (the orchestration layer).
 *
 * **Pattern: Suspense boundary + selector.** What a card grid actually holds is ONE batch promise for the
 * whole page (`POST /api/v1/recipes/nutrition-batch`), not one promise per card. This component is the seam
 * between the two: N of these over ONE promise are ONE read, because `use()` memoizes on promise identity —
 * they suspend together, settle together, and cost a single request. Handing each card its own promise would
 * pass every per-card test and issue N requests.
 *
 * ⛔ WHY THIS IS NOT A PROP ON {@link RecipeNutritionBoundary}. Selecting one recipe out of the batch has a
 * FOURTH outcome the per-recipe boundary deliberately cannot express: the recipe the response OMITTED.
 * `selectRecipeCalorieState` returns `null` for it, `null` is not assignable to that component's promise, and
 * the owner ruling (2026-08-16) is that such a card renders the skeleton while the lookup is in flight and
 * then renders NOTHING — never `unaccounted{food_unavailable}`, because food was fine and the viewer simply
 * may not read that recipe. The decision needs the settled response, so it happens INSIDE the suspending
 * content, here; a boolean/mode prop switching that behaviour on the other component is exactly the
 * orchestration-layer decision this codebase keeps out of render components.
 *
 * The boundary NESTING (ErrorBoundary → Suspense, and why `resetKeys` is load-bearing) is stated once, in
 * {@link NutritionBoundaryShell}, and shared with `RecipeNutritionBoundary` so the two cannot drift.
 */
import { use, type FC } from 'react';

import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { NutritionBoundaryShell } from './NutritionBoundaryShell.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.js';
import { selectRecipeCalorieState } from './model.js';

/** Props for {@link RecipeNutritionSlot}. */
export interface RecipeNutritionSlotProps {
    /**
     * The page's deferred nutrition batch, as a promise the HOST starts and does NOT await — created in the
     * server component (React streams a pending promise across the RSC boundary) or memoized in the client
     * container for a surface with no server pass.
     *
     * ⚠️ HOST CONTRACT: this promise's IDENTITY is the retry signal (see {@link NutritionBoundaryShell}), and
     * it MUST be stable across re-renders. A promise rebuilt every render re-suspends every card on every
     * render — a grid of skeletons that never settles.
     */
    readonly nutritionBatchPromise: Promise<RecipeNutritionResponse>;
    /** The recipe whose figure this slot renders. */
    readonly recipeId: string;
}

/**
 * Suspends on the shared batch, SELECTS this recipe's answer out of it, and renders it — or nothing at all
 * when the batch omitted this recipe.
 */
const RecipeNutritionSlotContent: FC<RecipeNutritionSlotProps> = ({ nutritionBatchPromise, recipeId }) => {
    // `selectRecipeCalorieState`, never a bare `response.nutrition[recipeId]`: this repo does not enable
    // `noUncheckedIndexedAccess`, so the index types as a state that is not there — see the selector's doc
    // for the three ways that goes wrong without a compile error.
    const nutrition = selectRecipeCalorieState(use(nutritionBatchPromise), recipeId);

    return nutrition === null ? null : <RecipeCalorieChip nutrition={nutrition} />;
};

/**
 * One card's deferred calorie figure, read out of the page's shared nutrition batch: its skeleton while the
 * batch is in flight, its chip once the batch settles, and nothing at all when the batch failed or omitted
 * this recipe.
 *
 * @param props - The shared batch promise and the recipe this slot speaks for.
 * @returns The boundary rendering exactly one of the four outcomes.
 */
export const RecipeNutritionSlot: FC<RecipeNutritionSlotProps> = ({ nutritionBatchPromise, recipeId }) => (
    <NutritionBoundaryShell resetKey={nutritionBatchPromise}>
        <RecipeNutritionSlotContent nutritionBatchPromise={nutritionBatchPromise} recipeId={recipeId} />
    </NutritionBoundaryShell>
);
