/**
 * @module @commise/features-recipes — native compare sheet (build spec §6.6): the mirror of `VersionCompareView.tsx`,
 * on the shared `FullScreenSheet`, which owns the modal window and its safe-area padding. It lists the caller's
 * `compareWithCurrent` diff: each changed field or element with what the version said and what the recipe says now,
 * "None" where one side has no such element, or one line when they match. Colours come from the theme at render.
 *
 * @pattern Composition over the shared `FullScreenSheet` Decorator, which owns the modal window and its safe-area padding
 */
import { useMessages } from '@commise/i18n/react';
import { FullScreenSheet } from '@commise/ui/full-screen-sheet';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { compareRowsOf, type VersionCompareViewProps } from './compare.js';
import { recipeVersionMessages } from './messages.js';

/** The native compare sheet. */
export const VersionCompareView: FC<VersionCompareViewProps> = ({ open, version, diff, onClose }) => {
    const { compare, conflict } = useMessages(recipeVersionMessages);
    const { colors } = useTheme();

    if (!open) {
        return null;
    }

    const versionNumber = version?.versionNumber ?? 0;
    const heading = fillTemplate(compare.title, { version: versionNumber });
    const rows = diff === undefined ? [] : compareRowsOf(diff, conflict);
    const ink = { color: colors.ink };
    const muted = { color: colors.inkMuted };

    return (
        <FullScreenSheet label={heading} onRequestClose={onClose}>
            <>
                <View style={styles.header}>
                    <Text accessibilityRole="header" style={[styles.title, ink]}>
                        {heading}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={compare.close}
                        onPress={onClose}
                        style={styles.close}
                    >
                        <Icon name="x" size={24} tone="inkMuted" />
                    </Pressable>
                </View>
                <ScrollView contentContainerStyle={styles.content}>
                    {rows.length === 0 ? (
                        <Text style={[styles.body, muted]}>{compare.noChanges}</Text>
                    ) : (
                        rows.map((row) => (
                            <View key={row.key} style={[styles.row, { borderBottomColor: colors.lineDivider }]}>
                                <Text style={[styles.label, ink]}>{row.label}</Text>
                                <Text style={[styles.caption, muted]}>
                                    {fillTemplate(compare.wasLabel, { version: versionNumber })}
                                </Text>
                                <Text style={[styles.meta, ink]}>{row.was === '' ? compare.noValue : row.was}</Text>
                                <Text style={[styles.caption, muted]}>{compare.nowLabel}</Text>
                                <Text style={[styles.meta, ink]}>{row.now === '' ? compare.noValue : row.now}</Text>
                            </View>
                        ))
                    )}
                </ScrollView>
            </>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    title: { ...nativeTokens.type.sectionTitle, flex: 1 },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[6] },
    row: { gap: 2, paddingVertical: nativeTokens.spacing[3], borderBottomWidth: StyleSheet.hairlineWidth },
    label: { ...nativeTokens.type.label, marginBottom: nativeTokens.spacing[1] },
    caption: { ...nativeTokens.type.caption },
    meta: { ...nativeTokens.type.meta },
    body: { ...nativeTokens.type.body },
});
