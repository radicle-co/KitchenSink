// @vitest-environment jsdom
/**
 * The food client's React seam (plan 002 S5): a provider hands the app's configured client to the hooks, and the hooks
 * read food-service directly. The details dialog (curated U14) lists a root's variants from `useFood`, and the Data
 * sources page (curated U25) reads `useDataSources`. The progressive search and the remote pick have their own suite,
 * `progressiveHooks.test.ts`.
 */
import type { GetFoodResult } from '@kitchensink/schema-food';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoodServiceClient } from '../client.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';
import type { CreateAuthoredFoodInput, CreateAuthoredFoodResult } from '../types.js';
import { BadRequestError, FetchUnavailableError, NotFoundError } from '../errors.js';
import {
    FoodServiceProvider,
    foodServiceKeys,
    useCreateAuthoredFood,
    useDataSources,
    useFood,
    useFoodServiceClient,
    useFoodServiceSubject,
    useProgressiveFoodSearch,
} from '../hooks.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetContractSkewLatchForTests();
});

/** A client whose network is refused, so a test that forgets to stub a call fails rather than reaching out. */
function guardedClient(): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });
}

/** How a hook is rendered: the signed-in cook, and the query client (the app's defaults, or one a case needs). */
interface RenderOptions {
    readonly subject?: string | undefined;
    readonly queryClient?: QueryClient;
}

/** Render a hook under a query client and the given food client, for the cook `user_a` unless a case says otherwise. */
function renderFoodHook<T>(hook: () => T, client: FoodServiceClient, options: RenderOptions = {}) {
    const queryClient = options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const subject = 'subject' in options ? options.subject : 'user_a';
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(FoodServiceProvider, { client, subject, children }),
        );

    return { ...renderHook(hook, { wrapper }), queryClient };
}

describe('FoodServiceProvider / useFoodServiceClient', () => {
    it('provides the exact client instance to a hook beneath it', () => {
        const client = guardedClient();

        expect(renderFoodHook(() => useFoodServiceClient(), client).result.current).toBe(client);
    });

    it('throws a named error when a hook is used outside the provider', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useFoodServiceClient())).toThrow(
            'useFoodServiceClient must be used within a <FoodServiceProvider>.',
        );

        consoleError.mockRestore();
    });
});

describe('useFood', () => {
    it('reads one food through the provided client, keyed by its id', async () => {
        const client = guardedClient();
        const answer = { status: 'PENDING', id: 'food_1' } as const;
        const getById = vi.spyOn(client, 'getById').mockResolvedValue(answer);

        const { result } = renderFoodHook(() => useFood('food_1'), client);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(answer);
        expect(getById).toHaveBeenCalledWith('food_1');
    });

    // `enabled` holds an automatic read, not a refetch; only `skipToken` makes "no id, no request" hold for both.
    it('asks nothing for an empty id, and a refetch cannot ask either', async () => {
        const client = guardedClient();
        const getById = vi.spyOn(client, 'getById');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { result } = renderFoodHook(() => useFood(''), client);

        expect(result.current.fetchStatus).toBe('idle');
        await act(async () => {
            await result.current.refetch();
        });
        expect(getById).not.toHaveBeenCalled();
    });

    it.each<[string, string, { readonly enabled?: boolean }]>([
        ['an empty id', '', {}],
        ['a disabled read', 'food_1', { enabled: false }],
    ])('asks nothing for %s', (_case, id, options) => {
        const client = guardedClient();
        const getById = vi.spyOn(client, 'getById');

        const { result } = renderFoodHook(() => useFood(id, options), client);

        expect(result.current.fetchStatus).toBe('idle');
        expect(getById).not.toHaveBeenCalled();
    });

    it('keeps a resolved food fresh, but asks again for one food is still resolving (a 202)', async () => {
        const client = guardedClient();
        const pending: GetFoodResult = { status: 'PENDING', id: 'food_1' };
        const resolved: GetFoodResult = {
            status: 'RESOLVED',
            food: {
                id: 'food_2',
                name: 'beef brisket',
                description: null,
                kind: 'generic',
                status: 'RESOLVED',
                nutrients: [],
                portions: [],
                provenance: {},
                variants: [],
            },
        };

        vi.spyOn(client, 'getById').mockImplementation((id) => Promise.resolve(id === 'food_1' ? pending : resolved));

        const stillResolving = renderFoodHook(() => useFood('food_1'), client);
        const settled = renderFoodHook(() => useFood('food_2'), client);

        await waitFor(() => expect(stillResolving.result.current.isSuccess).toBe(true));
        await waitFor(() => expect(settled.result.current.isSuccess).toBe(true));
        // A 202 answer is stale at once, so the next mount reads again; a resolved food keeps its five minutes.
        expect(stillResolving.result.current.isStale).toBe(true);
        expect(settled.result.current.isStale).toBe(false);
    });

    it('keys each food apart, so two roots never share a cache entry', () => {
        expect(foodServiceKeys.food('a')).not.toEqual(foodServiceKeys.food('b'));
        expect(foodServiceKeys.food('a')).toEqual(foodServiceKeys.food('a'));
    });
});

describe('useDataSources', () => {
    it('reads the cited sources through the provided client', async () => {
        const client = guardedClient();
        const answer = { sources: [] };
        const listSources = vi.spyOn(client, 'listSources').mockResolvedValue(answer);

        const { result } = renderFoodHook(() => useDataSources(), client);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(answer);
        expect(listSources).toHaveBeenCalledTimes(1);
    });
});

/**
 * A food read and the sources read repeat a failure only as the app's policy says (`@commise/query`'s `shouldRetryQuery`,
 * whose food veto is `shouldRetryFoodServiceFailure`). They used to carry a retry rule of their own, a second statement
 * of which failures are permanent. These cases prove neither read sets one: the query client's default is consulted.
 */
