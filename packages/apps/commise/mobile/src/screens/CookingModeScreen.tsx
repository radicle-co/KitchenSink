/**
 * Cooking Mode screen (mobile, T-012 / US-001…US-005, FR-032…FR-035).
 *
 * The APP-side container for `@commise/features-cooking`'s `CookingModeScreen`. It owns exactly three
 * things the feature package deliberately does not:
 *
 *  1. **where the recipe comes from** — the app's existing `useRecipe` query (`GET /api/v1/recipes/{id}`),
 *     the SAME request the recipe-detail screen already issues, so entering Cooking Mode from a detail the
 *     cook is already reading is served straight from the TanStack cache with no new round trip and, per
 *     REQ-CN-001, no new endpoint;
 *  2. **where the session is stored** — the platform's `CookingSessionStore` adapter (AsyncStorage); and
 *  3. **where "exit" and "finish" LAND** — the two are distinct outcomes, not synonyms (see below).
 *
 * Everything else — the step surface, timers, ingredient checkoff, yield scaling, the wake lock and the 24h
 * resume window — belongs to the shared feature, whose native leaf this mounts. Importing
 * `@commise/features-cooking` resolves the `.native` leaves under Metro, so the same specifier serves both
 * platforms (CLAUDE.md §14).
 *
 * **Pattern register.** *Container / humble object*: this component is a pure mapping from query state to
 * the feature's `CookingRecipeState` discriminated union plus three callbacks — it holds no session state
 * of its own, which is what keeps mobile and web from drifting on cooking behaviour. The union (rather than
 * a status flag beside nullable data) is what lets the feature SELECT a surface instead of branching on a
 * mode prop.
 *
 * **Exit vs finish are different events and stay separate props.** The feature's session hook persists a
 * paused, resumable session on `exit` and CLEARS the stored one on `finish`; collapsing them here — passing
 * one callback to both, or routing "finish" through the exit command — would silently either resurrect a
 * finished cook on the next visit or discard a session the cook meant to come back to. Their navigation
 * DESTINATION is the same today (back to the recipe), and that is a navigation decision belonging to the
 * caller, not a reason to merge the events.
 *
 * **Authentication.** This screen enforces the same gate as every other recipe screen — the app-wide
 * `AuthGate` (`src/components/AuthGate.tsx`), which renders `AppRoot` (and therefore every surface beneath
 * it, this one included) only for an unblocked, signed-in session. Mobile has no URL routing, so there is
 * no second way in: the only entry point is the recipe detail's "Start cooking" control, itself already
 * behind that gate. A per-screen re-check would be a second, drift-prone representation of one rule; the
 * recipe request additionally carries the viewer's Clerk token, so the service authorizes the read too.
 */
import { CookingModeScreen as CookingModeSurface, type CookingRecipeState } from '@commise/features-cooking';
import { useRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';

import { nativeCookingSessionStore } from '../storage/cookingSessionStore.js';

/** Props for {@link CookingModeScreen}. */
export interface CookingModeScreenProps {
    /** The id of the recipe to cook. The stored session is keyed by it. */
    readonly recipeId: string;
    /**
     * Invoked after the cook LEAVES mid-recipe. The session has already been persisted and stays resumable
     * for 24h — distinct from {@link onFinish}, which clears it.
     */
    readonly onExit: () => void;
    /** Invoked after the cook FINISHES the recipe. The stored session has already been cleared. */
    readonly onFinish: () => void;
}

/**
 * The Cooking Mode screen.
 *
 * @param props - The recipe id plus the exit and finish navigation callbacks.
 * @returns The cooking surface in its loading, error, empty, or step state.
 */
export function CookingModeScreen({ recipeId, onExit, onFinish }: CookingModeScreenProps): JSX.Element {
    const query = useRecipe(recipeId);

    // A retry in flight reports as loading, not as the failure it is retrying: TanStack keeps `status:
    // 'error'` until the refetch resolves, so without this the cook would tap "Try again" and watch the
    // error surface sit there unchanged — an affordance that reads as dead.
    const recipe: CookingRecipeState =
        query.isLoading || (query.isError && query.isFetching)
            ? { status: 'loading' }
            : query.isError || query.data === undefined
              ? { status: 'error' }
              : { status: 'ready', steps: query.data.steps, ingredients: query.data.ingredients };

    return (
        <CookingModeSurface
            recipeId={recipeId}
            recipe={recipe}
            sessionStore={nativeCookingSessionStore}
            // Cooking Mode fetches nothing itself, so the retry is ours. `void`: the surface's retry
            // affordance is fire-and-forget, and a rejected refetch is already reflected in `query.isError`.
            onRetry={() => void query.refetch()}
            onExit={onExit}
            onFinish={onFinish}
        />
    );
}
