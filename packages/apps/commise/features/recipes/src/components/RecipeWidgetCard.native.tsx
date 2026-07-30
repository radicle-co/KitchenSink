/**
 * @module @commise/features-recipes — native recipe-widget card shell (skeleton building block).
 */

import type { FC } from 'react';
import { palette } from '@commise/ui';
import { StyleSheet, Text, View } from 'react-native';

import type { RecipeWidgetCardProps } from './props.js';

/**
 * Card container for the recipe Home widget on React Native. The accessible label
 * is the widget title, matching the web implementation's heading semantics.
 */
export const RecipeWidgetCard: FC<RecipeWidgetCardProps> = ({ title, children }) => {
    return (
        <View accessibilityRole="summary" accessibilityLabel={title} style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
                {title}
            </Text>
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 8,
    },
    title: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
});
