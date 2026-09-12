/**
 * @module @commise/features-recipes/dataSources — native Data sources LIST (presentational; plan R55, design §S16).
 *
 * The React Native twin of `DataSourcesList.tsx`: one card per source, or the empty copy, in the service's order and
 * never sorted again. The sheet around it scrolls, so this is a plain column rather than a virtualized list: the
 * catalog cites at most the register's handful of sources.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// The native leaf by name, as `RecipeDetailBody.native.tsx` imports its source line: it takes the native-only `onOpen`.
import { DataSourceCard } from './DataSourceCard.native.js';
import { dataSourcesMessages } from './messages.js';
import type { DataSourcesListNativeProps } from './model.js';

/**
 * The settled read (native): one card per cited source, in the service's order, or the empty copy.
 *
 * @param props - The cited sources, and the link adapter for each card.
 * @returns The cards, or the empty state.
 */
export const DataSourcesList: FC<DataSourcesListNativeProps> = ({ sources, onOpen }) => {
    const messages = useMessages(dataSourcesMessages);

    if (sources.length === 0) {
        return <Text style={styles.empty}>{messages.empty}</Text>;
    }

    return (
        <View style={styles.column}>
            {sources.map((source) => (
                <DataSourceCard key={source.id} source={source} onOpen={onOpen} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    column: { gap: nativeTokens.spacing[3] },
    empty: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.slate },
});
