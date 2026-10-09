/**
 * @module @commise/features-recipes — the web "Recent recipes" grid: Home's fixed grid — 2 × 2 below a 600 container,
 * one row of four from 600 — of cards in the variant the host decided (compact below 960, the full card from 960; owner
 * ruling D8). A full card sits in a subgrid cell, so the four line up row by row (`homeCardsB.md` §3).
 *
 * Pure `props → JSX`: it threads each card's id up through `onSelectRecipe`, and the host routes.
 *
 * @pattern Layout component over a pure projection — it owns the arrangement and nothing else
 */
import type { FC } from 'react';

import { GRID_CELL_CLASS, HOME_GRID_CLASS } from '../card/cardGridClass.js';
import { RecipeCard } from '../card/RecipeCard.js';
import type { RecentRecipeGridProps } from './props.js';

export const RecentRecipeGrid: FC<RecentRecipeGridProps> = ({
    recipes,
    variant,
    onSelectRecipe,
    hrefOf,
    renderNutrition,
}) => (
    <ul className={HOME_GRID_CLASS}>
        {recipes.map((recipe) => (
            <li key={recipe.id} className={variant === 'grid' ? GRID_CELL_CLASS : undefined}>
                <RecipeCard
                    variant={variant}
                    recipe={recipe}
                    {...(onSelectRecipe === undefined ? {} : { onSelect: onSelectRecipe })}
                    {...(hrefOf === undefined ? {} : { href: hrefOf(recipe.id) })}
                    nutrition={renderNutrition?.(recipe.id)}
                />
            </li>
        ))}
    </ul>
);
