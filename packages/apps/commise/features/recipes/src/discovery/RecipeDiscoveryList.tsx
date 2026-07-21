/**
 * @module @commise/features-recipes — web public-discovery view (T076 building block, US2).
 *
 * Controlled, presentational discovery list: persistent chrome (heading + search) over a body that renders
 * one of four states — loading, error, empty, populated — derived from `status` + `results`. Every recipe
 * shown is public; each row offers a Clone action that copies it into the viewer's collection. It fetches
 * nothing; the composing app wires the search query + clone mutation to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
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

/** The loading placeholder — a busy status region with inert skeleton rows (hidden from assistive tech). */
const LoadingBody: FC<{ label: string }> = ({ label }) => (
    <div role="status" aria-label={label}>
        {[0, 1, 2].map((row) => (
            <span key={row} aria-hidden="true" />
        ))}
    </div>
);

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
        body = <LoadingBody label={discovery.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <div role="alert">
                <p>{discovery.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {discovery.retry}
                </button>
            </div>
        );
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search/filter with zero hits is a NO-MATCH, not the browse-empty "no public
        // recipes" state. `searchValue` or an active filter distinguishes them.
        const searching = searchValue.trim().length > 0 || hasActiveFilters;
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
                        className="self-center rounded-full bg-pearl px-6 py-2.5 text-body-sm font-semibold text-charcoal transition hover:bg-mist/40 disabled:opacity-60"
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
            <input
                type="search"
                aria-label={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-seafoam-light"
            />
            {filterSlot}
            {sort !== undefined && (
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
                                className={`rounded-full px-3 py-1 text-body-sm font-medium transition ${
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
