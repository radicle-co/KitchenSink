/**
 * @module @commise/features-recipes — web recent-recipe card for the Home widget.
 *
 * Renders the shared mockup-parity {@link RecipeCard} (4:3 cover + PRO badge, title, time · servings ·
 * difficulty, display-only stars). Non-interactive here: the widget shows the viewer's OWN recent recipes,
 * so the stars are display-only and there is no in-widget rating action.
 */

import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe card on web. Accessible name is the recipe title.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe }) => <RecipeCard recipe={recipe} />;
