'use client';

/**
 * @module @commise/features-recipes/nutrition — the deferred figure's boundary NESTING, stated once (web).
 *
 * **Pattern: Template Method / Layout component.** Two surfaces suspend on a deferred calorie lookup —
 * `RecipeNutritionBoundary` (ONE recipe's promise) and `RecipeNutritionSlot` (one recipe's
 * SELECTION out of a page-wide batch promise) — and they differ ONLY in what suspends inside. Everything
 * around it is the same invariant, so it lives here rather than in both:
 *
 *  - **ErrorBoundary → Suspense → content.** An error boundary catches a throw from any descendant, so an
 *    inner one would also catch `use()`'s re-thrown rejection; the outer position additionally covers a throw
 *    from the FALLBACK itself, and is the conventional reading order (catch, then wait).
 *  - **Neither branch is terminal.** Every way the subtree can stop waiting — a resolved reading, a resolved
 *    `unaccounted`, a rejection, an upstream deadline enforced as a rejection — lands on a component that
 *    renders an ANSWER. A skeleton that outlives its request is a spinner forever; an error state that
 *    outlives its request is the same defect wearing the other mask, invisible because on a card it renders
 *    as nothing.
 *  - **`resetKeys` is what closes the second half.** `react-error-boundary` resets only when a reset key
 *    CHANGES, so without it the first failed lookup pins the figure off for the component's whole lifetime,
 *    surviving every refetch and refresh. The promise's IDENTITY is therefore the retry signal, on both
 *    surfaces — React caches a rejection on the promise object itself, so recovering requires a NEW promise.
 *
 * Extracting it is the point: before this, a fix to one surface's boundary (the `onError` reporting gap
 * recorded on `RecipeNutritionBoundary`, say) could silently miss the other. It is NOT exported from
 * the feature barrel — it is how the two public components are built, not a third thing to compose.
 */
import { useMessages } from '@commise/i18n/react';
import { ErrorBoundary } from 'react-error-boundary';
import { Suspense, type FC, type ReactNode } from 'react';

import { recipeNutritionMessages } from './messages.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.js';
import { RecipeCalorieSkeleton } from './RecipeCalorieSkeleton.js';
import { NUTRITION_FOOD_UNAVAILABLE } from './model.js';

/** Props for {@link NutritionBoundaryShell}. */
export interface NutritionBoundaryShellProps {
    /**
     * The promise the content suspends on. Used ONLY as the error boundary's reset key — a new promise means
     * a new lookup, which is the one signal that may clear a failed one.
     */
    readonly resetKey: unknown;
    /** The component that suspends (via `use`) and renders the settled answer. */
    readonly children: ReactNode;
}

/**
 * The skeleton-then-answer boundary shared by every deferred calorie surface.
 *
 * @param props - The promise identity to reset on, and the suspending content.
 * @returns The error boundary wrapping the Suspense boundary wrapping the content.
 */
export const NutritionBoundaryShell: FC<NutritionBoundaryShellProps> = ({ resetKey, children }) => {
    const { loadingLabel } = useMessages(recipeNutritionMessages);

    return (
        <ErrorBoundary resetKeys={[resetKey]} fallback={<RecipeCalorieChip nutrition={NUTRITION_FOOD_UNAVAILABLE} />}>
            <Suspense fallback={<RecipeCalorieSkeleton label={loadingLabel} />}>{children}</Suspense>
        </ErrorBoundary>
    );
};
