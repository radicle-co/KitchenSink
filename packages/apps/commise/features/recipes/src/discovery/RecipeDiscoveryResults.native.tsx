/**
 * @module @commise/features-recipes — native discovery RESULTS (presentational, T076 / US2).
 *
 * The React Native twin of `RecipeDiscoveryResults`: the rails while browsing, the empty or no-match body, or the
 * counted two-column grid of public recipes with its load-more footer, plus the notice for a failed refresh. It fetches
 * nothing.
 *
 * The results are a `FlashList`, which both scrolls and recycles cells, with pull-to-refresh bound to the result list.
 * The rails bring their own scroll container and their own pull (`RecipeBrowseRails`), so while browsing this leaf
 * renders the slot as it is — a pull there refreshes the rails on screen, never the results hidden behind them.
 *
 * While newer results are pending (`stale`) the results stay readable and usable and the design-system `PendingBar`
 * appears after its delay. ⛔ Not `aria-busy`: a screen reader may hide busy content, and these results must stay
 * readable; the frame announces the settled ones. The bar sits on this container, OUTSIDE the list, so it does not
 * scroll away with the header.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { LoadMoreControl } from '@commise/ui/load-more';
import { nativeTokens } from '@commise/ui/native';
import { PendingBar } from '@commise/ui/pending-bar';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { FlashList } from '@shopify/flash-list';
import type { FC, ReactElement } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import { formatDiscoveryResultsSummary, type RecipeDiscoveryResultsProps } from './model.js';

export const RecipeDiscoveryResults: FC<RecipeDiscoveryResultsProps> = ({
    results,
    query,
    searching,
    stale,
    browseSlot,
    cloningId,
    onSelectRecipe,
    onClone,
    renderNutrition,
    loadMore,
    refreshNotice,
    refresh,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();
    const browsing = browseSlot !== undefined;
    const refreshControl =
        refresh === undefined ? undefined : (
            <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
        );

    let body: ReactElement;

    if (browsing) {
        body = <>{browseSlot}</>;
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search or filter with zero hits is a NO-MATCH, not the empty-catalogue state.
        body = (
            <View>
                <Text>{searching ? discovery.noMatchTitle : discovery.emptyTitle}</Text>
                <Text>{searching ? discovery.noMatchBody : discovery.emptyBody}</Text>
            </View>
        );
    } else {
        // FlashList (U4): `numColumns={2}` keeps the wrapping grid (U7), and v2 auto-measures — no `estimatedItemSize`.
        body = (
            <FlashList
                role="list"
                data={results}
                numColumns={2}
                keyExtractor={(result) => result.recipe.id}
                renderItem={({ item }) => (
                    <View role="listitem" style={styles.cell}>
                        {/* ONE promise, N slots: the host's renderer closes over this page's single nutrition batch. */}
                        <RecipeDiscoveryCard
                            recipe={toRecipeCardModel(item.recipe)}
                            authorHandle={item.recipe.authorHandle}
                            sourceAttribution={item.recipe.sourceAttribution}
                            isCloning={cloningId === item.recipe.id}
                            onSelect={onSelectRecipe}
                            onClone={onClone}
                            nutrition={renderNutrition?.(item.recipe.id)}
                        />
                    </View>
                )}
                ListHeaderComponent={
                    // S5 — the header names the query these results belong to.
                    <Text style={styles.count}>
                        {formatDiscoveryResultsSummary({ count: results.length, query, searching }, discovery, locale)}
                    </Text>
                }
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
        <View role="region" aria-label={discovery.resultsLabel} style={styles.container}>
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
    count: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '500',
        color: palette.slate,
        marginBottom: nativeTokens.spacing[3],
    },
    // A grid cell: `flex: 1` fills its column; the horizontal padding is the gutter, the bottom padding the row rhythm.
    cell: { flex: 1, paddingHorizontal: nativeTokens.spacing[1], paddingBottom: nativeTokens.spacing[3] },
});
