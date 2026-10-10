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
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { contentWidthOf, containerClassOf } from '@commise/ui/container-class';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { SearchField } from '@commise/ui/search-field';
import { useTheme } from '@commise/ui/theme';
import type { CollectionResponse } from '@kitchensink/schema-recipe';
import { FlashList } from '@shopify/flash-list';
import { useId, type FC } from 'react';
import { RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { libraryGridColumnsOf } from '../card/cardGridLayout.js';
import { formatRecipeCount } from '../list/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { collectionMessages } from './messages.js';
import { COLLECTION_SEARCH_FROM, type CollectionListResultsProps } from './model.js';

export const CollectionListResults: FC<CollectionListResultsProps> = ({
    collections,
    total,
    onSelect,
    search,
    firstRun,
    loadMore,
    refresh,
    refreshNotice,
    scrollBind,
}) => {
    const { list } = useMessages(collectionMessages);
    const { colors } = useTheme();
    const locale = useLocale();
    const searchId = useId();
    const contentWidth = contentWidthOf(useWindowDimensions().width);
    // Two columns on a phone; from a 600 container, as many columns of at least 240 as fit (§5.1).
    const columns = containerClassOf(contentWidth) === 'narrow' ? 2 : libraryGridColumnsOf(contentWidth);

    if (total === 0) {
        return (
            <View style={styles.firstRun}>
                <Text role="heading" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>
                    {list.emptyTitle}
                </Text>
                <Text style={[styles.body, styles.centred, { color: colors.inkMuted }]}>{list.emptyBody}</Text>
                {firstRun.hasRecipes ? (
                    <Button icon="plus" size="lg" width="fill" onPress={firstRun.onCreate}>
                        {list.createCta}
                    </Button>
                ) : (
                    <>
                        <Text style={[styles.body, { color: colors.inkMuted }]}>{list.needRecipes}</Text>
                        <Button icon="pencilLine" size="lg" width="fill" onPress={firstRun.onAddRecipe}>
                            {list.addRecipe}
                        </Button>
                    </>
                )}
            </View>
        );
    }

    return (
        <>
            {total >= COLLECTION_SEARCH_FROM && (
                <SearchField
                    id={searchId}
                    label={list.searchLabel}
                    labelVisibility="hidden"
                    clearLabel={list.clearSearch}
                    placeholder={list.searchLabel}
                    value={search.value}
                    onChangeText={search.onChange}
                />
            )}
            <Text style={[styles.count, { color: colors.ink }]}>
                {formatRecipeCount(total, { one: list.countOne, other: list.countOther }, locale)}
            </Text>
            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}
            {collections.length === 0 ? (
                <Text role="status" style={[styles.body, { color: colors.inkMuted }]}>
                    {fillTemplate(list.noMatch, { query: search.value.trim() })}
                </Text>
            ) : (
                <FlashList
                    key={columns}
                    {...scrollBind}
                    data={collections}
                    numColumns={columns}
                    keyExtractor={(collection) => collection.id}
                    renderItem={({ item }) => (
                        <View style={styles.cell}>
                            <CollectionCard collection={item} onSelect={onSelect} />
                        </View>
                    )}
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

/** One album card: the cover, the name (two lines), the visibility as glyph and word, and a copy's credit. */
const CollectionCard: FC<{ readonly collection: CollectionResponse; readonly onSelect: (id: string) => void }> = ({
    collection,
    onSelect,
}) => {
    const { list } = useMessages(collectionMessages);
    const { colors } = useTheme();
    const visibility = collection.visibility === 'public' ? list.visibilityPublic : list.visibilityPrivate;

    return (
        <PressScale
            accessibilityRole="link"
            accessibilityLabel={fillTemplate(list.cardLabel, { name: collection.name, visibility })}
            width="fill"
            onPress={() => onSelect(collection.id)}
        >
            <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
                <View style={styles.clip}>
                    <RecipeCover recipeId={collection.id} title={collection.name} aspect="1:1" />
                    <View style={styles.cardBody}>
                        <Text numberOfLines={2} style={[styles.cardTitle, { color: colors.ink }]}>
                            {collection.name}
                        </Text>
                        <View style={styles.meta}>
                            <Icon
                                name={collection.visibility === 'public' ? 'globe' : 'lock'}
                                size={16}
                                tone="inkMuted"
                            />
                            <Text style={[styles.metaText, { color: colors.inkMuted }]}>{visibility}</Text>
                        </View>
                        {collection.sourceOwnerHandle === undefined ? null : (
                            <Text numberOfLines={1} style={[styles.caption, { color: colors.inkMuted }]}>
                                {fillTemplate(list.copiedFrom, { handle: collection.sourceOwnerHandle })}
                            </Text>
                        )}
                    </View>
                </View>
            </View>
        </PressScale>
    );
};

/** The inter-card spacer for the virtualized list (FlashList lays cells out itself, so gap is a separator). */
const CardSeparator: FC = () => <View style={styles.cardSeparator} />;

const styles = StyleSheet.create({
    firstRun: {
        alignItems: 'center',
        alignSelf: 'center',
        width: '100%',
        maxWidth: 448,
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[8],
    },
    sectionTitle: { ...nativeTokens.type.sectionTitle },
    body: { ...nativeTokens.type.body },
    centred: { textAlign: 'center' },
    count: { ...nativeTokens.type.label, fontVariant: ['tabular-nums', 'lining-nums'] },
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    cardSeparator: { height: nativeTokens.spacing[4] },
    cell: { flex: 1, paddingHorizontal: nativeTokens.spacing[2] },
    card: { borderRadius: nativeTokens.radius.md, borderWidth: StyleSheet.hairlineWidth, ...nativeTokens.elevation.sm },
    clip: { borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
    cardBody: { padding: nativeTokens.spacing[3], gap: nativeTokens.spacing[1] },
    cardTitle: { ...nativeTokens.type.cardTitle },
    meta: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    metaText: { ...nativeTokens.type.meta },
    caption: { ...nativeTokens.type.caption },
});
