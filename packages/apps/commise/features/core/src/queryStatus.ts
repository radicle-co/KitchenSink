/**
 * @module @commise/features-core — shared query-status discriminator (DA8).
 *
 * The status DISCRIMINATOR for a surface that still reads through `useQuery` rather than a suspense boundary: a pure
 * function mapping the two query flags such a surface cares about onto the value its view renders against, so the
 * loading-beats-error-beats-ready precedence, and which failure counts as the page's error, are defined once. Every
 * list surface now suspends under a read boundary (`docs/CODING_STANDARDS.md` §11.0), so the package exports only
 * {@link toDetailQueryView}, which extends it with the SETTLED-BUT-ABSENT rule (B21) that DETAIL surfaces need.
 */

/** The three states a list view renders against: fetching, failed to load, or done. */
export type QueryStatus = 'loading' | 'error' | 'ready';

/**
 * The fetch-state facts {@link toQueryStatus} reads — structural, so a caller passes the TanStack Query result itself.
 *
 * ⛔ `isLoadingError`, never `isError`. TanStack sets `isError` for a failed REFETCH too, while the data it already
 * loaded stays in the cache; only `isLoadingError` (`isError && data === undefined`) means there is nothing to show.
 * A refetch failure over loaded data is reported inline (`isRefetchError`), and for an infinite query neither flag
 * counts a failed NEXT page, so a caller never subtracts `isFetchNextPageError` itself. Taking the result as an
 * object is what keeps the wrong flag out: a positional boolean accepted `query.isError` and compiled.
 */
export interface QueryStatusFacts {
    /** The query's `isLoading` flag. */
    readonly isLoading: boolean;
    /** The query's `isLoadingError` flag: the read failed with no data loaded. */
    readonly isLoadingError: boolean;
}

/**
 * Map a TanStack Query result onto the list view's {@link QueryStatus}.
 *
 * Precedence is LOADING, then ERROR, then READY (the fall-through). Pure: a discriminator over two flags.
 *
 * @param facts - The query result (or its `isLoading` / `isLoadingError` flags).
 * @returns The resolved {@link QueryStatus}.
 */
export function toQueryStatus(facts: QueryStatusFacts): QueryStatus {
    if (facts.isLoading) {
        return 'loading';
    }

    if (facts.isLoadingError) {
        return 'error';
    }

    return 'ready';
}

/** The fetch-state facts a detail surface derives its view from — the subset of a TanStack Query result
 *  {@link toDetailQueryView} reads (structural, so any query result satisfies it, and a pair of queries can
 *  be combined into one before it is passed in). */
export interface DetailQueryFacts<TData> extends QueryStatusFacts {
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
 * loading, has no loading error, and STILL has no data has settled with NOTHING, and that is a FAILURE — not a
 * pending fetch. A refetch that fails over the datum is not a failure of the page: the datum stays `'ready'`.
 *
 * A detail surface renders exactly one datum, so "settled with nothing" leaves it with nothing to draw, and routing
 * it into a LOADING affordance strands the viewer on a spinner with no retry. Its callers are the `useQuery` detail
 * reads: the server-prefetched web recipe detail, the mobile recipe detail that shares its leaf, and the mobile
 * profile. A surface that reads with a suspense
 * query needs no statement of this rule at all: query-core refuses to settle a query with `undefined` data, so the
 * rule is enforced by the library, and this function retires with the last of those.
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
    const status = toQueryStatus(facts);

    if (status === 'loading') {
        return { status: 'loading' };
    }

    // Settled-but-absent joins the genuine failure here — the two are one state to the viewer.
    return status === 'error' || facts.data === undefined ? { status: 'error' } : { status: 'ready', data: facts.data };
}
