/**
 * @module @commise/features-recipes — native discovery LOAD ERROR body (presentational; slice 5 of the UI overhaul).
 *
 * The React Native twin of `RecipeDiscoveryLoadError`: "We couldn't search right now." and a Try again under the field,
 * for any cause, with the results that were on screen before the failure kept under it (`previous`). The message is an
 * assertive `LiveRegion` — `accessibilityRole="alert"` alone is silent on iOS. Colour is read from the theme at render (D15).
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryLoadErrorProps } from './model.js';

export const RecipeDiscoveryLoadError: FC<RecipeDiscoveryLoadErrorProps> = ({ onRetry, previous }) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.stack}>
            <View style={styles.row}>
                <LiveRegion politeness="assertive" style={[styles.title, { color: colors.ink }]}>
                    {discovery.errorTitle}
                </LiveRegion>
                <Button variant="secondary" size="sm" icon="rotateCcw" onPress={onRetry}>
                    {discovery.retry}
                </Button>
            </View>
            {previous}
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { flex: 1, gap: nativeTokens.spacing[4] },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[3] },
    title: { ...nativeTokens.type.body },
});
