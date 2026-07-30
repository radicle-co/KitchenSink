/**
 * Test harness for the `@kitchensink/recipe-service-client` React-Query hooks (T064).
 *
 * The unit under test is the *hook*, whose only collaborator is a {@link RecipeServiceClient} handed in
 * through {@link RecipeServiceProvider}. So the seam is the **client method**, not `fetch`: the hooks own
 * query keys, `enabled` gating, and cache invalidation — they own no URLs, no bodies, and no status
 * mapping (all of that is the client's contract, already pinned by `client.methods.test.ts` /
 * `client.transport.test.ts`). Stubbing at `fetch` would therefore re-assert the client's contract through
 * a second layer and let a client-side change redden a hook test for a reason that has nothing to do with
 * the hook.
 *
 * The double is `vi.spyOn` over a **real client instance** rather than a hand-built fake object, so every
 * stub is type-checked against the real method signature (a renamed method, a reordered parameter, or a
 * wrong-shaped resolved value fails `tsc`, not just the assertion). The instance itself now comes from the
 * package's public `./testing` subpath ({@link createFakeRecipeServiceClient}, CP-6 T3) — this module keeps
 * the `makeGuardedClient`/`NETWORK_GUARD_MESSAGE` names its existing callers already import, but delegates
 * construction so there is exactly one network-guard-client implementation, not two.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { RenderHookResult } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';

import type { RecipeServiceClient } from '../../client.js';
import { RecipeServiceProvider } from '../../hooks.js';
import { NETWORK_GUARD_MESSAGE, createFakeRecipeServiceClient } from '../../testing/fakeClient.js';

export { NETWORK_GUARD_MESSAGE };

/**
 * A real {@link RecipeServiceClient} whose transport can never fire, for `vi.spyOn` to stub per test.
 *
 * @returns A client wired to a rejecting `fetch` guard.
 * @sideEffect Constructs a client holding a `vi.fn`-backed `fetch` double.
 */
export function makeGuardedClient(): RecipeServiceClient {
    return createFakeRecipeServiceClient();
}

/**
 * A `QueryClient` with retries disabled, so an error path settles on the first rejection instead of
 * retrying three times behind an exponential backoff (which would make error tests slow and timing-bound).
 *
 * @returns A fresh, retry-free query client.
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

/** Everything a hook test needs to act on and observe: the hook result plus its two providers' subjects. */
export interface RecipeHookHarness<TResult> {
    /** The live hook result (`result.current` re-reads the latest render). */
    readonly result: RenderHookResult<TResult, unknown>['result'];
    /** The query client backing the render — inspect its cache to observe keys and invalidation. */
    readonly queryClient: QueryClient;
    /** The client the hook resolved from context. */
    readonly client: RecipeServiceClient;
    /** Unmount the harness. */
    readonly unmount: () => void;
}

/** Optional collaborators to reuse across renders (defaults are freshly built per call). */
export interface RenderRecipeHookOptions {
    readonly client?: RecipeServiceClient;
    readonly queryClient?: QueryClient;
}

/**
 * Render a recipe-service hook inside the real provider stack it ships with: a `QueryClientProvider` (the
 * app owns this in production) wrapping a {@link RecipeServiceProvider}. Nothing about the hooks is mocked.
 *
 * @param hook - The hook invocation to render.
 * @param options - Reusable client / query client (both default to a fresh instance).
 * @returns The hook result plus the query client and client it was rendered against.
 * @sideEffect Mounts a React tree in the jsdom document.
 */
export function renderRecipeHook<TResult>(
    hook: () => TResult,
    options: RenderRecipeHookOptions = {},
): RecipeHookHarness<TResult> {
    const client = options.client ?? makeGuardedClient();
    const queryClient = options.queryClient ?? makeTestQueryClient();

    function wrapper({ children }: { readonly children: ReactNode }) {
        return createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RecipeServiceProvider, { client, children }),
        );
    }

    const { result, unmount } = renderHook(hook, { wrapper });

    return { result, queryClient, client, unmount };
}

/**
 * The query keys currently in the cache, as plain arrays.
 *
 * @param queryClient - The client whose cache to read.
 * @returns Every cached query's key.
 */
export function cachedQueryKeys(queryClient: QueryClient): unknown[][] {
    return queryClient
        .getQueryCache()
        .getAll()
        .map((query) => [...query.queryKey]);
}
