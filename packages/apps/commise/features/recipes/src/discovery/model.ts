/**
 * @module @commise/features-recipes — public-discovery model layer (T076).
 *
 * Pure, platform-agnostic types + the search-result projection shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) discovery views, so the two renders can never drift on shape. No React, no platform
 * APIs. The count/template copy-formatting primitives are reused from the list model (`../list/model.js`)
 * — one authoritative implementation of pluralization + placeholder filling for the whole feature.
 */
import type { Locale } from '@commise/i18n';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { ReactNode } from 'react';

import { RecipeSearchSortBy, type RecipeSearchResult } from '@kitchensink/recipe-core';
import type { RecipeSearchQuery } from '@kitchensink/schema-recipe';

import type { RecipeCardModel } from '../card/model.js';
import type { SaveCopy, SaveCopyState } from '../hooks/useSaveCopy.js';
import { filtersToSearchParams, hasActiveFilters, type RecipeFilterState } from '../filters/model.js';
import { fillTemplate, formatRecipeCount, type RecipeListRefreshControl } from '../list/model.js';
import type { DiscoveryMessages } from './messages.js';
import { noResultTitleOf, type NoResultKind } from './noResults.js';
import type { RefreshNoticeControl } from '../refresh/model.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';

/**
 * The sort options the discovery UI offers (S3), in display order — a subset of {@link RecipeSearchSortBy}
 * (the `title` sort is a library concern, not a discovery one). Backed by W8-a.9 (`most-cloned`, `quickest`).
 */
export const DISCOVERY_SORTS: readonly RecipeSearchSortBy[] = [
    RecipeSearchSortBy.RELEVANCE,
    RecipeSearchSortBy.RECENT,
    RecipeSearchSortBy.MOST_CLONED,
    RecipeSearchSortBy.QUICKEST,
];

/**
 * Whether a menu value is one of the discovery sorts. A menu reports a string; only a known key is passed on.
 *
 * @param value - The chosen value.
 * @returns `true` for a sort Discover offers.
 */
export const isDiscoverySort = (value: string): value is RecipeSearchSortBy =>
    (DISCOVERY_SORTS as readonly string[]).includes(value);

/**
 * The visible label of a discovery sort option (S3). A sort discovery does not offer (the library's `title`) reads as
 * relevance, the order a discovery search falls back to.
 *
 * @param sort - The sort to label.
 * @param messages - The discovery copy.
 * @returns The option's label.
 */
export const discoverySortLabel = (
    sort: RecipeSearchSortBy,
    messages: Pick<DiscoveryMessages, 'sortRelevance' | 'sortNewest' | 'sortMostSaved' | 'sortQuickest'>,
): string => {
    switch (sort) {
        case RecipeSearchSortBy.RECENT:
            return messages.sortNewest;
        case RecipeSearchSortBy.MOST_CLONED:
            return messages.sortMostSaved;
        case RecipeSearchSortBy.QUICKEST:
            return messages.sortQuickest;
        default:
            return messages.sortRelevance;
    }
};

/**
 * How long the keyword search box must settle (no keystroke) before its value feeds the network search
 * (U7). The per-keystroke cost is the FETCH, so both platforms hold an immediate local echo for the input
 * and debounce only the value passed to `useInfiniteSearchRecipes` by this window. Single-sourced here so
 * web and native cannot drift on the debounce budget.
 */
export const DISCOVERY_SEARCH_DEBOUNCE_MS = 250;

/**
 * The curated browse rails shown when discovery has no active query/filter (U7, net-new). Each rail is one
 * fixed-sort search over the SAME visibility-scoped `useInfiniteSearchRecipes`, so a rail never surfaces a
 * recipe the viewer couldn't otherwise see. Ordered as displayed: what's catching on, what's fresh, what's
 * fast.
 */
export type RecipeBrowseRailId = 'trending' | 'new' | 'quick';

