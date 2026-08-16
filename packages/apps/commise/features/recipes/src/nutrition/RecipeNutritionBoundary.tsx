'use client';

/**
 * @module @commise/features-recipes/nutrition — web nutrition boundary (the orchestration layer).
 *
 * **Pattern: Suspense boundary + error boundary as a state SELECTOR.** This is the one place the deferred
 * lookup's three states become three components, and it is the only component here that is not pure:
 * `use(promise)` suspends, so the choice between skeleton / chip / terminal answer is made by React's
 * unwinding rather than by a branch on flags. The render components stay pure `props → JSX`.
 *
 * The nesting is **ErrorBoundary → Suspense → content**. An error boundary catches a throw from ANY
 * descendant, so an inner boundary would also catch `use()`'s re-thrown rejection; the outer position is
 * chosen because it additionally covers a throw from the FALLBACK itself, and because it is the conventional
 * reading order (catch, then wait). Do not read this as "inverting it crashes the card" — it does not.
 *
 * ⛔ THE INVARIANT THIS COMPONENT EXISTS TO HOLD: **neither branch is terminal.** Every way this subtree can
 * stop waiting — a resolved reading, a resolved `unaccounted`, a rejection, a deadline enforced upstream as a
 * rejection — lands on a component that renders an ANSWER, and the error branch RESETS when a new lookup
 * arrives. Both halves are load-bearing: a skeleton that outlives its request is a spinner forever, and an
 * error state that outlives its request is the same defect wearing the other mask — invisible, because on a
 * card it renders as nothing. `resetKeys` is what closes the second half; see its note below.
 *
 * `react-error-boundary` is used rather than a hand-rolled class: error boundaries are a `componentDidCatch`
 * /`getDerivedStateFromError` mechanism with reset semantics that both apps already depend on this library
 * for (library-first).
 *
 * ⚠️ NO `onError` REPORTING, and that is a gap rather than a decision. During a food-service outage every
 * card's figure silently becomes nothing, which on screen is indistinguishable from an honest
 * `unaccounted{no_resolved_ingredients}` — so nothing here tells an operator the difference. This package has
 * no reporting seam of its own (the host owns Sentry), so wiring it belongs with the host that mounts these
 * boundaries. Recorded so the absence is a known hole, not an assumed non-issue.
 */
import { useMessages } from '@commise/i18n/react';
import { ErrorBoundary } from 'react-error-boundary';
import { Suspense, use, type FC } from 'react';

import { recipeNutritionMessages } from './messages.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.js';
import { RecipeCalorieSkeleton } from './RecipeCalorieSkeleton.js';
import { NUTRITION_FOOD_UNAVAILABLE, type RecipeCalorieState } from './model.js';

/** Props for {@link RecipeNutritionBoundary}. */
export interface RecipeNutritionBoundaryProps {
    /**
     * The viewer's per-serving reading for ONE recipe, as a promise the HOST starts and does not await —
     * the same contract the recipe Home widget uses for its recipes. Remote state stays in the data layer;
     * this component only renders whichever state the promise is in.
     *
     * ⚠️ HOST CONTRACT: this promise's IDENTITY is the retry signal. It is the boundary's `resetKeys`, and
     * React caches a rejection on the promise object itself — so recovering from a failed lookup requires
     * handing this component a NEW promise (a refetch), not the same rejected one. A data layer that memoizes
     * per recipe id and never re-creates the promise turns a transient food-service blip into a permanently
     * blank figure for that card.
     */
    readonly nutritionPromise: Promise<RecipeCalorieState>;
}

/** Suspends on the reading, then hands the settled state to the pure chip. */
const RecipeNutritionContent: FC<RecipeNutritionBoundaryProps> = ({ nutritionPromise }) => (
    <RecipeCalorieChip nutrition={use(nutritionPromise)} />
);

/**
 * The deferred calorie figure for one recipe: its skeleton while the lookup is in flight, its chip once the
 * lookup settles, and a terminal `unaccounted` answer if the lookup fails.
 *
 * @param props - The pending reading for one recipe.
 * @returns The boundary rendering exactly one of the three states.
 */
export const RecipeNutritionBoundary: FC<RecipeNutritionBoundaryProps> = ({ nutritionPromise }) => {
    const { loadingLabel } = useMessages(recipeNutritionMessages);

    return (
        // `resetKeys` is NOT optional decoration. Without it `react-error-boundary` never leaves its error
        // state (its `componentDidUpdate` resets only when a reset key CHANGES), so the first failed lookup
        // would pin this card's figure off for the component's whole lifetime — surviving every refetch,
        // refresh and filter change, and doing so silently, because the failure renders as nothing.
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
