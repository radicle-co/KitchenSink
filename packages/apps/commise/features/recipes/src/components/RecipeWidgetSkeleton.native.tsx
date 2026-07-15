/**
 * @module @commise/features-recipes — native recipe-widget loading skeleton (building block).
 */

import type { FC } from 'react';
import { palette } from '@commise/ui';
import { StyleSheet, View } from 'react-native';

import { MAX_RECENT_RECIPES, type RecipeWidgetSkeletonProps } from './props.js';

/**
 * Loading placeholder for the recipe Home widget on React Native. Hidden from
 * assistive tech so the placeholder rows are not announced.
 */
export const RecipeWidgetSkeleton: FC<RecipeWidgetSkeletonProps> = ({ itemCount = MAX_RECENT_RECIPES }) => {
    const placeholders = Array.from({ length: itemCount }, (_unused, index) => index);

    return (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.wrap}>
            {placeholders.map((key) => (
                <View key={key} style={styles.row} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    wrap: { gap: 8 },
    row: { height: 32, borderRadius: 8, backgroundColor: palette.pearl },
});
