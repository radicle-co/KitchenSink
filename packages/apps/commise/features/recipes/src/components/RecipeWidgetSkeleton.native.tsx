/**
 * @module @commise/features-recipes — native recipe-widget loading skeleton (building block).
 */

import type { FC } from 'react';
import { palette } from '@commise/ui';
import { StyleSheet, View } from 'react-native';

import { MAX_RECENT_RECIPES, type RecipeWidgetSkeletonProps } from './props.js';

/**
 * Loading placeholder for the recipe Home widget on React Native. Hidden from assistive tech so the placeholder
 * rows are not announced.
 *
 * The hiding is spelled `aria-hidden` rather than RN's `accessibilityElementsHidden` +
 * `importantForAccessibility="no-hide-descendants"`. The forms are equivalent on device — React Native's `View`
 * reverse-maps `aria-hidden` onto both of them — but react-native-web translates the legacy pair to NO DOM
 * attribute, so the ARIA spelling is the only one the native component tier can actually assert. It matches the
 * web leaf's `aria-hidden` too, which is one fewer way for the two platforms to drift.
 */
export const RecipeWidgetSkeleton: FC<RecipeWidgetSkeletonProps> = ({ itemCount = MAX_RECENT_RECIPES }) => {
    const placeholders = Array.from({ length: itemCount }, (_unused, index) => index);

    return (
        <View aria-hidden style={styles.wrap}>
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
