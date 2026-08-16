'use client';

/**
 * Container for the Cooking Mode route (`/[locale]/recipes/[id]/cook`, feature 008 / T-011).
 *
 * **Pattern register.** `CookingModeScreen` is feature 008's single ORCHESTRATIONAL component; this
 * container is the thin *adapter* that lets the web app host it. It does exactly three things and
 * nothing else:
 *
 *  1. **Maps the fetch state onto the screen's own union.** The screen consumes `CookingRecipeState`
 *     (`loading | error | ready + steps + ingredients`), not a query object, so the app's data layer
 *     never leaks into the feature package. The mapping runs through the shared `toDetailQueryView`,
 *     which is where the SETTLED-BUT-ABSENT rule (B21) lives — a query that stopped loading, carries no
 *     error and still holds no recipe has failed, and must reach the screen's error surface with its
 *     retry rather than a spinner nobody can escape.
 *  2. **Injects the platform port.** `webCookingSessionStore` is the web `CookingSessionStore` adapter
 *     (a module singleton — the hook requires a referentially stable store). The wake lock is the
 *     screen's own web default, so it is not restated here.
 *  3. **Owns the navigations.** Cooking Mode is handed no router: retry re-runs the recipe query, and
 *     both endings — `onExit` (paused, resumable for 24h) and `onFinish` (session cleared) — return the
 *     cook to the recipe they were cooking. Deliberately the same destination through ONE function, so
 *     the two endings cannot drift; the difference between them is a session fact the hook has already
 *     applied by the time either callback fires, not a routing one.
 *
 * **Cooking Mode never writes to the recipe** (REQ-CN-001). This container holds no mutation and issues
 * no request beyond the read every other recipe surface already performs — the EXISTING
 * `GET /api/v1/recipes/{id}` detail payload, whose `steps` and `ingredients` are the whole input.
 */
import { CookingModeScreen, type CookingRecipeState } from '@commise/features-cooking';
import { toDetailQueryView, type DetailQueryView } from '@commise/features-core';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { useRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import type { FC } from 'react';

import { webCookingSessionStore } from '@/lib/cookingSessionStore';

/** Props for {@link CookingModeContainer}. */
export interface CookingModeContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/**
 * Project the recipe detail query onto the Cooking Mode screen's recipe state. Pure.
 *
 * @param view - The detail query's resolved view (loading / error / ready + recipe).
 * @returns The state the screen renders from.
 */
function toCookingRecipeState(view: DetailQueryView<RecipeDetail>): CookingRecipeState {
    if (view.status === 'loading') {
        return { status: 'loading' };
    }

    if (view.status === 'error') {
        return { status: 'error' };
    }

    return { status: 'ready', steps: view.data.steps, ingredients: view.data.ingredients };
}

/**
 * The live Cooking Mode container.
 *
 * @param props - The recipe id to cook.
 * @returns The Cooking Mode screen, driven by the recipe-detail query.
 */
export const CookingModeContainer: FC<CookingModeContainerProps> = ({ recipeId }) => {
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();
    const query = useRecipe(recipeId);

    // Rebuilt on every render on purpose — `useCookingSession` folds the recipe down to the stable facts
    // its effects depend on (step COUNT, the joined ingredient ids), so a fresh object here restarts
    // nothing. Memoizing it would add a dependency list to keep correct for no behavioural gain.
    const recipe = toCookingRecipeState(toDetailQueryView(query));

    /** Return to the recipe the cook was cooking — the destination for BOTH endings of a session. */
    const returnToRecipe = (): void => {
        router.push(`/${locale}/recipes/${recipeId}` as Route);
    };

    return (
        <CookingModeScreen
            recipeId={recipeId}
            recipe={recipe}
            sessionStore={webCookingSessionStore}
            onRetry={() => void query.refetch()}
            onExit={returnToRecipe}
            onFinish={returnToRecipe}
        />
    );
};
