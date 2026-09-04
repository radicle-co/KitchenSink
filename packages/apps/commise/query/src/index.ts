/**
 * @module @commise/query — how the Commise apps' TanStack Query cache behaves.
 *
 * A product-level cross-cutting package, the sibling of `@commise/ui` (how the product looks) and
 * `@commise/i18n` (how it speaks): both apps mount ONE `QueryClientProvider`, and this is the one place its
 * behaviour is decided, so web and mobile cannot drift on it.
 *
 * It composes rather than classifies — each client package owns which of ITS failures are transient, beside
 * the `errors.ts` that defines them. See `retryPolicy.ts` for why that split is load-bearing.
 */
export { createAppQueryClient } from './queryClient.js';
export { MAX_QUERY_RETRIES, shouldRetryQuery } from './retryPolicy.js';
