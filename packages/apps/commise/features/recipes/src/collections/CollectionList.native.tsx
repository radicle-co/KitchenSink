/**
 * @module @commise/features-recipes — native collection-list view (T071 building block).
 *
 * The React Native leaf of {@link import('./CollectionList.js').CollectionList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), plus the server-paged
 * `[Load more]` control (W5/C7), rendered with RN primitives.
 *
 * U4: the rows are virtualized with FlashList v2 (v2 auto-measures — no `estimatedItemSize`); the blank
 * loading view became inert card skeletons; pull-to-refresh is wired through the recycler; and the styles
 * derive from the shared design scale (`nativeTokens`). The `[Load more]` control is the list footer.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { FlashList } from '@shopify/flash-list';
import type { Collection } from '@kitchensink/recipe-core';
import type { FC, ReactElement } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListViewProps } from './model.js';

/** The inter-card gap, shared by the FlashList separator and the loading skeletons. */
const CARD_GAP = nativeTokens.spacing[3];

/** How many inert skeleton cards the blank loading state renders. */
const SKELETON_COUNT = 4;

export const CollectionList: FC<CollectionListViewProps> = ({
    status,
    collections,
    onSelect,
    onCreate,
    onRetry,
    loadMore,
    refresh,
}) => {
    const { list } = useMessages(collectionMessages);
    const hasMore = loadMore?.hasMore ?? false;
    const isFetchingNextPage = loadMore?.loading ?? false;

    let body: ReactElement;

    if (status === 'loading') {
        // Skeleton cards (NOT a blank view — U4): inert, motion-free placeholders shaped like a collection
        // row, so the surface has structure while the first page loads. Motion-free ⇒ no reduce-motion gate.
        body = (
            <View accessibilityLabel={list.loadingLabel} style={styles.cards}>
                {Array.from({ length: SKELETON_COUNT }, (_value, index) => (
                    <View key={index} aria-hidden style={styles.skeletonCard} />
                ))}
            </View>
        );
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
        // FlashList (U4), not ScrollView + .map: a full server page holds up to 20 rows plus the load-more
        // control, so the list must both scroll AND recycle cells. v2 auto-measures — no `estimatedItemSize`.
        // The `[Load more]` control (W5/C7 — server-paged, no infinite scroll) is the list footer; it vanishes
        // once the last page loads. Pull-to-refresh (U4/L8) binds to the query refetch; absent on web.
        body = (
            <FlashList
                data={collections}
                keyExtractor={(collection) => collection.id}
                renderItem={({ item }) => <CollectionRow collection={item} onSelect={onSelect} />}
                ItemSeparatorComponent={CardSeparator}
                ListFooterComponent={
                    hasMore ? (
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
                    ) : null
                }
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                refreshControl={
                    refresh !== undefined ? (
                        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                    ) : undefined
                }
            />
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
    container: { flex: 1, gap: nativeTokens.spacing[4], paddingHorizontal: nativeTokens.spacing[4], paddingTop: nativeTokens.spacing[2] },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', color: palette.charcoal },
    createButton: {
        backgroundColor: palette.seafoam,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: 10,
        paddingHorizontal: 18,
        minHeight: 44,
        justifyContent: 'center',
    },
    createLabel: { color: palette.white, fontWeight: '600', fontSize: nativeTokens.fontSize.bodySm },
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    cardSeparator: { height: CARD_GAP },
    loadMore: {
        alignSelf: 'center',
        backgroundColor: palette.pearl,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: 10,
        paddingHorizontal: nativeTokens.spacing[5],
        marginTop: nativeTokens.spacing[2],
        minHeight: 44,
        justifyContent: 'center',
    },
    loadMoreBusy: { opacity: 0.6 },
    loadMoreLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
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
    // Inert loading placeholder shaped like a collection row; borderSubtle fill, no motion.
    skeletonCard: { height: 76, borderRadius: nativeTokens.radius.lg, backgroundColor: nativeTokens.borderSubtle, marginBottom: CARD_GAP },
});
