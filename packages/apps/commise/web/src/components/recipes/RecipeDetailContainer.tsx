'use client';

/**
 * Container for the recipe-detail route: fetches a single recipe via `useRecipe(id)` and renders the
 * shared, presentational `RecipeDetailView` on success. The fetch-state affordances (loading, generic
 * error with retry, and a distinct not-found message) belong to the app, not the building block, and are
 * localized through the web dictionary (`useMessages`). Remote state stays in TanStack Query — this
 * component derives its view from the query, never copying the recipe into local state.
 */
import { RecipeDetailView } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import { useRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeDetailContainer}. */
export interface RecipeDetailContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly id: string;
}

/**
 * The live recipe-detail container.
 *
 * @param props - The recipe id to load.
 * @returns The detail view, or a localized loading / not-found / error affordance.
 */
export const RecipeDetailContainer: FC<RecipeDetailContainerProps> = ({ id }) => {
    const { recipes } = useMessages(webMessages);
    const query = useRecipe(id);

    if (query.isLoading) {
        return <div role="status" aria-label={recipes.detail.loadingLabel} />;
    }

    if (query.isError) {
        const notFound = isNotFoundError(query.error);

        return (
            <div role="alert">
                <p>{notFound ? recipes.detail.notFoundTitle : recipes.detail.errorTitle}</p>
                {!notFound && (
                    <button type="button" onClick={() => void query.refetch()}>
                        {recipes.detail.retry}
                    </button>
                )}
            </div>
        );
    }

    if (query.data === undefined) {
        // An enabled query that is neither loading nor errored should have data; guard defensively so a
        // transient undefined never crashes the view.
        return <div role="status" aria-label={recipes.detail.loadingLabel} />;
    }

    return <RecipeDetailView recipe={query.data} />;
};
