/**
 * @module @commise/features-recipes/filters — pure, platform-agnostic recipe-filter model (FR-006).
 *
 * The SINGLE source of filter-state truth shared by the web (`RecipeFilterBar.tsx`) and native
 * (`RecipeFilterBar.native.tsx`) bars and by both apps' persistence edges (web = URL query params, mobile =
 * component state), so the two platforms can never drift on filter semantics. No React, no platform APIs.
 *
 * Scope is driven by the API contract, not guesswork: `GET /v1/search/recipes` is the only endpoint that
 * accepts these filters AND returns `facets`, and it facets exactly two dimensions — `dietaryFlags` and
 * `tags` — plus the caller-supplied `maxTotalTime` bound. `GET /v1/recipes` (the owner's library list) has
 * neither facets nor filter params, so the faceted bar belongs on the search-backed surface. The remaining
 * search params (`cuisine`, `maxPrepTime`, `ingredientIds`) are forwarded by the client but are not faceted
 * by the service, so nothing drives a chip for them yet — adding one is additive here and in the service's
 * facet CTE.
 *
 * Query-string (de)serialization goes through {@link URLSearchParams} rather than hand-rolled concatenation
 * (CLAUDE.md library-first): it percent-encodes values and round-trips repeated array params, which is the
 * exact wire shape the service's `SearchRecipesQueryDto` accepts (`?dietaryFlags=a&dietaryFlags=b`).
 */
import type { Locale } from '@commise/i18n';
import type { RecipeFacetCount, RecipeSearchParams } from '@kitchensink/recipe-core';

import { fillTemplate } from '../list/model.js';

/** The facet dimensions the service aggregates (and the bar renders as chip groups). */
export type FacetDimension = 'dietaryFlags' | 'tags';

/**
 * The active recipe filters. Each key is present ONLY when it constrains the query: an empty dimension omits
 * its key entirely (never `[]`) and an unset time bound omits `maxTotalTime` (never `undefined`), so the
 * state is always a minimal, canonical description of "what is filtered" — and never forwards an empty
 * constraint to the wire.
 */
export interface RecipeFilterState {
    readonly dietaryFlags?: readonly string[];
    readonly tags?: readonly string[];
    readonly maxTotalTime?: number;
}

/** A mutable working copy used to build a {@link RecipeFilterState} immutably (omitting cleared keys). */
type FilterDraft = {
    dietaryFlags?: readonly string[];
    tags?: readonly string[];
    maxTotalTime?: number;
};

/** The canonical empty filter state — no dimension selected, no time bound. Frozen (shared singleton). */
export const EMPTY_RECIPE_FILTERS: RecipeFilterState = Object.freeze({});

/** The total-time "under N minutes" bucket ladder the bar offers (minutes). A bound, not a facet value list. */
export const TOTAL_TIME_BUCKETS_MINUTES: readonly number[] = [15, 30, 60];

/**
 * The facet counts the bar consumes — structurally the service's `RecipeSearchFacets` wire shape, but
 * declared here (over `RecipeFacetCount` from recipe-core) so this presentational package need not depend on
 * the HTTP client. The composing container passes the search response's `facets` straight in.
 */
export interface RecipeFacets {
    readonly dietaryFlags?: readonly RecipeFacetCount[];
    readonly tags?: readonly RecipeFacetCount[];
}

/**
 * One rendered facet chip: a value, its match count (absent when the value is selected but the sampled
 * facet response omits it), and whether it is currently selected.
 */
export interface RecipeFacetChip {
    readonly value: string;
    readonly count?: number;
    readonly selected: boolean;
}

/**
 * Build the ordered chip list for one facet dimension. Preserves the server's bucket ordering, hides an
 * unselected zero-count bucket (never offer a filter that returns nothing), keeps a selected zero-count
 * bucket (so it stays clearable), and appends any selected value the facet response omits (the service
 * samples only the top matches, so an active filter's value can be absent) — without a count. Pure.
 *
 * @param buckets - The dimension's facet buckets from the search response, or `undefined` when absent.
 * @param selectedValues - The values currently selected in this dimension.
 * @returns The chips to render, in display order.
 */
