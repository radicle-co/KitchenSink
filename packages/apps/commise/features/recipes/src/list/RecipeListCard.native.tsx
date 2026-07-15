/**
 * @module @commise/features-recipes — native recipe-list card (building block).
 *
 * The React Native leaf of {@link import('./RecipeListCard.js').RecipeListCard} — same contract, RN
 * primitives. Accessible button named by the recipe title plus the formatted total time.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { recipeMessages } from '../messages.js';
import { formatDurationMinutes, type RecipeListCardProps } from './model.js';

/**
 * A single recipe row on React Native. Styled to the Commise design language (@commise/ui palette): a
 * white rounded card with a display-weight title and a muted total-time line.
 *
 * @param props - The recipe view-model and the selection callback.
 */
export const RecipeListCard: FC<RecipeListCardProps> = ({ recipe, onSelect }) => {
    const { list } = useMessages(recipeMessages);
    const duration = formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={recipe.title}
            onPress={() => onSelect(recipe.id)}
            style={styles.card}
        >
            <Text style={styles.title}>{recipe.title}</Text>
            <Text style={styles.duration}>{duration}</Text>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        paddingVertical: 16,
        paddingHorizontal: 18,
        gap: 6,
    },
    title: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    duration: { fontSize: 13, color: palette.slate },
});
