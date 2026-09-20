/**
 * @module @commise/features-recipes — native browse-rail LOAD ERROR body (presentational, U7).
 *
 * The React Native twin of `RecipeBrowseRailLoadError`: the rail's short failure note and a 44pt Try again that retries
 * only this rail. The note is an assertive `LiveRegion`, so a retry that fails again is spoken on iOS as well as Android
 * (`accessibilityRole="alert"` alone is silent on iOS).
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { discoveryMessages } from './messages.js';
import type { RecipeBrowseRailLoadErrorProps } from './model.js';

export const RecipeBrowseRailLoadError: FC<RecipeBrowseRailLoadErrorProps> = ({ onRetry }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <View style={styles.row}>
            <LiveRegion politeness="assertive" style={styles.note}>
                {discovery.railError}
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
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    note: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    retryLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
});
