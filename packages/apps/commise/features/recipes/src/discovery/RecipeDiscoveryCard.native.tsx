/**
 * @module @commise/features-recipes — native public-discovery result card, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1): the shared {@link RecipeCard} in the variant the host decided, with the
 * Discover footer (the author and the Save a copy icon button) in its `footer` slot. The card's link covers the recipe;
 * the footer sits beside it, so the Save a copy control stays its own accessible element.
 *
 * @pattern Adapter over the shared `RecipeCard`, filling its footer slot with the Discover footer
 */
import type { FC } from 'react';

import { RecipeCard } from '../card/RecipeCard.native.js';
import { DiscoveryFooter } from './DiscoveryFooter.native.js';
import type { RecipeDiscoveryCardProps } from './model.js';

export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({
    recipe,
    variant,
    authorHandle,
    sourceAttribution,
    saveCopy,
    onSelect,
    onSave,
    nutrition,
}) => (
    <RecipeCard
        variant={variant}
        recipe={recipe}
        onSelect={onSelect}
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
