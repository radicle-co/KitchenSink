/**
 * @module @commise/features-recipes — native notice for a failed save of the library's grid/list choice
 * (presentational). Mirrors `ViewSaveFailedNotice.tsx`: the view has already gone back to what it was, and this says so.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import { recipeMessages } from '../messages.js';

/**
 * Says the cook's grid/list choice was not saved; the view has already gone back to what it was. An alert, so it is
 * announced without moving focus. The host renders it only while the save is failed.
 *
 * @returns The notice.
 */
export const ViewSaveFailedNotice: FC = () => {
    const { list } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <Text role="alert" style={[styles.text, { color: colors.dangerText }]}>
            {list.viewSaveFailed}
        </Text>
    );
};

const styles = StyleSheet.create({
    text: { ...nativeTokens.type.meta },
});