describe('useFood and useDataSources — the retry is the app’s', () => {
    /** A query client whose default retry is a spy that never retries. */
    function withRetrySpy() {
        const retry = vi.fn(() => false);

        return { retry, queryClient: new QueryClient({ defaultOptions: { queries: { retry } } }) };
    }

    it('asks the app’s rule whether to read a food again', async () => {
        const client = guardedClient();
        vi.spyOn(client, 'getById').mockRejectedValue(new NotFoundError('food_1'));
        const { retry, queryClient } = withRetrySpy();

        const { result } = renderFoodHook(() => useFood('food_1'), client, { queryClient });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(retry).toHaveBeenCalledWith(0, expect.any(NotFoundError));
    });

    it('asks the app’s rule whether to read the sources again', async () => {
        const client = guardedClient();
        vi.spyOn(client, 'listSources').mockRejectedValue(new FetchUnavailableError(5));
        const { retry, queryClient } = withRetrySpy();

        const { result } = renderFoodHook(() => useDataSources(), client, { queryClient });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(retry).toHaveBeenCalledWith(0, expect.any(FetchUnavailableError));
    });
});
/**
 * REWRITTEN for plan 002 S7.8: the cook's own foods now arrive in the progressive search's database frame (ADR-0055
 * point 5), so a create clears the cook's PROGRESSIVE answers, not the authored search's, and leaves another cook's.
 */
describe('useCreateAuthoredFood', () => {
    const INPUT: CreateAuthoredFoodInput = {
        name: 'my egg',
        macros: { calories: 150, proteinG: 12, carbsG: 1, fatG: 10 },
    };
    const ANSWER = { database: undefined, sources: [], complete: true } as const;

    /** A query client holding one progressive answer for `user_a` and one for `user_b`. */
    function withSearches(): QueryClient {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        queryClient.setQueryData(foodServiceKeys.progressiveSearch('user_a', 'egg'), ANSWER);
        queryClient.setQueryData(foodServiceKeys.progressiveSearch('user_b', 'egg'), ANSWER);

        return queryClient;
    }

    // S5 list contract L4.6: without this the next row's search would not find the food, and the cook would make it twice.
    it.each<[string, CreateAuthoredFoodResult]>([
        [
            'a created food',
            {
                kind: 'created',
                food: {
                    id: 'food_9',
                    name: 'my egg',
                    description: null,
                    kind: 'generic',
                    status: 'RESOLVED',
                    nutrients: [],
                    portions: [],
                    provenance: {},
                    variants: [],
                },
            },
        ],
        ['a duplicate name', { kind: 'duplicate', existingId: 'food_9' }],
    ])('clears the cook’s progressive answers after %s, and leaves another cook’s', async (_case, outcome) => {
        const client = guardedClient();
        vi.spyOn(client, 'createAuthoredFood').mockResolvedValue(outcome);
        const queryClient = withSearches();

        const { result } = renderFoodHook(() => useCreateAuthoredFood(), client, { queryClient });
        await act(async () => {
            await result.current.mutateAsync(INPUT);
        });

        expect(queryClient.getQueryData(foodServiceKeys.progressiveSearch('user_a', 'egg'))).toBeUndefined();
        expect(queryClient.getQueryData(foodServiceKeys.progressiveSearch('user_b', 'egg'))).toStrictEqual(ANSWER);
    });

    it('leaves the answers as they were when the create fails', async () => {
        const client = guardedClient();
        vi.spyOn(client, 'createAuthoredFood').mockRejectedValue(new BadRequestError());
        const queryClient = withSearches();

        const { result } = renderFoodHook(() => useCreateAuthoredFood(), client, { queryClient });
        await act(async () => {
            await result.current.mutateAsync(INPUT).catch(() => undefined);
        });

        expect(queryClient.getQueryData(foodServiceKeys.progressiveSearch('user_a', 'egg'))).toStrictEqual(ANSWER);
    });

    it('finishes without waiting for the cleared search to answer again', async () => {
        const client = guardedClient();
        let asked = 0;
        vi.spyOn(client, 'searchProgressive').mockImplementation(async function* () {
            asked += 1;

            if (asked === 1) {
                yield { type: 'complete' } as const;

                return;
            }

            await new Promise(() => undefined);
        });
        vi.spyOn(client, 'createAuthoredFood').mockResolvedValue({ kind: 'duplicate', existingId: 'food_9' });

        const { result } = renderFoodHook(
            () => ({ search: useProgressiveFoodSearch('egg'), create: useCreateAuthoredFood() }),
            client,
        );
        await waitFor(() => expect(result.current.search.data?.complete).toBe(true));
        const tooLong = new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('the create waited on the search')), 500);
        });
        await act(async () => {
            await Promise.race([result.current.create.mutateAsync(INPUT), tooLong]);
        });

        expect(asked).toBe(2);
        await waitFor(() => expect(result.current.search.isPending).toBe(true));
    });
});

describe('FoodServiceProvider — the signed-in cook', () => {
    it('hands the cook to the hooks', () => {
        expect(renderFoodHook(() => useFoodServiceSubject(), guardedClient()).result.current).toBe('user_a');
    });

    it('hands undefined to the hooks while no one is signed in', () => {
        const { result } = renderFoodHook(() => useFoodServiceSubject(), guardedClient(), { subject: undefined });

        expect(result.current).toBeUndefined();
    });

    it('throws a named error when the subject is read outside the provider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useFoodServiceSubject())).toThrow(
            'useFoodServiceSubject must be used within a <FoodServiceProvider>.',
        );
    });
});
