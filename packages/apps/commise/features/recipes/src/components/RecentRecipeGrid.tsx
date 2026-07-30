/**
 * @module @commise/features-recipes — web "Recent recipes" card GRID (Home widget building block).
 *
 * The mockup (`docs/mockups/screens/screen-home.html`, the "Recent Recipes" section) lays the recent recipes
 * out as a `grid grid-cols-2 md:grid-cols-4 gap-4` of tappable cards — NOT the vertical stack the widget shell
 * used to produce by rendering its children in a column. That layout is one piece of knowledge, so it lives in
 * this one leaf rather than being inlined into the widget: the shell stays a titled section with a content
 * slot (its single responsibility), and this owns the arrangement (its single responsibility).
 *
 * Pure `props → JSX`: no fetching, no navigation, no state. It threads the caller's `onSelectRecipe` down so
 * each cell reports ITS OWN recipe id upward, and the composing host — the only layer that knows the router —
 * turns that into a route.
 */
import type { FC } from 'react';

import { RecentRecipeItem } from './RecentRecipeItem.js';
import type { RecentRecipeGridProps } from './props.js';

/**
 * The recent-recipes card grid: 2-up on phones, 4-up from `md` (mockup parity). An empty `recipes` list
 * renders an empty grid — the widget's orchestration layer selects the dedicated empty-state component
 * instead, so this leaf never has to invent a placeholder card.
 */
export const RecentRecipeGrid: FC<RecentRecipeGridProps> = ({ recipes, onSelectRecipe }) => (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {recipes.map((recipe) => (
            <li key={recipe.id}>
                {/* `onSelect` is forwarded only when the host gave us one, so a destination-less surface
                    renders inert cards rather than buttons that do nothing. */}
                {onSelectRecipe === undefined ? (
                    <RecentRecipeItem recipe={recipe} />
                ) : (
                    <RecentRecipeItem recipe={recipe} onSelect={onSelectRecipe} />
                )}
            </li>
        ))}
    </ul>
);
