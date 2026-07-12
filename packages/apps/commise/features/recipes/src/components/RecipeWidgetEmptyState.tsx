/**
 * @module @commise/features-recipes — web recipe-widget empty state (building block).
 */

import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetEmptyStateProps } from './props.js';

/**
 * Empty state for the **live** recipe widget when the viewer has no recipes yet.
 * (An absent/gated widget renders nothing at all — this is not that case.)
 */
export const RecipeWidgetEmptyState: FC<RecipeWidgetEmptyStateProps> = ({ message = recipeMessages.emptyState }) => {
    return <p>{message}</p>;
};
