'use client';

/**
 * @module @commise/features-recipes/nutrition — one card's calorie slot, read out of its page's batch (both platforms;
 * the orchestration layer).
 *
 * What a card grid holds is ONE batch reading per page (`POST /api/v1/recipes/nutrition-batch`), not one per card.
 * This component is the seam between the two: it takes the page's reading and this card's recipe id and SELECTS which
 * render component stands in the card, one of four outcomes — the skeleton while the batch is pending, this recipe's
 * chip once it has settled, nothing at all when the settled response OMITTED this recipe (owner ruling 2026-08-16: "not for you", never
 * `food_unavailable`), and the terminal `unaccounted{food_unavailable}` answer when the batch failed.
 *
 * ⛔ IT NEVER SUSPENDS (ADR-0079). The reading is a VALUE, so the choice is an exhaustive switch rather than React's
 * unwinding. A suspending slot held every deferred update on its screen — "See all", a sort, a collection switch —
 * behind the calorie lookup, because a committed fallback's retry lane runs ahead of a pinged transition.
 * `repoGuards`' `nutritionNeverSuspends` refuses `use(`, `Suspense` and `useSuspense*` under this folder.
 *
 * Platform-agnostic: the chip and the skeleton are the platform pair (`.native.tsx` leaves), so this one component
 * serves both apps.
 *
 * @pattern Visitor — exhaustive switch over the batch reading's discriminated union, then a selector over the settled
 *     response
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeNutritionMessages } from './messages.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.js';
import { RecipeCalorieSkeleton } from './RecipeCalorieSkeleton.js';
import { NUTRITION_FOOD_UNAVAILABLE, selectRecipeCalorieState, type RecipeNutritionBatchReading } from './model.js';

/** Props for {@link RecipeNutritionSlot}. */
export interface RecipeNutritionSlotProps {
    /** Where the page's batch lookup stands — `useRecipeNutritionBatches`' answer for this recipe. */
    readonly reading: RecipeNutritionBatchReading;
    /** The recipe whose figure this slot renders. */
    readonly recipeId: string;
}

/**
 * One card's deferred calorie figure, read out of the page's batch: its skeleton while the batch is pending, its chip
 * once the batch has settled, and nothing at all when the batch failed or omitted this recipe.
 *
 * @param props - The page's batch reading and the recipe this slot speaks for.
 * @returns Exactly one of the four outcomes.
 */
export const RecipeNutritionSlot: FC<RecipeNutritionSlotProps> = ({ reading, recipeId }) => {
    const { loadingLabel } = useMessages(recipeNutritionMessages);

    switch (reading.status) {
        case 'pending':
            return <RecipeCalorieSkeleton label={loadingLabel} />;

        case 'failed':
            return <RecipeCalorieChip nutrition={NUTRITION_FOOD_UNAVAILABLE} />;

        case 'settled': {
            // `selectRecipeCalorieState`, never a bare `response.nutrition[recipeId]`: this repo does not enable
            // `noUncheckedIndexedAccess`, so the index types as a state that is not there — see the selector's doc.
            const nutrition = selectRecipeCalorieState(reading.response, recipeId);

            return nutrition === null ? null : <RecipeCalorieChip nutrition={nutrition} />;
        }
    }
};
