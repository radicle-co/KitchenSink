/**
 * @module @commise/features-recipes — web recipe-list card (building block).
 *
 * One card in the recipe list: the shared mockup-parity {@link RecipeCard} in its actionable form (an
 * article containing a button named by the recipe title that reports the recipe id upward). Presentational —
 * it holds no state.
 */
import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import type { RecipeListCardProps } from './model.js';

/**
 * A single recipe card on web.
 *
 * @param props - The recipe view-model and the selection callback.
 */
export const RecipeListCard: FC<RecipeListCardProps> = ({ recipe, onSelect, nutrition }) => (
    <RecipeCard recipe={recipe} onSelect={onSelect} nutrition={nutrition} />
);
