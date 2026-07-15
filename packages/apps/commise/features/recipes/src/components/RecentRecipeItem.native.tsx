/**
 * @module @commise/features-recipes — native recent-recipe row (skeleton building block).
 */

import type { FC } from 'react';
import { palette } from '@commise/ui';
import { StyleSheet, Text, View } from 'react-native';

import type { RecentRecipeItemProps } from './props.js';

/**
 * A single recent-recipe row on React Native. Accessible label is the recipe title.
 */
export const RecentRecipeItem: FC<RecentRecipeItemProps> = ({ recipe }) => {
    return (
        <View accessibilityLabel={recipe.title} style={styles.row}>
            <Text style={styles.title}>{recipe.title}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(178, 190, 195, 0.2)' },
    title: { fontSize: 15, fontWeight: '500', color: palette.charcoal },
});
