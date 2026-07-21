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
 * Minimal view-model for one public-recipe row in discovery — the subset of a {@link RecipeSearchResult}
 * the row renders. `sourceAttribution` is present only when the recipe carries provenance (an imported
 * recipe); a user-created public recipe has none.
 */
export interface RecipeDiscoveryItem {
    readonly id: string;
    readonly title: string;
    /** Human-readable provenance (e.g. `Serious Eats`) — surfaced as attribution when present. */
    readonly sourceAttribution?: string;
}

/**
 * Project a {@link RecipeSearchResult} envelope down to the {@link RecipeDiscoveryItem} the row renders.
 * `sourceAttribution` is omitted (never set to `undefined`) when absent, so the property stays optional in
 * the exact sense. Pure.
 *
 * @param result - The search-result envelope (`{ recipe, rank? }`).
 * @returns The discovery-row view-model subset.
 */
export const toRecipeDiscoveryItem = (result: RecipeSearchResult): RecipeDiscoveryItem => {
    const { id, title, sourceAttribution } = result.recipe;

    return sourceAttribution === undefined ? { id, title } : { id, title, sourceAttribution };
};

/** Props for a single public-recipe row in discovery. */
export interface RecipeDiscoveryCardProps {
    readonly recipe: RecipeDiscoveryItem;
    /** Whether THIS row's clone is in flight (drives the busy/disabled clone action). */
    readonly isCloning: boolean;
    /** Invoked with the recipe id when the row (title) is activated. */
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
}
