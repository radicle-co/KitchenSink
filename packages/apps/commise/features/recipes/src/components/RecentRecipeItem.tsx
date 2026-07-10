/**
 * @module @commise/features-recipes — web recent-recipe row (skeleton building block).
 */

import type { FC } from 'react';

import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe row on web. Accessible name is the recipe title.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe }) => {
    return (
        <article aria-label={recipe.title}>
            <span>{recipe.title}</span>
        </article>
    );
};
