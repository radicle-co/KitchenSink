/**
 * @module @commise/features-recipes/import — `ImportModeChoice` (native): the React Native leaf of
 * `./ImportModeChoice.tsx`, on the same props and the same words. The file, the three modes as one radio group of cards
 * with nothing preselected, then Start — disabled until the cook picks, full width so its label never wraps at 320 dp —
 * and its hint. At the wide container class (1194) the reassurance follows the choice.
 *
 * A frame of its own (U17): the file, the modes and the reassurance scroll; Start and its hint sit in a bar OUTSIDE the
 * scroll region, at the bottom, within thumb reach. At large text or on a short screen the bar would take the frame:
 * past half of it the bar becomes the scroll region's last item instead (`usePinnedFooter`,
 * `docs/design/compactHeightLayout.md` §3.1), the house rule the review wizard shares.
 *
 * Presentational: the host decides what Start does. Painted from the theme's roles, so it reads in both themes.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { useContainerClass, usePinnedFooter } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { RadioList } from '@commise/ui/radio-list';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { modeOfOptionId, modeOptionsOf } from './importMode.js';
import { importMessages } from './messages.js';
import type { ImportModeChoiceProps } from './props.js';

/** The mode choice before a bulk import. */
export const ImportModeChoice: FC<ImportModeChoiceProps> = ({
    fileName,
    sourceName,
    recipeCount,
    mode,
    onModeChange,
    onStart,
    starting = false,
}) => {
    const messages = useMessages(importMessages);
    const m = messages.mode;
    const locale = useLocale();
    const { colors } = useTheme();
    const wide = useContainerClass() === 'wide';
    const pinning = usePinnedFooter();

    const bar = (
        <View
            collapsable={false}
            onLayout={pinning.onFooterLayout}
            style={[styles.bar, { borderTopColor: colors.lineDivider, backgroundColor: colors.paper }]}
        >
            <Button icon="check" width="fill" disabled={mode === undefined} busy={starting} onPress={onStart}>
                {m.start}
            </Button>
            <Text style={[styles.meta, { color: colors.inkMuted }]}>{m.startHint}</Text>
        </View>
    );

    return (
        <View style={styles.frame} onLayout={pinning.onFrameLayout}>
            <ScrollView style={styles.grow} contentContainerStyle={styles.column} keyboardShouldPersistTaps="handled">
                <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                    {m.title}
                </Text>
                <View style={[styles.file, { borderColor: colors.lineDivider, backgroundColor: colors.paperRaised }]}>
                    <Icon name="bookOpen" size={20} />
                    <View style={styles.fileWords}>
                        <Text style={[styles.fileName, { color: colors.ink }]}>{fileName}</Text>
                        <Text style={[styles.meta, { color: colors.inkMuted }]}>
                            {fillTemplate(pluralOf(m.fileSummary, recipeCount, locale), { source: sourceName })}
                        </Text>
                    </View>
                </View>
                <Text style={[styles.body, { color: colors.inkMuted }]}>{m.intro}</Text>
                <RadioList
                    label={m.groupLabel}
                    options={modeOptionsOf(messages)}
                    value={mode}
                    onChange={(id) => {
                        const chosen = modeOfOptionId(id);

                        if (chosen !== undefined) {
                            onModeChange(chosen);
                        }
                    }}
                />
                {wide ? <Text style={[styles.meta, { color: colors.inkMuted }]}>{m.promise}</Text> : null}
                {pinning.unpinned ? bar : null}
            </ScrollView>
            {pinning.unpinned ? null : bar}
        </View>
    );
};

const styles = StyleSheet.create({
    frame: { flex: 1 },
    grow: { flex: 1 },
    column: { gap: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[4] },
    title: nativeTokens.type.largeTitle.narrow,
    file: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
    },
    fileWords: { flex: 1, minWidth: 0 },
    fileName: nativeTokens.type.cardTitle,
    body: nativeTokens.type.body,
    meta: nativeTokens.type.meta,
    bar: {
        gap: nativeTokens.spacing[2],
        paddingVertical: nativeTokens.spacing[3],
        borderTopWidth: StyleSheet.hairlineWidth,
    },
});
