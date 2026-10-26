/**
 * @module @commise/features-recipes/import — `ImportFlaggedList` (native): the React Native leaf of
 * `./ImportFlaggedList.tsx`, on the same words. Each row's Use and Choose another sit on their own line under the doubt and wrap
 * rather than squeeze, so neither label wraps inside its control at 320 dp; each keeps the 44 pt touch floor. Below the
 * wide container class Choose another opens the options sheet (the host's); at it (1194) the options pane stands beside
 * the list. While a send for a line is in flight, Use reads busy if it is the one sending and both refuse a press (M5). A Use that did not save says so on its row, with Try again, and the page has ONE polite
 * live region (M6, U9). Try again keeps the screen-reader cursor (WCAG 2.4.3): while the retry is in flight it lands on
 * the row's Use, or Choose another when the row has no Use (`flaggedRowViewOf`), and returns to the new Try again if the
 * retry fails again (`useRetryFocus`).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useContainerClass } from '@commise/ui/layout';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.native.js';
import { useMatchCopy } from '../ingredientMatching/useMatchCopy.js';
import { useRetryFocus } from '../ingredientMatching/useRetryFocus.js';
import { flaggedRowViewOf } from './flaggedRowView.js';
import { importMessages } from './messages.js';
import type { ImportFlaggedListProps } from './props.js';

/** The pane's width beside the list at the wide class, dp. */
const PANE_WIDTH = 384;

/** The lines the save-time check doubts. */
export const ImportFlaggedList: FC<ImportFlaggedListProps> = ({
    total,
    lines,
    pending,
    failed,
    announcement,
    onUseSuggestion,
    onChooseAnother,
    detail,
}) => {
    const { flagged: f } = useMessages(importMessages);
    const locale = useLocale();
    const copy = useMatchCopy();
    const rows = lines.map((line) => ({
        line,
        view: flaggedRowViewOf(line, { failed: failed.has(line.key), pending: pending.get(line.key) }, copy),
    }));
    const retryOf = useRetryFocus(rows.map((row) => row.view.send));
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
                    {rows.map(({ line, view }) => {
                        const retry = retryOf(line.key);

                        return (
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
                                            busy={pending.get(line.key)?.kind === 'useProposal'}
                                            refused={pending.has(line.key)}
                                            focusRequested={view.landing === 'use' && retry.landing.requested}
                                            onFocusRequestHandled={retry.landing.onHandled}
                                            onPress={() => onUseSuggestion(line.key)}
                                        >
                                            {fillTemplate(f.use, { food: line.suggestion.name })}
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        accessibilityLabel={fillTemplate(f.chooseAnotherName, { line: line.text })}
                                        refused={pending.has(line.key)}
                                        focusRequested={view.landing === 'chooseAnother' && retry.landing.requested}
                                        onFocusRequestHandled={retry.landing.onHandled}
                                        onPress={() => onChooseAnother(line.key)}
                                    >
                                        {f.chooseAnother}
                                    </Button>
                                </View>
                                {view.failure === undefined ? null : (
                                    <MatchFailureLine
                                        failure={view.failure}
                                        onRetry={() => onUseSuggestion(line.key)}
                                        focus={retry.tryAgain}
                                    />
                                )}
                            </View>
                        );
                    })}
                </View>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>
                    {fillTemplate(f.footer, { title: pluralOf(f.title, total, locale) })}
                </Text>
            </View>
            {wide && detail !== undefined ? <View style={styles.pane}>{detail}</View> : null}
            <LiveRegion politeness="polite" occurrence={announcement.occurrence} visuallyHidden>
                {announcement.text}
            </LiveRegion>
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