/** A browse rail's identity + the search sort that populates it. */
export interface RecipeBrowseRailDefinition {
    readonly id: RecipeBrowseRailId;
    readonly sortBy: RecipeSearchSortBy;
}

/** The browse rails, in display order (Trending → New → Quick) — a tuple, so a positional read of it is compile-checked. */
export const RECIPE_BROWSE_RAILS = [
    { id: 'trending', sortBy: RecipeSearchSortBy.MOST_CLONED },
    { id: 'new', sortBy: RecipeSearchSortBy.RECENT },
    { id: 'quick', sortBy: RecipeSearchSortBy.QUICKEST },
] as const satisfies readonly RecipeBrowseRailDefinition[];

/** A single browse rail is a teaser row, not the full list — cap each rail's fetch to a small page. */
export const RECIPE_BROWSE_RAIL_PAGE_SIZE = 12;

/**
 * What a rail reads: its own sort, capped to the teaser page. The ONE definition of a rail's search, so the rail's
 * suspense read, the rails' refresh observers and any page prefetch key the same cache entry.
 *
 * @param rail - The rail to read.
 * @returns The search params for that rail.
 */
export const browseRailSearchParams = ({ sortBy }: RecipeBrowseRailDefinition): RecipeSearchQuery => ({
    sortBy,
    pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE,
});

/**
 * Everything a discovery search runs on, as the viewer has set it. Both platforms' containers hold these (web in the
 * URL plus local state, native in state) and defer them as ONE value, so the previous results stay on screen until the
 * next ones settle.
 */
export interface RecipeDiscoveryCriteria {
    readonly filters: RecipeFilterState;
    /** The search term that runs — the DEBOUNCED one, not every keystroke. */
    readonly query: string;
    readonly sortBy: RecipeSearchSortBy;
    /**
     * Whether a rail's "see all" left browse for the full list. It changes nothing that is fetched, but it rides with the
     * criteria so the rails stay on screen until the list that replaces them has settled.
     */
    readonly browseDismissed: boolean;
}

/**
 * The search params a discovery search sends. The ONE definition of the main search's key, shared by the page's
 * prefetch and both platforms' containers.
 *
 * @param criteria - The criteria to search on.
 * @returns The filters and the trimmed term, plus the sort.
 */
export const discoverySearchParams = ({
    filters,
    query,
    sortBy,
}: Pick<RecipeDiscoveryCriteria, 'filters' | 'query' | 'sortBy'>): RecipeSearchQuery => ({
    ...filtersToSearchParams(filters, query),
    sortBy,
});

/**
 * Whether the viewer is searching: a non-blank term or any active filter. Searching turns discovery into a result
 * list, and zero hits into a no-match rather than an empty catalogue.
 *
 * @param criteria - The term and filters to judge.
 * @returns `true` when anything narrows the search.
 */
export const isDiscoverySearching = ({ filters, query }: Pick<RecipeDiscoveryCriteria, 'filters' | 'query'>): boolean =>
    query.trim().length > 0 || hasActiveFilters(filters);

/**
 * Whether discovery shows the curated rails: nothing is searched and no rail's "see all" has left browse.
 *
 * @param criteria - The criteria to judge.
 * @returns `true` when the rails are the body.
 */
export const isDiscoveryBrowsing = (criteria: RecipeDiscoveryCriteria): boolean =>
    !criteria.browseDismissed && !isDiscoverySearching(criteria);

/**
 * The recipe ids of a discovery search's FETCHED PAGES, one list per page. Pure.
 *
 * The shape the deferred calorie lookup batches on (ADR-0021 §6): one request per page, so "load more" asks only about
 * the page it added and leaves every figure already on screen settled. Page boundaries, empty pages and an id a later
 * page repeats are all handed through untouched — skipping an empty page and letting the first page win a repeat are
 * the lookup's rules, not this projection's.
 *
 * @param pages - The search's fetched pages, in the order they loaded.
 * @returns Each page's recipe ids, in result order.
 */
