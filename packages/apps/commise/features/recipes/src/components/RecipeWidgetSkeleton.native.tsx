/**
 * @module @commise/features-recipes — native recipe-widget loading skeleton (building block).
 */

import type { FC } from 'react';
import { View } from 'react-native';

import { MAX_RECENT_RECIPES, type RecipeWidgetSkeletonProps } from './props.js';

/**
 * Loading placeholder for the recipe Home widget on React Native. Hidden from
 * assistive tech so the placeholder rows are not announced.
 */
export const RecipeWidgetSkeleton: FC<RecipeWidgetSkeletonProps> = ({ itemCount = MAX_RECENT_RECIPES }) => {
    const placeholders = Array.from({ length: itemCount }, (_unused, index) => index);

    return (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {placeholders.map((key) => (
                <View key={key} />
            ))}
        </View>
    );
};
