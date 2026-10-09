/**
 * @module @commise/features-recipes/filters — pure, platform-agnostic recipe-filter model (FR-006).
 *
 * The SINGLE source of filter-state truth shared by the web (`RecipeFilterBar.tsx`) and native
 * (`RecipeFilterBar.native.tsx`) bars and by both apps' persistence edges (web = URL query params, mobile =
 * component state), so the two platforms can never drift on filter semantics. No React, no platform APIs.
 *
 * Scope is driven by the API contract, not guesswork: `GET /api/v1/search/recipes` is the only endpoint that
 * accepts these filters AND returns `facets`, and it facets exactly two dimensions — `dietaryFlags` and
 * `tags` — plus the caller-supplied `maxTotalTime` bound. `GET /api/v1/recipes` (the owner's library list) has
 * neither facets nor filter params, so the faceted bar belongs on the search-backed surface. The remaining
 * search params (`cuisine`, `maxPrepTime`, `maxCookTime`, `foodIds`) are forwarded by the client but
 * are not faceted by the service, so nothing drives a chip for them yet — adding one is additive here and in
 * the service's facet CTE.
 *
 * Query-string (de)serialization goes through {@link URLSearchParams} rather than hand-rolled concatenation
 * (CLAUDE.md library-first): it percent-encodes values and round-trips repeated array params, which is the
 * exact wire shape the service's `SearchRecipesQueryDto` accepts (`?dietaryFlags=a&dietaryFlags=b`).
 *
 * **Ingredient filter (FR-006 gap #3, plan 002 R45).** The filter keys on a FOOD: `foodIds` is forwarded by the
 * client, and the service matches a recipe with a line bound to that food (a private food only for its author). It
 * is never faceted, and its values are opaque food ids, not human-readable strings: a chip needs a NAME to render,
 * which the id alone cannot supply. So the filter state stores `{ foodId, name }` pairs
 * ({@link RecipeIngredientFilter}), populated only at SELECTION time (the typeahead result the user picked carries
 * its own name) — never re-derived from a bare id. The query string carries both `foodId` and `foodName` as
 * parallel repeated params (paired by position), so a reloaded/shared URL can render the chip's label without a
 * network round-trip to re-resolve the name.
 */
import type { Locale } from '@commise/i18n';
import type { Ingredient, RecipeFacetCount } from '@kitchensink/recipe-core';
import { MAX_SEARCH_FOOD_FILTERS, type RecipeSearchFacets, type RecipeSearchQuery } from '@kitchensink/schema-recipe';

import { fillTemplate } from '../list/model.js';
import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

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
    /**
     * A single cuisine (S2). The search API filters by ONE exact cuisine (`RecipeSearchQuery.cuisine` is a
     * string, not an array), so this is single-select — never a multi-value array — even though the UI draws
     * cuisine as a facet group.
     */
    readonly cuisine?: string;
    /** Max prep-time bound in minutes (S2), on the {@link TIME_BUCKETS_MINUTES} ladder. */
    readonly maxPrepTime?: number;
    /** Max cook-time bound in minutes (REQ-030f), on the {@link TIME_BUCKETS_MINUTES} ladder. */
    readonly maxCookTime?: number;
    /** Max total-time bound in minutes, on the {@link TIME_BUCKETS_MINUTES} ladder. */
    readonly maxTotalTime?: number;
    /**
     * The selected ingredient filters (food id + display name), resolved via the ingredient typeahead. Projects
     * onto `RecipeSearchQuery.foodIds` (ids only) for the wire. OR-narrowed, like the other array
     * dimensions (a recipe matches if it contains ANY selected ingredient).
     */
    readonly ingredients?: readonly RecipeIngredientFilter[];
}

/** A mutable working copy used to build a {@link RecipeFilterState} immutably (omitting cleared keys). */
type FilterDraft = {
    dietaryFlags?: readonly string[];
    tags?: readonly string[];
    cuisine?: string;
    maxPrepTime?: number;
    maxCookTime?: number;
    maxTotalTime?: number;
    ingredients?: readonly RecipeIngredientFilter[];
};

