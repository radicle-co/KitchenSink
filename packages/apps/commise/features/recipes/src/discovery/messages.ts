/**
 * @module @commise/features-recipes/discovery/messages — user-facing copy for the public-discovery
 * surface (T076, US2).
 *
 * Shared, platform-neutral strings for the discovery view as a {@link LocalizedMessages} dictionary,
 * consumed by BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms
 * cannot drift on copy. The `en` set is required; adding a locale is just another key. This is scoped to
 * discovery so it can grow independently of the shared recipe-feature copy in `../messages.ts`.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the public-discovery screen (T076), rendered by both the web and native views. */
export interface DiscoveryMessages {
    /** Page/section heading for the discovery surface. */
    readonly heading: string;
    /** Accessible name of the region holding the results (or the rails) under the frame. */
    readonly resultsLabel: string;
    /** Accessible name for the search field. */
    readonly searchLabel: string;
    /** Placeholder shown inside the search field. */
    readonly searchPlaceholder: string;
    /** Singular result-count template (contains `{count}`). */
    readonly countOne: string;
    /** Plural result-count template (contains `{count}`). */
    readonly countOther: string;
    /** Query-echo results header when a search term is active (contains `{count}` and `{query}`) — S5. */
    readonly resultsForQuery: string;
    /** Visible label for the load-more button (S4). */
    readonly loadMore: string;
    /** Visible label for the load-more button while the next page is loading (S4). */
    readonly loadingMore: string;
    /** Announced beside the load-more button when the next page fails; the loaded results stay (S4). */
    readonly loadMoreError: string;
    /** The notice when refreshing the search results already on screen fails. */
    readonly refreshError: string;
    /** Accessible name for the sort control (S3). */
    readonly sortLabel: string;
    /** The sort button's text (contains `{choice}`): "Sort: Relevance". */
    readonly sortButton: string;
    /** The native sort sheet's title and the menu's name. */
    readonly sortMenuLabel: string;
    /** The native sort sheet's Close control. */
    readonly sortClose: string;
    /** Visible label for the Relevance sort. */
    readonly sortRelevance: string;
    /** Visible label for the Newest (recent) sort. */
    readonly sortNewest: string;
    /** Visible label for the Most-saved sort (the glossary retires "cloned"). */
    readonly sortMostSaved: string;
    /** Visible label for the Quickest sort. */
    readonly sortQuickest: string;
    /** Accessible label for the loading state. */
    readonly loadingLabel: string;
    /** Heading of the browse-empty state (no public recipes to show at all). */
    readonly emptyTitle: string;
    /** Body copy of the browse-empty state. */
    readonly emptyBody: string;
    /** Heading of the no-match state (an active search/filter matched nothing). */
    readonly noMatchTitle: string;
    /** Body of the no-result state caused by filters alone. */
    readonly noMatchFiltersBody: string;
    /** Heading of the no-result state caused by a search (contains `{query}`). */
    readonly noMatchQueryTitle: string;
    /** Body of the no-result state caused by a search. */
    readonly noMatchQueryBody: string;
    /** Heading of the no-result state caused by a search AND filters (contains `{query}`). */
    readonly noMatchBothTitle: string;
    /** Clears the search term. */
    readonly clearSearch: string;
    /** Clears the filters. */
    readonly clearFilters: string;
    /** The lead-in to the tag chips every no-result state ends with. */
    readonly tryThese: string;
    /** The tag chips' group name. */
    readonly tryTheseLabel: string;
    /** Message shown when discovery fails to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the error state. */
    readonly retry: string;
    /** Source-provenance template shown on a row (contains `{source}`). */
    readonly attribution: string;
    /** The author's handle on a result card (contains `{handle}`) — S1. */
    readonly authorHandle: string;
    /** Previous / next on a rail, for a fine pointer. */
    readonly previous: string;
    readonly next: string;
    /** A rail's track region name (contains `{rail}`): "Trending recipes". */
    readonly railRegion: string;
    /** Accessible name for the curated browse-rails region (U7). */
    readonly browseLabel: string;
    /** Title of the Trending rail (most-cloned). */
    readonly railTrending: string;
    /** Title of the New rail (recent). */
    readonly railNew: string;
    /** Title of the Quick rail (quickest). */
    readonly railQuick: string;
    /** Visible label of a rail's "see all" action. */
    readonly seeAll: string;
    /** Accessible-name template for a rail's "see all" action (contains `{rail}`). */
    readonly seeAllLabel: string;
    /** Section title for the cuisine shortcuts. */
    readonly cuisinesTitle: string;
    /** Accessible-name template for a cuisine shortcut (contains `{cuisine}`) — S. */
    readonly cuisineShortcutLabel: string;
    /** Shown inside a rail that settled with no recipes. */
    readonly railEmpty: string;
    /** Shown inside a rail that failed to load. */
    readonly railError: string;
    /** The notice when refreshing the rails already on screen fails. */
    readonly railsRefreshError: string;
    /** Visible label of the "back to browse" action shown after a rail's see-all. */
    readonly backToBrowse: string;
    /** Accessible name + visible title of the recent-searches panel (U7). */
    readonly recentSearchesLabel: string;
    /** Accessible-name template for one recent search (contains `{query}`, so each button is unique) — U7. */
    readonly recentSearchLabel: string;
    /** Visible label of the clear-recent-searches action. */
    readonly clearRecentSearches: string;
    /** Accessible name of the clear-recent-searches action (the visible label alone is ambiguous). */
    readonly clearRecentSearchesLabel: string;
}

