'use client';

/**
 * @module @commise/features-recipes/collections — the web add-recipes picker's settled body
 * (`docs/design/uiOverhaul/buildSpec.md` §5.3): the caller's recipes as the host's rows in a list, or the reason there are
 * none — "You have no recipes yet." with **Add a recipe** (which opens the editor), or "No recipes match your search" with
 * **Clear search**. It draws no row itself: the host closes over the collection's membership and the toggle.
 *
 * Presentational: it draws the rows the host gives it, or the reason there are none.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { CollectionRecipePickerCandidatesProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionRecipePickerCandidates: FC<CollectionRecipePickerCandidatesProps> = ({
    recipes,
    query,
    onClearSearch,
    onCreateRecipe,
    renderRow,
}) => {
    const { picker } = useMessages(collectionMessages);

    if (recipes.length === 0) {
        return query.trim().length > 0 ? (
            <div className="flex flex-col items-start gap-3 py-6">
                <p className="text-section-title text-ink">{picker.noMatchesTitle}</p>
                <Button variant="secondary" icon="x" onPress={onClearSearch}>
                    {picker.clearSearch}
                </Button>
            </div>
        ) : (
            <div className="flex flex-col items-start gap-3 py-6">
                <p className="text-section-title text-ink">{picker.noRecipesTitle}</p>
                <Button icon="plus" onPress={onCreateRecipe}>
                    {picker.createRecipe}
                </Button>
            </div>
        );
    }

    return (
        <ul className="flex flex-col">
            {recipes.map((recipe) => (
                <li key={recipe.id}>{renderRow(recipe)}</li>
            ))}
        </ul>
    );
};
