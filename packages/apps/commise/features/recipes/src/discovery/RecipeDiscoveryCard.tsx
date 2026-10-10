'use client';

/**
 * @module @commise/features-recipes — web public-discovery result card (T076 / W4 S1; slice 5 of the UI overhaul).
 *
 * The shared {@link RecipeCard} in the variant the host decided (`cardVariantOf(container, mode, 'discover')`: compact
 * below a 600 container, grid from 600), with the Discover footer in its `footer` slot: the author and the 44 px Save a
 * copy icon button (`docs/design/uiOverhaul/buildSpec.md` §4.1). The card is one link named by the title; the footer's
 * control is lifted above the link's hit area and never nested in it, so one press cannot do both.
 *
 * Presentational: it reports selection and the save upward and holds no state.
 *
 * @pattern Adapter over the shared `RecipeCard`, filling its footer slot with the Discover footer
 */
import type { FC } from 'react';

import { RecipeCard } from '../card/RecipeCard.js';
import { DiscoveryFooter } from './DiscoveryFooter.js';
import type { RecipeDiscoveryCardProps } from './model.js';

export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({
    recipe,
    variant,
    authorHandle,
    sourceAttribution,
    saveCopy,
    href,
    onSelect,
    onSave,
    nutrition,
}) => (
    <RecipeCard
        variant={variant}
        recipe={recipe}
        onSelect={onSelect}
        {...(href === undefined ? {} : { href })}
        nutrition={nutrition}
        footer={
            <DiscoveryFooter
                title={recipe.title}
                {...(authorHandle === undefined ? {} : { authorHandle })}
                {...(sourceAttribution === undefined ? {} : { sourceAttribution })}
                state={saveCopy}
                onSave={() => onSave(recipe.id)}
            />
        }
    />
);
