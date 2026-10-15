/**
 * @module @commise/features-recipes/form — `PastedReadingRow` (native): the React Native leaf of
 * `./PastedReadingRow.tsx`, on the same props and the same words (`pasteStatusCopy.ts`). Painted from the theme's roles,
 * so it reads in both themes (D15). The one action sits on its own line, so nothing wraps inside a control at 320 px.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeFormMessages } from './messages.js';
import { pasteRowViewOf } from './pasteStatusCopy.js';
import type { PastedReadingRowProps } from './pastedReadingRowProps.js';

/** One pasted line still joining the recipe. */
export const PastedReadingRow: FC<PastedReadingRowProps> = ({ row, onRetryLookup, onAddAsWritten }) => {
    const m = useMessages(recipeFormMessages);
    const { colors } = useTheme();
    const view = pasteRowViewOf(row.state, m);
    const color = view.tone === 'attention' ? colors.attention : colors.inkMuted;

    return (
        <View style={styles.row}>
            <Text style={[styles.name, { color: colors.ink }]} numberOfLines={2}>
                {row.sourceLine}
            </Text>
            <View style={styles.state}>
                <Icon name={view.icon} size={16} tone={view.tone} />
                <Text style={[styles.stateText, { color }]}>{view.stateText}</Text>
            </View>
            {view.action === 'addAsWritten' && onAddAsWritten !== undefined && (
                <View style={styles.action}>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="listPlus"
                        accessibilityLabel={fillTemplate(m.statusActionAddAsWrittenLabel, { line: row.sourceLine })}
                        onPress={() => onAddAsWritten(row.lineIndex)}
                    >
                        {m.statusActionAddAsWritten}
                    </Button>
                </View>
            )}
            {view.action === 'retryLookup' && onRetryLookup !== undefined && (
                <View style={styles.action}>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="refreshCw"
                        accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.sourceLine })}
                        onPress={onRetryLookup}
                    >
                        {m.statusActionRetry}
                    </Button>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    row: { gap: nativeTokens.spacing[1], minHeight: 48, justifyContent: 'center' },
    name: { ...nativeTokens.type.body },
    state: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    stateText: { ...nativeTokens.type.caption, flexShrink: 1 },
    action: { flexDirection: 'row' },
});
