'use client';

/**
 * Container for the add-a-recipe-to-collection route (the ADD half of FR-009 / T072): it loads the target
 * collection (for its name + current membership) and the caller's own recipes, then drives the shared,
 * presentational `CollectionRecipePicker`. The caller sees only their
 * OWN recipes and their OWN collection — both queries are scoped to the authenticated caller by the recipe
 * service, so no other user's recipe or collection can be offered here.
 *
 * Remote state stays in TanStack Query: the candidate list, the membership, and the add's in-flight/success/
 * failure signals are all DERIVED from the queries and the `useAddRecipeToCollection` mutation, never copied
 * into local state. The only local state is the ephemeral search box value — view state, not server data. The
 * add mutation invalidates the collection's cache on success, so a just-added recipe re-renders as a member
 * (its row flips to the inert "in this collection" marker), which is what makes a re-add idempotent-feeling.
 * Search filtering is a client-side title match over the already-fetched page — the same projection the list
 * card renders (`toRecipeListItem`).
 *
 * The picker FRAME (heading, Done, search) sits OUTSIDE the read boundary and the candidates INSIDE it, so the
 * search field is one element in every state (typing while the list loads keeps its focus and value) and Done is
 * reachable while loading and after a failure. The candidates are suspense reads under a `ClientQueryBoundary` —
 * hydration-gated, because this route is not server-prefetched. The heading's collection NAME is the one read that
 * is not: the heading renders without it (as it always did while loading), so it is enrichment, read with
 * `useCollection` on the same cache key as the suspense read — one request, not two.
 */
import {
    CollectionRecipePicker,
    CollectionRecipePickerCandidates,
    CollectionRecipePickerLoadError,
    CollectionRecipePickerLoading,
    toRecipeListItem,
} from '@commise/features-recipes';
import { collectionQueries, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useAddRecipeToCollection,
    useCollection,
    useRecipeServiceClient,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQueries } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';

/** Props for {@link CollectionRecipePickerContainer}. */
export interface CollectionRecipePickerContainerProps {
    /** The target collection's id from the `[id]` route segment. */
    readonly id: string;
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live add-a-recipe picker container.
 *
 * @param props - The target collection id and the active locale.
 * @returns The picker frame around its read boundary: the loading and load-error bodies, or the candidates.
 */
export const CollectionRecipePickerContainer: FC<CollectionRecipePickerContainerProps> = ({ id, locale }) => {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const collection = useCollection(id);

    return (
        <CollectionRecipePicker
            collectionName={collection.data?.name ?? ''}
            query={query}
            onQueryChange={setQuery}
            onDone={() => router.push(`/${locale}/collections/${id}` as Route)}
        >
            <ClientQueryBoundary
                loading={<CollectionRecipePickerLoading />}
                renderError={({ resetErrorBoundary }) => (
                    <CollectionRecipePickerLoadError onRetry={resetErrorBoundary} />
                )}
                resetKeys={[id]}
            >
                <PickerCandidatesView
                    collectionId={id}
                    query={query}
                    onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
                />
            </ClientQueryBoundary>
        </CollectionRecipePicker>
    );
};

/**
 * The settled candidates: the collection and the caller's recipes have both resolved by the time this renders.
 *
 * @param props - The collection id, the search value, and the create-recipe navigation.
 * @returns The candidates wired to the add mutation.
 * @throws {Error} For an empty collection id — a read that cannot be made fails into the boundary rather than
 *   issuing a request for `''`.
 */
const PickerCandidatesView: FC<{
    readonly collectionId: string;
    readonly query: string;
    readonly onCreateRecipe: () => void;
}> = ({ collectionId, query, onCreateRecipe }) => {
    if (collectionId.length === 0) {
        throw new Error('A collection recipe picker needs a collection id.');
    }

    const client = useRecipeServiceClient();
    const [collection, recipes] = useSuspenseQueries({
        queries: [collectionQueries(client).detail(collectionId), recipeQueries(client).list()],
    });
    const addRecipe = useAddRecipeToCollection();

    const term = query.trim().toLowerCase();
    const candidates = recipes.data.data
        .map(toRecipeListItem)
        .filter((recipe) => term.length === 0 || recipe.title.toLowerCase().includes(term));
    const memberRecipeIds = collection.data.recipes.map((recipe) => recipe.id);

    // Derived from the mutation (the source of truth) rather than mirrored into local state: the pending row
    // is the one whose add is in flight; the announcement names the last successful add; the alert shows on
    // the last failure. Each resets when the next `mutate` starts.
    const pendingRecipeId = addRecipe.isPending ? addRecipe.variables.recipeId : undefined;
    const lastAddedRecipeId = addRecipe.isSuccess ? addRecipe.variables.recipeId : undefined;

    return (
        <CollectionRecipePickerCandidates
            recipes={candidates}
            memberRecipeIds={memberRecipeIds}
            query={query}
            pendingRecipeId={pendingRecipeId}
            lastAddedRecipeId={lastAddedRecipeId}
            addFailed={addRecipe.isError}
            onAdd={(recipeId) => addRecipe.mutate({ id: collectionId, recipeId })}
            onCreateRecipe={onCreateRecipe}
        />
    );
};
