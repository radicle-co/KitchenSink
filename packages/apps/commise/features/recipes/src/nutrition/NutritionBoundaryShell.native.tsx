/**
 * @module @commise/features-recipes/nutrition — the deferred figure's boundary NESTING, stated once (native).
 *
 * Same contract, same nesting, same invariant as the web leaf (see `NutritionBoundaryShell.tsx`):
 * **ErrorBoundary → Suspense → content**, neither branch is terminal, and `resetKeys` is what makes the error
 * branch recoverable. The two files differ ONLY in which platform leaves they compose.
 */
import { useMessages } from '@commise/i18n/react';
import { ErrorBoundary } from 'react-error-boundary';
import { Suspense, type FC, type ReactNode } from 'react';

import { recipeNutritionMessages } from './messages.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.native.js';
import { RecipeCalorieSkeleton } from './RecipeCalorieSkeleton.native.js';
import { NUTRITION_FOOD_UNAVAILABLE } from './model.js';

/** Props for the native {@link NutritionBoundaryShell}. */
export interface NutritionBoundaryShellProps {
    /** The promise the content suspends on — used ONLY as the error boundary's reset key (its identity). */
    readonly resetKey: unknown;
    /** The component that suspends (via `use`) and renders the settled answer. */
    readonly children: ReactNode;
}

/**
 * The skeleton-then-answer boundary shared by every deferred calorie surface (native).
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
