/**
 * @module @commise/query/refresh-notice — the state a failed-refresh notice renders, derived from the query it
 * reports on.
 *
 * `QueryBoundary` owns a read that failed with nothing loaded. This owns the other failure: a refresh of data
 * already on screen (TanStack's `isRefetchError`), where the data stays and the surface shows a notice with a
 * retry. For an infinite query the flag already excludes a failed NEXT page, which `LoadMoreControl` reports.
 *
 * `recoveries` counts retries started FROM the notice that succeeded, so the surface can move focus off the button
 * those retries removed. The verdict is the awaited `refetch` result, never inferred from `isRefetchError` turning
 * false (CODING_STANDARDS §11.0: resolve an outcome and await it). That is also what keeps a pull-to-refresh or a
 * focus refetch that recovers from moving focus: it clears `failed` but never runs this retry.
 *
 * A surface whose focus target and notice sit on OPPOSITE sides of a suspense boundary — a heading in a frame outside
 * it, the notice in the results inside it — cannot share `recoveries`, which lives with the notice. Such a surface
 * passes `onRecovered` and counts recoveries where the heading is, with `useRecoverySignal`
 * (`@commise/query/recovery-signal`).
 *
 * @pattern Headless hook — a projection of the query's own flags plus one Command (the awaited `refetch`)
 */
import { useCallback, useState } from 'react';

/** The part of a TanStack Query result {@link useRefreshNotice} reads; any query result satisfies it. */
export interface RefreshableQuery {
    /** Whether the last refetch failed while data was loaded. */
    readonly isRefetchError: boolean;
    /** Whether a refetch of loaded data is in flight. */
    readonly isRefetching: boolean;
    /** Refetch, resolving with the settled result. */
    readonly refetch: () => Promise<{ readonly isSuccess: boolean }>;
}

/**
 * What a failed-refresh notice renders: the facts, the retry, and the count of retries that recovered. Consumed by
 * `@commise/features-recipes`' `RefreshNoticeControl`, which states the same shape because neither package may
 * depend on the other; a drift fails `tsc` at every container that passes one into the other.
 */
export interface RefreshNoticeState {
    /** Whether the last refresh of loaded data failed. */
    readonly failed: boolean;
    /** Whether a refresh is in flight. */
    readonly refreshing: boolean;
    /** Refresh again, from the notice. */
    readonly onRetry: () => void;
    /** How many retries started from the notice have succeeded; a change is the signal to move focus. */
    readonly recoveries: number;
}

/** Options for {@link useRefreshNotice}. */
export interface RefreshNoticeOptions {
    /** Called once for every retry started from the notice that succeeds — the same verdict `recoveries` counts. */
    readonly onRecovered?: () => void;
}

/**
 * Derive a failed-refresh notice's state from a query.
 *
 * @param query - The query result the notice reports on.
 * @param options - An optional recovery callback, for a surface that counts recoveries outside the read.
 * @returns The notice state.
 * @sideEffect `onRetry` refetches the query.
 */
export function useRefreshNotice(query: RefreshableQuery, options?: RefreshNoticeOptions): RefreshNoticeState {
    const [recoveries, setRecoveries] = useState(0);
    const { refetch } = query;
    const onRecovered = options?.onRecovered;

    const onRetry = useCallback(() => {
        void refetch().then((result) => {
            if (result.isSuccess) {
                setRecoveries((count) => count + 1);
                onRecovered?.();
            }
        });
    }, [refetch, onRecovered]);

    return { failed: query.isRefetchError, refreshing: query.isRefetching, onRetry, recoveries };
}
