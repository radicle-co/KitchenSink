/**
 * @module @commise/features-recipes — native discovery LOAD ERROR body (presentational).
 *
 * The React Native twin of `RecipeDiscoveryLoadError`: a card with the surface's only Try again, at the 44pt floor every
 * other control on the surface carries, when a search failed with nothing loaded for it. The message is an assertive
 * `LiveRegion` — `accessibilityRole="alert"` alone is silent on iOS — and the card matches the web body's treatment.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryLoadErrorProps } from './model.js';

export const RecipeDiscoveryLoadError: FC<RecipeDiscoveryLoadErrorProps> = ({ onRetry }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <View style={styles.card}>
            <LiveRegion politeness="assertive" style={styles.title}>
                {discovery.errorTitle}
            </LiveRegion>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={discovery.retry}
                onPress={onRetry}
                style={styles.retry}
            >
                <Text style={styles.retryLabel}>{discovery.retry}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        padding: nativeTokens.spacing[5],
        gap: nativeTokens.spacing[2],
    },
    title: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '500', color: palette.charcoal },
    retry: {
        minHeight: 44,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: nativeTokens.spacing[4],
    },
    retryLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
});
