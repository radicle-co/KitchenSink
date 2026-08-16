/**
 * @module @commise/features-recipes/nutrition — native per-card nutrition slot (the orchestration layer).
 *
 * Same contract and same reasoning as the web leaf (see `RecipeNutritionSlot.tsx`): N slots over ONE batch
 * promise are ONE read, and the OMITTED recipe — the fourth outcome `RecipeNutritionBoundary` deliberately
 * cannot express — renders nothing once the batch settles. The two files differ ONLY in which platform
 * leaves they compose.
 *
 * `use(promise)` + `<Suspense>` are client-side React 19 and behave identically under React Native (the same
 * correction `RecipeNutritionBoundary.native.tsx` records), so this leaf is promise-driven exactly like the
 * web one — do NOT "restore parity" by giving it a prop-driven `isLoading`.
 */
import { use, type FC } from 'react';

import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { NutritionBoundaryShell } from './NutritionBoundaryShell.native.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.native.js';
import { selectRecipeCalorieState } from './model.js';

/** Props for the native {@link RecipeNutritionSlot}. */
export interface RecipeNutritionSlotProps {
    /**
     * The screen's deferred nutrition batch, as a promise the HOST starts and does NOT await. Its IDENTITY is
     * the retry signal and MUST be stable across re-renders — a promise rebuilt every render re-suspends
     * every card on every render.
     */
    readonly nutritionBatchPromise: Promise<RecipeNutritionResponse>;
    /** The recipe whose figure this slot renders. */
    readonly recipeId: string;
}

/** Suspends on the shared batch, selects this recipe's answer, and renders it — or nothing when omitted. */
const RecipeNutritionSlotContent: FC<RecipeNutritionSlotProps> = ({ nutritionBatchPromise, recipeId }) => {
    const nutrition = selectRecipeCalorieState(use(nutritionBatchPromise), recipeId);

    return nutrition === null ? null : <RecipeCalorieChip nutrition={nutrition} />;
};

/**
 * One card's deferred calorie figure, read out of the screen's shared nutrition batch (native).
 *
 * @param props - The shared batch promise and the recipe this slot speaks for.
 * @returns The boundary rendering exactly one of the four outcomes.
 */
export const RecipeNutritionSlot: FC<RecipeNutritionSlotProps> = ({ nutritionBatchPromise, recipeId }) => (
    <NutritionBoundaryShell resetKey={nutritionBatchPromise}>
        <RecipeNutritionSlotContent nutritionBatchPromise={nutritionBatchPromise} recipeId={recipeId} />
    </NutritionBoundaryShell>
);
