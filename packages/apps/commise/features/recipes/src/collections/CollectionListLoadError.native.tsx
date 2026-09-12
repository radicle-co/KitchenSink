/**
 * @module @commise/features-recipes — native collection-list LOAD-ERROR fallback (presentational): what the list's error boundary renders
 * when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListLoadErrorProps } from './model.js';

export const CollectionListLoadError: FC<CollectionListLoadErrorProps> = ({ onRetry }) => {
    const { list } = useMessages(collectionMessages);

    return (
        <View accessibilityRole="alert">
            <Text>{list.errorTitle}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={list.retry} onPress={onRetry}>
                <Text>{list.retry}</Text>
            </Pressable>
        </View>
    );
};
