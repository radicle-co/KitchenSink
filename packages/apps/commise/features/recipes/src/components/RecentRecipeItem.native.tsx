/**
 * @module @commise/features-recipes — native recent-recipe card for the Home widget.
 *
 * The RN leaf of {@link import('./RecentRecipeItem.js').RecentRecipeItem}: renders the shared mockup-parity
 * {@link RecipeCard}. Non-interactive (display-only stars) — these are the viewer's own recent recipes.
 */

import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe card on React Native. Accessible content is the recipe title, time, servings,
 * difficulty, and rating.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe }) => <RecipeCard recipe={recipe} />;
