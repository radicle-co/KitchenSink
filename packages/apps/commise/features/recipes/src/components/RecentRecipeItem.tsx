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
        <article aria-label={recipe.title} className="rounded-lg px-3 py-2 transition hover:bg-pearl">
            <span className="text-body-md font-medium text-charcoal">{recipe.title}</span>
        </article>
    );
};
