/**
 * Add-a-recipe-to-collection screen (mobile, the ADD half of FR-009 / T072). Loads the target collection
 * (for its name + current membership) via `useCollection` and the caller's own recipes via `useRecipes`, then
 * drives the shared native `CollectionRecipePicker`, wiring the add to `useAddRecipeToCollection`. The caller
 * sees only their OWN recipes and their OWN collection — both queries are scoped to the authenticated caller
 * by the recipe service. Remote state stays in the query cache: the candidate list, the membership, and the
 * add's in-flight/success/failure signals are DERIVED from the queries and the mutation; the only local state
 * is the transient search box value. A successful add invalidates the collection's cache, so the just-added
 * recipe re-renders as a member (its row flips to the inert marker), making a re-add idempotent-feeling.
 */
import { CollectionRecipePicker, toRecipeListItem, type RecipePickerStatus } from '@commise/features-recipes';
import { useAddRecipeToCollection, useCollection, useRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';

/** Props for {@link CollectionRecipePickerScreen}. */
export interface CollectionRecipePickerScreenProps {
    /** The target collection's id. */
    readonly collectionId: string;
    /** Invoked when the create-recipe action is activated (no recipes yet). */
    readonly onCreateRecipe: () => void;
    /** Invoked when the done affordance is activated (dismisses the picker). */
    readonly onDone: () => void;
}

/**
 * The add-a-recipe picker screen.
 *
 * @param props - The target collection id and the create/done callbacks the navigator wires.
 * @returns The picker wired to the recipe + collection queries and the add mutation.
 */
export function CollectionRecipePickerScreen({
    collectionId,
    onCreateRecipe,
    onDone,
}: CollectionRecipePickerScreenProps): JSX.Element {
    const [query, setQuery] = useState('');
    const collection = useCollection(collectionId);
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
            onAdd={(recipeId) => addRecipe.mutate({ id: collectionId, recipeId })}
            onRetry={() => {
                void collection.refetch();
                void recipes.refetch();
            }}
            onCreateRecipe={onCreateRecipe}
            onDone={onDone}
        />
    );
}
