/**
 * @module @commise/features-recipes/form — `IngredientsNutritionTotal` (native): the Ingredients section's running
 * total (build spec §7.5.6). The React Native leaf of `./IngredientsNutritionTotal.tsx`. Loading is a still placeholder
 * named for the screen reader (no pulse, so reduced motion has nothing to stop), never a partial figure.
 *
 * Presentational: `props → JSX` over the total's view (`nutritionTotalViewOf`).
 *
 * @pattern Visitor — an exhaustive `switch` over the total's view
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { IngredientsNutritionTotalProps } from './IngredientsNutritionTotal.js';

/** The running total. */
export const IngredientsNutritionTotal: FC<IngredientsNutritionTotalProps> = ({
    view,
    loadingLabel,
    failedText,
    retryLabel,
    onRetry,
}): ReactElement => {
    const { colors } = useTheme();

    switch (view.kind) {
        case 'loading':
            return (
                <View accessible accessibilityLabel={loadingLabel} style={styles.stack}>
                    <View aria-hidden style={[styles.bar, { backgroundColor: colors.surfaceMuted }]} />
                </View>
            );
        case 'failed':
            return (
                <View style={styles.stack}>
                    <Text style={[styles.caption, { color: colors.inkMuted }]}>{failedText}</Text>
                    {onRetry !== undefined && (
                        <View style={styles.action}>
                            <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                                {retryLabel}
                            </Button>
                        </View>
                    )}
                </View>
            );
        case 'ready':
            return (
                <View style={styles.stack}>
                    <Text style={[styles.line, { color: colors.ink }]}>{view.line}</Text>
                    {view.rangeNotice !== undefined && (
                        <Text style={[styles.caption, { color: colors.inkMuted }]}>{view.rangeNotice}</Text>
                    )}
                </View>
            );
    }
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[1] },
    // Sized to the line it stands in for, so the foot keeps its shape when the figure lands.
    bar: { width: 192, maxWidth: '100%', height: 16, borderRadius: nativeTokens.radius.sm },
    line: { ...nativeTokens.type.label, fontVariant: ['tabular-nums'] },
    caption: { ...nativeTokens.type.caption },
    action: { flexDirection: 'row' },
});
