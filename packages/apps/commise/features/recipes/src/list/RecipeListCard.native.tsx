/**
 * @module @commise/features-recipes — native recipe-list card (building block).
 *
 * The React Native leaf of {@link import('./RecipeListCard.js').RecipeListCard} — same contract, RN
 * primitives. Accessible button named by the recipe title plus the formatted total time.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { formatDurationMinutes, type RecipeListCardProps } from './model.js';

/**
 * A single recipe row on React Native.
 *
 * @param props - The recipe view-model and the selection callback.
 */
export const RecipeListCard: FC<RecipeListCardProps> = ({ recipe, onSelect }) => {
    const { list } = useMessages(recipeMessages);
    const duration = formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes);

    return (
        <View>
            <Pressable accessibilityRole="button" accessibilityLabel={recipe.title} onPress={() => onSelect(recipe.id)}>
                <Text>{recipe.title}</Text>
            </Pressable>
            <Text>{duration}</Text>
        </View>
    );
};
