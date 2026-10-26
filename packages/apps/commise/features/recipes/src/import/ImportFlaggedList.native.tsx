/**
 * @module @commise/features-recipes/import — `ImportFlaggedList` (native): the React Native leaf of
 * `./ImportFlaggedList.tsx`, on the same words. Each row's Use and Search sit on their own line under the doubt and wrap
 * rather than squeeze, so neither label wraps inside its control at 320 dp; each keeps the 44 pt touch floor. Below the
 * wide container class Search opens the options sheet (the host's); at it (1194) the options pane stands beside the list.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useContainerClass } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { matchLineMessages } from '../ingredientMatching/messages.js';
import { importMessages } from './messages.js';
import type { ImportFlaggedListProps } from './props.js';

/** The pane's width beside the list at the wide class, dp. */
const PANE_WIDTH = 384;

/** The lines the save-time check doubts. */
export const ImportFlaggedList: FC<ImportFlaggedListProps> = ({ total, lines, onUseSuggestion, onSearch, detail }) => {
    const { flagged: f } = useMessages(importMessages);
    const m = useMessages(matchLineMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const wide = useContainerClass() === 'wide';

    return (
        <View style={styles.layout}>
            <View style={styles.column}>
                <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                    {pluralOf(f.title, total, locale)}
                </Text>
                <Text style={[styles.body, { color: colors.inkMuted }]}>{pluralOf(f.intro, total, locale)}</Text>
                <View>
                    {lines.map((line) => (
                        <View key={line.key} style={[styles.row, { borderTopColor: colors.lineDivider }]}>
                            <Text style={[styles.line, { color: colors.ink }]}>
                                {fillTemplate(f.lineContext, { line: line.text, recipe: line.recipeTitle })}
                            </Text>
                            <Text style={[styles.meta, { color: colors.inkMuted }]}>
                                {fillTemplate(f.doubt, { food: line.matchedFood })}
                            </Text>
                            <View style={styles.actions}>
                                {line.suggestion === undefined ? null : (
                                    <Button
                                        variant="secondary"
                                        icon="check"
                                        accessibilityLabel={fillTemplate(f.useName, {
                                            food: line.suggestion.name,
                                            line: line.text,
                                        })}
                                        onPress={() => onUseSuggestion(line.key)}
                                    >
                                        {fillTemplate(f.use, { food: line.suggestion.name })}
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="search"
                                    accessibilityLabel={fillTemplate(m.searchName, { line: line.text })}
                                    onPress={() => onSearch(line.key)}
                                >
                                    {f.search}
                                </Button>
                            </View>
                        </View>
                    ))}
                </View>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>
                    {fillTemplate(f.footer, { count: total })}
                </Text>
            </View>
            {wide && detail !== undefined ? <View style={styles.pane}>{detail}</View> : null}
        </View>
    );
};

const styles = StyleSheet.create({
    layout: { flexDirection: 'row', gap: nativeTokens.spacing[6], alignItems: 'flex-start' },
    column: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[4] },
    pane: { width: PANE_WIDTH },
    title: nativeTokens.type.largeTitle.narrow,
    body: nativeTokens.type.body,
    line: nativeTokens.type.cardTitle,
    meta: nativeTokens.type.meta,
    row: {
        gap: nativeTokens.spacing[2],
        paddingVertical: nativeTokens.spacing[3],
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[3] },
});
