/**
 * @module @commise/features-recipes — native collection-list RESULTS (presentational): what renders inside the list's suspense boundary
 * once the read has settled.
 *
 * The React Native leaf of `CollectionListResults`: the refresh notice, then the empty state or the rows, with the
 * server-paged `[Load more]` control (W5/C7) as the list footer. U4: the rows are virtualized with FlashList v2 (v2
 * auto-measures — no `estimatedItemSize`), pull-to-refresh is wired through the recycler, and the styles derive from
 * the shared design scale (`nativeTokens`).
 */
import { LoadMoreControl } from '@commise/ui/load-more';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { FlashList } from '@shopify/flash-list';
import type { Collection } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListResultsProps } from './model.js';

export const CollectionListResults: FC<CollectionListResultsProps> = ({
    collections,
    onSelect,
    loadMore,
    refresh,
    refreshNotice,
}) => {
    const { list } = useMessages(collectionMessages);

    return (
        <>
            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}
            {collections.length === 0 ? (
                <View>
                    <Text>{list.emptyTitle}</Text>
                    <Text>{list.emptyBody}</Text>
                </View>
            ) : (
                // FlashList (U4), not ScrollView + .map: a full server page holds up to 20 rows plus the load-more
                // control, so the list must both scroll AND recycle cells. The `[Load more]` control (W5/C7 —
                // server-paged, no infinite scroll) is the list footer; it vanishes once the last page loads.
                <FlashList
                    data={collections}
                    keyExtractor={(collection) => collection.id}
                    renderItem={({ item }) => <CollectionRow collection={item} onSelect={onSelect} />}
                    ItemSeparatorComponent={CardSeparator}
                    ListFooterComponent={
                        loadMore === undefined ? null : (
                            <LoadMoreControl
                                {...loadMore}
                                labels={{
                                    loadMore: list.loadMore,
                                    loadingMore: list.loadingMore,
                                    retry: list.retry,
                                    failed: list.loadMoreError,
                                }}
                            />
                        )
                    }
                    style={styles.cardsScroll}
                    contentContainerStyle={styles.cards}
                    refreshControl={
                        refresh !== undefined ? (
                            <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                        ) : undefined
                    }
                />
            )}
        </>
    );
};

/** A single collection row (a card named by the collection, with an optional description). */
const CollectionRow: FC<{ collection: Collection; onSelect: (id: string) => void }> = ({ collection, onSelect }) => (
    <Pressable
        accessibilityRole="button"
        accessibilityLabel={collection.name}
        onPress={() => onSelect(collection.id)}
        style={styles.card}
    >
        <Text style={styles.cardTitle}>{collection.name}</Text>
        {collection.description !== undefined && collection.description.length > 0 && (
            <Text style={styles.cardDescription}>{collection.description}</Text>
        )}
    </Pressable>
);

/** The inter-card spacer for the virtualized list (FlashList lays cells out itself, so gap is a separator). */
const CardSeparator: FC = () => <View style={styles.cardSeparator} />;

const styles = StyleSheet.create({
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    cardSeparator: { height: nativeTokens.spacing[3] },
    card: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        padding: 18,
        gap: nativeTokens.spacing[1],
    },
    cardTitle: { fontSize: nativeTokens.fontSize.headingSm, fontWeight: '600', color: palette.charcoal },
    cardDescription: { fontSize: 13, color: palette.slate },
});
