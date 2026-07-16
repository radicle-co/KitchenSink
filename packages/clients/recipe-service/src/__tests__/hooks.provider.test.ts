// @vitest-environment jsdom
/**
 * Provider/context wiring for the recipe-service hooks (T064): `RecipeServiceProvider` +
 * `useRecipeServiceClient`. This is the seam every other hook depends on — if it resolves the wrong client
 * (or fails quietly), every hook in the package silently talks to the wrong API or to nothing at all.
 *
 * | Requirement | Behavior pinned                                                                    |
 * | ----------- | ---------------------------------------------------------------------------------- |
 * | T064        | the provider supplies the exact client instance to a hook beneath it                |
 * | T064        | a data hook drives the provided client (not a global/default one)                   |
 * | T064        | a hook used outside the provider throws a named, actionable error — it fails loudly |
 * | T064        | nested providers resolve the nearest client (per-subtree override)                  |
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';

import { RecipeServiceProvider, useRecipeServiceClient, useRecipes } from '../hooks.js';
import { makePaginatedResponse, makeRecipe } from '../__fixtures__/recipes.js';
import { makeGuardedClient, makeTestQueryClient, renderRecipeHook } from './utils/hookHarness.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('RecipeServiceProvider / useRecipeServiceClient', () => {
    it('provides the exact client instance to a hook rendered beneath it', () => {
        const client = makeGuardedClient();

        const { result } = renderRecipeHook(() => useRecipeServiceClient(), { client });

        expect(result.current).toBe(client);
    });

    it('drives the provided client — a data hook fetches through it, not through a default client', async () => {
        const client = makeGuardedClient();
        const page = makePaginatedResponse([makeRecipe({ id: 'rec_provided' })]);
        const listRecipes = vi.spyOn(client, 'listRecipes').mockResolvedValue(page);

        const { result } = renderRecipeHook(() => useRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(page);
        expect(listRecipes).toHaveBeenCalledTimes(1);
    });

    it('throws a named, actionable error when a hook is used outside the provider', () => {
        // React logs a render-phase throw to console.error; silence it so the expected failure is not noise.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useRecipeServiceClient())).toThrow(
            'useRecipeServiceClient must be used within a <RecipeServiceProvider>.',
        );

        consoleError.mockRestore();
    });

    it('throws (rather than silently never fetching) when a QUERY hook is used outside the provider', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queryClient = makeTestQueryClient();

        function queryOnlyWrapper({ children }: { readonly children: ReactNode }) {
            return createElement(QueryClientProvider, { client: queryClient }, children);
        }

        expect(() => renderHook(() => useRecipes(), { wrapper: queryOnlyWrapper })).toThrow(
            /must be used within a <RecipeServiceProvider>/,
        );

        consoleError.mockRestore();
    });

    it('resolves the nearest provider when providers are nested (per-subtree client override)', () => {
        const outer = makeGuardedClient();
        const inner = makeGuardedClient();
        const queryClient = makeTestQueryClient();

        function nestedWrapper({ children }: { readonly children: ReactNode }) {
            return createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(RecipeServiceProvider, {
                    client: outer,
                    children: createElement(RecipeServiceProvider, { client: inner, children }),
                }),
            );
        }

        const { result } = renderHook(() => useRecipeServiceClient(), { wrapper: nestedWrapper });

        expect(result.current).toBe(inner);
        expect(result.current).not.toBe(outer);
    });

    it('renders its children', () => {
        const client = makeGuardedClient();
        const { result } = renderRecipeHook(() => useRecipeServiceClient(), { client });

        // A hook only runs if the provider actually rendered the subtree containing it.
        expect(result.current).toBeInstanceOf(Object);
    });
});
