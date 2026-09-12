'use client';

/**
 * @module @commise/features-recipes — web discovery RESULTS (presentational, T076 / US2).
 *
 * What the discovery suspense boundary renders once a search has settled, below the frame: the curated rails while
 * browsing, the empty or no-match body, or the counted grid of public recipes — each with a Clone action — and its
 * explicit load-more control, plus the notice for a failed refresh. It fetches nothing.
 *
 * While newer results are pending (`stale`), these stay at full strength and fully usable: dimming would take the card
 * text under 4.5:1, and they can still be opened or cloned. The design-system `PendingBar` appears above them after a
 * delay. ⛔ The region is deliberately NOT `aria-busy`: JAWS hides content marked busy, which would take away the very
 * results this state keeps usable; the settled results are announced by the frame instead. The header names `query`, the term these results belong to, so it keeps
 * saying what is on screen while the field already holds the next term.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { LoadMoreControl } from '@commise/ui/load-more';
import { PendingBar } from '@commise/ui/pending-bar';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import type { FC, ReactElement } from 'react';

import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
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
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();
    const browsing = browseSlot !== undefined;

    let body: ReactElement;

    if (browsing) {
        // The curated rails ARE the default experience, not a bare relevance stream.
        body = <>{browseSlot}</>;
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search or filter with zero hits is a NO-MATCH. The empty half is reachable: a rail's
        // "see all" leaves browse with nothing searched, and `RecipeDiscoveryContainer`'s test pins that path.
        body = (
            <div>
                <p>{searching ? discovery.noMatchTitle : discovery.emptyTitle}</p>
                <p>{searching ? discovery.noMatchBody : discovery.emptyBody}</p>
            </div>
        );
    } else {
        body = (
            <div className="flex flex-col gap-4">
                {/* S5 — the header names the query these results belong to; a bare list shows just the count. */}
                <p className="text-body-sm font-medium text-slate">
                    {formatDiscoveryResultsSummary({ count: results.length, query, searching }, discovery, locale)}
                </p>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {results.map((result) => (
                        <li key={result.recipe.id}>
                            <RecipeDiscoveryCard
                                recipe={toRecipeCardModel(result.recipe)}
                                authorHandle={result.recipe.authorHandle}
                                sourceAttribution={result.recipe.sourceAttribution}
                                isCloning={cloningId === result.recipe.id}
                                onSelect={onSelectRecipe}
                                onClone={onClone}
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
