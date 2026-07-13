/**
 * @module @commise/features-recipes — native recipe-widget empty state (building block).
 */

import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Text } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetEmptyStateProps } from './props.js';

/**
 * Empty state for the **live** recipe widget on React Native when the viewer has
 * no recipes yet. An absent/gated widget renders nothing at all — this is not that
 * case.
 */
export const RecipeWidgetEmptyState: FC<RecipeWidgetEmptyStateProps> = ({ message }) => {
    const messages = useMessages(recipeMessages);

    return <Text>{message ?? messages.emptyState}</Text>;
};
