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
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (status === 'loading') {
        body = <View accessibilityLabel={discovery.loadingLabel} />;
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
        const searching = searchValue.trim().length > 0 || hasActiveFilters;
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
        // ScrollView, not View: the full-bleed 4:3 cover cards mean only ~1 card fits, so without scrolling
        // every discovered recipe past the first is unreachable. Header + search + filters stay pinned above.
        body = (
            <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.count}>{header}</Text>
                {results.map((result) => (
                    <RecipeDiscoveryCard
                        key={result.recipe.id}
                        recipe={toRecipeCardModel(result.recipe)}
                        authorHandle={result.recipe.authorHandle}
                        sourceAttribution={result.recipe.sourceAttribution}
                        isCloning={cloningId === result.recipe.id}
                        onSelect={onSelectRecipe}
                        onClone={onClone}
                    />
                ))}
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
            {sort !== undefined && (
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
});
