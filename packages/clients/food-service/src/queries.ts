/**
 * `queryOptions` factories for `@kitchensink/food-service-client` (plan 002 S5): the key, the fetcher and the cache
 * policy of each read, built from a {@link FoodServiceClient}. The hooks in `./hooks/` are thin over these, so two
 * hooks that read the same data cannot disagree about its key or its freshness.
 *
 * @pattern Repository — the read seam over food-service, as `@kitchensink/recipe-service-client`'s `queries.ts` is
 */
import { experimental_streamedQuery, queryOptions, skipToken } from '@tanstack/react-query';

import type { FoodServiceClient } from './client.js';
import { EMPTY_PROGRESSIVE_ANSWER, withProgressiveFrame, type ProgressiveAnswer } from './progressiveAnswer.js';
import type { ProgressiveFrame } from './progressiveFrames.js';
import { shouldRetryFoodServiceFailure } from './retryPolicy.js';

/**
 * How long a RESOLVED food's read stays fresh. A root's variants change only with a catalog seed, which ships with a
 * deploy, so a dialog opened twice in a session reads the same answer.
 */
const FOOD_STALE_TIME_MS = 5 * 60_000;

/** How long the cited sources stay fresh: they change only with a seed. */
const DATA_SOURCES_STALE_TIME_MS = 30 * 60_000;

/** How long a complete search answer stays fresh: the catalog changes only with a seed, and a create clears it. */
const SEARCH_STALE_TIME_MS = 5 * 60_000;

/**
 * How many times a progressive search is asked again after a failure: none (plan 002 R65). A second ask would resend
 * the source calls food already admitted for the first. The bound narrows the app's rule; it does not replace it.
 */
const PROGRESSIVE_SEARCH_RETRIES = 0;

/** The query keys of every food-service read, under one namespace, `all`. */
export const foodServiceKeys = {
    all: ['food-service'] as const,
    food: (id: string) => ['food-service', 'food', id] as const,
    dataSources: () => ['food-service', 'data-sources'] as const,
    /**
     * Every progressive search of one cook (ADR-0055): its database frame holds the cook's own foods, so the answer is
     * the cook's, keyed on them as ADR-0054 keys every per-cook read (plan 002 S3 property 7). With no one signed in,
     * the cook member is `null`, which no user id equals, and no read runs under it ({@link foodQueries}).
     */
    progressiveSearches: (subject: string | undefined) =>
        ['food-service', 'search', 'progressive', subject ?? null] as const,
    /** One progressive search of one cook. */
    progressiveSearch: (subject: string | undefined, query: string) =>
        ['food-service', 'search', 'progressive', subject ?? null, query] as const,
};

/** One progressive search's key. */
type ProgressiveSearchKey = ReturnType<typeof foodServiceKeys.progressiveSearch>;

/**
 * The read factories over one client.
 *
 * @param client - The configured client.
 * @returns The factories. Pure.
 */
export function foodQueries(client: FoodServiceClient) {
    return {
        /**
         * `GET /api/v1/foods/{id}`: one food, with its variants once resolved. An empty id asks nothing, and a refetch
         * cannot ask either (`skipToken`). Its retry is the app's (`shouldRetryFoodServiceFailure` in the app's policy).
         */
        food: (id: string) =>
            queryOptions({
                queryKey: foodServiceKeys.food(id),
                queryFn: id === '' ? skipToken : () => client.getById(id),
                // Only a resolved food is worth keeping: a `202` (still resolving) is stale at once, so the next
                // mount asks again instead of showing an answer that is already out of date.
                staleTime: (query) => (query.state.data?.status === 'RESOLVED' ? FOOD_STALE_TIME_MS : 0),
            }),
        /** `GET /api/v1/foods/sources`: the sources a stored value cites. Its retry is the app's, as `food`'s is. */
        dataSources: () =>
            queryOptions({
                queryKey: foodServiceKeys.dataSources(),
                queryFn: () => client.listSources(),
                staleTime: DATA_SOURCES_STALE_TIME_MS,
            }),
        /**
         * `GET /api/v1/foods/search/progressive`: the cook's progressive answer for `query`, each frame folded in as it
         * arrives (`experimental_streamedQuery`, `withProgressiveFrame`). With no cook it asks nothing (`skipToken`).
         *
         * - ⛔ Never retried (plan 002 R65): a second ask would resend source calls food already admitted.
         * - `networkMode: 'online'`, not the app's `offlineFirst`: with no retry, an offline read can park only if it
         *   never starts, so it waits for a connection and then asks (`rowEditorOpenDecisions.md` P6, "Offline").
         * - Fresh only once complete: an incomplete answer is never kept as the text's answer (P2), so coming back to the
         *   text asks again. A new ask starts empty (`refetchMode: 'reset'`), so the old gap never shows under it.
         * - Not asked again on focus or reconnect, so an answer that ended does not change under the cook.
         */
        progressiveSearch: (subject: string | undefined, query: string) =>
            queryOptions({
                queryKey: foodServiceKeys.progressiveSearch(subject, query),
                queryFn:
                    subject === undefined
                        ? skipToken
                        : experimental_streamedQuery<ProgressiveFrame, ProgressiveAnswer, ProgressiveSearchKey>({
                              streamFn: ({ signal }) => client.searchProgressive(query, { signal }),
                              reducer: withProgressiveFrame,
                              initialValue: EMPTY_PROGRESSIVE_ANSWER,
                              refetchMode: 'reset',
                          }),
                retry: (failureCount, error) =>
                    failureCount < PROGRESSIVE_SEARCH_RETRIES && shouldRetryFoodServiceFailure(error),
                networkMode: 'online',
                staleTime: (query) => (query.state.data?.complete === true ? SEARCH_STALE_TIME_MS : 0),
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
            }),
    };
}
