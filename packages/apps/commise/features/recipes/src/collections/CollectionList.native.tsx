/**
 * @module @commise/features-recipes — native collection-list view (T071 building block).
 *
 * The React Native leaf of {@link import('./CollectionList.js').CollectionList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), rendered with RN
 * primitives.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListViewProps } from './model.js';

export const CollectionList: FC<CollectionListViewProps> = ({ status, collections, onSelect, onCreate, onRetry }) => {
    const { list } = useMessages(collectionMessages);

    let body: ReactElement;

    if (status === 'loading') {
        body = <View accessibilityLabel={list.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert">
                <Text>{list.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={list.retry} onPress={onRetry}>
                    <Text>{list.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (collections.length === 0) {
        body = (
            <View>
                <Text>{list.emptyTitle}</Text>
                <Text>{list.emptyBody}</Text>
            </View>
        );
    } else {
        body = (
            <View>
                {collections.map((collection) => (
                    <View key={collection.id}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={collection.name}
                            onPress={() => onSelect(collection.id)}
                        >
                            <Text>{collection.name}</Text>
                        </Pressable>
                        {collection.description !== undefined && collection.description.length > 0 && (
                            <Text>{collection.description}</Text>
                        )}
                    </View>
                ))}
            </View>
        );
    }

    return (
        <View accessibilityLabel={list.heading}>
            <Text accessibilityRole="header">{list.heading}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={list.createCta} onPress={onCreate}>
                <Text>{list.createCta}</Text>
            </Pressable>
            {body}
        </View>
    );
};
