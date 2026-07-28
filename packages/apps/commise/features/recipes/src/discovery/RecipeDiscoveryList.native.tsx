/**
 * @module @commise/features-recipes — native public-discovery view (T076 building block, US2).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryList.js').RecipeDiscoveryList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), rendered with RN
 * primitives. Every recipe shown is public; each row offers a Clone action.
 *
 * Like its web peer it owns exactly one piece of local UI state — `searchFocused` — gating the recent-search
 * panel (U7) to the idle state (field focused, query blank). The history itself lives in the screen's
 * `useRecentSearches`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import type { FC, ReactElement } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
import { RecipeSourceTabs } from '../list/RecipeSourceTabs.native.js';
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
    refresh,
    recentSearches,
    tab,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    // Local UI state ONLY (no data, no side effect): whether the keyword field holds focus. The recent
    // searches are an idle-state shortcut that appears on focus and vanishes on blur, so they never sit
    // permanently between the field and the rails.
    const [searchFocused, setSearchFocused] = useState(false);

    // Empty ≠ no-match, and browse ≠ either: an active query/filter turns the surface into a result list;
    // with neither, the curated `browseSlot` (when provided) is the default experience, not a bare stream.
    const searching = searchValue.trim().length > 0 || hasActiveFilters;
    const browsing = browseSlot !== undefined && !searching;
    // Idle + focused + something to offer: anything else (a typed query, an ACTIVE FILTER, an empty
    // history) renders no panel at all rather than an empty one. Gate on `!searching`, not on the query
    // alone: a filter applied from the sheet leaves the query blank, so checking only `searchValue` kept
    // this idle-only panel drawn over the result list — and on a phone it covers the middle of the screen,
    // which is exactly where a swipe to scroll the results lands.
    const showRecentSearches =
        recentSearches !== undefined && recentSearches.queries.length > 0 && searchFocused && !searching;

    let body: ReactElement;

    // ⚠️ ORDER IS LOAD-BEARING: `status` outranks `browsing`. See the web leaf's identical note — browsing is
    // the DEFAULT state of Discover, so testing it first made the loading, error and empty branches below
    // unreachable on the surface's own default, taking the only retry down with them.
    if (status === 'loading') {
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
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={discovery.retry}
                    onPress={onRetry}
                    style={styles.retry}
                >
                    <Text>{discovery.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (browsing) {
        // ScrollView, NOT a bare fragment: the browse surface is three curated rails plus the cuisine
        // shortcuts, which is several viewports tall on a phone. Rendered unwrapped inside the screen's
        // `flex: 1` container nothing scrolled at all, stranding the third rail ("Quick") and the cuisine
        // shortcuts off-screen with no way to reach them (caught on-device by Maestro `discover-browse` /
        // `search-navigation`, which swiped up 13 times without the surface moving). The RESULT state was
        // always virtualized (FlashList) and so never had this problem — browse was the one stranded state.
        // Pull-to-refresh rides along here too, so the gesture means the same thing on both surfaces.
        body = (
            <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    refresh !== undefined ? (
                        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                    ) : undefined
                }
            >
                {browseSlot}
            </ScrollView>
        );
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search/filter with zero hits is a NO-MATCH, not the browse-empty "no public
        // recipes" state. `searchValue` or an active filter distinguishes them. The browse-empty half is
        // reachable on both platforms once a rail's "see all" drops the browse slot — see the web leaf.
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
        // FlashList (U4), not ScrollView + .map: even a 2-col grid overflows a phone once several rows load, so
        // the cards must both scroll AND recycle cells. `numColumns={2}` keeps the wrapping 2-col grid (U7); v2
        // auto-measures — no `estimatedItemSize`. The back-to-browse + count are the list header, the `[Load
        // more]` pager the footer; header/search/filters stay pinned above. Pull-to-refresh (U4/L8) binds to
        // the query refetch (results only, not the browse rails); absent on web.
        body = (
            <FlashList
                role="list"
                data={results}
                numColumns={2}
                keyExtractor={(result) => result.recipe.id}
                renderItem={({ item }) => (
                    <View role="listitem" style={styles.flashCell}>
                        <RecipeDiscoveryCard
                            recipe={toRecipeCardModel(item.recipe)}
                            authorHandle={item.recipe.authorHandle}
                            sourceAttribution={item.recipe.sourceAttribution}
                            isCloning={cloningId === item.recipe.id}
                            onSelect={onSelectRecipe}
                            onClone={onClone}
                        />
                    </View>
                )}
                ListHeaderComponent={
                    <View style={styles.resultsHeader}>
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
                    </View>
                }
                ListFooterComponent={
                    loadMore?.hasMore === true ? (
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
                    ) : null
                }
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    refresh !== undefined ? (
                        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                    ) : undefined
                }
            />
        );
    }

    return (
        <View accessibilityLabel={discovery.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {discovery.heading}
            </Text>
            {/* L5 — the source switcher, same component and same position as the personal library's, so a host
                that composes this surface WITHOUT a shell tab bar still offers the way back (mobile's recipe
                shell owns its own switcher, so it passes no `tab`). */}
            {tab !== undefined && <RecipeSourceTabs tab={tab} />}
            <TextInput
                accessibilityLabel={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the
                // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
                placeholderTextColor={palette.slate}
                value={searchValue}
                onChangeText={onSearchChange}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={styles.search}
            />
            {/* Recent searches (U7): a compact list of buttons directly under the field while idle. Pressing
                one does NOT blur the field on RN (no implicit focus move), so the panel survives the tap;
                it disappears as soon as the container sets the chosen query (non-blank ⇒ result state). */}
            {showRecentSearches && (
                <View accessibilityLabel={discovery.recentSearchesLabel} style={styles.recentPanel}>
                    <View style={styles.recentHeader}>
                        <Text style={styles.recentTitle}>{discovery.recentSearchesLabel}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={discovery.clearRecentSearchesLabel}
                            onPress={recentSearches.onClear}
                            style={styles.recentClear}
                        >
                            <Text style={styles.recentClearLabel}>{discovery.clearRecentSearches}</Text>
                        </Pressable>
                    </View>
                    {recentSearches.queries.map((query) => (
                        <Pressable
                            key={query}
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(discovery.recentSearchLabel, { query })}
                            onPress={() => recentSearches.onSelect(query)}
                            style={styles.recentRow}
                        >
                            <Text style={styles.recentRowLabel}>{query}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
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
    container: {
        flex: 1,
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
    },
    heading: { fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', color: palette.charcoal },
    search: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.charcoal,
    },
    count: { fontSize: 13, fontWeight: '500', color: palette.slate },
    // The settled-failure retry — the 44pt floor every other control on this leaf already carries.
    retry: { minHeight: 44, justifyContent: 'center' },
    sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    sortChip: {
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: 6,
        minHeight: 44,
        justifyContent: 'center',
        backgroundColor: palette.pearl,
    },
    sortChipActive: { backgroundColor: palette.charcoal },
    sortLabelText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
    sortLabelActive: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.white },
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
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    // The virtualized results header — back-to-browse (when present) + the result count.
    resultsHeader: { gap: nativeTokens.spacing[3], marginBottom: nativeTokens.spacing[3] },
    // A FlashList grid cell (U4): `flex: 1` fills its `numColumns={2}` column; the horizontal padding is the
    // inter-column gutter, the bottom padding the inter-row rhythm.
    flashCell: { flex: 1, paddingHorizontal: nativeTokens.spacing[1], paddingBottom: nativeTokens.spacing[3] },
    // 2-col skeleton grid (U7 — preserved): a wrapping row of half-width cells, each an inert placeholder card.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    gridCell: { width: '48%' },
    skeletonCard: { height: 220, borderRadius: nativeTokens.radius.lg, backgroundColor: nativeTokens.borderSubtle },
    // Recent searches (U7): a card of 44pt-tall rows under the keyword field.
    recentPanel: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recentTitle: { fontSize: nativeTokens.fontSize.caption, fontWeight: '600', color: palette.slate },
    recentClear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[1] },
    recentClearLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
    recentRow: { minHeight: 44, justifyContent: 'center' },
    recentRowLabel: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.charcoal },
    backToBrowse: {
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: nativeTokens.spacing[1],
        minHeight: 44,
        justifyContent: 'center',
    },
    backToBrowseText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
});
