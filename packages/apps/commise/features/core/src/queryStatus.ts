/**
 * @module @commise/features-core — shared query-status discriminator (DA8).
 *
 * `CollectionListContainer` and `RecipeListContainer` each derived their list view's status from a
 * TanStack Query result with a byte-identical local `toListStatus` helper. This module is that shared
 * status DISCRIMINATOR: a pure function mapping the two query flags a container cares about onto the
 * value both list views render against — one authoritative representation of the mapping (DRY), so the
 * loading-beats-error-beats-ready precedence is defined once instead of twice.
 *
 * {@link toDetailQueryView} extends it with the SETTLED-BUT-ABSENT rule (B21) that DETAIL surfaces need.
 */

/** The three states a list view renders against: fetching, failed, or done. */
export type QueryStatus = 'loading' | 'error' | 'ready';

/**
 * Map a TanStack Query result's `isLoading`/`isError` flags onto the list view's {@link QueryStatus}.
 *
 * Precedence is LOADING first — a query can be both loading and errored mid-retry, and the spinner wins
 * — then ERROR, then READY (the fall-through). Pure: no I/O, just a discriminator over two booleans.
 *
 * @param isLoading - The query's `isLoading` flag.
 * @param isError - The query's `isError` flag.
 * @returns The resolved {@link QueryStatus}.
 */
export function toQueryStatus(isLoading: boolean, isError: boolean): QueryStatus {
    if (isLoading) {
        return 'loading';
    }

    if (isError) {
        return 'error';
    }

    return 'ready';
}

/** The fetch-state facts a detail surface derives its view from — the subset of a TanStack Query result
 *  {@link toDetailQueryView} reads (structural, so any query result satisfies it, and a pair of queries can
 *  be combined into one before it is passed in). */
export interface DetailQueryFacts<TData> {
    /** The query's `isLoading` flag. */
    readonly isLoading: boolean;
    /** The query's `isError` flag. */
    readonly isError: boolean;
    /** The query's data, or `undefined` when it holds none. */
    readonly data: TData | undefined;
}

/**
 * Which affordance a DETAIL surface renders. A discriminated union rather than a bare {@link QueryStatus} so
 * "ready" CARRIES its data: the illegal "ready with nothing to render" state is unrepresentable, and callers
 * narrow to the loaded datum without re-deriving (and possibly re-deciding) absence a second time.
 */
export type DetailQueryView<TData> =
    { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly data: TData };

/**
 * Resolve a DETAIL surface's view, applying the SETTLED-BUT-ABSENT rule (B21): a query that has stopped
 * loading, carries no error, and STILL has no data has settled with NOTHING, and that is a FAILURE — not a
 * pending fetch.
 *
 * A detail surface renders exactly one datum, so "settled with nothing" leaves it with nothing to draw. The
 * three web detail containers (recipe detail, collection detail, recipe version history) each routed that
 * case back into their LOADING affordance — a permanent spinner with no retry and no explanation, which made
 * their error and not-found branches unreachable from it — while the equivalent mobile screens
 * (`RecipeDetailScreen`, `CollectionDetailScreen`, `RecipeVersionsScreen`) routed the SAME shape into ERROR.
 * This function is that rule's ONE authoritative statement, so the two platforms cannot disagree again.
 *
 * It is deliberately SEPARATE from {@link toQueryStatus} rather than a flag on it: a LIST surface's absent
 * data is a legitimately renderable state (its building block owns the empty state), so folding the rule
 * into the shared discriminator would misclassify every list. The loading-beats-error precedence is NOT
 * restated here — it delegates to {@link toQueryStatus} — so there is still exactly one definition of it.
 * Pure.
 *
 * @param facts - The query's loading/error flags and its data.
 * @returns The view to render, with the loaded datum attached on `'ready'`.
 */
export function toDetailQueryView<TData>(facts: DetailQueryFacts<TData>): DetailQueryView<TData> {
    const status = toQueryStatus(facts.isLoading, facts.isError);

    if (status === 'loading') {
        return { status: 'loading' };
    }

    // Settled-but-absent joins the genuine failure here — the two are one state to the viewer.
    return status === 'error' || facts.data === undefined ? { status: 'error' } : { status: 'ready', data: facts.data };
}
