/**
 * @module @commise/features-recipes/nutrition — native nutrition boundary (the RN leaf).
 *
 * Same contract, same nesting, same invariant as the web leaf (see `RecipeNutritionBoundary.tsx`):
 * **ErrorBoundary → Suspense → content**, neither branch is terminal, and `resetKeys` is what makes the
 * error branch recoverable.
 *
 * ⚠️ CORRECTS A PREMISE STATED ELSEWHERE IN THIS FEATURE. `RecipeHomeWidget.tsx` says "React Native has no
 * Suspense-for-data streaming", and its native leaf therefore takes a prop-driven `isLoading` while the web
 * leaf takes a promise. That claim is true of SERVER streaming — there is no RSC payload to stream into a
 * React Native client — and FALSE of the mechanism: `use(promise)` + `<Suspense>` are client-side React 19
 * and behave identically under React Native. So this leaf is promise-driven exactly like the web one, and the
 * two files differ ONLY in styling primitives. Do NOT "restore parity" by copying the widget's divergent
 * prop shape onto it; that divergence is the thing being corrected, and
 * `__tests__/RecipeNutritionBoundary.native.test.tsx` is the evidence.
 */
import { useMessages } from '@commise/i18n/react';
import { ErrorBoundary } from 'react-error-boundary';
import { Suspense, use, type FC } from 'react';

import { recipeNutritionMessages } from './messages.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.native.js';
import { RecipeCalorieSkeleton } from './RecipeCalorieSkeleton.native.js';
import { NUTRITION_FOOD_UNAVAILABLE, type RecipeCalorieState } from './model.js';

/** Props for the native nutrition boundary. */
export interface RecipeNutritionBoundaryProps {
    /**
     * The viewer's per-serving reading for ONE recipe, as a promise the HOST starts and does not await.
     *
     * ⚠️ HOST CONTRACT: the promise's IDENTITY is the retry signal (it is this boundary's `resetKeys`, and
     * React caches a rejection on the promise object), so recovering from a failed lookup requires a NEW
     * promise. Identical to the web leaf — see `RecipeNutritionBoundary.tsx`.
     */
    readonly nutritionPromise: Promise<RecipeCalorieState>;
}

/** Suspends on the reading, then hands the settled state to the pure chip. */
const RecipeNutritionContent: FC<RecipeNutritionBoundaryProps> = ({ nutritionPromise }) => (
    <RecipeCalorieChip nutrition={use(nutritionPromise)} />
);

/**
 * The deferred calorie figure for one recipe (native): skeleton, then chip, or a terminal `unaccounted`
 * answer if the lookup fails.
 *
 * @param props - The pending reading for one recipe.
 * @returns The boundary rendering exactly one of the three states.
 */
export const RecipeNutritionBoundary: FC<RecipeNutritionBoundaryProps> = ({ nutritionPromise }) => {
    const { loadingLabel } = useMessages(recipeNutritionMessages);

    return (
        // See the web leaf: without `resetKeys` the boundary never leaves its error state, so one failed
        // lookup would pin this card's figure off for the component's whole lifetime.
        <ErrorBoundary
            resetKeys={[nutritionPromise]}
            fallback={<RecipeCalorieChip nutrition={NUTRITION_FOOD_UNAVAILABLE} />}
        >
            <Suspense fallback={<RecipeCalorieSkeleton label={loadingLabel} />}>
                <RecipeNutritionContent nutritionPromise={nutritionPromise} />
            </Suspense>
        </ErrorBoundary>
    );
};
