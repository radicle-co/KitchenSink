/**
 * @module @commise/features-recipes/form — `PasteMatchRow` (native): the React Native leaf of `./PasteMatchRow.tsx`, on
 * the same props and the same words (`pasteMatchView.ts`). The controls sit on their own line under the status and wrap,
 * so no label wraps inside a control at 320 pt; a line under review shows a still glyph, never a spinner. Painted from
 * the theme's roles, so it reads in both themes (D15).
 *
 * @pattern Visitor — an exhaustive switch over the status union
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PastedLine } from './PastedLine.native.js';
import type { PasteMatchRowProps } from './pasteMatchRowProps.js';
import type { PasteMatchStatus } from './pasteMatchView.js';

/** The theme colours a status reads. */
interface StatusColors {
    readonly ink: string;
    readonly inkMuted: string;
    readonly attention: string;
}

/** The status line's content. */
const statusOf = (status: PasteMatchStatus, colors: StatusColors): ReactElement => {
    switch (status.kind) {
        case 'food':
            return (
                <>
                    <Icon name="check" size={16} tone="actionText" />
                    <Text style={[styles.statusText, { color: colors.ink }]}>
                        {status.food}
                        {status.yourChoice !== undefined && ' '}
                        {status.yourChoice !== undefined && (
                            <Text style={{ color: colors.inkMuted }}>{status.yourChoice}</Text>
                        )}
                    </Text>
                </>
            );
        case 'proposal':
            return (
                <View style={styles.proposal}>
                    {status.waiting && <Icon name="clock" size={16} tone="inkMuted" />}
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

        default: {
            const unhandled: never = status;

            return unhandled;
        }
    }
};

/** One settled pasted line. */
export const PasteMatchRow: FC<PasteMatchRowProps> = ({ line, view, onAction, onSeeWhy }) => {
    const { colors } = useTheme();
    const { trailing } = view;

    return (
        <View style={styles.row}>
            <PastedLine line={line} />
            <View style={styles.status}>
                {statusOf(view.status, colors)}
                {trailing !== undefined && (
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={trailing.icon}
                        accessibilityLabel={trailing.name}
                        onPress={() => onAction(trailing.kind)}
                    >
                        {trailing.label}
                    </Button>
                )}
            </View>
            {view.actions.length > 0 && (
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
                                onPress={() => onAction(action.kind)}
                            >
                                {action.label}
                            </Button>
                        ),
                    )}
                </View>
            )}
            {view.note !== undefined && (
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
        minHeight: 48,
        justifyContent: 'center',
        paddingVertical: nativeTokens.spacing[2],
    },
    status: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    statusText: { ...nativeTokens.type.meta, flex: 1, flexShrink: 1 },
    proposal: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[2],
        rowGap: nativeTokens.spacing[1],
    },
    proposalText: { ...nativeTokens.type.meta, flexShrink: 1 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[1] },
    unavailable: { ...nativeTokens.type.meta, paddingHorizontal: nativeTokens.spacing[2] },
    note: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: nativeTokens.spacing[2] },
    noteText: { ...nativeTokens.type.meta, flexShrink: 1 },
});