/**
 * One ingredient selected as a filter constraint: the {@link Ingredient.foodId} the wire filters on, plus the
 * {@link Ingredient.name} the chip renders — opaque ids carry no human-readable label on their own, so the name
 * travels alongside it in filter state (see the module doc). A name the cook declared has no food id, so it can
 * never be a filter (R45).
 */
export interface RecipeIngredientFilter {
    readonly foodId: string;
    readonly name: string;
}

/** The canonical empty filter state — no dimension selected, no time bound. Frozen (shared singleton). */
export const EMPTY_RECIPE_FILTERS: RecipeFilterState = Object.freeze({});

/**
 * The "under N minutes" bucket ladder the bar offers for prep, cook (REQ-030f), and total time (minutes) —
 * a bound, not a facet value list.
 */
export const TIME_BUCKETS_MINUTES: readonly number[] = [15, 30, 60];

/** @deprecated Use {@link TIME_BUCKETS_MINUTES}. Kept as an alias so existing importers don't break. */
export const TOTAL_TIME_BUCKETS_MINUTES: readonly number[] = TIME_BUCKETS_MINUTES;

/**
 * The facet counts the FILTER BAR consumes — a deliberately NARROWER view-model DERIVED from the wire shape,
 * not an independent declaration of it.
 *
 * It differs from `RecipeSearchFacets` in two ways that are real, not incidental:
 *  - it covers only the three dimensions the bar renders as chips, omitting `totalTime` (which the bar offers
 *    as a bound via {@link TIME_BUCKETS_MINUTES}, not as a facet value list);
 *  - every dimension is OPTIONAL, because a container may render the bar before a search has resolved, or
 *    pass a partial block — whereas the wire contract always carries all four (an empty dimension is `[]`).
 *
 * `Pick` + `Partial` over the generated wire type is what keeps those differences INTENTIONAL: adding,
 * removing or renaming a facet dimension in the contract now fails this package's typecheck instead of
 * silently leaving a stale hand-written copy behind. The previous declaration was structurally independent,
 * which is how the server and client came to disagree about whether a facet block could be absent at all.
 */
export type RecipeFacets = Partial<Pick<RecipeSearchFacets, 'dietaryFlags' | 'tags' | 'cuisine'>>;

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

/** The three time bounds — identical behaviour, one key apart, which is why they are a FIELD and not three functions. */
export type TimeBoundField = 'maxTotalTime' | 'maxPrepTime' | 'maxCookTime';

/**
 * Every transition the filter state admits.
 *
 * DESIGN PATTERN: the variant half of a Visitor — {@link applyFilterAction}'s exhaustive switch is the other
 * half, so adding a member here is a COMPILE error until it is handled rather than a silently ignored action.
 */
export type FilterAction =
    | { readonly kind: 'toggleFacet'; readonly dimension: FacetDimension; readonly value: string }
    | { readonly kind: 'setTimeBound'; readonly field: TimeBoundField; readonly minutes: number | undefined }
    | { readonly kind: 'setCuisine'; readonly cuisine: string | undefined }
    | { readonly kind: 'addIngredient'; readonly ingredient: RecipeIngredientFilter }
    | { readonly kind: 'removeIngredient'; readonly foodId: string }
    | { readonly kind: 'clearAll' };

/**
 * The state WITHOUT one key — the single expression of "clearing omits the key entirely".
 *
 * ⛔ A cleared time bound, a cleared cuisine, a facet whose last value was toggled off and an ingredient list
 * whose last entry was removed all OMIT their key rather than carry `undefined` or `[]`, because both reach the
 * wire and narrow the search to nothing — and `filtersToSearchParams` cannot tell an omitted key from a
 * wrongly-present one. Every clearing branch of {@link applyFilterAction} goes through here.
 *
 * @param state - The current filter state.
 * @param key - The key to drop.
 * @returns A new state without that key. Pure.
 */
function omitting(state: RecipeFilterState, key: keyof RecipeFilterState): RecipeFilterState {
    const draft: FilterDraft = { ...state };

    delete draft[key];

    return draft;
}

