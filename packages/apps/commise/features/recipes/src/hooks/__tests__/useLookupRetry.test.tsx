// @vitest-environment jsdom
/**
 * Unit tests for `useLookupRetry` — the FAILED row's Try again (plan 002 V1, orchestrator slice 2): it is
 * `GET /api/v1/ingredients/{id}/status`, which re-asks food for an open failure and settles it (no recipe write).
 *
 * ⛔ What must hold: the answer is applied through the CALLER's latest `onStatus` (the host's settle, over its latest
 * draft) — never through the values captured when Try again was pressed, which an edit made while the lookup ran
 * would overwrite; the same id is never asked twice at once; and the read goes through the status query's own cache
 * entry, so a poller mounted afterwards for that id sees the fresh answer rather than an older cached one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { seedLineKey } from '../../form/lineKey.js';
import { useLookupRetry } from '../useLookupRetry.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({ useRecipeServiceClient: vi.fn() }));

const getIngredientStatus = vi.fn();
/** The row Try again was pressed on: the announcement follows the LINE, which a settle never re-keys. */
const ROW = seedLineKey(1, 0);
const OTHER_ROW = seedLineKey(1, 1);
vi.mocked(useRecipeServiceClient).mockReturnValue({ getIngredientStatus } as unknown as ReturnType<
    typeof useRecipeServiceClient
>);

afterEach(() => {
    getIngredientStatus.mockReset();
});

const harness = (
    onStatus: (
        answers: readonly {
            polledId: string;
            observed: { id: string; status: string; foodId?: string; variant?: { id: string } };
        }[],
    ) => void,
) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return {
        queryClient,
        ...renderHook((props: { onStatus: typeof onStatus }) => useLookupRetry(props.onStatus), {
            wrapper,
            initialProps: { onStatus },
        }),
    };
};

