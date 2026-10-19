/**
 * @module @commise/features-recipes — native recipe-list LOAD-ERROR fallback (presentational): what the list's error
 * boundary renders when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 *
 * It draws no create button: the frame does, outside the read boundary, so it shows here without this body (see
 * `shouldShowCreateButton`).
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeListLoadErrorProps } from './model.js';

export const RecipeListLoadError: FC<RecipeListLoadErrorProps> = ({ onRetry }) => {
    const { list } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <View collapsable={false} accessibilityRole="alert" style={styles.alert}>
            <Text style={[styles.body, { color: colors.ink }]}>{list.errorTitle}</Text>
            <Button variant="secondary" icon="rotateCcw" onPress={onRetry}>
                {list.retry}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    alert: { alignItems: 'flex-start', gap: nativeTokens.spacing[3], paddingVertical: nativeTokens.spacing[6] },
    body: { ...nativeTokens.type.body },
});
