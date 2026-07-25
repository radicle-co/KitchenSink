/**
 * @module @commise/features-recipes — native collection-list view (T071 building block).
 *
 * The React Native leaf of {@link import('./CollectionList.js').CollectionList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), plus the server-paged
 * `[Load more]` control (W5/C7), rendered with RN primitives.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListViewProps } from './model.js';

export const CollectionList: FC<CollectionListViewProps> = ({
    status,
    collections,
    onSelect,
    onCreate,
    onRetry,
    loadMore,
}) => {
    const { list } = useMessages(collectionMessages);
    const hasMore = loadMore?.hasMore ?? false;
    const isFetchingNextPage = loadMore?.loading ?? false;

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
        // ScrollView, not View: a full server page can hold up to 20 rows plus the load-more control, so
        // without scrolling every row past the first screenful — and the load-more control itself, W5/C7 —
        // is unreachable. Same reasoning `RecipeList.native.tsx`'s `cardsScroll` documents for its own list.
        body = (
            <ScrollView style={styles.cardsScroll} contentContainerStyle={styles.cards}>
                {collections.map((collection) => (
                    <Pressable
                        key={collection.id}
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
                ))}
                {hasMore && (
                    // W5/C7 — server-paged "Load more" (no infinite scroll); vanishes once the last page loads.
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={isFetchingNextPage ? list.loadingMore : list.loadMore}
                        accessibilityState={{ busy: isFetchingNextPage, disabled: isFetchingNextPage }}
                        disabled={isFetchingNextPage}
                        onPress={() => loadMore?.onLoadMore()}
                        style={[styles.loadMore, isFetchingNextPage && styles.loadMoreBusy]}
                    >
                        <Text style={styles.loadMoreLabel}>
                            {isFetchingNextPage ? list.loadingMore : list.loadMore}
                        </Text>
                    </Pressable>
                )}
            </ScrollView>
        );
    }

    return (
        <View accessibilityLabel={list.heading} style={styles.container}>
            <View style={styles.headerRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {list.heading}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={list.createCta}
                    onPress={onCreate}
                    style={styles.createButton}
                >
                    <Text style={styles.createLabel}>{list.createCta}</Text>
                </Pressable>
            </View>
            {body}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, gap: 16, paddingHorizontal: 16, paddingTop: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    createButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
    createLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    cardsScroll: { flex: 1 },
    cards: { gap: 12, paddingBottom: 24 },
    loadMore: {
        alignSelf: 'center',
        backgroundColor: palette.pearl,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 24,
        marginTop: 8,
    },
    loadMoreBusy: { opacity: 0.6 },
    loadMoreLabel: { fontSize: 14, fontWeight: '600', color: palette.charcoal },
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 18,
        gap: 4,
    },
    cardTitle: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    cardDescription: { fontSize: 13, color: palette.slate },
});
