import { QueryClient } from '@tanstack/react-query';

/**
 * Build a fresh `QueryClient` with retries disabled, so an error-path test settles on the first rejection
 * instead of retrying three times behind TanStack Query's default exponential backoff.
 *
 * @returns A retry-free query client.
 * @sideEffect Allocates a query cache.
 */
export function makeTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
}
