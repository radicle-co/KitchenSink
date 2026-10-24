// @vitest-environment jsdom
/**
 * The progressive food search's React seam (ADR-0055 points 5, 9 and 10; staff-architect review ruling 1):
 * `useProgressiveFoodSearch` folds the streamed frames into one cached answer with TanStack's
 * `experimental_streamedQuery`, keyed on the signed-in cook (ADR-0054), and `useAdoptRemoteFood` is the remote pick's
 * command.
 *
 * Neither is ever retried automatically (plan 002 R65, control C5): a retried search would resend source calls food
 * already admitted, and a retried adopt can spend a second one. With no retry, an offline read can only park if it never
 * starts, so the search is `networkMode: 'online'` (`docs/design/rowEditorOpenDecisions.md` P6, "Offline").
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoodServiceClient } from '../client.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';
import { FetchUnavailableError, SourceBusyError } from '../errors.js';
import { FoodServiceProvider, foodServiceKeys, useAdoptRemoteFood, useProgressiveFoodSearch } from '../hooks.js';
import type { ProgressiveFrame } from '../progressiveFrames.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
    resetContractSkewLatchForTests();
});

/** A client whose network is refused, so a test that forgets to stub a call fails rather than reaching out. */
function guardedClient(): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });
}

/** Frames a test hands over one at a time, as a body would. */
interface FrameFeed {
    readonly frames: () => AsyncGenerator<ProgressiveFrame>;
    readonly push: (frame: ProgressiveFrame) => void;
    readonly end: () => void;
    readonly fail: (error: unknown) => void;
}

/** A feed whose generator waits for each frame the test pushes. */
function frameFeed(): FrameFeed {
    const queue: ({ readonly frame: ProgressiveFrame } | { readonly end: true } | { readonly error: unknown })[] = [];
    let wake: (() => void) | undefined;

    const put = (item: (typeof queue)[number]): void => {
        queue.push(item);
        wake?.();
        wake = undefined;
    };

    return {
        frames: async function* () {
            for (;;) {
                while (queue.length === 0) {
                    await new Promise<void>((resolve) => {
                        wake = resolve;
                    });
                }

                const next = queue.shift();

                if (next === undefined || 'end' in next) {
                    return;
                }

                if ('error' in next) {
                    throw next.error;
                }

                yield next.frame;
            }
        },
        push: (frame) => put({ frame }),
        end: () => put({ end: true }),
        fail: (error) => put({ error }),
    };
}

const DATABASE: ProgressiveFrame = {
    type: 'database',
    catalog: { outcome: 'answered', results: [{ id: 'food_1', name: 'egg', score: 0.9 }] },
    authored: { outcome: 'answered', results: [] },
};
const USDA: ProgressiveFrame = {
    type: 'source',
    source: 'usda',
    outcome: 'answered',
    items: [{ name: 'Egg, duck', reference: 'r1' }],
};
const COMPLETE: ProgressiveFrame = { type: 'complete' };

/** A frame list as a finished body. */
async function* bodyOf(...frames: readonly ProgressiveFrame[]): AsyncGenerator<ProgressiveFrame> {
    for (const frame of frames) {
        yield frame;
    }
}

interface RenderOptions {
    readonly subject?: string | undefined;
    readonly queryClient?: QueryClient;
}

/**
 * Render a hook for the cook `user_a` unless a case says otherwise, under a query client with the app's defaults where
 * they matter here: it RETRIES, and reads `offlineFirst` (`@commise/query`'s `createQueryClient`).
 */
function renderFoodHook<T, P>(
    hook: (props: P) => T,
    client: FoodServiceClient,
    options: RenderOptions & { initialProps?: P } = {},
) {
    const queryClient =
        options.queryClient ??
        new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0, networkMode: 'offlineFirst' } } });
    const subject = 'subject' in options ? options.subject : 'user_a';
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(FoodServiceProvider, { client, subject, children }),
        );

    return { ...renderHook(hook, { wrapper, initialProps: options.initialProps }), queryClient };
}

