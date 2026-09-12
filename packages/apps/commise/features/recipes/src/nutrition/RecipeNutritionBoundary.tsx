'use client';

/**
 * @module @commise/features-recipes/nutrition — web nutrition boundary (the orchestration layer).
 *
 * **Pattern: Suspense boundary + error boundary as a state SELECTOR.** This is the one place the deferred
 * lookup's three states become three components, and it is the only component here that is not pure:
 * `use(promise)` suspends, so the choice between skeleton / chip / terminal answer is made by React's
 * unwinding rather than by a branch on flags. The render components stay pure `props → JSX`.
 *
 * The nesting — **ErrorBoundary → Suspense → content**, and the `resetKeys` that make the error branch
 * recoverable — lives in {@link NutritionBoundaryShell}, shared with `RecipeNutritionSlot` (the
 * batch-reading twin) so the two cannot drift. Read that module for the invariant it holds: **neither branch
 * is terminal.**
 *
 * ⛔ THIS COMPONENT vs THE SLOT. This one renders ONE recipe's own promise, which is the right shape for a
 * surface that has one (a detail view). A card GRID holds one BATCH promise for the whole page, and selecting
 * a single recipe out of it has a fourth outcome — the recipe the response omitted — that this component's
 * `Promise<RecipeCalorieState>` deliberately cannot express. That surface uses `RecipeNutritionSlot`.
 *
 * ⚠️ NO `onError` REPORTING, and that is a gap rather than a decision. During a food-service outage every
 * card's figure silently becomes nothing, which on screen is indistinguishable from an honest
 * `unaccounted{no_resolved_ingredients}` — so nothing here tells an operator the difference. This package has
 * no reporting seam of its own (the host owns Sentry), so wiring it belongs with the host that mounts these
 * boundaries. Recorded so the absence is a known hole, not an assumed non-issue.
 *
 * @pattern Suspense boundary + error boundary as a state selector — the deferred lookup's three states become three
 *     components by React's unwinding rather than a branch on flags, and the render components stay pure.
 */
import { use, type FC } from 'react';

import { NutritionBoundaryShell } from './NutritionBoundaryShell.js';
import { RecipeCalorieChip } from './RecipeCalorieChip.js';
import type { RecipeCalorieState } from './model.js';

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
export const RecipeNutritionBoundary: FC<RecipeNutritionBoundaryProps> = ({ nutritionPromise }) => (
    <NutritionBoundaryShell resetKey={nutritionPromise}>
        <RecipeNutritionContent nutritionPromise={nutritionPromise} />
    </NutritionBoundaryShell>
);