export function buildFacetChips(
    buckets: readonly RecipeFacetCount[] | undefined,
    selectedValues: readonly string[],
): RecipeFacetChip[] {
    const selected = new Set(selectedValues);
    const chips: RecipeFacetChip[] = [];
    const seen = new Set<string>();

    for (const bucket of buckets ?? []) {
        const isSelected = selected.has(bucket.value);

        if (!isSelected && bucket.count === 0) {
            continue;
        }

        chips.push({ value: bucket.value, count: bucket.count, selected: isSelected });
        seen.add(bucket.value);
    }

    for (const value of selectedValues) {
        if (!seen.has(value)) {
            chips.push({ value, selected: true });
            seen.add(value);
        }
    }

    return chips;
}

/**
 * Toggle a value in a facet dimension (AND-narrowing across dimensions, OR within one). Adds the value when
 * absent, removes it when present, and drops the dimension key entirely when it empties. Returns a new state
 * — never mutates the input. Pure.
 *
 * @param state - The current filter state.
 * @param dimension - The dimension to toggle within.
 * @param value - The facet value to toggle.
 * @returns The next filter state.
 */
export function toggleFacetValue(
    state: RecipeFilterState,
    dimension: FacetDimension,
    value: string,
): RecipeFilterState {
    const current = state[dimension] ?? [];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];

    if (next.length === 0) {
        const draft: FilterDraft = { ...state };
        delete draft[dimension];

        return draft;
    }

    return { ...state, [dimension]: next };
}

/**
 * Set (or clear) the max-total-time bound. Clearing omits the key entirely, so it never reaches the wire as
 * `undefined`. Returns a new state — never mutates the input. Pure.
 *
 * @param state - The current filter state.
 * @param minutes - The bound in minutes, or `undefined` to clear it.
 * @returns The next filter state.
 */
export function setMaxTotalTime(state: RecipeFilterState, minutes: number | undefined): RecipeFilterState {
    if (minutes === undefined) {
        const draft: FilterDraft = { ...state };
        delete draft.maxTotalTime;

        return draft;
    }

    return { ...state, maxTotalTime: minutes };
}

/**
 * Count the active filters: each selected value across every dimension, plus the time bound as one. Pure.
 *
 * @param state - The filter state.
 * @returns The number of active filters.
 */
export function countActiveFilters(state: RecipeFilterState): number {
    return (state.dietaryFlags?.length ?? 0) + (state.tags?.length ?? 0) + (state.maxTotalTime !== undefined ? 1 : 0);
}

/**
 * Whether any filter is active. Pure.
 *
 * @param state - The filter state.
 * @returns `true` when at least one filter constrains the query.
 */
export function hasActiveFilters(state: RecipeFilterState): boolean {
    return countActiveFilters(state) > 0;
}

/**
 * The empty filter state (clear-all). Pure.
 *
 * @returns {@link EMPTY_RECIPE_FILTERS}.
 */
export function clearRecipeFilters(): RecipeFilterState {
    return EMPTY_RECIPE_FILTERS;
}

/**
 * Project the filter state + search term onto the `RecipeSearchParams` the client forwards to
 * `GET /v1/search/recipes`. Omits every empty dimension and a blank/whitespace query, so the request is a
 * pure subset — only what is actually constrained. Pure.
 *
 * @param state - The filter state.
 * @param query - The raw search term (trimmed here).
 * @returns The search params to send.
 */
export function filtersToSearchParams(state: RecipeFilterState, query: string): RecipeSearchParams {
    const params: RecipeSearchParams = {};
    const term = query.trim();

    if (term.length > 0) {
        params.query = term;
    }

    if (state.dietaryFlags && state.dietaryFlags.length > 0) {
        params.dietaryFlags = [...state.dietaryFlags];
    }

    if (state.tags && state.tags.length > 0) {
        params.tags = [...state.tags];
    }

    if (state.maxTotalTime !== undefined) {
        params.maxTotalTime = state.maxTotalTime;
    }

    return params;
}

