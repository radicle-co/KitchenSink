/**
 * @module @commise/features-recipes — native collection-list LOAD-ERROR fallback (presentational): what the list's error boundary renders
 * when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches. The frame's header is drawn
 * first, in the same scroller, so the title never vanishes with the failure.
 */
import { useMessages } from '@commise/i18n/react';
import { useContext, type FC } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { YStack } from 'tamagui';

import { RecipeListHeaderContext } from '../list/recipeListHeaderContext.js';

import { collectionMessages } from './messages.js';
import type { CollectionListLoadErrorProps } from './model.js';

export const CollectionListLoadError: FC<CollectionListLoadErrorProps> = ({ onRetry }) => {
    const { list } = useMessages(collectionMessages);

    const header = useContext(RecipeListHeaderContext);

    return (
        <ScrollView>
            {header}
            <YStack paddingHorizontal="$4">
                <View collapsable={false} accessibilityRole="alert">
                    <Text>{list.errorTitle}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={list.retry} onPress={onRetry}>
                        <Text>{list.retry}</Text>
                    </Pressable>
                </View>
            </YStack>
        </ScrollView>
    );
};
