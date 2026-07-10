/**
 * @module @commise/features-recipes — web recipe-widget empty state (building block).
 */

import type { FC } from 'react';

import type { RecipeWidgetEmptyStateProps } from './props.js';

const DEFAULT_EMPTY_MESSAGE = 'No recipes yet. Create your first recipe to see it here.';

/**
 * Empty state for the **live** recipe widget when the viewer has no recipes yet.
 * (An absent/gated widget renders nothing at all — this is not that case.)
 */
export const RecipeWidgetEmptyState: FC<RecipeWidgetEmptyStateProps> = ({ message = DEFAULT_EMPTY_MESSAGE }) => {
    return <p>{message}</p>;
};
