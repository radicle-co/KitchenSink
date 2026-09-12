import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { Locale } from '@commise/i18n';
import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';

/** Options accepted by {@link renderWithRecipeClient}. */
export interface RenderWithRecipeClientOptions {
    /** The locale supplied to `LocaleProvider`. Defaults to `'en'`. */
    readonly locale?: Locale;
    /** A `QueryClient` to reuse across a render (e.g. to inspect its cache afterward). Defaults to a fresh,
     * retry-disabled instance per call. */
    readonly queryClient?: QueryClient;
}

/**
 * Build a fresh `QueryClient` with retries disabled, so an error-path test settles on the first rejection
 * instead of retrying three times behind TanStack Query's default exponential backoff.
 *
 * @returns A retry-free query client.
 * @sideEffect Allocates a query cache.
 */
function makeTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
}

/**
 * RTL custom-render helper for web container tests that exercise the REAL `@kitchensink/recipe-service-client`
 * hooks (rather than mocking the hooks module). Composes `LocaleProvider` + a `QueryClientProvider` +
 * `RecipeServiceProvider` around `ui`, so a test only needs to hand in a
 * {@link RecipeServiceClient} — typically
 * `createFakeRecipeServiceClient()` from `@kitchensink/recipe-service-client/testing`, stubbed per test with
 * `vi.spyOn` — instead of hand-mocking the hooks module's `Record<string, unknown>` return shapes.
 *
 * A hook rename or signature change now fails `tsc` at the `vi.spyOn` call site, not just the test assertion
 * at runtime — the type-safety win this helper exists for (see `docs/CODING_STANDARDS.md` / CP-6 T3).
 *
 * @param ui - The element to render (typically the container/component under test).
 * @param client - The `RecipeServiceClient` to provide (real instance, network-guarded — see
 *   `createFakeRecipeServiceClient`).
 * @param options - Optional locale / `QueryClient` overrides.
 * @returns RTL's own `render` result, unchanged.
 * @sideEffect Mounts a React tree in the jsdom document.
 */
export function renderWithRecipeClient(
    ui: ReactElement,
    client: RecipeServiceClient,
    options?: RenderWithRecipeClientOptions,
): RenderResult {
    const locale = options?.locale ?? 'en';
    const queryClient = options?.queryClient ?? makeTestQueryClient();

    // Providers are supplied via RTL's `wrapper` option (not a hand-nested tree passed straight to `render`)
    // so the returned `rerender(ui)` re-applies the SAME provider stack around the new element instead of
    // replacing it wholesale — a container test that rerenders with new props would otherwise silently lose
    // its `RecipeServiceProvider`/`QueryClientProvider` context on the second render.
    function Wrapper({ children }: { readonly children: ReactNode }) {
        return (
            <LocaleProvider locale={locale}>
                <QueryClientProvider client={queryClient}>
                    <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>
        );
    }

    return render(ui, { wrapper: Wrapper });
}
