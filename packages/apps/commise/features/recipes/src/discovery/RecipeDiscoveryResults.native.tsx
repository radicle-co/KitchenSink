/**
 * @module @commise/features-recipes — native discovery RESULTS (presentational, T076 / US2; slice 5 of the UI overhaul).
 *
 * The React Native twin of `RecipeDiscoveryResults`: the rails while browsing; a no-result state — a search, filters, or
 * both — that always ends in tag chips and the Trending rail, so the page is never a dead end; or the cards in the
 * variant the host decided (compact 2-up below a 600 container, grid from 600) in a virtualised list with the load-more
 * footer, plus the notice for a failed refresh (`docs/design/uiOverhaul/buildSpec.md` §4.5, §4.6). It fetches nothing.
 * The count line is the frame's.
 *
 * The results are a `FlashList`, which both scrolls and recycles cells, with pull-to-refresh bound to the result list.
 * The rails bring their own scroll container and their own pull (`RecipeBrowseRails`), so while browsing this leaf
 * renders the slot as it is — a pull there refreshes the rails on screen, never the results hidden behind them.
 *
 * While newer results are pending (`stale`) the results stay readable and usable and the design-system `PendingBar`
 * appears after its delay. ⛔ Not `aria-busy`: a screen reader may hide busy content, and these results must stay
 * readable. The bar sits on this container, OUTSIDE the list, so it does not scroll away with the header. Colour is read
 * from the theme at render (D15).
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { contentWidthOf } from '@commise/ui/container-class';
import { LoadMoreControl } from '@commise/ui/load-more';
import { nativeTokens } from '@commise/ui/native';
import { PendingBar } from '@commise/ui/pending-bar';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { useTheme } from '@commise/ui/theme';
import { FlashList } from '@shopify/flash-list';
import type { FC, ReactElement } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { GRID_GAP, libraryGridColumnsOf } from '../card/cardGridLayout.js';
import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import type { DiscoveryNoResultControls, RecipeDiscoveryResultsProps } from './model.js';
import { noResultTitleOf, type NoResultKind } from './noResults.js';

/** Compact results are two to a row. */
const COMPACT_COLUMNS = 2;

/** A no-result state: its status region, the tag chips and the Trending rail. */
const NoResult: FC<{
    readonly kind: NoResultKind | undefined;
    readonly query: string;
    readonly noResult: DiscoveryNoResultControls;
    readonly scrollBind: ScrollBind | undefined;
}> = ({ kind, query, noResult, scrollBind }) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const narrowed = kind !== undefined;

    return (
        <ScrollView {...scrollBind} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.noResult}>
            <View collapsable={false} accessibilityLiveRegion="polite" role="status" style={styles.status}>
                <Text role="heading" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>
                    {noResultTitleOf(kind, query, discovery)}
                </Text>
                {kind === 'query' ? (
                    <Text style={[styles.body, { color: colors.inkMuted }]}>{discovery.noMatchQueryBody}</Text>
                ) : null}
                {kind === 'filters' ? (
                    <Text style={[styles.body, { color: colors.inkMuted }]}>{discovery.noMatchFiltersBody}</Text>
                ) : null}
                {narrowed ? (
                    <View style={styles.actions}>
                        {kind !== 'query' ? (
                            <Button
                                variant={kind === 'both' ? 'primary' : 'secondary'}
                                icon="x"
                                onPress={noResult.onClearFilters}
                            >
                                {discovery.clearFilters}
                            </Button>
                        ) : null}
                        {kind !== 'filters' ? (
                            <Button variant="secondary" icon="x" onPress={noResult.onClearSearch}>
                                {discovery.clearSearch}
                            </Button>
                        ) : null}
                    </View>
                ) : null}
            </View>
            {narrowed && noResult.tryTags.length > 0 ? (
                <View style={styles.tryThese}>
                    <Text style={[styles.label, { color: colors.ink }]}>{discovery.tryThese}</Text>
                    <ChipRow mode="filter" label={discovery.tryTheseLabel} overflow="wrap">
                        {noResult.tryTags.map((tag) => (
                            <Chip
                                key={tag}
                                kind="filter"
                                label={tag}
                                selected={false}
                                onPress={() => noResult.onPickTag(tag)}
                            />
                        ))}
                    </ChipRow>
                </View>
            ) : null}
            {narrowed ? noResult.trendingSlot : null}
        </ScrollView>
    );
};

