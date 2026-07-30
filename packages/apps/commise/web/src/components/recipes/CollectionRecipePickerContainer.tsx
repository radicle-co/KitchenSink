'use client';

/**
 * Container for the add-a-recipe-to-collection route (the ADD half of FR-009 / T072): it loads the target
 * collection (for its name + current membership) via `useCollection(id)` and the caller's own recipes via
 * `useRecipes()`, then drives the shared, presentational `CollectionRecipePicker`. The caller sees only their
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
 */
import { CollectionRecipePicker, toRecipeListItem, type RecipePickerStatus } from '@commise/features-recipes';
import { useCollection, useAddRecipeToCollection, useRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

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
 * @returns The picker wired to the recipe + collection queries and the add mutation.
 */
export const CollectionRecipePickerContainer: FC<CollectionRecipePickerContainerProps> = ({ id, locale }) => {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const collection = useCollection(id);
    const recipes = useRecipes();
    const addRecipe = useAddRecipeToCollection();

    const status: RecipePickerStatus =
        collection.isError || recipes.isError
            ? 'error'
            : collection.isLoading || recipes.isLoading
              ? 'loading'
              : 'ready';

    const term = query.trim().toLowerCase();
    const candidates = (recipes.data?.data ?? [])
        .map(toRecipeListItem)
        .filter((recipe) => term.length === 0 || recipe.title.toLowerCase().includes(term));
    const memberRecipeIds = (collection.data?.recipes ?? []).map((recipe) => recipe.id);

    // Derived from the mutation (the source of truth) rather than mirrored into local state: the pending row
    // is the one whose add is in flight; the announcement names the last successful add; the alert shows on
    // the last failure. Each resets when the next `mutate` starts.
    const pendingRecipeId = addRecipe.isPending ? addRecipe.variables?.recipeId : undefined;
    const lastAddedRecipeId = addRecipe.isSuccess ? addRecipe.variables?.recipeId : undefined;

    return (
        <CollectionRecipePicker
            collectionName={collection.data?.name ?? ''}
            status={status}
            recipes={candidates}
            memberRecipeIds={memberRecipeIds}
            query={query}
            pendingRecipeId={pendingRecipeId}
            lastAddedRecipeId={lastAddedRecipeId}
            addFailed={addRecipe.isError}
            onQueryChange={setQuery}
            onAdd={(recipeId) => addRecipe.mutate({ id, recipeId })}
            onRetry={() => {
                void collection.refetch();
                void recipes.refetch();
            }}
            onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
            onDone={() => router.push(`/${locale}/collections/${id}` as Route)}
        />
    );
};
