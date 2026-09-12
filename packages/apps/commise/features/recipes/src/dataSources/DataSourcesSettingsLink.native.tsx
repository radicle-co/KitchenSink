/**
 * @module @commise/features-recipes/dataSources — native settings WAY IN to the Data sources sheet (presentational;
 * design §S16).
 *
 * The React Native twin of `DataSourcesSettingsLink.tsx`: a section headed "Food data", one line on what the page
 * holds, and a link titled with the page's name. Native has no router, so the link opens the sheet the host mounts,
 * through `onOpen`; it goes in account settings before the danger zone, which stays last.
 *
 * @pattern Adapter over React Native's accessibility focus API — the link takes the reading cursor back when the host's
 *     close count changes (`useScreenReaderFocusOnSignal`), because React Native cannot read where the cursor was
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesSettingsLinkNativeProps } from './model.js';

/**
 * The settings section that opens the Data sources sheet (native).
 *
 * @param props - What opening the sheet does.
 * @returns The section.
 */
export const DataSourcesSettingsLink: FC<DataSourcesSettingsLinkNativeProps> = ({ onOpen, returnFocusSignal = 0 }) => {
    const messages = useMessages(dataSourcesMessages);
    const linkRef = useScreenReaderFocusOnSignal<View>(returnFocusSignal);

    return (
        <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
                {messages.settingsHeading}
            </Text>
            <Text style={styles.summary}>{messages.settingsSummary}</Text>
            <Pressable ref={linkRef} accessibilityRole="link" onPress={onOpen} style={styles.linkTouch}>
                <Text style={styles.link}>{messages.title}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[1] },
    heading: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    summary: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    // 48 dp: a link on its own row, never a target too small to tap (§S15).
    linkTouch: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
    // Contrast (WCAG AA): `ocean-dark` is 6.20:1 on the page surface. Underlined, so the affordance is not colour alone.
    link: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '500',
        color: palette['ocean-dark'],
        textDecorationLine: 'underline',
    },
});
