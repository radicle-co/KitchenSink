/**
 * @module @commise/features-recipes/import — `ImportLineList` (native): the React Native leaf of `./ImportLineList.tsx`,
 * on the same props and the same words (`importLineCopy.ts`). One open line expanded, every other open line a closed
 * 48 dp row naming its need, so the next choice is one tap within thumb reach; matched and chosen lines with Change; a
 * checking line with Use this and Search for a food; a late check result as one quiet sentence under the cook's pick.
 * Actions sit on their own line, so no label wraps inside a control at 320 dp. Nothing animates.
 *
 * ⚠️ RECONCILE AT MERGE with the paste flow's line list (the editor builder's, in parallel).
 *
 * @pattern Visitor — `LineRow` is an exhaustive switch over the `ImportLine` state union; the expanded line is chosen by
 *     the host's `expandedKey`, never by a mode flag
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { isNothingToFix } from './importLine.js';
import { candidatesOf, closedNeedOf, openPromptOf, pickTextOf } from './importLineCopy.js';
import { ImportLineOptions } from './ImportLineOptions.js';
import { importMessages } from './messages.js';
import type { ImportLineListProps, ImportLineRowProps, ImportOpenLineProps } from './props.js';

/** The one expanded line: its text, its prompt, its options. */
const OpenLine: FC<ImportOpenLineProps> = ({ line, onPick, onSearch }) => {
    const { line: m } = useMessages(importMessages);
    const { colors } = useTheme();
    const prompt = openPromptOf(line, m);

    return (
        <View style={styles.line}>
            <Text style={[styles.text, { color: colors.ink }]}>{line.text}</Text>
            {prompt === undefined ? null : <Text style={[styles.meta, { color: colors.inkMuted }]}>{prompt}</Text>}
            <ImportLineOptions
                lineText={line.text}
                candidates={candidatesOf(line)}
                pick={line.choice?.pick}
                onPick={(pick) => onPick(line.key, pick)}
                onSearch={() => onSearch(line.key)}
            />
        </View>
    );
};

/** A closed line, by its state. */
const LineRow: FC<ImportLineRowProps> = ({ line, onExpand, onUseProposal, onSearch, onSeeWhy }) => {
    const { line: m } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const text = <Text style={[styles.text, { color: colors.ink }]}>{line.text}</Text>;

    if (line.state === 'checking') {
        return (
            <View style={styles.line}>
                {text}
                <View style={styles.match}>
                    <Icon name="refreshCw" size={16} tone="actionText" />
                    <Text style={[styles.meta, styles.grow, { color: colors.ink }]}>{line.proposal}</Text>
                    <StatusBadge status="note">{m.checkingTag}</StatusBadge>
                </View>
                <View style={styles.actions}>
                    <Button
                        variant="ghost"
                        size="sm"
                        accessibilityLabel={fillTemplate(m.useThisName, { food: line.proposal, line: line.text })}
                        onPress={() => onUseProposal(line.key)}
                    >
                        {m.useThis}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="search"
                        accessibilityLabel={fillTemplate(m.searchName, { line: line.text })}
                        onPress={() => onSearch(line.key)}
                    >
                        {m.search}
                    </Button>
                </View>
            </View>
        );
    }

    const change = (
        <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={fillTemplate(m.changeName, { line: line.text })}
            onPress={() => onExpand(line.key)}
        >
            {m.change}
        </Button>
    );

    if (line.choice !== undefined) {
        const { pick, lateSuggestion } = line.choice;

        return (
            <View style={styles.line}>
                {text}
                <View style={styles.match}>
                    <Text style={[styles.meta, styles.grow, { color: colors.ink }]}>
                        {pickTextOf(pick, m)} · <Text style={{ color: colors.inkMuted }}>{m.yourChoice}</Text>
                    </Text>
                    {change}
                </View>
                {lateSuggestion === undefined ? null : (
                    <View style={styles.actions}>
                        <Text style={[styles.meta, { color: colors.inkMuted }]}>
                            {fillTemplate(m.lateSuggestion, { food: lateSuggestion })}
                        </Text>
                        <Button
                            variant="ghost"
                            size="sm"
                            accessibilityLabel={fillTemplate(m.seeWhyName, { food: lateSuggestion, line: line.text })}
                            onPress={() => onSeeWhy(line.key)}
                        >
                            {m.seeWhy}
                        </Button>
                    </View>
                )}
            </View>
        );
    }

    if (line.state === 'confident') {
        return (
            <View style={styles.line}>
                {text}
                <View style={styles.match}>
                    <Text style={[styles.meta, styles.grow, { color: colors.ink }]}>{line.food}</Text>
                    {change}
                </View>
            </View>
        );
    }

    return (
        <Pressable role="button" onPress={() => onExpand(line.key)} style={[styles.line, styles.closed]}>
            <View style={styles.grow}>
                {text}
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{closedNeedOf(line, m, locale)}</Text>
            </View>
            <Icon name="chevronRight" size={16} tone="inkMuted" />
        </Pressable>
    );
};

/** One imported recipe's lines, one open line expanded. */
export const ImportLineList: FC<ImportLineListProps> = ({ lines, expandedKey, onPick, ...rowHandlers }) => {
    const { wizard } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();

    return (
        <View style={styles.list}>
            {isNothingToFix(lines) ? (
                <Text style={[styles.body, { color: colors.inkMuted }]}>
                    {pluralOf(wizard.nothingToFix, lines.length, locale)}
                </Text>
            ) : null}
            {lines.map((line, index) => (
                <View
                    key={line.key}
                    style={index > 0 ? [styles.divided, { borderTopColor: colors.lineDivider }] : undefined}
                >
                    {line.key === expandedKey && line.state !== 'checking' ? (
                        <OpenLine line={line} onPick={onPick} onSearch={rowHandlers.onSearch} />
                    ) : (
                        <LineRow line={line} {...rowHandlers} />
                    )}
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: nativeTokens.spacing[2] },
    divided: { borderTopWidth: StyleSheet.hairlineWidth },
    line: { gap: nativeTokens.spacing[2], paddingVertical: nativeTokens.spacing[3] },
    closed: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
    text: nativeTokens.type.body,
    meta: nativeTokens.type.meta,
    body: nativeTokens.type.body,
    grow: { flex: 1, minWidth: 0 },
    match: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: nativeTokens.spacing[4] },
});