export const recipeIdPagesOf = (
    pages: readonly { readonly results: readonly RecipeSearchResult[] }[],
): readonly (readonly string[])[] => pages.map((page) => page.results.map((result) => result.recipe.id));

/** The facts the results header states: how many results, the term they belong to, and what narrowed the search. */
export interface RecipeDiscoveryResultsSummary {
    /** How many recipes the search matched in all (the response's total, not the pages loaded so far). */
    readonly count: number;
    readonly query: string;
    /** What narrowed the search, or `undefined` for none: zero results are then an empty catalogue. */
    readonly kind: NoResultKind | undefined;
}

/**
 * The results header's sentence (S5), and the text announced when results settle — one formatter, so the visible
 * header and the announcement cannot say different things. It names the query the results BELONG TO, which is what
 * tells a viewer what stale results on screen are while newer ones are pending.
 *
 * @param summary - The results' count, term and narrowing.
 * @param messages - The discovery copy.
 * @param locale - The locale whose plural rules count the results.
 * @returns "12 recipes for “lamb”" (or just the count with no term), or the no-result heading when there are none.
 */
export const formatDiscoveryResultsSummary = (
    { count, query, kind }: RecipeDiscoveryResultsSummary,
    messages: Pick<
        DiscoveryMessages,
        | 'countOne'
        | 'countOther'
        | 'resultsForQuery'
        | 'noMatchTitle'
        | 'noMatchQueryTitle'
        | 'noMatchBothTitle'
        | 'emptyTitle'
    >,
    locale: Locale,
): string => {
    if (count === 0) {
        return noResultTitleOf(kind, query, messages);
    }

    const counted = formatRecipeCount(count, { one: messages.countOne, other: messages.countOther }, locale);
    const term = query.trim();

    return term.length > 0 ? fillTemplate(messages.resultsForQuery, { count: counted, query: term }) : counted;
};

/**
 * One browse rail as the rails block renders it: its identity (which titles it), its "see all", and its BODY. The body
 * is whatever the rail's own read boundary renders — loading, a load error, or {@link RecipeBrowseRailResultsProps} — so
 * each rail loads and fails on its own while the block keeps every heading on screen.
 */
export interface RecipeBrowseRailView {
    readonly id: RecipeBrowseRailId;
    /** Reveal the full sorted list for this rail (leaves browse for the result list, U7). */
    readonly onSeeAll: () => void;
    /** The rail's content under its heading. */
    readonly body: ReactNode;
    /**
     * Changes whenever this rail's OWN Try again is pressed. That button unmounts as the rail reloads, so the rail's
     * heading takes focus instead of `<body>` (SC 2.4.3). A plain counter, so the view stays presentational: the
     * container that owns the retry counts it.
     */
    readonly headingFocusSignal: number;
}

/** A cuisine shortcut chip in the browse view — selecting one applies a cuisine filter (leaving browse). */
export interface RecipeBrowseCuisineShortcut {
    readonly value: string;
    readonly onSelect: () => void;
}

/**
 * Props for the curated browse-rails block (U7) — the presentational body discovery renders while nothing is searched:
 * each rail's heading and "see all" over its body, then the cuisine shortcuts derived from the search facets. It fetches
 * nothing; the composing container gives every rail its own read boundary.
 */
export interface RecipeBrowseRailsProps {
    readonly rails: readonly RecipeBrowseRailView[];
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    /**
     * Optional notice for a failed refresh of the rails on screen — ONE for the block, not one per rail: the rails read
     * the same endpoint, so they fail together, and three notices would be three announcements for one outage.
     */
    readonly refreshNotice?: RefreshNoticeControl;
    /**
     * Pull-to-refresh on the rails — mobile only; the web leaf ignores it. It refreshes THE RAILS, which is what is on
     * screen while browsing; the results' own pull refreshes the result list.
     */
    readonly refresh?: RecipeListRefreshControl;
    /**
     * The screen's scroll host's bind for this, its one vertical scroller (blueprint A7) — native only: the host reads
     * the scroll (the floating create button, the tab's second tap). Web's document scrolls, so the web leaf ignores it.
     */
    readonly scrollBind?: ScrollBind;
}

