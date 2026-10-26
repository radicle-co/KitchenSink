/**
 * @module @commise/features-recipes/ingredientMatching — `MatchSettledRow` (native): the React Native leaf of
 * `./MatchSettledRow.tsx`, on the same props and the same words (`matchLineView.ts`). The controls sit on their own line under the status and wrap,
 * so no label wraps inside a control at 320 pt; a line under review shows a still glyph, never a spinner. While a send
 * for the line is in flight that control reads busy and the others refuse a press (`refused`). A send that did not save
 * says so, with Try again (M6). The status and the note are the 14 pt `list` role; `MatchLineList` draws the rule above
 * the line. Painted from the theme's roles, so it reads in both themes (D15).
 *
 * @pattern Visitor — an exhaustive switch with no default branch over the status union
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MatchFailureLine } from './MatchFailureLine.native.js';
import { settledControlFocusOf } from './listControlFocus.js';
import { MatchLineText } from './MatchLineText.native.js';
import type { SettledStatus } from './matchLineView.js';
import type { MatchSettledRowProps } from './matchSettledRowProps.js';

/** The theme colours a status reads. */
interface StatusColors {
    readonly ink: string;
    readonly inkMuted: string;
    readonly attention: string;
}

/** The status line's content. */
const statusOf = (status: SettledStatus, colors: StatusColors): ReactElement => {
    switch (status.kind) {
        case 'food':
            return (
                <>
                    <Icon name="check" size={16} tone="actionText" />
                    <View style={styles.proposal}>
                        <Text style={[styles.proposalText, { color: colors.ink }]}>{status.text}</Text>
                        {status.tag === undefined ? null : <StatusBadge status="note">{status.tag}</StatusBadge>}
                    </View>
                </>
            );
        case 'proposal':
            return (
                <View style={styles.proposal}>
                    {status.waiting ? <Icon name="clock" size={16} tone="inkMuted" /> : null}
                    <Text style={[styles.proposalText, { color: colors.ink }]}>{status.food}</Text>
                    <StatusBadge status="note">{status.tag}</StatusBadge>
                </View>
            );
        case 'text':
            return status.tone === 'attention' ? (
                <>
                    <Icon name="triangleAlert" size={16} tone="attention" />
                    <Text style={[styles.statusText, { color: colors.attention }]}>{status.text}</Text>
                </>
            ) : (
                <Text style={[styles.statusText, { color: colors.inkMuted }]}>{status.text}</Text>
            );
    }
};

/** One settled line. */
export const MatchSettledRow: FC<MatchSettledRowProps> = ({ line, view, onAction, onSeeWhy, onRetryPick, retry }) => {
    const { colors } = useTheme();
    const { trailing } = view;

    return (
        <View style={styles.row}>
            <MatchLineText line={line} />
            <View style={styles.status}>
                {statusOf(view.status, colors)}
                {trailing === undefined ? null : (
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={trailing.icon}
                        accessibilityLabel={trailing.name}
                        busy={trailing.busy}
                        refused={view.refusing && !trailing.busy}
                        {...settledControlFocusOf(view, trailing.kind, retry.landing)}
                        onPress={() => onAction(trailing.kind)}
                    >
                        {trailing.label}
                    </Button>
                )}
            </View>
            {view.actions.length === 0 ? null : (
                <View style={styles.actions}>
                    {view.actions.map((action) =>
                        action.kind === 'unavailable' ? (
                            <Text key="unavailable" style={[styles.unavailable, { color: colors.inkMuted }]}>
                                {action.text}
                            </Text>
                        ) : (
                            <Button
                                key={action.kind}
                                variant="ghost"
                                size="sm"
                                icon={action.icon}
                                accessibilityLabel={action.name}
                                busy={action.busy}
                                refused={view.refusing && !action.busy}
                                {...settledControlFocusOf(view, action.kind, retry.landing)}
                                onPress={() => onAction(action.kind)}
                            >
                                {action.label}
                            </Button>
                        ),
                    )}
                </View>
            )}
            {view.failure === undefined ? null : (
                <MatchFailureLine failure={view.failure} onRetry={onRetryPick} focus={retry.tryAgain} />
            )}
            {view.note === undefined ? null : (
                <View style={styles.note}>
                    <Text style={[styles.noteText, { color: colors.inkMuted }]}>{view.note.sentence}</Text>
                    <Button variant="ghost" size="sm" accessibilityLabel={view.note.seeWhyName} onPress={onSeeWhy}>
                        {view.note.seeWhy}
                    </Button>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        gap: nativeTokens.spacing[1],
        minHeight: nativeTokens.touchTarget,
        justifyContent: 'center',
        paddingVertical: nativeTokens.spacing[3],
    },
    status: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    statusText: { ...nativeTokens.type.list, flex: 1, flexShrink: 1 },
    proposal: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[2],
        rowGap: nativeTokens.spacing[1],
    },
    proposalText: { ...nativeTokens.type.list, flexShrink: 1 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[1] },
    unavailable: { ...nativeTokens.type.list, paddingHorizontal: nativeTokens.spacing[2] },
    note: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: nativeTokens.spacing[2] },
    noteText: { ...nativeTokens.type.list, flexShrink: 1 },
});
