/**
 * @module @commise/features-recipes — public-discovery model layer (T076).
 *
 * Pure, platform-agnostic types + the search-result projection shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) discovery views, so the two renders can never drift on shape. No React, no platform
 * APIs. The count/template copy-formatting primitives are reused from the list model (`../list/model.js`)
 * — one authoritative implementation of pluralization + placeholder filling for the whole feature.
 */
import type { ReactNode } from 'react';

import { RecipeSearchSortBy, type RecipeSearchResult } from '@kitchensink/recipe-core';

import type { RecipeCardModel } from '../card/model.js';

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

/** The browse rails, in display order (Trending → New → Quick). */
export const RECIPE_BROWSE_RAILS: readonly RecipeBrowseRailDefinition[] = [
    { id: 'trending', sortBy: RecipeSearchSortBy.MOST_CLONED },
    { id: 'new', sortBy: RecipeSearchSortBy.RECENT },
    { id: 'quick', sortBy: RecipeSearchSortBy.QUICKEST },
];

/** A single browse rail is a teaser row, not the full list — cap each rail's fetch to a small page. */
export const RECIPE_BROWSE_RAIL_PAGE_SIZE = 12;

/** One browse rail projected for the presentational rails view: its identity, state, results, and see-all. */
export interface RecipeBrowseRailView {
    readonly id: RecipeBrowseRailId;
    readonly status: RecipeDiscoveryStatus;
    readonly results: readonly RecipeSearchResult[];
    /** Reveal the full sorted list for this rail (leaves browse for the result list, U7). */
    readonly onSeeAll: () => void;
}

/** A cuisine shortcut chip in the browse view — selecting one applies a cuisine filter (leaving browse). */
export interface RecipeBrowseCuisineShortcut {
    readonly value: string;
    readonly onSelect: () => void;
}

/**
 * Props for the curated browse-rails block (U7) — a controlled, presentational view rendered when discovery
 * has no active query/filter. It fetches nothing; the composing container runs one search per rail (fixed
 * sort, small page) and projects them here, alongside the cuisine shortcuts derived from the search facets.
 */
export interface RecipeBrowseRailsProps {
    readonly rails: readonly RecipeBrowseRailView[];
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    /** The id of the recipe whose clone is in flight, if any (busies exactly that card). */
    readonly cloningId?: string | null;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
}

/** The sort control (S3): the active sort and a change callback. Absent → the view renders no sort control. */
export interface RecipeDiscoverySortControl {
    readonly active: RecipeSearchSortBy;
    readonly onChange: (sort: RecipeSearchSortBy) => void;
}

/**
 * The three top-level states the discovery view renders. `ready` further splits into empty vs populated on
 * `results.length` (a distinction the view derives — a successful search with no hits is not an error).
 */
export type RecipeDiscoveryStatus = 'loading' | 'error' | 'ready';

/**
 * Props for a single public-recipe search result card (S1). It composes the shared {@link RecipeCard}
 * compound parts (P7's search surface) from a {@link RecipeCardModel} — photo, title, cuisine/time/calorie
 * meta, visibility badge, rating, tags — rather than widening a flat discovery prop bag. `authorHandle`
 * (`by @handle`, W8-a.2) and `sourceAttribution` (imported provenance) are the two search-specific extras.
 */
export interface RecipeDiscoveryCardProps {
    /** The card view-model projected from the search hit's recipe (drives the compound RecipeCard parts). */
    readonly recipe: RecipeCardModel;
    /** The author's handle (`by @handle`), when the recipe carries one. */
    readonly authorHandle?: string;
    /** Human-readable provenance (e.g. `Serious Eats`) for an imported recipe, when present. */
    readonly sourceAttribution?: string;
    /** Whether THIS row's clone is in flight (drives the busy/disabled clone action). */
    readonly isCloning: boolean;
    /** Invoked with the recipe id when the card (cover/title) is activated. */
    readonly onSelect: (id: string) => void;
    /** Invoked with the recipe id when the row's clone action is activated. */
    readonly onClone: (id: string) => void;
}

/**
 * Props for the public-discovery view — a controlled, presentational component (US2). It renders one of
 * four states (loading, error, empty, populated) from `status` + `results`, and delegates every
 * interaction upward. It performs NO data fetching: the composing app wires the search query + clone
 * mutation to these props. Every recipe shown is public; `onClone` copies one into the viewer's collection.
 */
export interface RecipeDiscoveryListProps {
    readonly status: RecipeDiscoveryStatus;
    readonly results: readonly RecipeSearchResult[];
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
    readonly onRetry: () => void;
    /** The id of the recipe whose clone is currently in flight, if any (busies exactly that row). */
    readonly cloningId?: string | null;
    /**
     * Whether any filter (beyond the search term) is active. Combined with a non-blank `searchValue` it tells
     * the empty body apart from a no-match: a successful search/filter with zero hits is a NO-MATCH ("nothing
     * matches your search"), not the browse-empty "no public recipes" state. Defaults to `false`.
     */
    readonly hasActiveFilters?: boolean;
    /**
     * Optional composition seam rendered between the search field and the results body — where the composing
     * app mounts the {@link import('../filters/index.js').RecipeFilterBar} so the filters sit under the search
     * box, above the results. The view stays presentational and unaware of filter semantics.
     */
    readonly filterSlot?: ReactNode;
    /** Optional sort control (S3). Absent → no sort UI (e.g. a surface that only browses). */
    readonly sort?: RecipeDiscoverySortControl;
    /** Optional load-more pager (S4). Absent → no pagination control. */
    readonly loadMore?: RecipeDiscoveryLoadMoreControl;
    /**
     * Optional curated browse block (U7). When provided AND no query/filter is active, the view renders this
     * in place of the flat result body (and hides the sort control) — the default browse experience is the
     * curated rails, not a bare relevance stream. Absent → the view always renders its result states.
     */
    readonly browseSlot?: ReactNode;
    /**
     * Optional "back to browse" affordance. Provided by a container only after a rail's "see all" has left
     * browse into the full result list while no query/filter is active, so the user can return to the rails.
     */
    readonly onExitToBrowse?: () => void;
}

/**
 * The load-more pager (S4): whether another page exists, whether the next page is in flight, and the
 * fetch-next callback. The view renders a "Load more" button only while {@link hasMore}; it vanishes at the
 * last page ("no infinite scroll").
 */
export interface RecipeDiscoveryLoadMoreControl {
    readonly hasMore: boolean;
    readonly loading: boolean;
    readonly onLoadMore: () => void;
}
