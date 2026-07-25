/**
 * @module @commise/features-core — shared query-status discriminator (DA8).
 *
 * `CollectionListContainer` and `RecipeListContainer` each derived their list view's status from a
 * TanStack Query result with a byte-identical local `toListStatus` helper. This module is that shared
 * status DISCRIMINATOR: a pure function mapping the two query flags a container cares about onto the
 * value both list views render against — one authoritative representation of the mapping (DRY), so the
 * loading-beats-error-beats-ready precedence is defined once instead of twice.
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
