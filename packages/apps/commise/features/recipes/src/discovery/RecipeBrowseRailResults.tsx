'use client';

/**
 * @module @commise/features-recipes — web browse-rail RESULTS (presentational, U7).
 *
 * What one rail's read boundary renders once that rail has settled: a horizontal, snap-scrolling strip of discovery
 * cards, or the rail's empty note.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
import type { RecipeBrowseRailResultsProps } from './model.js';

export const RecipeBrowseRailResults: FC<RecipeBrowseRailResultsProps> = ({
    results,
    cloningId,
    onSelectRecipe,
    onClone,
    renderNutrition,
}) => {
    const discovery = useMessages(discoveryMessages);

    if (results.length === 0) {
        return <p className="text-body-sm text-slate">{discovery.railEmpty}</p>;
    }

    return (
        <ul className="flex snap-x gap-4 overflow-x-auto pb-2" role="list">
            {results.map((entry) => (
                <li key={entry.recipe.id} className="w-64 shrink-0 snap-start">
                    <RecipeDiscoveryCard
                        recipe={toRecipeCardModel(entry.recipe)}
                        authorHandle={entry.recipe.authorHandle}
                        sourceAttribution={entry.recipe.sourceAttribution}
                        isCloning={cloningId === entry.recipe.id}
                        onSelect={onSelectRecipe}
                        onClone={onClone}
                        nutrition={renderNutrition?.(entry.recipe.id)}
                    />
                </li>
            ))}
        </ul>
    );
};