describe('useLookupRetry', () => {
    it('asks the status read for the line’s binding and applies the answer through onStatuses', async () => {
        getIngredientStatus.mockResolvedValue({
            id: 'ing_1',
            name: 'Kale',
            foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
        });
        const onStatus = vi.fn();
        const { result } = harness(onStatus);

        act(() => result.current.retry('ing_1', ROW));

        expect(result.current.retrying.has('ing_1')).toBe(true);
        // EDITED for REVIEW F1: the answers arrive as ONE list, applied as one transition.
        await waitFor(() =>
            expect(onStatus).toHaveBeenCalledWith([
                { polledId: 'ing_1', observed: { id: 'ing_1', status: FoodResolutionStatus.NOT_FOUND } },
            ]),
        );
        expect(getIngredientStatus).toHaveBeenCalledWith('ing_1');
        await waitFor(() => expect(result.current.retrying.has('ing_1')).toBe(false));
    });

    it('⛔ applies the answer through the LATEST onStatus, not the one captured when Try again was pressed', async () => {
        let answer: (value: unknown) => void = () => undefined;
        getIngredientStatus.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            }),
        );
        const stale = vi.fn();
        const latest = vi.fn();
        const { result, rerender } = harness(stale);

        act(() => result.current.retry('ing_1', ROW));
        rerender({ onStatus: latest });
        await act(async () => {
            answer({ id: 'ing_1', name: 'Kale', foodResolutionStatus: FoodResolutionStatus.RESOLVED });
        });

        await waitFor(() => expect(latest).toHaveBeenCalledTimes(1));
        expect(stale).not.toHaveBeenCalled();
    });

    it('⛔ applies ALL answers in ONE call, so a host whose setter takes a value cannot lose one (REVIEW F1)', async () => {
        getIngredientStatus.mockImplementation(async (id: string) => ({
            id,
            name: id,
            foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
        }));
        const onStatuses = vi.fn();
        const { result } = harness(onStatuses);

        act(() => result.current.retry('ing_a', ROW));
        act(() => result.current.retry('ing_b', OTHER_ROW));

        await waitFor(() => expect(onStatuses.mock.lastCall?.[0]).toHaveLength(2));

        for (const call of onStatuses.mock.calls) {
            // Every call carries every answer known so far: never one answer alone after another has landed.
            expect(call).toHaveLength(1);
        }

        expect(onStatuses.mock.lastCall?.[0]).toEqual([
            { polledId: 'ing_a', observed: { id: 'ing_a', status: FoodResolutionStatus.NOT_FOUND } },
            { polledId: 'ing_b', observed: { id: 'ing_b', status: FoodResolutionStatus.NOT_FOUND } },
        ]);
    });

    it('reports the settled answer of a retry the cook started, for the polite announcement (V1 sign-off 3c)', async () => {
        getIngredientStatus.mockResolvedValue({
            id: 'ing_1',
            name: 'Kale',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        const { result } = harness(vi.fn());

        expect(result.current.settled).toBeUndefined();
        act(() => result.current.retry('ing_1', ROW));

        // Finding #6: keyed by the ROW, not the polled binding — a settle may move the row to another binding.
        await waitFor(() =>
            expect(result.current.settled).toEqual({ lineKey: ROW, status: FoodResolutionStatus.RESOLVED }),
        );
    });

    it('carries the food the answered binding names, so the resolved line gets its nutrition (finding #5)', async () => {
        getIngredientStatus.mockResolvedValue({
            id: 'bound_1',
            name: 'Saffron',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            foodId: 'food_saffron',
        });
        const onStatuses = vi.fn();
        const { result } = harness(onStatuses);

        act(() => result.current.retry('ing_1', ROW));

        await waitFor(() =>
            expect(onStatuses).toHaveBeenCalledWith([
                {
                    polledId: 'ing_1',
                    observed: {
                        id: 'bound_1',
                        status: FoodResolutionStatus.RESOLVED,
                        foodId: 'food_saffron',
                    },
                },
            ]),
        );
    });

    /** REWRITTEN for curated U15: the root and the variant both travel, so the row can show the variant's parts. */
    it('carries a variant binding by its root AND its variant (curated U9)', async () => {
        getIngredientStatus.mockResolvedValue({
            id: 'bound_1',
            name: 'Saffron',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            foodId: 'food_saffron',
            variant: { id: 'var_threads', parts: [{ attribute: 'form', text: 'threads' }] },
        });
        const onStatuses = vi.fn();
        const { result } = harness(onStatuses);

        act(() => result.current.retry('ing_1', ROW));

        await waitFor(() =>
            expect(onStatuses).toHaveBeenCalledWith([
                {
                    polledId: 'ing_1',
                    observed: {
                        id: 'bound_1',
                        status: FoodResolutionStatus.RESOLVED,
                        foodId: 'food_saffron',
                        variant: { id: 'var_threads', parts: [{ attribute: 'form', text: 'threads' }] },
                    },
                },
            ]),
        );
    });

    it('⛔ clears the announcement while a new ask runs, so a repeated outcome is announced again (finding #6)', async () => {
        let answer: (value: unknown) => void = () => undefined;
        getIngredientStatus.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const { result } = harness(vi.fn());
        const failedAgain = { id: 'ing_1', name: 'Saffron', foodResolutionStatus: FoodResolutionStatus.FAILED };

        act(() => result.current.retry('ing_1', ROW));
        await act(async () => answer(failedAgain));
        await waitFor(() =>
            expect(result.current.settled).toEqual({ lineKey: ROW, status: FoodResolutionStatus.FAILED }),
        );

        act(() => result.current.retry('ing_1', ROW));

        // The same outcome is the same sentence: only an empty region between the two makes the second one news.
        expect(result.current.settled).toBeUndefined();
        await act(async () => answer(failedAgain));
        await waitFor(() =>
            expect(result.current.settled).toEqual({ lineKey: ROW, status: FoodResolutionStatus.FAILED }),
        );
    });

    it('never asks the same id twice at once', () => {
        getIngredientStatus.mockReturnValue(new Promise(() => undefined));
        const { result } = harness(vi.fn());

        act(() => result.current.retry('ing_1', ROW));
        act(() => result.current.retry('ing_1', ROW));

        expect(getIngredientStatus).toHaveBeenCalledTimes(1);
    });

    it('writes the answer to the status query’s own cache entry, so a later poller reads it', async () => {
        getIngredientStatus.mockResolvedValue({
            id: 'ing_1',
            name: 'Kale',
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        const { result, queryClient } = harness(vi.fn());

        act(() => result.current.retry('ing_1', ROW));

        await waitFor(() =>
            expect(queryClient.getQueryData(recipeServiceKeys.ingredientStatus('ing_1'))).toMatchObject({
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            }),
        );
    });

    it('a lookup that fails leaves the row as it was and lets the cook try again', async () => {
        getIngredientStatus.mockRejectedValueOnce(new Error('offline'));
        const onStatus = vi.fn();
        const { result } = harness(onStatus);

        act(() => result.current.retry('ing_1', ROW));

        await waitFor(() => expect(result.current.retrying.has('ing_1')).toBe(false));
        expect(onStatus).not.toHaveBeenCalled();
    });
});
