/**
 * @module @commise/features-recipes/form — `PastedReadingRow` (native): the React Native leaf of
 * `./PastedReadingRow.tsx`, on the same props. Painted from the theme's roles, so it reads in both themes (D15).
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from './messages.js';
import type { PastedReadingRowProps } from './pastedReadingRowProps.js';

/** One pasted line still joining the recipe. */
export const PastedReadingRow: FC<PastedReadingRowProps> = ({ row, onRetry }) => {
    const m = useMessages(recipeFormMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.row}>
            <Text style={[styles.name, { color: colors.ink }]} numberOfLines={2}>
                {row.sourceLine}
            </Text>
            {row.state === 'failed' ? (
                <View style={styles.failed}>
                    <Icon name="triangleAlert" size={16} tone="attention" />
                    <Text style={[styles.state, { color: colors.attention }]}>{m.rowStateLookupFailed}</Text>
                    {onRetry !== undefined && (
                        <Button
                            variant="ghost"
                            icon="refreshCw"
                            accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.sourceLine })}
                            onPress={onRetry}
                        >
                            {m.statusActionRetry}
                        </Button>
                    )}
                </View>
            ) : (
                <Text style={[styles.state, { color: colors.inkMuted }]}>
                    {row.state === 'waiting' ? m.rowStateWaitingForConnection : m.rowStateReading}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    row: { gap: nativeTokens.spacing[1], minHeight: 48, justifyContent: 'center' },
    name: { ...nativeTokens.type.body },
    state: { ...nativeTokens.type.caption },
    failed: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
});
