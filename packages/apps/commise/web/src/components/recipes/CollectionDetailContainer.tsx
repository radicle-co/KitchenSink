'use client';

/**
 * Container for the collection-detail route: fetches a single collection (with its member recipes) via
 * `useCollection(id)` and renders the shared, presentational `CollectionDetail` on success. The fetch-state
 * affordances (loading, generic error with retry, and a distinct not-found message) belong to the app, not
 * the building block, and are localized through the web dictionary (`useMessages`). It wires the member and
 * collection mutations (remove a member, delete the collection → navigate back to the list) and navigation
 * (rename → the rename form; select a member → the recipe route). Remote state stays in TanStack Query — the
 * view is derived from the query, never copied into local state.
 */
import { CollectionDetail } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCollection,
    useDeleteCollection,
    useRemoveRecipeFromCollection,
} from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link CollectionDetailContainer}. */
export interface CollectionDetailContainerProps {
    /** The collection id from the `[id]` route segment. */
    readonly id: string;
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live collection-detail container.
 *
 * @param props - The collection id to load and the active locale.
 * @returns The detail view, or a localized loading / not-found / error affordance.
 */
export const CollectionDetailContainer: FC<CollectionDetailContainerProps> = ({ id, locale }) => {
    const router = useRouter();
    const { collections } = useMessages(webMessages);
    const query = useCollection(id);
    const removeRecipe = useRemoveRecipeFromCollection();
    const deleteCollection = useDeleteCollection();

    if (query.isLoading) {
        return <div role="status" aria-label={collections.detail.loadingLabel} />;
    }

    if (query.isError) {
        const notFound = isNotFoundError(query.error);

        return (
            <div role="alert">
                <p>{notFound ? collections.detail.notFoundTitle : collections.detail.errorTitle}</p>
                {!notFound && (
                    <button type="button" onClick={() => void query.refetch()}>
                        {collections.detail.retry}
                    </button>
                )}
            </div>
        );
    }

    if (query.data === undefined) {
        // An enabled query that is neither loading nor errored should have data; guard defensively so a
        // transient undefined never crashes the view.
        return <div role="status" aria-label={collections.detail.loadingLabel} />;
    }

    return (
        <CollectionDetail
            collection={query.data}
            onSelectRecipe={(recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route)}
            onRemoveRecipe={(recipeId) => removeRecipe.mutate({ id, recipeId })}
            onAddRecipe={() => router.push(`/${locale}/collections/${id}/add` as Route)}
            onRename={() => router.push(`/${locale}/collections/${id}/rename` as Route)}
            onDelete={() =>
                deleteCollection.mutate(id, {
                    onSuccess: () => router.push(`/${locale}/collections` as Route),
                })
            }
        />
    );
};