/** Props for one browse rail's settled RESULTS: a horizontal strip of discovery cards, or the rail's empty note. */
export interface RecipeBrowseRailResultsProps {
    readonly results: readonly RecipeSearchResult[];
    /** Each card's Save a copy control (`useSaveCopy`). */
    readonly saveCopy: SaveCopy;
    /** Where a recipe's card leads, which makes it a real link on web. Native has no URLs and ignores it. */
    readonly hrefOf?: (recipeId: string) => string;
    readonly onSelectRecipe: (id: string) => void;
    /**
     * Render one card's deferred per-serving calorie figure (see {@link RenderRecipeNutrition}); the host closes over
     * this rail's batch promise. The rails are the default state of Discover, so a host that omits it leaves the
     * screen's opening view the only card grid in the product with no figure.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
}

/** Props for one browse rail's LOAD ERROR body: that rail failed with nothing loaded. */
export interface RecipeBrowseRailLoadErrorProps {
    /** Retry this rail's read. */
    readonly onRetry: () => void;
}

/**
 * The recent-search memory offered on the keyword field (U7). The view is purely presentational about it: it
 * decides only WHEN the panel is visible (the search field focused AND the query blank — the idle/browse
 * state) and renders one button per query; the container owns the history itself via `useRecentSearches`
 * (what gets recorded, de-duplication, the cap, persistence).
 */
export interface RecipeRecentSearchesControl {
    /** The recent searches, newest first (already de-duplicated + capped by the model). */
    readonly queries: readonly string[];
    /** Run this recent search — the container sets it as the query, which re-runs the search. */
    readonly onSelect: (query: string) => void;
    /** Forget every recent search. */
    readonly onClear: () => void;
}

/** The sort control (S3): the active sort and a change callback. Absent → the view renders no sort control. */
export interface RecipeDiscoverySortControl {
    readonly active: RecipeSearchSortBy;
    readonly onChange: (sort: RecipeSearchSortBy) => void;
}

/**
 * Props for the footer of a Discover card: the author (or the source of an imported recipe), and the Save a copy control
 * in the state the copy is in. Presentational — it sends nothing itself.
 */
export interface DiscoveryFooterProps {
    /** The recipe's title, so the control is named for the recipe it copies. */
    readonly title: string;
    /** The author's handle, when the recipe carries one. */
    readonly authorHandle?: string;
    /** Human-readable provenance (e.g. `Serious Eats`) for an imported recipe with no author handle. */
    readonly sourceAttribution?: string;
    readonly state: SaveCopyState;
    /** Make a copy; the card does not call it while a copy is saving or saved. */
    readonly onSave: () => void;
}

/**
 * Props for a single public-recipe search result card (S1): the shared `RecipeCard` in the variant the host
 * decided (`cardVariantOf`), with the Discover footer in its `footer` slot.
 */
export interface RecipeDiscoveryCardProps {
    /** The card view-model projected from the search hit's recipe. */
    readonly recipe: RecipeCardModel;
    /** `grid` from a 600 container, `compact` below it; a Discover rail card is always `grid`. */
    readonly variant: 'grid' | 'compact';
    /** The author's handle (`@handle`), when the recipe carries one. */
    readonly authorHandle?: string;
    /** Human-readable provenance for an imported recipe, when present. */
    readonly sourceAttribution?: string;
    /** The Save a copy control's state for this recipe. */
    readonly saveCopy: SaveCopyState;
    /** Where the card leads, which makes it a real link on web. */
    readonly href?: string;
    /** Invoked with the recipe id when the card is activated. */
    readonly onSelect: (id: string) => void;
    /** Make a copy of this recipe. */
    readonly onSave: (id: string) => void;
    /**
     * This recipe's per-serving nutrition, as an already-decided NODE for the card's meta row (the host
     * closes over the page's ONE batch promise — see `RenderRecipeNutrition`). Absent ⇒ no nutrition line.
     */
    readonly nutrition?: ReactNode;
}

/**
 * Props for the discovery FRAME — the chrome that renders outside the discovery suspense boundary, so a pending or
 * failed search never unmounts the field a viewer is typing in: heading, source switcher, search field with its
 * recent-search panel, filter slot, back-to-browse and sort. What the boundary renders arrives as `children`.
 *
 * The frame follows what the viewer has asked for NOW — the controls appear on the keystroke or press that calls for
 * them, which also keeps their layout shift inside the input window — while the results below it follow what has
 * settled.
 */
/** The id of Discover's large title. */
export const DISCOVER_TITLE_ID = 'discover-title';

/** The id of Discover's search field, which the `/` shortcut focuses. */
export const DISCOVER_SEARCH_ID = 'discover-search';

/**
 * Where Discover's filters live (`docs/design/uiOverhaul/buildSpec.md` §4.4).
 *
 * - `panel` — a sticky panel beside the results, at a 960 container in a window that is not short.
 * - `sheet` — otherwise: a Filters button (with the sort), the applied-filter chips under it, and the sheet it opens.
 */
export type DiscoveryFilterSlots =
    | { readonly presentation: 'panel'; readonly panel: ReactNode }
    | {
          readonly presentation: 'sheet';
          readonly trigger: ReactNode;
          readonly applied: ReactNode;
          readonly sheet: ReactNode;
      };

export interface RecipeDiscoveryFrameProps {
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    /**
     * Whether the viewer is searching right now (a typed term or an active filter). The recent-search panel is an
     * idle-state shortcut, so it shows only while this is `false`.
     */
    readonly searching: boolean;
    /** Changes whenever a refresh retry from the results' notice succeeds; the heading takes focus when it does. */
    readonly headingFocusSignal: number;
    /**
     * The settled results, announced politely through a region the frame keeps mounted: the same sentence the results
     * header shows. Absent while nothing has settled, or while the rails are the body — neither is announced.
     */
    readonly resultsSummary?: RecipeDiscoveryResultsSummary;
    /**
     * The large title's action: the avatar, which opens Profile (`buildSpec.md` §3.3). The app supplies it, because
     * the profile read and the navigation are the app's. Discover is a tab of its own since slice 3, so this surface
     * takes no source switcher.
     */
    readonly headerAction?: HeaderAction;
    /** The recent-search memory (U7). Absent → no recent searches on this surface. */
    readonly recentSearches?: RecipeRecentSearchesControl;
    /**
     * The filters, in the one presentation the container decided (`filterPresentationOf`). A union, so a panel and a
     * sheet can never both be drawn, and the facets exist exactly once.
     */
    readonly filters?: DiscoveryFilterSlots;
    /** The sort control (S3). The container omits it while the viewer is browsing the rails. */
    readonly sort?: RecipeDiscoverySortControl;
    /** Back to the rails, offered by the container only after a rail's "see all" left browse with nothing searched. */
    readonly onExitToBrowse?: () => void;
    /** What the discovery boundary renders: the loading body, the load-error body, or the results. */
    readonly children: ReactNode;
}

/** What the no-result states offer: the two clears, the tag chips and the Trending rail that end every one of them. */
export interface DiscoveryNoResultControls {
    /** Clear the search term. */
    readonly onClearSearch: () => void;
    /** Clear the filters. */
    readonly onClearFilters: () => void;
    /** The three most-used tags to try (`tryTheseTagsOf`), or none when fewer than three remain. */
    readonly tryTags: readonly string[];
    /** Apply one of those tags as a filter. */
    readonly onPickTag: (tag: string) => void;
    /** The Trending rail, which the container builds from the same rail view the browse surface uses. */
    readonly trendingSlot?: ReactNode;
}

/**
 * Props for the discovery RESULTS — what renders inside the discovery suspense boundary once a search has settled: the
 * rails (while browsing), a no-result state, or the cards in the decided variant with the load-more control, plus the
 * notice for a failed refresh. A pending or failed search never reaches it; the boundary renders the loading and
 * load-error bodies instead. The count line is the frame's.
 */
export interface RecipeDiscoveryResultsProps {
    readonly results: readonly RecipeSearchResult[];
    /**
     * The term the results BELONG TO — the settled one, not the field's current value. While newer results are pending
     * the no-result heading keeps naming the query of the results on screen.
     */
    readonly query: string;
    /** What narrowed the settled search: zero results are then a no-result state, not an empty catalogue. */
    readonly kind: NoResultKind | undefined;
    /**
     * Whether newer results are pending behind these. The results stay readable and usable; the region is marked busy
     * and, after a delay, a still bar appears above it.
     */
    readonly stale: boolean;
    /** The curated rails (U7), supplied by the container while browsing; rendered in place of the result body. */
    readonly browseSlot?: ReactNode;
    /** The variant the host decided with `cardVariantOf(container, mode, 'discover')`. */
    readonly cardVariant: 'grid' | 'compact';
    /** Each card's Save a copy control (`useSaveCopy`). */
    readonly saveCopy: SaveCopy;
    /** Where a recipe's card leads, which makes it a real link on web. Native has no URLs and ignores it. */
    readonly hrefOf?: (recipeId: string) => string;
    readonly onSelectRecipe: (id: string) => void;
    /** What the no-result states offer. */
    readonly noResult: DiscoveryNoResultControls;
    /**
     * How to render one card's deferred calorie figure — called once per visible card with its recipe id (see
     * {@link RenderRecipeNutrition}). The host closes over the page's ONE batch promise, so N cards are ONE read.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
    /** The load-more pager (S4). Absent → no pagination control. */
    readonly loadMore?: RecipeDiscoveryLoadMoreControl;
    /**
     * The notice for a failed refresh of the results on screen. It reports only over results: while browsing, the rails
     * are on screen and carry their own notice.
     */
    readonly refreshNotice?: RefreshNoticeControl;
    /**
     * Pull-to-refresh (U4/L8) — mobile only; the web leaf ignores it. The same `RecipeListRefreshControl` contract every
     * list uses.
     */
    readonly refresh?: RecipeListRefreshControl;
    /**
     * The screen's scroll host's bind for this, its one vertical scroller (blueprint A7) — native only: the host reads
     * the scroll (the floating create button, the tab's second tap). Web's document scrolls, so the web leaf ignores it.
     */
    readonly scrollBind?: ScrollBind;
}

/** Props for the discovery LOAD ERROR body: a search failed with nothing loaded for it. */
export interface RecipeDiscoveryLoadErrorProps {
    /** Retry the failed search. */
    readonly onRetry: () => void;
    /**
     * The results that were on screen before this search failed, which stay under the message
     * (`docs/design/uiOverhaul/buildSpec.md` §4.6: "Previous results stay"). Absent on a first load.
     */
    readonly previous?: ReactNode;
}

/**
 * The load-more pager (S4): whether another page exists, whether the next page is in flight, and the
 * fetch-next callback. The view renders a "Load more" button only while {@link hasMore}; it vanishes at the
 * last page ("no infinite scroll").
 */
export interface RecipeDiscoveryLoadMoreControl {
    readonly hasMore: boolean;
    readonly loading: boolean;
    /** The last next-page fetch failed; the loaded results stay and the control offers a retry beside the reason. */
    readonly failed: boolean;
    readonly onLoadMore: () => void;
}
