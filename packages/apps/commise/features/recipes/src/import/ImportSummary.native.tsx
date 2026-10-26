/**
 * @module @commise/features-recipes/import — `ImportSummary` (native): the React Native leaf of `./ImportSummary.tsx`,
 * on the same words (`summaryCopy.ts`). Each row's action sits after its words and wraps under them at 320 dp rather
 * than squeezing them; Choose foods fills the width. The nutrition coverage follows at the wide container class (1194).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useContainerClass } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { importMessages } from './messages.js';
import type { ImportSummaryProps } from './props.js';
import { summaryCopyOf } from './summaryCopy.js';

/** One row of the summary: its headline, its detail, and its one action. */
const Row: FC<{ readonly title: string; readonly detail: string; readonly action?: ReactNode }> = ({
    title,
    detail,
    action,
}) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.row, { borderTopColor: colors.lineDivider }]}>
            <View style={styles.words}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{detail}</Text>
            </View>
            {action}
        </View>
    );
};

/** The end of a bulk import. */
export const ImportSummary: FC<ImportSummaryProps> = ({ onSeeAdded, onFixUnreadable, onChooseFoods, ...counts }) => {
    const { summary: s } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const wide = useContainerClass() === 'wide';
    const copy = summaryCopyOf(counts, s, locale);

    return (
        <View style={styles.column}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                {s.title}
            </Text>
            <Text style={[styles.body, { color: colors.inkMuted }]}>{copy.from}</Text>
            <View>
                <Row
                    title={copy.added}
                    detail={copy.breakdown}
                    action={
                        <Button variant="ghost" size="sm" onPress={onSeeAdded}>
                            {s.seeThem}
                        </Button>
                    }
                />
                {copy.alreadyHere === undefined ? null : <Row title={copy.alreadyHere} detail={s.alreadyHereHint} />}
                {copy.unreadable === undefined ? null : (
                    <Row
                        title={copy.unreadable.title}
                        detail={copy.unreadable.titles}
                        action={
                            <Button variant="ghost" size="sm" onPress={onFixUnreadable}>
                                {s.fix}
                            </Button>
                        }
                    />
                )}
            </View>
            {copy.asWritten === undefined ? null : (
                <View style={[styles.asWritten, { backgroundColor: colors.surfaceMuted }]}>
                    <Text style={[styles.body, { color: colors.ink }]}>{copy.asWritten}</Text>
                    <Button variant="secondary" icon="search" width="fill" onPress={onChooseFoods}>
                        {s.chooseFoods}
                    </Button>
                </View>
            )}
            {wide ? (
                <View style={[styles.coverage, { borderColor: colors.lineDivider }]}>
                    <Text style={[styles.label, { color: colors.inkMuted }]}>{s.coverageTitle}</Text>
                    <Text style={[styles.stat, { color: colors.ink }]}>{copy.coverage}</Text>
                    <Text style={[styles.meta, { color: colors.inkMuted }]}>{s.coverageHint}</Text>
                </View>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    column: { gap: nativeTokens.spacing[4] },
    title: nativeTokens.type.largeTitle.narrow,
    body: nativeTokens.type.body,
    meta: nativeTokens.type.meta,
    label: nativeTokens.type.label,
    stat: nativeTokens.type.figureStat,
    rowTitle: nativeTokens.type.cardTitle,
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    words: { flexShrink: 1, minWidth: 0 },
    asWritten: { gap: nativeTokens.spacing[2], padding: nativeTokens.spacing[4], borderRadius: nativeTokens.radius.md },
    coverage: {
        gap: nativeTokens.spacing[1],
        padding: nativeTokens.spacing[4],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
    },
});
