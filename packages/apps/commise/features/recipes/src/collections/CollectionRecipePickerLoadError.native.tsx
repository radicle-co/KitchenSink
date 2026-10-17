/**
 * @module @commise/features-recipes — the native add-recipes picker body when the caller's recipes failed to load, the
 * twin of the web leaf: the failure and a Try again, with the frame (the search field, Done) still around it. The message
 * is an assertive `LiveRegion` — `accessibilityRole="alert"` alone is silent on iOS. Colour is read from the theme (D15).
 *
 * Presentational: it sends nothing; the host retries.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerLoadErrorProps } from './model.js';

export const CollectionRecipePickerLoadError: FC<CollectionRecipePickerLoadErrorProps> = ({ onRetry }) => {
    const { picker } = useMessages(collectionMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.stack}>
            <LiveRegion politeness="assertive" style={[styles.title, { color: colors.ink }]}>
                {picker.errorTitle}
            </LiveRegion>
            <Button variant="secondary" icon="rotateCcw" onPress={onRetry}>
                {picker.retry}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { alignItems: 'flex-start', gap: nativeTokens.spacing[3], paddingVertical: nativeTokens.spacing[6] },
    title: { ...nativeTokens.type.body },
});