export const RecipeDiscoveryResults: FC<RecipeDiscoveryResultsProps> = ({
    results,
    query,
    kind,
    stale,
    browseSlot,
    cardVariant,
    saveCopy,
    onSelectRecipe,
    noResult,
    renderNutrition,
    loadMore,
    refreshNotice,
    refresh,
    scrollBind,
}) => {
    const { width } = useWindowDimensions();
    const discovery = useMessages(discoveryMessages);
    const browsing = browseSlot !== undefined;
    const columns = cardVariant === 'compact' ? COMPACT_COLUMNS : libraryGridColumnsOf(contentWidthOf(width));
    const refreshControl =
        refresh === undefined ? undefined : (
            <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
        );

    let body: ReactElement;

    if (browsing) {
        body = <>{browseSlot}</>;
    } else if (results.length === 0) {
        body = <NoResult kind={kind} query={query} noResult={noResult} scrollBind={scrollBind} />;
    } else {
        // FlashList (U4): the wrapping grid (U7), and v2 auto-measures — no `estimatedItemSize`. Width-derived columns, so
        // a tablet gets the columns a tablet holds rather than a phone layout stretched.
        body = (
            <FlashList
                // A new column count is a new layout: keying on it makes FlashList measure afresh.
                key={`${cardVariant}-${String(columns)}`}
                {...scrollBind}
                role="list"
                data={results}
                numColumns={columns}
                keyExtractor={(result) => result.recipe.id}
                renderItem={({ item }) => (
                    <View collapsable={false} role="listitem" style={styles.cell}>
                        {/* ONE promise, N slots: the host's renderer closes over this page's single nutrition batch. */}
                        <RecipeDiscoveryCard
                            recipe={toRecipeCardModel(item.recipe)}
                            variant={cardVariant}
                            authorHandle={item.recipe.authorHandle}
                            sourceAttribution={item.recipe.sourceAttribution}
                            saveCopy={saveCopy.stateOf(item.recipe.id)}
                            onSelect={onSelectRecipe}
                            onSave={saveCopy.save}
                            nutrition={renderNutrition?.(item.recipe.id)}
                        />
                    </View>
                )}
                ListFooterComponent={
                    loadMore === undefined ? null : (
                        <LoadMoreControl
                            {...loadMore}
                            labels={{
                                loadMore: discovery.loadMore,
                                loadingMore: discovery.loadingMore,
                                retry: discovery.retry,
                                failed: discovery.loadMoreError,
                            }}
                        />
                    )
                }
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                refreshControl={refreshControl}
            />
        );
    }

    return (
        <View collapsable={false} role="region" aria-label={discovery.resultsLabel} style={styles.container}>
            <PendingBar pending={stale} />
            {refreshNotice !== undefined && (
                <RefreshNotice
                    // Mounted while browsing too, so its announcement region exists before the results return; the
                    // notice describes the results, so it only reports while they are on screen.
                    failed={refreshNotice.failed && !browsing}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: discovery.refreshError, retry: discovery.retry }}
                />
            )}
            {body}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, gap: nativeTokens.spacing[4] },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: nativeTokens.spacing[5] },
    // A grid cell: `flex: 1` fills its column; the horizontal padding is half the gap, the bottom padding the row rhythm.
    cell: { flex: 1, paddingHorizontal: GRID_GAP / 2, paddingBottom: GRID_GAP },
    noResult: { gap: nativeTokens.spacing[6], paddingBottom: nativeTokens.spacing[5] },
    status: { gap: nativeTokens.spacing[3], alignItems: 'flex-start', paddingVertical: nativeTokens.spacing[6] },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    tryThese: { gap: nativeTokens.spacing[3] },
    sectionTitle: { ...nativeTokens.type.sectionTitle },
    body: { ...nativeTokens.type.body },
    label: { ...nativeTokens.type.label },
});
