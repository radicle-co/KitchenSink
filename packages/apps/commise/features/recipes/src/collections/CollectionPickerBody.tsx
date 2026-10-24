'use client';

/**
 * @module @commise/features-recipes/collections — the add-recipes picker's SETTLED body, shared by web and mobile: the
 * whole library (the same read My recipes narrows on the device), narrowed by the search, with each row's membership
 * read off the collection — which the toggles rewrite at once. A suspense read: the host puts it under its own read
 * boundary, with `CollectionRecipePickerLoading` and `CollectionRecipePickerLoadError` as the fallbacks.
 *
 * Orchestration: it reads, and draws only through the candidates and row pairs, which resolve per platform — plain
 * `.tsx` with no native twin.
 *
 * @pattern Adapter — the picker's suspense reads, projected into the candidates list's props
 */
import { collectionQueries, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, type FC } from 'react';

import { CollectionPickerToggleRow } from './CollectionPickerToggleRow.js';
import { CollectionRecipePickerCandidates } from './CollectionRecipePickerCandidates.js';
import { narrowByTitle } from './pickerModel.js';

/** Props for {@link CollectionPickerBody}. */
export interface CollectionPickerBodyProps {
    readonly collectionId: string;
    /** The picker's search text. */
    readonly query: string;
    readonly onClearSearch: () => void;
    /** The empty state's "Add a recipe". */
    readonly onCreateRecipe: () => void;
}

export const CollectionPickerBody: FC<CollectionPickerBodyProps> = ({
    collectionId,
    query,
    onClearSearch,
    onCreateRecipe,
}) => {
    const client = useRecipeServiceClient();
    const library = useSuspenseInfiniteQuery(recipeQueries(client).library({ sortBy: 'updatedAt' }));
    const collection = useSuspenseQuery(collectionQueries(client).detail(collectionId));
    const members = useMemo(
        () => new Set(collection.data.recipes.map((recipe) => recipe.id)),
        [collection.data.recipes],
    );
    const recipes = useMemo(
        () =>
            narrowByTitle(
                library.data.pages.flatMap((chunk) => chunk.data),
                query,
            ),
        [library.data.pages, query],
    );

    return (
        <CollectionRecipePickerCandidates
            recipes={recipes}
            query={query}
            onClearSearch={onClearSearch}
            onCreateRecipe={onCreateRecipe}
            renderRow={(recipe) => (
                <CollectionPickerToggleRow
                    collectionId={collectionId}
                    recipe={recipe}
                    checked={members.has(recipe.id)}
                />
            )}
        />
    );
};
