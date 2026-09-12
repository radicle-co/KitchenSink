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
 *
 * @pattern Suspense boundary + error boundary as a state selector — the same nesting and the same non-terminal
 *     invariant as the web leaf, over the same client-side `use(promise)` mechanism.
 */
import { use, type FC } from 'react';

import { NutritionBoundaryShell } from './NutritionBoundaryShell.native.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.native.js';
import type { RecipeCalorieState } from './model.js';

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
export const RecipeNutritionBoundary: FC<RecipeNutritionBoundaryProps> = ({ nutritionPromise }) => (
    // The nesting + `resetKeys` live in the shared shell — see `NutritionBoundaryShell.native.tsx`.
    <NutritionBoundaryShell resetKey={nutritionPromise}>
        <RecipeNutritionContent nutritionPromise={nutritionPromise} />
    </NutritionBoundaryShell>
);
