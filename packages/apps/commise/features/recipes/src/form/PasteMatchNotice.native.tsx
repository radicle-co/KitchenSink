/**
 * @module @commise/features-recipes/form — `PasteMatchNotice` (native): the React Native leaf of
 * `./PasteMatchNotice.tsx`, on the same props and words (`pasteMatchNoticeOf`). On a device the choices are saved on the
 * device. A polite `status` live region (U9), as the web leaf, under the same host rule. Painted from the theme's roles
 * (D15).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeFormMessages } from './messages.js';
import type { PasteMatchNoticeProps } from './pasteMatchNoticeProps.js';
import { pasteMatchNoticeOf } from './pasteMatchView.js';

/** The notice above the pasted lines. */
export const PasteMatchNotice: FC<PasteMatchNoticeProps> = ({ notice }) => {
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const { colors } = useTheme();

    return (
        <View
            collapsable={false}
            role="status"
            accessibilityLiveRegion="polite"
            aria-live="polite"
            style={[styles.notice, { backgroundColor: colors.surfaceMuted }]}
        >
            <Icon name="info" size={20} tone="inkMuted" />
            <Text style={[styles.text, { color: colors.ink }]}>{pasteMatchNoticeOf(notice, m, locale)}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    notice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    text: { ...nativeTokens.type.list, flex: 1, minWidth: 0 },
});
