/**
 * Add-a-recipe-to-collection screen (mobile, the ADD half of FR-009 / T072). Loads the target collection
 * (for its name + current membership) and the caller's own recipes, then drives the shared native
 * `CollectionRecipePicker`, wiring the add to `useAddRecipeToCollection`. The caller
 * sees only their OWN recipes and their OWN collection — both queries are scoped to the authenticated caller
 * by the recipe service. Remote state stays in the query cache: the candidate list, the membership, and the
 * add's in-flight/success/failure signals are DERIVED from the queries and the mutation; the only local state
 * is the transient search box value. A successful add invalidates the collection's cache, so the just-added
 * recipe re-renders as a member (its row flips to the inert marker), making a re-add idempotent-feeling.
 *
 * The picker FRAME (heading, Done, search) sits OUTSIDE the read boundary and the candidates INSIDE it, so Done —
 * this screen's only way out — is reachable while loading and after a failure, and the search field keeps what was
 * typed when the candidates settle. The collection NAME in the heading is enrichment the heading renders without,
 * read with `useCollection` on the same cache key as the suspense read, so it costs no second request.
 */
import {
    CollectionRecipePicker,
    CollectionRecipePickerCandidates,
    CollectionRecipePickerLoadError,
    CollectionRecipePickerLoading,
    toRecipeListItem,
} from '@commise/features-recipes';
import { QueryBoundary } from '@commise/query/boundary';
import { collectionQueries, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useAddRecipeToCollection,
    useCollection,
    useRecipeServiceClient,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQueries } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

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
 * @returns The picker frame around its read boundary: the loading and load-error bodies, or the candidates.
 */
export function CollectionRecipePickerScreen({
    collectionId,
    onCreateRecipe,
    onDone,
}: CollectionRecipePickerScreenProps): JSX.Element {
    const [query, setQuery] = useState('');
    const collection = useCollection(collectionId);

    return (
        <CollectionRecipePicker
            collectionName={collection.data?.name ?? ''}
            query={query}
            onQueryChange={setQuery}
            onDone={onDone}
        >
            <QueryBoundary
                loading={<CollectionRecipePickerLoading />}
                renderError={({ resetErrorBoundary }) => (
                    <CollectionRecipePickerLoadError onRetry={resetErrorBoundary} />
                )}
                resetKeys={[collectionId]}
            >
                <PickerCandidatesView collectionId={collectionId} query={query} onCreateRecipe={onCreateRecipe} />
            </QueryBoundary>
        </CollectionRecipePicker>
    );
}

/**
 * The settled candidates: the collection and the caller's recipes have both resolved by the time this renders.
 *
 * @param props - The collection id, the search value, and the create-recipe callback.
 * @returns The candidates wired to the add mutation.
 * @throws {Error} For an empty collection id — a read that cannot be made fails into the boundary rather than
 *   issuing a request for `''`.
 */
function PickerCandidatesView({
    collectionId,
    query,
    onCreateRecipe,
}: {
    readonly collectionId: string;
    readonly query: string;
    readonly onCreateRecipe: () => void;
}): JSX.Element {
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
}
