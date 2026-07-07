/**
 * @module @commise/features-recipes — native recipe-widget card shell (skeleton building block).
 */

import type { FC } from 'react';
import { Text, View } from 'react-native';

import type { RecipeWidgetCardProps } from './props.js';

/**
 * Card container for the recipe Home widget on React Native. The accessible label
 * is the widget title, matching the web implementation's heading semantics.
 */
export const RecipeWidgetCard: FC<RecipeWidgetCardProps> = ({ title, children }) => {
    return (
        <View accessibilityRole="summary" accessibilityLabel={title}>
            <Text accessibilityRole="header">{title}</Text>
            {children}
        </View>
    );
};
