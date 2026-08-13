/**
 * @module @commise/features-recipes — native recipe-list card (building block).
 *
 * The React Native leaf of `RecipeListCard` — same contract, RN
 * primitives. Renders the shared mockup-parity {@link RecipeCard} as a Pressable named by the recipe title.
 */
import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import type { RecipeListCardProps } from './model.js';

/**
 * A single recipe card on React Native.
 *
 * @param props - The recipe view-model and the selection callback.
 */
export const RecipeListCard: FC<RecipeListCardProps> = ({ recipe, onSelect }) => (
    <RecipeCard recipe={recipe} onSelect={onSelect} />
);
