'use client';

/**
 * @module @commise/features-recipes — web public-discovery view (T076 building block, US2).
 *
 * Controlled, presentational discovery list: persistent chrome (heading + search) over a body that renders
 * one of four states — loading, error, empty, populated — derived from `status` + `results`. Every recipe
 * shown is public; each row offers a Clone action that copies it into the viewer's collection. It fetches
 * nothing; the composing app wires the search query + clone mutation to these props.
 *
 * The loading body is the shared {@link import('../card/RecipeCardGridSkeleton.js').RecipeCardGridSkeleton} —
 * ONE authoritative card-skeleton grid, also used by `RecipeList`, so the two card-grid surfaces cannot drift
 * (it previously rendered a blank body while the query was in flight). The error body is a styled card
 * surface, matching how `CollectionRecipePicker` renders a settled failure.
 *
 * The one piece of local state it owns is `searchFocused` — pure UI, no data and no side effect — because the
 * recent-search panel (U7) is an IDLE-state affordance: it appears only while focus is inside the search area
 * AND the query is blank, and the history behind it (recording, de-duplication, cap, persistence) belongs to
 * the container's `useRecentSearches`, not here.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState } from 'react';
import type { FC, ReactElement } from 'react';

import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.js';
import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
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
    recentSearches,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    // Local UI state ONLY (no data, no side effect): whether focus is inside the search area. The recent
    // searches are an idle-state shortcut, so they appear on focus and vanish once focus leaves — they must
    // never sit permanently between the field and the results.
    const [searchFocused, setSearchFocused] = useState(false);

    // Empty ≠ no-match, and browse ≠ either: an active query/filter turns the surface into a result list;
    // with neither, the curated `browseSlot` (when provided) is the default experience, not a bare stream.
    const searching = searchValue.trim().length > 0 || hasActiveFilters;
    const browsing = browseSlot !== undefined && !searching;
    // Idle + focused + something to offer: anything else (a typed query, an ACTIVE FILTER, an empty
    // history, a surface that wires no memory) renders no panel at all rather than an empty one.
    // Gate on `!searching`, not on the query alone: a filter applied from the sheet leaves the query blank,
    // so checking only `searchValue` kept this idle-only panel drawn over the result list.
    const showRecentSearches =
        recentSearches !== undefined && recentSearches.queries.length > 0 && searchFocused && !searching;

    let body: ReactElement;

    // ⚠️ ORDER IS LOAD-BEARING: `status` outranks `browsing`, NOT the other way round.
    //
    // `browsing` used to be tested FIRST, and because it is the DEFAULT state of /discover (no query, no
    // filter, rails supplied), that made the loading, error and empty branches below unreachable on the
    // surface's own default. The error branch carries the ONLY "Try again" this surface has, so a failed
    // load settled into curated rails with no failure reported and no way to recover — while /recipes, on
    // the identical failure, offered a working retry.
    //
    // The rails DO own per-rail loading/error states of their own, which is why the gap hid for so long: the
    // surface looked busy. But those cover a DIFFERENT query (`useBrowseRails`), not the container's main
    // search — the one that also feeds the facets the filter bar and cuisine shortcuts are built from. When
    // that query fails there is nothing behind the browse surface, so the honest body is the failure and its
    // retry, not partially-populated rails. (Accepted trade-off: if the main query fails while the rails
    // happen to succeed, working rails are replaced by the error card. They share an endpoint and an auth
    // context, so that split is rare, and a reachable retry beats a silent failure either way.)
    if (status === 'loading') {
        // A card skeleton grid, NOT a blank body (the previous bug): the ONE authoritative web recipe-grid
        // skeleton, shared with `RecipeList`, so discovery and the personal list cannot drift. It also carries
        // the localized label as its visible caption — an empty `role="status"` announces nothing.
        body = <RecipeCardGridSkeleton label={discovery.loadingLabel} />;
    } else if (status === 'error') {
        // A styled card surface, not bare text on a blank page — the same settled-failure treatment
        // `CollectionRecipePicker` uses, so a failure reads as a deliberate state.
        body = (
            <div role="alert" className="rounded-2xl bg-card p-6 text-body-md text-slate shadow-sm">
                <p className="font-medium text-charcoal">{discovery.errorTitle}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 inline-flex min-h-11 items-center rounded-full px-4 py-2 text-body-sm font-semibold text-ocean-dark transition hover:bg-seafoam/10 md:min-h-0"
                >
                    {discovery.retry}
                </button>
            </div>
        );
    } else if (browsing) {
        // Settled and idle: the curated rails ARE the default experience, not a bare relevance stream.
        body = <>{browseSlot}</>;
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search/filter with zero hits is a NO-MATCH, not the browse-empty "no public
        // recipes" state. `searchValue` or an active filter distinguishes them.
        //
        // The browse-empty half (`emptyTitle`/`emptyBody`) is REACHABLE on web, and is not dead copy: the
        // container passes `browseSlot` only while `browsing`, so a viewer who leaves browse via a rail's
        // "see all" (`browseDismissed`) has no query and no filter AND no browse slot — exactly this branch.
        // `RecipeDiscoveryContainer`'s own test pins that path so it cannot be optimised away by accident.
        body = (
            <div>
                <p>{searching ? discovery.noMatchTitle : discovery.emptyTitle}</p>
                <p>{searching ? discovery.noMatchBody : discovery.emptyBody}</p>
            </div>
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
        body = (
            <div className="flex flex-col gap-4">
                <p className="text-body-sm font-medium text-slate">{header}</p>
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
                            />
                        </li>
                    ))}
                </ul>
                {loadMore?.hasMore === true && (
                    // S4 — explicit "Load more" (no infinite scroll); it vanishes once the last page is reached.
                    <button
                        type="button"
                        onClick={loadMore.onLoadMore}
                        disabled={loadMore.loading}
                        aria-busy={loadMore.loading || undefined}
                        className="inline-flex min-h-11 items-center justify-center self-center rounded-full bg-pearl px-6 py-2.5 text-body-sm font-semibold text-charcoal transition hover:bg-mist/40 disabled:opacity-60 md:min-h-0"
                    >
                        {loadMore.loading ? discovery.loadingMore : discovery.loadMore}
                    </button>
                )}
            </div>
        );
    }

    return (
        <section aria-label={discovery.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            <header>
                <h1 className="font-display text-display-md font-bold text-charcoal">{discovery.heading}</h1>
            </header>
            {/* The field + its recent-search panel form ONE focus scope: `focusout` bubbles here carrying the
                element focus is moving TO, so a click that moves focus INTO the panel keeps it mounted long
                enough for that click to land — the classic "the suggestion vanished under my cursor" bug. */}
            <div
                className="flex flex-col gap-2"
                onFocus={() => setSearchFocused(true)}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                        setSearchFocused(false);
                    }
                }}
            >
                <input
                    type="search"
                    aria-label={discovery.searchLabel}
                    placeholder={discovery.searchPlaceholder}
                    value={searchValue}
                    onChange={(event) => onSearchChange(event.target.value)}
                    // Placeholder text is TEXT: `placeholder:text-slate`, never `mist` (palette JSDoc,
                    // `@commise/ui`'s `tokens/colors.ts`). The `border-border` hairline stays `mist`-derived.
                    className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-slate focus:ring-2 focus:ring-seafoam-light"
                />
                {showRecentSearches && (
                    <section
                        aria-label={discovery.recentSearchesLabel}
                        className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-caption font-semibold uppercase tracking-wide text-slate">
                                {discovery.recentSearchesLabel}
                            </p>
                            <button
                                type="button"
                                aria-label={discovery.clearRecentSearchesLabel}
                                onClick={recentSearches.onClear}
                                // Touch floor: `min-h-11` (44px) at base — the native leaf's `styles.recentClear`
                                // already carries the same 44pt floor — reset at `md:` so the desktop density
                                // of this small header control is unchanged.
                                className="inline-flex min-h-11 items-center rounded-full px-2 py-1 text-caption font-semibold text-ocean-dark transition hover:bg-mist/20 md:min-h-0"
                            >
                                {discovery.clearRecentSearches}
                            </button>
                        </div>
                        <ul className="flex flex-col">
                            {recentSearches.queries.map((query) => (
                                <li key={query}>
                                    <button
                                        type="button"
                                        aria-label={fillTemplate(discovery.recentSearchLabel, { query })}
                                        onClick={() => recentSearches.onSelect(query)}
                                        className="inline-flex min-h-11 w-full items-center rounded-lg px-2 py-2 text-left text-body-sm text-charcoal transition hover:bg-pearl md:min-h-0"
                                    >
                                        {query}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
            {filterSlot}
            {onExitToBrowse !== undefined && !browsing && (
                <button
                    type="button"
                    onClick={onExitToBrowse}
                    className="inline-flex min-h-11 items-center self-start rounded-full px-3 py-1 text-body-sm font-semibold text-ocean-dark transition hover:bg-mist/20 md:min-h-0"
                >
                    {discovery.backToBrowse}
                </button>
            )}
            {sort !== undefined && !browsing && (
                <div role="radiogroup" aria-label={discovery.sortLabel} className="flex flex-wrap gap-2">
                    {DISCOVERY_SORTS.map((option) => {
                        const checked = sort.active === option;

                        return (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                onClick={() => sort.onChange(option)}
                                // Touch floor: `min-h-11` at base, reset at `md:` so the desktop chip density is
                                // unchanged — the same treatment `RecipeList`'s facet chips and the native
                                // leaf's `styles.sortChip` (`minHeight: 44`) already carry.
                                className={`inline-flex min-h-11 items-center rounded-full px-3 py-1 text-body-sm font-medium transition md:min-h-0 ${
                                    checked ? 'bg-charcoal text-white' : 'bg-pearl text-slate hover:bg-mist/40'
                                }`}
                            >
                                {sortLabel(option, discovery)}
                            </button>
                        );
                    })}
                </div>
            )}
            {body}
        </section>
    );
};
