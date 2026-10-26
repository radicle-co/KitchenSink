/**
 * @module @commise/features-recipes/import — `ImportModeChoice` (native): the React Native leaf of
 * `./ImportModeChoice.tsx`, on the same props and the same words. The file, the three modes as one radio group of cards
 * with nothing preselected, then Start — disabled until the cook picks, full width so its label never wraps at 320 dp —
 * and its hint. At the wide container class (1194) the reassurance follows the choice.
 *
 * Presentational: a column for the host's scroll view. Painted from the theme's roles, so it reads in both themes.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { useContainerClass } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { RadioList } from '@commise/ui/radio-list';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
    const { mode: m } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const wide = useContainerClass() === 'wide';

    return (
        <View style={styles.column}>
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
                look="cards"
                options={modeOptionsOf(m)}
                value={mode}
                onChange={(id) => {
                    const chosen = modeOfOptionId(id);

                    if (chosen !== undefined) {
                        onModeChange(chosen);
                    }
                }}
            />
            <View style={styles.start}>
                <Button icon="check" width="fill" disabled={mode === undefined} busy={starting} onPress={onStart}>
                    {m.start}
                </Button>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{m.startHint}</Text>
            </View>
            {wide ? <Text style={[styles.meta, { color: colors.inkMuted }]}>{m.promise}</Text> : null}
        </View>
    );
};

const styles = StyleSheet.create({
    column: { gap: nativeTokens.spacing[4] },
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
    start: { gap: nativeTokens.spacing[2] },
});