describe('useProgressiveFoodSearch', () => {
    it('folds each frame into the answer as it arrives, fetching until the body ends', async () => {
        const client = guardedClient();
        const feed = frameFeed();
        const search = vi.spyOn(client, 'searchProgressive').mockImplementation(() => feed.frames());

        const { result } = renderFoodHook(() => useProgressiveFoodSearch('egg'), client);

        expect(result.current.data).toBeUndefined();
        act(() => feed.push(DATABASE));
        await waitFor(() => expect(result.current.data?.database).toStrictEqual(DATABASE));
        expect(result.current.fetchStatus).toBe('fetching');
        expect(result.current.data?.sources).toStrictEqual([]);

        act(() => feed.push(USDA));
        await waitFor(() => expect(result.current.data?.sources).toStrictEqual([USDA]));
        act(() => {
            feed.push(COMPLETE);
            feed.end();
        });

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(result.current.data).toStrictEqual({ database: DATABASE, sources: [USDA], complete: true });
        expect(search).toHaveBeenCalledWith('egg', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });

    it('keys each answer on the cook and the text', async () => {
        const client = guardedClient();
        vi.spyOn(client, 'searchProgressive').mockImplementation(() => bodyOf(DATABASE, COMPLETE));

        const { queryClient } = renderFoodHook(() => useProgressiveFoodSearch('egg'), client);

        await waitFor(() =>
            expect(queryClient.getQueryData(foodServiceKeys.progressiveSearch('user_a', 'egg'))).toMatchObject({
                complete: true,
            }),
        );
        expect(queryClient.getQueryData(foodServiceKeys.progressiveSearch('user_b', 'egg'))).toBeUndefined();
    });

    it.each<[string, RenderOptions, { readonly enabled?: boolean }]>([
        ['with no one signed in', { subject: undefined }, {}],
        ['while held', {}, { enabled: false }],
    ])('asks nothing %s', async (_case, options, hookOptions) => {
        const client = guardedClient();
        const search = vi.spyOn(client, 'searchProgressive');

        const { result } = renderFoodHook(() => useProgressiveFoodSearch('egg', hookOptions), client, options);

        expect(result.current.fetchStatus).toBe('idle');
        expect(search).not.toHaveBeenCalled();
    });

    it('is never retried, whatever the app’s default, so food’s admitted calls are not sent twice', async () => {
        const client = guardedClient();
        const search = vi.spyOn(client, 'searchProgressive').mockImplementation(async function* () {
            yield* bodyOf();
            throw new FetchUnavailableError();
        });

        const { result } = renderFoodHook(() => useProgressiveFoodSearch('egg'), client);

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('parks offline without asking, and asks once the connection returns', async () => {
        const client = guardedClient();
        const search = vi.spyOn(client, 'searchProgressive').mockImplementation(() => bodyOf(DATABASE, COMPLETE));
        onlineManager.setOnline(false);

        const { result } = renderFoodHook(() => useProgressiveFoodSearch('egg'), client);

        await waitFor(() => expect(result.current.fetchStatus).toBe('paused'));
        expect(search).not.toHaveBeenCalled();

        act(() => onlineManager.setOnline(true));

        await waitFor(() => expect(result.current.data?.complete).toBe(true));
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('keeps a complete answer for its text, so coming back to the text asks nothing', async () => {
        const client = guardedClient();
        const search = vi.spyOn(client, 'searchProgressive').mockImplementation(() => bodyOf(DATABASE, COMPLETE));

        const { result, rerender } = renderFoodHook(
            ({ text }: { text: string }) => useProgressiveFoodSearch(text),
            client,
            {
                initialProps: { text: 'egg' },
            },
        );

        await waitFor(() => expect(result.current.data?.complete).toBe(true));
        rerender({ text: 'eggs' });
        await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
        rerender({ text: 'egg' });

        expect(result.current.data?.complete).toBe(true);
        expect(search).toHaveBeenCalledTimes(2);
    });

    // P2: "An incomplete or failed answer is never kept as the text's answer", or "Edit your search to try again" would
    // bring back the same gap.
    it('asks again for a text whose answer was incomplete, rather than showing that answer', async () => {
        const client = guardedClient();
        const search = vi.spyOn(client, 'searchProgressive').mockImplementation(() => bodyOf(DATABASE));

        const { result, rerender } = renderFoodHook(
            ({ text }: { text: string }) => useProgressiveFoodSearch(text),
            client,
            {
                initialProps: { text: 'egg' },
            },
        );

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(result.current.data?.complete).toBe(false);
        rerender({ text: 'eggs' });
        await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
        rerender({ text: 'egg' });

        await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    });
});

describe('useAdoptRemoteFood', () => {
    it('adopts the hit by its reference and answers the root', async () => {
        const client = guardedClient();
        const adopt = vi.spyOn(client, 'adoptRemoteFood').mockResolvedValue({ id: 'food_42' });

        const { result } = renderFoodHook(() => useAdoptRemoteFood(), client);
        let answer: unknown;
        await act(async () => {
            answer = await result.current.mutateAsync('sealed.ref');
        });

        expect(answer).toStrictEqual({ id: 'food_42' });
        expect(adopt).toHaveBeenCalledWith('sealed.ref');
    });

    it('is never retried, whatever the app’s mutation default', async () => {
        const client = guardedClient();
        const adopt = vi.spyOn(client, 'adoptRemoteFood').mockRejectedValue(new SourceBusyError(2));
        const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0 } } });

        const { result } = renderFoodHook(() => useAdoptRemoteFood(), client, { queryClient });
        await act(async () => {
            await result.current.mutateAsync('sealed.ref').catch(() => undefined);
        });

        expect(adopt).toHaveBeenCalledTimes(1);
    });
});
