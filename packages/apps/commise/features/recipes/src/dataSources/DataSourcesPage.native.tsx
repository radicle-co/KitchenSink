/**
 * @module @commise/features-recipes/dataSources — native Data sources PAGE, a full-screen sheet (presentational; plan
 * R55, design §S16, §S18).
 *
 * The React Native twin of `DataSourcesPage.tsx`. Native has no router (`AppRoot` is a `useState` switch), and a sheet
 * returns the cook to the same place they opened it from, so the page is a `FullScreenSheet` on this platform: its
 * title and a 48 × 48 Close at the top end, then the two intro sentences and the read's state, which the host passes
 * as `children`, in one scrolling column. Close and Android back both reach `onRequestClose`, the sheet's one way out.
 *
 * Focus (§S16): once the sheet is presented, the reading cursor moves to the title, and again when
 * `headingFocusSignal` advances (a retry that took Try again away). Returning it to the control that opened the sheet
 * is the host's.
 *
 * @pattern Adapter over `FullScreenSheet` — the title takes the reading cursor on `Modal.onShow`, the one moment a
 *     native modal is on screen (a mount effect runs before it is)
 */
import { Icon } from '@commise/ui/icon';
import { useMessages } from '@commise/i18n/react';
import { FullScreenSheet } from '@commise/ui/full-screen-sheet';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesPageNativeProps } from './model.js';

/**
 * The page as a full-screen sheet (native): its title and Close, the two intro sentences, then the read's state.
 *
 * @param props - The read's state, and the sheet's one way out.
 * @returns The sheet.
 */
export const DataSourcesPage: FC<DataSourcesPageNativeProps> = ({ onRequestClose, children, headingFocusSignal }) => {
    const messages = useMessages(dataSourcesMessages);
    const { colors } = useTheme();
    const [shown, setShown] = useState(0);
    // Either moment moves the cursor, so the two counters are one signal.
    const titleRef = useScreenReaderFocusOnSignal<Text>(shown + headingFocusSignal);

    return (
        <FullScreenSheet
            label={messages.title}
            onRequestClose={onRequestClose}
            onShow={() => setShown((count) => count + 1)}
        >
            <View style={styles.header}>
                <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                    {messages.title}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.close}
                    onPress={onRequestClose}
                    style={styles.close}
                >
                    <Icon name="x" size={24} tone="ink" />
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.body}>
                <Text style={[styles.intro, { color: colors.ink }]}>{messages.intro}</Text>
                <Text style={[styles.note, { color: colors.inkMuted }]}>{messages.closeMatchNote}</Text>
                {children}
            </ScrollView>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    title: {
        flex: 1,
        fontFamily: nativeTokens.fontFace.display.semibold,
        fontSize: nativeTokens.fontSize.headingMd,
    },
    // 48 × 48 dp: the sheet's only visible exit must be easy to hit (§S16).
    close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    body: { gap: nativeTokens.spacing[3], paddingBottom: nativeTokens.spacing[4] },
    intro: { fontSize: nativeTokens.fontSize.bodyMd },
    note: { fontSize: nativeTokens.fontSize.bodyMd },
});