/**
 * Serialize the filter state + search term to a URL query string (via {@link URLSearchParams}, so values are
 * percent-encoded and array dimensions become repeated params). The empty state serializes to `''`. Pure.
 *
 * @param state - The filter state.
 * @param query - The raw search term (trimmed; omitted when blank).
 * @returns The query string, without a leading `?`.
 */
export function filtersToQueryString(state: RecipeFilterState, query: string): string {
    const params = new URLSearchParams();
    const term = query.trim();

    if (term.length > 0) {
        params.append('query', term);
    }

    for (const value of state.dietaryFlags ?? []) {
        params.append('dietaryFlags', value);
    }

    for (const value of state.tags ?? []) {
        params.append('tags', value);
    }

    if (state.maxTotalTime !== undefined) {
        params.append('maxTotalTime', String(state.maxTotalTime));
    }

    return params.toString();
}

/**
 * Parse a URL query string back into a filter state + search term. Hostile-input safe (a hand-edited URL
 * cannot inject bad state): blank array entries are dropped, and `maxTotalTime` is accepted only when it is
 * an integer on the {@link TOTAL_TIME_BUCKETS_MINUTES} ladder (a non-numeric or off-ladder value is ignored,
 * never forwarded as `NaN` or an arbitrary bound). Pure.
 *
 * @param queryString - The URL query string (with or without a leading `?`).
 * @returns The parsed `{ filters, query }`.
 */
export function filtersFromQueryString(queryString: string): { filters: RecipeFilterState; query: string } {
    const params = new URLSearchParams(queryString);
    const query = (params.get('query') ?? '').trim();
    const filters: FilterDraft = {};

    const dietaryFlags = params.getAll('dietaryFlags').filter((value) => value.length > 0);

    if (dietaryFlags.length > 0) {
        filters.dietaryFlags = dietaryFlags;
    }

    const tags = params.getAll('tags').filter((value) => value.length > 0);

    if (tags.length > 0) {
        filters.tags = tags;
    }

    const rawMax = params.get('maxTotalTime');

    if (rawMax !== null) {
        const minutes = Number(rawMax);

        if (Number.isInteger(minutes) && TOTAL_TIME_BUCKETS_MINUTES.includes(minutes)) {
            filters.maxTotalTime = minutes;
        }
    }

    return { filters, query };
}

/**
 * Compose a facet chip's accessible name from its value and (optional) count: `"vegan, 4 recipes"`, or just
 * `"paleo"` when the count is absent. Pluralizes the count via the locale's rules. Pure.
 *
 * @param chip - The chip.
 * @param countLabels - The singular/plural `{count}` templates.
 * @param locale - The active locale.
 * @returns The chip's accessible name.
 */
export function formatFacetChipName(
    chip: RecipeFacetChip,
    countLabels: { readonly one: string; readonly other: string },
    locale: Locale,
): string {
    if (chip.count === undefined) {
        return chip.value;
    }

    const category = new Intl.PluralRules(locale).select(chip.count);
    const template = category === 'one' ? countLabels.one : countLabels.other;

    return `${chip.value}, ${fillTemplate(template, { count: chip.count })}`;
}

/** The controlled, presentational recipe filter bar's props (web + native share this shape). */
export interface RecipeFilterBarProps {
    /** Facet buckets from the latest search response (drives which chips render, with counts). */
    readonly facets: RecipeFacets;
    /** The active filter state (drives selected/pressed chips and the clear-all summary). */
    readonly filters: RecipeFilterState;
    /** Toggle a facet value within a dimension. */
    readonly onToggleFacet: (dimension: FacetDimension, value: string) => void;
    /** Set the max-total-time bound, or clear it with `undefined`. */
    readonly onSetMaxTotalTime: (minutes: number | undefined) => void;
    /** Clear every active filter. */
    readonly onClearAll: () => void;
}
