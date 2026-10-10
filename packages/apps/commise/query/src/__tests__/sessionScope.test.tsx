// @vitest-environment jsdom
/**
 * `useQuerySessionScope`: when the signed-in cook changes from a cook to anyone else, the app's query cache forgets
 * everything the last cook read and every write the last cook queued in memory (ADR-0054). It replaced
 * `FoodServiceProvider`'s purge, whose tests asserted it removed food reads "and nothing else"; that assertion is
 * reversed here on purpose, because the recipe client's reads (a cook's private recipes, their collections) were the
 * larger leak, and they share the one cache.
 *
 * The cases drive a real `QueryClient` and read its caches back, and the write case counts sends, so each fails if the
 * boundary removes too little or acts at the wrong transition.
 */
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode, createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQuerySessionScope } from '../sessionScope.js';

afterEach(() => {
    cleanup();
    act(() => {
        onlineManager.setOnline(true);
    });
});

/** A client holding a recipe read, a catalog read, a food read and one cook's authored search. */
function seeded(): QueryClient {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    queryClient.setQueryData(['recipe-service', 'recipes'], { items: ['A’s private soup'] });
    queryClient.setQueryData(['food-service', 'search', 'catalog', 'egg'], { results: [] });
    queryClient.setQueryData(['food-service', 'food', 'food_1'], { status: 'PENDING', id: 'food_1' });
    queryClient.setQueryData(['food-service', 'search', 'authored', 'user_A', 'egg'], { results: [] });

    return queryClient;
}

/** Mount the boundary for `subject` over `queryClient`; `switchTo` re-renders it for another cook. */
function mountScope(queryClient: QueryClient, subject: string | undefined) {
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    const view = renderHook(({ cook }: { cook: string | undefined }) => useQuerySessionScope(queryClient, cook), {
        wrapper,
        initialProps: { cook: subject },
    });

    return { switchTo: (cook: string | undefined) => view.rerender({ cook }) };
}

/** Mounts the boundary for one cook over `client`. */
function Scope({ client, cook }: { readonly client: QueryClient; readonly cook: string }) {
    useQuerySessionScope(client, cook);

    return null;
}

const readsIn = (queryClient: QueryClient): number => queryClient.getQueryCache().getAll().length;

describe('useQuerySessionScope — when a cook’s session ends', () => {
    it.each([
        ['the cook signs out', undefined],
        ['another cook signs in', 'user_B'],
    ])('removes every read, recipe and food alike, when %s', (_case, next) => {
        const queryClient = seeded();

        mountScope(queryClient, 'user_A').switchTo(next);

        expect(readsIn(queryClient)).toBe(0);
    });

    it('stops a read still in flight', () => {
        const queryClient = new QueryClient();
        let signal: AbortSignal | undefined;
        const scope = mountScope(queryClient, 'user_A');

        void queryClient.prefetchQuery({
            queryKey: ['recipe-service', 'recipes'],
            queryFn: ({ signal: querySignal }) => {
                signal = querySignal;

                return new Promise<never>(() => undefined);
            },
        });
        scope.switchTo(undefined);

        expect(signal?.aborted).toBe(true);
    });

    // A write queued while offline is held in memory only. Sent after the cook left, it would be sent with whatever
    // session is live then, so it goes with the session. (A write queued through `SyncProvider` is in the cook's own
    // outbox, which this boundary does not touch: it drains when that cook signs in again.)
    it('never sends a write the cook queued offline, even once the connection returns', async () => {
        const queryClient = new QueryClient();
        const mutationFn = vi.fn(async () => 'sent');
        const scope = mountScope(queryClient, 'user_A');

        act(() => {
            onlineManager.setOnline(false);
        });
        const pending = queryClient
            .getMutationCache()
            .build(queryClient, { mutationFn })
            .execute(undefined)
            .catch(() => undefined);
        // `execute` reaches the retryer, where an offline write waits, only after its own awaits have run.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(queryClient.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);

        scope.switchTo(undefined);
        await act(async () => {
            onlineManager.setOnline(true);
            await queryClient.resumePausedMutations();
        });

        expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
        expect(mutationFn).not.toHaveBeenCalled();
        void pending;
    });
});

describe('useQuerySessionScope — when no session ends', () => {
    // A page that read the catalog before the identity client named the cook keeps its answer.
    it('removes nothing when a cook signs in from signed out', () => {
        const queryClient = seeded();

        mountScope(queryClient, undefined).switchTo('user_A');

        expect(readsIn(queryClient)).toBe(4);
    });

    it('removes nothing while the same cook stays signed in', () => {
        const queryClient = seeded();

        mountScope(queryClient, 'user_A').switchTo('user_A');

        expect(readsIn(queryClient)).toBe(4);
    });

    // StrictMode mounts, unmounts and remounts every effect in development. A boundary that acted on unmount would
    // discard what the server render had just hydrated, on every page load.
    it('removes nothing when it mounts under StrictMode', () => {
        const queryClient = seeded();

        render(
            createElement(
                StrictMode,
                null,
                createElement(
                    QueryClientProvider,
                    { client: queryClient },
                    createElement(Scope, { client: queryClient, cook: 'user_A' }),
                ),
            ),
        );

        expect(readsIn(queryClient)).toBe(4);
    });
});

/**
 * A read still mounted when the cook changes (a direct switch between two signed-in cooks, which leaves the screen in
 * place) must show the new cook's answer, not keep the last cook's.
 */
describe('useQuerySessionScope — a read mounted across a change of cook', () => {
    /** Shows the recipes read for the cook, keyed without the cook, as the recipe client's reads are. */
    function Recipes({ cook }: { readonly cook: string }) {
        const { data } = useQuery({
            queryKey: ['recipe-service', 'recipes'],
            queryFn: async () => `${cook}'s recipes`,
            staleTime: Number.POSITIVE_INFINITY,
        });

        return createElement('span', null, data ?? 'loading');
    }

    /** The boundary and the read, for `cook`. */
    function Screen({ client, cook }: { readonly client: QueryClient; readonly cook: string }) {
        useQuerySessionScope(client, cook);

        return createElement(Recipes, { cook });
    }

    it('shows the new cook’s answer once the switch has settled', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const tree = (cook: string) =>
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(Screen, { client: queryClient, cook }),
            );
        const view = render(tree('user_A'));
        await waitFor(() => expect(screen.getByText("user_A's recipes")).toBeTruthy());

        view.rerender(tree('user_B'));

        await waitFor(() => expect(screen.getByText("user_B's recipes")).toBeTruthy());
        expect(screen.queryByText("user_A's recipes")).toBeNull();
    });
});