/**
 * Apply one {@link FilterAction} — the SINGLE entry point for every filter transition.
 *
 * DESIGN PATTERN: Visitor, as an exhaustive `switch` over a discriminated union (no class machinery needed —
 * the union plus `satisfies never` IS the pattern here).
 *
 * ⛔ WHY ONE FUNCTION RATHER THAN EIGHT. A caller driving this state machine had to learn eight signatures,
 * three of which differed only in which key they wrote, and reproduce the omit-the-key rule's consequences at
 * each call site. Both platforms' discovery surfaces imported all eight and threaded them through
 * `setFilters` callbacks, so the eight-name interface was paid for twice. One action type means a caller
 * learns one thing, and a NEW transition is a union member the switch must handle rather than a ninth export
 * every consumer has to discover.
 *
 * ⚠️ Returns the SAME object when nothing changed (a re-added ingredient, an absent id), so a React caller
 * does not re-render every subscriber for a no-op. That property is asserted, not incidental.
 *
 * @param state - The current filter state.
 * @param action - The transition to apply.
 * @returns The next filter state — never the input, mutated. Pure.
 */
export function applyFilterAction(state: RecipeFilterState, action: FilterAction): RecipeFilterState {
    switch (action.kind) {
        case 'toggleFacet': {
            const current = state[action.dimension] ?? [];
            const next = current.includes(action.value)
                ? current.filter((entry) => entry !== action.value)
                : [...current, action.value];

            return next.length === 0 ? omitting(state, action.dimension) : { ...state, [action.dimension]: next };
        }

        case 'setTimeBound':
            return action.minutes === undefined
                ? omitting(state, action.field)
                : { ...state, [action.field]: action.minutes };
        case 'setCuisine':
            // Single-select WITH an off state: re-selecting the current cuisine clears it.
            return action.cuisine === undefined || state.cuisine === action.cuisine
                ? omitting(state, 'cuisine')
                : { ...state, cuisine: action.cuisine };

        case 'addIngredient': {
            const current = state.ingredients ?? [];

            // Idempotent by `id` — the wire identity. A stale or renamed `name` is never compared. A full filter
            // refuses the add: the server answers 400 past its bound, so the search would fail.
            return isIngredientFilterFull(state) || current.some((entry) => entry.foodId === action.ingredient.foodId)
                ? state
                : { ...state, ingredients: [...current, action.ingredient] };
        }

        case 'removeIngredient': {
            const current = state.ingredients ?? [];
            const next = current.filter((entry) => entry.foodId !== action.foodId);

            if (next.length === current.length) {
                return state;
            }

            return next.length === 0 ? omitting(state, 'ingredients') : { ...state, ingredients: next };
        }

        case 'clearAll':
            return EMPTY_RECIPE_FILTERS;
        default:
            // ⛔ EXHAUSTIVENESS, checked by the compiler: a new union member that nobody handled fails here
            // rather than falling through and silently ignoring a user's action.
            return action satisfies never;
    }
}

/**
 * Count the active filters: each selected value across every dimension (including ingredients), plus each
 * single-value bound (cuisine, prep, total) as one. Pure.
 *
 * @param state - The filter state.
 * @returns The number of active filters.
 */
