/**
 * @module @commise/features-recipes — web recent-recipe card for the Home widget.
 *
 * Renders the shared mockup-parity {@link RecipeCard} (4:3 cover + PRO badge, title, time · servings ·
 * difficulty, display-only stars). The stars stay display-only — the widget shows the viewer's OWN recent
 * recipes, so there is no in-widget rating action — but the CARD is tappable through to the recipe detail
 * (mockup `screen-home`: `cursor-pointer` cards) whenever the host supplies `onSelect`.
 *
 * Pure `props → JSX`: it performs no navigation of its own, it forwards the activated recipe's id to
 * `onSelect` and lets the composing host route.
 */

import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe card on web. Accessible name is the recipe title. Actionable (a button) when
 * `onSelect` is given; a non-interactive article otherwise.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe, onSelect }) =>
    onSelect === undefined ? <RecipeCard recipe={recipe} /> : <RecipeCard recipe={recipe} onSelect={onSelect} />;
