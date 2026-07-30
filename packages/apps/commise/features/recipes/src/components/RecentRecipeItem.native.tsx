/**
 * @module @commise/features-recipes — native recent-recipe card for the Home widget.
 *
 * The RN leaf of {@link import('./RecentRecipeItem.js').RecentRecipeItem}: renders the shared mockup-parity
 * {@link RecipeCard}. The stars stay display-only (these are the viewer's own recent recipes), while the card
 * itself is tappable through to the recipe detail when the host supplies `onSelect` — the same navigation seam
 * the web leaf honours, so the two platforms present the same affordance.
 */

import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe card on React Native. Accessible content is the recipe title, time, servings,
 * difficulty, and rating. Actionable when `onSelect` is given; inert otherwise.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe, onSelect }) =>
    onSelect === undefined ? <RecipeCard recipe={recipe} /> : <RecipeCard recipe={recipe} onSelect={onSelect} />;
