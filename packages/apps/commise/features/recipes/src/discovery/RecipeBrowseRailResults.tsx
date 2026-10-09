'use client';

/**
 * @module @commise/features-recipes — web browse-rail RESULTS (presentational, U7; slice 5 of the UI overhaul).
 *
 * What one rail's read boundary renders once that rail has settled: a horizontal, snap-scrolling strip of full grid
 * cards — each `clamp(240px, 78%, 256px)` wide, so the next card peeks at 320 and 390 and the cards stay equal from 390 up
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4, "Settled here" 5) — or the rail's empty note. Each card carries the
 * Discover footer with its Save a copy control.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
import type { RecipeBrowseRailResultsProps } from './model.js';
import { RailTrack } from './RailTrack.js';

export const RecipeBrowseRailResults: FC<RecipeBrowseRailResultsProps> = ({
    results,
    saveCopy,
    hrefOf,
    onSelectRecipe,
    renderNutrition,
}) => {
    const discovery = useMessages(discoveryMessages);

    if (results.length === 0) {
        return <p className="text-meta text-ink-muted">{discovery.railEmpty}</p>;
    }

    return (
        <RailTrack>
            {results.map((entry) => (
                <li key={entry.recipe.id} className="w-[clamp(240px,78%,256px)] shrink-0 snap-start">
                    <RecipeDiscoveryCard
                        recipe={toRecipeCardModel(entry.recipe)}
                        variant="grid"
                        authorHandle={entry.recipe.authorHandle}
                        sourceAttribution={entry.recipe.sourceAttribution}
                        saveCopy={saveCopy.stateOf(entry.recipe.id)}
                        {...(hrefOf === undefined ? {} : { href: hrefOf(entry.recipe.id) })}
                        onSelect={onSelectRecipe}
                        onSave={saveCopy.save}
                        nutrition={renderNutrition?.(entry.recipe.id)}
                    />
                </li>
            ))}
        </RailTrack>
    );
};
