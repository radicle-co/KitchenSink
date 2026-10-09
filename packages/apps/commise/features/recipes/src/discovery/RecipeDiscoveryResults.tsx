'use client';

/**
 * @module @commise/features-recipes — web discovery RESULTS (presentational, T076 / US2; slice 5 of the UI overhaul).
 *
 * What the discovery suspense boundary renders once a search has settled, below the frame: the curated rails while
 * browsing; a no-result state — a search, filters, or both — that always ends in tag chips and the Trending rail, so the
 * page is never a dead end; or the cards in the variant the host decided (compact 2-up below a 600 container, grid from
 * 600) with their Save a copy footers and an explicit load-more control, plus the notice for a failed refresh
 * (`docs/design/uiOverhaul/buildSpec.md` §4.5, §4.6). It fetches nothing. The count line is the frame's: one element that
 * is both the visible line and the polite live region.
 *
 * While newer results are pending (`stale`), these stay at full strength and fully usable: dimming would take the card
 * text under 4.5:1, and they can still be opened or copied. The design-system `PendingBar` appears above them after a
 * delay. ⛔ The region is deliberately NOT `aria-busy`: JAWS hides content marked busy, which would take away the very
 * results this state keeps usable.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { LoadMoreControl } from '@commise/ui/load-more';
import { PendingBar } from '@commise/ui/pending-bar';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import type { FC, ReactElement } from 'react';

import { COMPACT_GRID_CLASS, GRID_CELL_CLASS, LIBRARY_GRID_CLASS } from '../card/cardGridClass.js';
import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
import type { DiscoveryNoResultControls, RecipeDiscoveryResultsProps } from './model.js';
import { noResultTitleOf, type NoResultKind } from './noResults.js';

/**
 * A no-result state. It is a status region, so it is announced; its heading takes no focus — focus stays in the search
 * field (§4.6).
 */
const NoResult: FC<{
    readonly kind: NoResultKind | undefined;
    readonly query: string;
    readonly noResult: DiscoveryNoResultControls;
}> = ({ kind, query, noResult }) => {
    const discovery = useMessages(discoveryMessages);
    const narrowed = kind !== undefined;

    return (
        <div className="flex flex-col gap-6">
            <div role="status" className="flex flex-col items-start gap-3 py-6">
                <h2 className="text-section-title text-ink">{noResultTitleOf(kind, query, discovery)}</h2>
                {kind === 'query' ? <p className="text-body text-ink-muted">{discovery.noMatchQueryBody}</p> : null}
                {kind === 'filters' ? <p className="text-body text-ink-muted">{discovery.noMatchFiltersBody}</p> : null}
                {narrowed ? (
                    <div className="flex flex-wrap gap-3">
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
                    </div>
                ) : null}
            </div>
            {narrowed && noResult.tryTags.length > 0 ? (
                <section className="flex flex-col gap-3">
                    <p className="text-label text-ink">{discovery.tryThese}</p>
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
                </section>
            ) : null}
            {narrowed ? noResult.trendingSlot : null}
        </div>
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
    hrefOf,
    onSelectRecipe,
    noResult,
    renderNutrition,
    loadMore,
    refreshNotice,
}) => {
    const discovery = useMessages(discoveryMessages);
    const browsing = browseSlot !== undefined;

    let body: ReactElement;

    if (browsing) {
        // The curated rails ARE the default experience, not a bare relevance stream.
        body = <>{browseSlot}</>;
    } else if (results.length === 0) {
        body = <NoResult kind={kind} query={query} noResult={noResult} />;
    } else {
        const isGrid = cardVariant === 'grid';

        body = (
            <div className="flex flex-col gap-4">
                <ul className={isGrid ? LIBRARY_GRID_CLASS : COMPACT_GRID_CLASS}>
                    {results.map((result) => (
                        <li key={result.recipe.id} className={isGrid ? GRID_CELL_CLASS : undefined}>
                            <RecipeDiscoveryCard
                                recipe={toRecipeCardModel(result.recipe)}
                                variant={cardVariant}
                                authorHandle={result.recipe.authorHandle}
                                sourceAttribution={result.recipe.sourceAttribution}
                                saveCopy={saveCopy.stateOf(result.recipe.id)}
                                {...(hrefOf === undefined ? {} : { href: hrefOf(result.recipe.id) })}
                                onSelect={onSelectRecipe}
                                onSave={saveCopy.save}
                                nutrition={renderNutrition?.(result.recipe.id)}
                            />
                        </li>
                    ))}
                </ul>
                {/* S4 — explicit "Load more" (no infinite scroll); it vanishes once the last page is reached. */}
                {loadMore !== undefined && (
                    <LoadMoreControl
                        {...loadMore}
                        labels={{
                            loadMore: discovery.loadMore,
                            loadingMore: discovery.loadingMore,
                            retry: discovery.retry,
                            failed: discovery.loadMoreError,
                        }}
                    />
                )}
            </div>
        );
    }

    return (
        // `relative`: the pending bar is absolutely placed in the frame's gap above this region.
        <section aria-label={discovery.resultsLabel} className="relative flex flex-col gap-6">
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
        </section>
    );
};
