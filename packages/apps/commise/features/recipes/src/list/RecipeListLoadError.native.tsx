/**
 * @module @commise/features-recipes — native recipe-list LOAD-ERROR fallback (presentational): what the list's error
 * boundary renders when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 *
 * It draws no create button: the frame does, outside the read boundary, so it shows here without this body (see
 * `shouldShowCreateButton`). So the alert scrolls and ends with that button's room (`FAB_RESERVED_BOTTOM_PX`), as the
 * list's cards and empty states do. The message is the design-system `Text` in the `body` role, so it grows to the 2x
 * text cap.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useFabReservedBottom } from '@commise/ui/create-fab';
import { nativeTokens } from '@commise/ui/native';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeListLoadErrorProps } from './model.js';

export const RecipeListLoadError: FC<RecipeListLoadErrorProps> = ({ onRetry }) => {
    const { list } = useMessages(recipeMessages);
    const fabRoom = useFabReservedBottom();

    return (
        // It scrolls, and ends with the floating button's room (designer ruling 2026-11-01): the frame keeps the button
        // here, and at a large text size the alert would otherwise run under it with no way to scroll it clear.
        <ScrollView contentContainerStyle={{ paddingBottom: fabRoom }} keyboardShouldPersistTaps="handled">
            <View collapsable={false} accessibilityRole="alert" style={styles.alert}>
                <Text typeRole="body" color="$ink">
                    {list.errorTitle}
                </Text>
                <Button variant="quiet" icon="refreshCw" onPress={onRetry}>
                    {list.retry}
                </Button>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    alert: { alignItems: 'flex-start', gap: nativeTokens.spacing[3], paddingVertical: nativeTokens.spacing[6] },
});
