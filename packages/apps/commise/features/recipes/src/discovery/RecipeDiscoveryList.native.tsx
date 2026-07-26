/**
 * @module @commise/features-recipes — native public-discovery view (T076 building block, US2).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryList.js').RecipeDiscoveryList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), rendered with RN
 * primitives. Every recipe shown is public; each row offers a Clone action.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import { DISCOVERY_SORTS, type RecipeDiscoveryListProps } from './model.js';

/** Visible label for each discovery sort option (S3). */
const sortLabel = (sort: RecipeSearchSortBy, m: DiscoveryMessages): string => {
    switch (sort) {
        case RecipeSearchSortBy.RELEVANCE:
            return m.sortRelevance;
        case RecipeSearchSortBy.RECENT:
            return m.sortNewest;
        case RecipeSearchSortBy.MOST_CLONED:
            return m.sortMostCloned;
        case RecipeSearchSortBy.QUICKEST:
            return m.sortQuickest;
        default:
            return m.sortRelevance;
    }
};

export const RecipeDiscoveryList: FC<RecipeDiscoveryListProps> = ({
    status,
    results,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onClone,
    onRetry,
    cloningId,
    hasActiveFilters = false,
    filterSlot,
    sort,
    loadMore,
    browseSlot,
    onExitToBrowse,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    // Empty ≠ no-match, and browse ≠ either: an active query/filter turns the surface into a result list;
    // with neither, the curated `browseSlot` (when provided) is the default experience, not a bare stream.
    const searching = searchValue.trim().length > 0 || hasActiveFilters;
    const browsing = browseSlot !== undefined && !searching;

    let body: ReactElement;

    if (browsing) {
        body = <>{browseSlot}</>;
    } else if (status === 'loading') {
        // Skeleton cards (NOT a blank view — the previous bug): inert, motion-free placeholders in the same
        // 2-col grid the results use, so the surface has shape while the first page loads. Being motion-free,
        // they need no reduce-motion gate (there is no non-essential animation to suppress).
        body = (
            <View accessibilityLabel={discovery.loadingLabel} style={styles.grid}>
                {[0, 1, 2, 3].map((card) => (
                    <View key={card} aria-hidden style={[styles.gridCell, styles.skeletonCard]} />
                ))}
            </View>
        );
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert">
                <Text>{discovery.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={discovery.retry} onPress={onRetry}>
                    <Text>{discovery.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search/filter with zero hits is a NO-MATCH, not the browse-empty "no public
        // recipes" state. `searchValue` or an active filter distinguishes them.
        body = (
            <View>
                <Text>{searching ? discovery.noMatchTitle : discovery.emptyTitle}</Text>
                <Text>{searching ? discovery.noMatchBody : discovery.emptyBody}</Text>
            </View>
        );
    } else {
        const count = formatRecipeCount(
            results.length,
            { one: discovery.countOne, other: discovery.countOther },
            locale,
        );
        // S5 — echo the active query in the results header; a bare browse shows just the count.
        const query = searchValue.trim();
        const header = query.length > 0 ? fillTemplate(discovery.resultsForQuery, { count, query }) : count;
        // ScrollView, not View: even a 2-col grid overflows a phone once several rows load, so the cards must
        // scroll. Header + search + filters stay pinned above. Cards lay out in a wrapping 2-col grid (U7).
        body = (
            <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
            >
                {onExitToBrowse !== undefined && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={discovery.backToBrowse}
                        onPress={onExitToBrowse}
                        style={styles.backToBrowse}
                    >
                        <Text style={styles.backToBrowseText}>{discovery.backToBrowse}</Text>
                    </Pressable>
                )}
                <Text style={styles.count}>{header}</Text>
                <View role="list" style={styles.grid}>
                    {results.map((result) => (
                        <View key={result.recipe.id} role="listitem" style={styles.gridCell}>
                            <RecipeDiscoveryCard
                                recipe={toRecipeCardModel(result.recipe)}
                                authorHandle={result.recipe.authorHandle}
                                sourceAttribution={result.recipe.sourceAttribution}
                                isCloning={cloningId === result.recipe.id}
                                onSelect={onSelectRecipe}
                                onClone={onClone}
                            />
                        </View>
                    ))}
                </View>
                {loadMore?.hasMore === true && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={loadMore.loading ? discovery.loadingMore : discovery.loadMore}
                        accessibilityState={{ busy: loadMore.loading, disabled: loadMore.loading }}
                        disabled={loadMore.loading}
                        onPress={loadMore.onLoadMore}
                        style={[styles.loadMore, loadMore.loading && styles.loadMoreBusy]}
                    >
                        <Text style={styles.loadMoreLabel}>
                            {loadMore.loading ? discovery.loadingMore : discovery.loadMore}
                        </Text>
                    </Pressable>
                )}
            </ScrollView>
        );
    }

    return (
        <View accessibilityLabel={discovery.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {discovery.heading}
            </Text>
            <TextInput
                accessibilityLabel={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                placeholderTextColor={palette.mist}
                value={searchValue}
                onChangeText={onSearchChange}
                style={styles.search}
            />
            {filterSlot}
            {sort !== undefined && !browsing && (
                <View accessibilityRole="radiogroup" accessibilityLabel={discovery.sortLabel} style={styles.sortRow}>
                    {DISCOVERY_SORTS.map((option) => {
                        const checked = sort.active === option;

                        return (
                            <Pressable
                                key={option}
                                accessibilityRole="radio"
                                accessibilityState={{ checked }}
                                onPress={() => sort.onChange(option)}
                                style={[styles.sortChip, checked && styles.sortChipActive]}
                            >
                                <Text style={checked ? styles.sortLabelActive : styles.sortLabelText}>
                                    {sortLabel(option, discovery)}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            )}
            {body}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, gap: 16, paddingHorizontal: 16, paddingTop: 8 },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    search: {
        backgroundColor: palette.white,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        paddingVertical: 12,
        paddingHorizontal: 20,
        fontSize: 16,
        color: palette.charcoal,
    },
    count: { fontSize: 13, fontWeight: '500', color: palette.slate },
    sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    sortChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.pearl },
    sortChipActive: { backgroundColor: palette.charcoal },
    sortLabelText: { fontSize: 14, fontWeight: '500', color: palette.slate },
    sortLabelActive: { fontSize: 14, fontWeight: '500', color: palette.white },
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
    cardsScroll: { flex: 1 },
    cards: { gap: 12, paddingBottom: 24 },
    // 2-col grid (U7): a wrapping row of half-width cells, each holding one result/skeleton card.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    gridCell: { width: '48%' },
    skeletonCard: { height: 220, borderRadius: 20, backgroundColor: 'rgba(178, 190, 195, 0.3)' },
    backToBrowse: {
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: 4,
        minHeight: 44,
        justifyContent: 'center',
    },
    backToBrowseText: { fontSize: 14, fontWeight: '600', color: palette.seafoam },
});