export function countActiveFilters(state: RecipeFilterState): number {
    return (
        (state.dietaryFlags?.length ?? 0) +
        (state.tags?.length ?? 0) +
        (state.cuisine !== undefined ? 1 : 0) +
        (state.maxPrepTime !== undefined ? 1 : 0) +
        (state.maxCookTime !== undefined ? 1 : 0) +
        (state.maxTotalTime !== undefined ? 1 : 0) +
        (state.ingredients?.length ?? 0)
    );
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
 * Project the filter state + search term onto the published `RecipeSearchQuery` the client forwards to
 * `GET /api/v1/search/recipes`. Omits every empty dimension and a blank/whitespace query, so the request is a
 * pure subset — only what is actually constrained. Pure.
 *
 * @param state - The filter state.
 * @param query - The raw search term (trimmed here).
 * @returns The search params to send.
 */
export function filtersToSearchParams(state: RecipeFilterState, query: string): RecipeSearchQuery {
    const params: RecipeSearchQuery = {};
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

    if (state.cuisine !== undefined) {
        params.cuisine = state.cuisine;
    }

    if (state.maxPrepTime !== undefined) {
        params.maxPrepTime = state.maxPrepTime;
    }

    if (state.maxCookTime !== undefined) {
        params.maxCookTime = state.maxCookTime;
    }

    if (state.maxTotalTime !== undefined) {
        params.maxTotalTime = state.maxTotalTime;
    }

    if (state.ingredients && state.ingredients.length > 0) {
        params.foodIds = state.ingredients.map((entry) => entry.foodId);
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

    if (state.cuisine !== undefined) {
        params.append('cuisine', state.cuisine);
    }

    if (state.maxPrepTime !== undefined) {
        params.append('maxPrepTime', String(state.maxPrepTime));
    }

    if (state.maxCookTime !== undefined) {
        params.append('maxCookTime', String(state.maxCookTime));
    }

    if (state.maxTotalTime !== undefined) {
        params.append('maxTotalTime', String(state.maxTotalTime));
    }

    for (const entry of state.ingredients ?? []) {
        params.append('foodId', entry.foodId);
        params.append('foodName', entry.name);
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

    const cuisine = params.get('cuisine');

    if (cuisine !== null && cuisine.length > 0) {
        filters.cuisine = cuisine;
    }

    const prep = timeBucketFromParam(params.get('maxPrepTime'));

    if (prep !== undefined) {
        filters.maxPrepTime = prep;
    }

    const cook = timeBucketFromParam(params.get('maxCookTime'));

    if (cook !== undefined) {
        filters.maxCookTime = cook;
    }

    const total = timeBucketFromParam(params.get('maxTotalTime'));

    if (total !== undefined) {
        filters.maxTotalTime = total;
    }

    const ingredients = ingredientFiltersFromParams(params);

    if (ingredients.length > 0) {
        filters.ingredients = ingredients;
    }

    return { filters, query };
}

/**
 * Parse the paired `foodId`/`foodName` repeated params into {@link RecipeIngredientFilter}s.
 * Hostile-input safe: a mismatched pair count is truncated to the shorter list (never `undefined` paired
 * with a real id), a blank id or name drops that entry, and a repeated id keeps only its first occurrence —
 * a hand-edited URL cannot inject a malformed or duplicate chip. Pure.
 */
function ingredientFiltersFromParams(params: URLSearchParams): RecipeIngredientFilter[] {
    const ids = params.getAll('foodId');
    const names = params.getAll('foodName');
    const seen = new Set<string>();
    const ingredients: RecipeIngredientFilter[] = [];

    for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        const name = names[index];

        if (id === undefined || id.length === 0 || name === undefined || name.length === 0 || seen.has(id)) {
            continue;
        }

        seen.add(id);
        ingredients.push({ foodId: id, name });

        // A shared URL past the bound keeps its first ingredients rather than failing the search.
        if (ingredients.length === MAX_SEARCH_FOOD_FILTERS) {
            break;
        }
    }

    return ingredients;
}

/**
 * Parse a raw URL time-bound param to a valid bucket, or `undefined`. Hostile-input safe: a non-numeric or
 * off-ladder value is ignored (never forwarded as `NaN` or an arbitrary bound). Pure.
 */
function timeBucketFromParam(raw: string | null): number | undefined {
    if (raw === null) {
        return undefined;
    }

    const minutes = Number(raw);

    return Number.isInteger(minutes) && TIME_BUCKETS_MINUTES.includes(minutes) ? minutes : undefined;
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

/**
 * The ingredient-filter typeahead's current view — a discriminated union so the bar renders it with an
 * exhaustive `switch`/branch set instead of re-deriving the state from raw query flags. Deliberately a
 * NARROWER union than the editor entry's `EntrySearchView` (`hooks/foodSuggestions.model.ts`): filtering never
 * resolves nutrition or creates a catalog row — see `hooks/useIngredientFilterSearch.ts` for why that hook (and this
 * view state) is a deliberately separate, read-only composition of the SAME shared search primitives.
 *  - `idle` — no query typed yet: the box is untouched, so there is nothing to say about it.
 *  - `tooShort` — something is typed, but fewer than {@link MIN_SEARCH_QUERY_LENGTH} characters
 *    (003-FR-010a). Distinct from `idle` because FR-010a requires the cook to be told why nothing is
 *    searched.
 *  - `searching` — a query is in flight, OR `trimmed` has crossed the threshold but the debounced query
 *    hasn't caught up to it yet, so the bar never flashes "no matches" before the search has run.
 *  - `results` — the search settled, with zero or more catalog matches (or an error).
 */
export type IngredientFilterSearchViewState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'tooShort'; readonly minimum: number }
    | { readonly kind: 'searching' }
    | { readonly kind: 'results'; readonly results: readonly FoodIngredient[]; readonly isError: boolean }
    /** The filter holds `max` ingredients, the most one search may filter on: the bar offers no search. */
    | { readonly kind: 'full'; readonly max: number };

/**
 * Whether the filter already holds as many ingredients as one search may filter on (curated U9). Search expands each
 * filtered root to its live variants, one food read per root, so the server bounds the filter at
 * `MAX_SEARCH_FOOD_FILTERS` and answers 400 past it.
 *
 * @param state - The filter state.
 * @returns `true` when no further ingredient can be added. Pure.
 */
export function isIngredientFilterFull(state: RecipeFilterState): boolean {
    return isIngredientFilterFullAt(state.ingredients?.length ?? 0);
}

/**
 * Whether `count` selected ingredients fill the filter: the one statement of the bound.
 *
 * @param count - How many ingredients the filter holds.
 * @returns `true` at or past `MAX_SEARCH_FOOD_FILTERS`. Pure.
 */
export function isIngredientFilterFullAt(count: number): boolean {
    return count >= MAX_SEARCH_FOOD_FILTERS;
}

/** A search result that is a food — the only kind of result a recipe filter can key on (plan 002 R45). */
export type FoodIngredient = Ingredient & { readonly foodId: string };

/**
 * Whether a search result is a food. A name the cook declared has no food id and cannot be a filter target. Pure.
 *
 * @param ingredient - A search result.
 * @returns `true` when it carries a food id.
 */
function isFoodIngredient(ingredient: Ingredient): ingredient is FoodIngredient {
    return ingredient.foodId !== undefined;
}

/** The raw query facts {@link deriveIngredientFilterSearchViewState} reduces to one view state. */
export interface DeriveIngredientFilterSearchViewStateInput {
    readonly trimmed: string;
    /** The debounced query gating the search fetch — see {@link IngredientFilterSearchViewState}'s doc. */
    readonly debouncedTrimmed: string;
    readonly results: readonly Ingredient[];
    readonly isLoading: boolean;
    readonly isError: boolean;
    /** How many ingredients the filter already holds. */
    readonly selectedCount: number;
}

/**
 * Pure reduction of the ingredient-filter typeahead's raw search facts to one
 * {@link IngredientFilterSearchViewState}. Pure.
 *
 * @param input - The current query/search facts.
 * @returns The single view state the bar renders.
 */
export function deriveIngredientFilterSearchViewState(
    input: DeriveIngredientFilterSearchViewStateInput,
): IngredientFilterSearchViewState {
    // First: a full filter offers no search, so a query typed before the last add says nothing about this state.
    if (isIngredientFilterFullAt(input.selectedCount)) {
        return { kind: 'full', max: MAX_SEARCH_FOOD_FILTERS };
    }

    // Checked before the debounce window: below the minimum no request is ever issued, so `searching` would never end.
    if (!meetsSearchMinimum(input.trimmed)) {
        return input.trimmed.length === 0 ? { kind: 'idle' } : { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH };
    }

    if (input.isLoading || input.trimmed !== input.debouncedTrimmed) {
        return { kind: 'searching' };
    }

    return { kind: 'results', results: input.results.filter(isFoodIngredient), isError: input.isError };
}

/** The ingredient-filter typeahead's live state, owned by the container's `useIngredientFilterSearch`. */
export interface RecipeIngredientSearchState {
    /** The controlled search-box text. */
    readonly query: string;
    /** Update the search-box text. */
    readonly onQueryChange: (query: string) => void;
    /** The current typeahead view (idle/searching/results). */
    readonly viewState: IngredientFilterSearchViewState;
}
