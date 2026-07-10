/**
 * @module @commise/features-recipes — native recent-recipe row (skeleton building block).
 */

import type { FC } from 'react';
import { Text, View } from 'react-native';

import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe row on React Native. Accessible label is the recipe title.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe }) => {
    return (
        <View accessibilityLabel={recipe.title}>
            <Text>{recipe.title}</Text>
        </View>
    );
};