export const discoveryMessages: LocalizedMessages<DiscoveryMessages> = {
    en: {
        heading: 'Discover',
        resultsLabel: 'Search results',
        searchLabel: 'Search recipes',
        searchPlaceholder: 'Search recipes',
        countOne: '{count} recipe',
        countOther: '{count} recipes',
        resultsForQuery: '{count} for “{query}”',
        loadMore: 'Load more',
        loadingMore: 'Loading…',
        loadMoreError: 'We couldn’t load more recipes.',
        refreshError: 'We couldn’t refresh these results.',
        sortLabel: 'Sort by',
        sortButton: 'Sort: {choice}',
        sortMenuLabel: 'Sort by',
        sortClose: 'Close sort menu',
        sortRelevance: 'Relevance',
        sortNewest: 'Newest',
        sortMostSaved: 'Most saved',
        sortQuickest: 'Quickest',
        loadingLabel: 'Loading recipes',
        emptyTitle: 'No public recipes yet.',
        emptyBody: 'Public recipes will show up here.',
        noMatchTitle: 'No recipes match these filters',
        noMatchFiltersBody: 'Remove a filter to see more.',
        noMatchQueryTitle: 'No recipes for “{query}”',
        noMatchQueryBody: 'Check the spelling, or try a shorter search.',
        noMatchBothTitle: 'No recipes for “{query}” with these filters',
        clearSearch: 'Clear search',
        clearFilters: 'Clear filters',
        tryThese: 'Try one of these',
        tryTheseLabel: 'Popular tags',
        errorTitle: 'We couldn’t search right now.',
        retry: 'Try again',
        attribution: 'From {source}',
        authorHandle: '@{handle}',
        previous: 'Previous',
        next: 'Next',
        railRegion: '{rail} recipes',
        browseLabel: 'Browse recipes',
        railTrending: 'Trending',
        railNew: 'New',
        railQuick: 'Quick',
        seeAll: 'See all',
        seeAllLabel: 'See all {rail}',
        cuisinesTitle: 'Browse by cuisine',
        cuisineShortcutLabel: 'Browse {cuisine} recipes',
        railEmpty: 'Nothing here yet.',
        railError: 'Couldn’t load this row.',
        railsRefreshError: 'We couldn’t refresh these recipes.',
        backToBrowse: 'Back to browse',
        recentSearchesLabel: 'Recent searches',
        recentSearchLabel: 'Search for “{query}”',
        clearRecentSearches: 'Clear',
        clearRecentSearchesLabel: 'Clear recent searches',
    },
};
