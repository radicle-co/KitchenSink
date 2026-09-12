/**
 * @module @commise/features-recipes/dataSources — native Data sources ERROR state (presentational; design §S16).
 *
 * The React Native twin of `DataSourcesLoadError.tsx`, less the failure's words: Try again, which retries the read, and
 * stays mounted and busy while it runs, so the reading cursor stays on it. The words are the screen's always-mounted
 * live region (`DataSourcesScreen.native.tsx`), because Android speaks only a change to a region it already holds, and
 * this leaf mounts with the failure (`LiveRegion`'s own rule).
 */
import { Feather } from '@expo/vector-icons';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesLoadErrorNativeProps } from './model.js';

/**
 * The read's failed state (native): Try again.
 *
 * @param props - What retrying the read does, and whether it runs.
 * @returns The error state's control.
 */
export const DataSourcesLoadError: FC<DataSourcesLoadErrorNativeProps> = ({ onRetry, retrying }) => {
    const messages = useMessages(dataSourcesMessages);

    return (
        <View style={styles.action}>
            <Button
                variant="secondary"
                icon={<Feather name="refresh-cw" size={16} color={palette.charcoal} />}
                onPress={onRetry}
                busy={retrying}
            >
                {messages.retry}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    action: { alignItems: 'flex-start' },
});
