// @vitest-environment jsdom
/**
 * The details dialog's orchestration hook (curated U14): the food read becomes the statechart's input, and each
 * pick, removal or close reaches the host's commit port once.
 */
import { FoodServiceClient, NotFoundError, type GetFoodResult } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import type { IngredientVariant } from '@kitchensink/recipe-core';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DetailsDialogEntry, DetailsDialogOutcome } from '../detailsDialogMachine.js';
import { makeFoodResponse } from '../__fixtures__/foodResponse.js';
import { BEEF_BRISKET, BONELESS_SKINLESS_CHICKEN_THIGHS } from '../__fixtures__/seedVariants.js';
import { type UseVariantDetailsDialogOptions, useVariantDetailsDialog } from '../useVariantDetailsDialog.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
});

const THIGHS: GetFoodResult = {
    status: 'RESOLVED',
    food: makeFoodResponse({ id: 'root_thighs', variants: [...BONELESS_SKINLESS_CHICKEN_THIGHS] }),
};
const BRISKET: GetFoodResult = {
    status: 'RESOLVED',
    food: makeFoodResponse({ id: 'root_brisket', variants: [...BEEF_BRISKET] }),
};
const THIGH = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
const CURRENT: IngredientVariant = { id: THIGH.id, parts: THIGH.parts };
const EDIT: DetailsDialogEntry = { mode: 'edit', current: CURRENT };
const ADD: DetailsDialogEntry = { mode: 'add' };

/** A client whose network is refused, so a read the test did not stub fails loudly. */
function guardedClient(): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });
}

/** Render the hook under a fresh query client and `client`. */
function renderDialogHook(initial: UseVariantDetailsDialogOptions, client: FoodServiceClient) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(FoodServiceProvider, { client, subject: 'user_1', children }),
        );

    return renderHook((options: UseVariantDetailsDialogOptions) => useVariantDetailsDialog(options), {
        wrapper,
        initialProps: initial,
    });
}

/** Options for an open dialog over `rootId`. */
function opened(
    rootId: string,
    entry: DetailsDialogEntry,
    onOutcome: (outcome: DetailsDialogOutcome) => void = () => undefined,
): UseVariantDetailsDialogOptions {
    return { open: true, rootId, entry, onOutcome };
}

describe('the read', () => {
    it('reads nothing while closed', () => {
        const client = guardedClient();
        const getById = vi.spyOn(client, 'getById');

        renderDialogHook({ ...opened('root_thighs', ADD), open: false }, client);

        expect(getById).not.toHaveBeenCalled();
    });

    it('is loading, then lists the root variants it read', async () => {
        const client = guardedClient();
        const getById = vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const { result } = renderDialogHook(opened('root_thighs', ADD), client);

        expect(result.current.state.name).toBe('loading');
        await waitFor(() => expect(result.current.state.name).toBe('combined'));
        expect(getById).toHaveBeenCalledWith('root_thighs');
    });

    it('fails to error, and Retry loads again', async () => {
        const client = guardedClient();
        const getById = vi.spyOn(client, 'getById').mockRejectedValueOnce(new NotFoundError('root_thighs'));
        const { result } = renderDialogHook(opened('root_thighs', ADD), client);

        await waitFor(() => expect(result.current.state.name).toBe('error'));

        let answer: (result: GetFoodResult) => void = () => undefined;

        getById.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            }),
        );
        act(() => result.current.onRetry());

        await waitFor(() => expect(result.current.state.name).toBe('loading'));
        act(() => answer(THIGHS));
        await waitFor(() => expect(result.current.state.name).toBe('combined'));
    });

    it('reads a food that is not resolved as a failure to retry, never as "no details"', async () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue({ id: 'root_thighs', status: 'PENDING' });
        const { result } = renderDialogHook(opened('root_thighs', EDIT), client);

        await waitFor(() => expect(result.current.state.name).toBe('error'));
    });

    it('keeps loading, not offline, for a read parked while the app has no focus', async () => {
        onlineManager.setOnline(false);
        focusManager.setFocused(false);
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const { result } = renderDialogHook(opened('root_thighs', ADD), client);

        await waitFor(() => expect(result.current.state.name).toBe('loading'));
        expect(result.current.state.name).not.toBe('offline');
    });

    it('shows the offline slot for a parked read', async () => {
        onlineManager.setOnline(false);
        const client = guardedClient();
        const getById = vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const { result } = renderDialogHook(opened('root_thighs', ADD), client);

        await waitFor(() => expect(result.current.state.name).toBe('offline'));
        expect(getById).not.toHaveBeenCalled();
    });
});

describe('search', () => {
    it('searches a long list and clears back to it', async () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue(BRISKET);
        const { result } = renderDialogHook(opened('root_brisket', ADD), client);

        await waitFor(() => expect(result.current.state.name).toBe('longList'));
        act(() => result.current.onQueryChange('navel'));
        expect(result.current.state.name).toBe('searching');
        expect(result.current.query).toBe('navel');

        act(() => result.current.onClearQuery());
        expect(result.current.state.name).toBe('longList');
        expect(result.current.query).toBe('');
    });

    it('announces the count only after typing has stopped for 500 ms', async () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue(BRISKET);
        const { result } = renderDialogHook(opened('root_brisket', ADD), client);

        await waitFor(() => expect(result.current.state.name).toBe('longList'));
        vi.useFakeTimers();
        act(() => result.current.onQueryChange('navel'));
        act(() => {
            vi.advanceTimersByTime(499);
        });
        expect(result.current.announcedCount).toBeUndefined();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.announcedCount).toEqual({ kind: 'matches', shown: 4, total: 40 });
    });

    // §S8.5: "no matches" waits with the count. Its text holds the query, so announced live it would restart on every
    // key press (`docs/design/readSurfacesEvaluation.md` D4).
    it('announces "no matches" only after typing has stopped, with the query it settled on', async () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue(BRISKET);
        const { result } = renderDialogHook(opened('root_brisket', ADD), client);

        await waitFor(() => expect(result.current.state.name).toBe('longList'));
        vi.useFakeTimers();
        act(() => result.current.onQueryChange('zz'));
        act(() => {
            vi.advanceTimersByTime(300);
        });
        act(() => result.current.onQueryChange('zzz'));
        act(() => {
            vi.advanceTimersByTime(300);
        });

        // Both key presses landed in "no matches", and neither settled: nothing to say yet.
        expect(result.current.state.name).toBe('noMatches');
        expect(result.current.announcedCount).toBeUndefined();

        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(result.current.announcedCount).toEqual({ kind: 'noMatches', query: 'zzz', total: 40 });
    });

    it('says nothing about an earlier opening’s search while a new opening settles', async () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue(BRISKET);
        const options = opened('root_brisket', ADD);
        const { result, rerender } = renderDialogHook(options, client);

        await waitFor(() => expect(result.current.state.name).toBe('longList'));
        vi.useFakeTimers();
        act(() => result.current.onQueryChange('zzz'));
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(result.current.announcedCount).toEqual({ kind: 'noMatches', query: 'zzz', total: 40 });

        rerender({ ...options, open: false });
        rerender(options);

        expect(result.current.announcedCount).toBeUndefined();
    });

    it('starts each opening with an empty search', async () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockResolvedValue(BRISKET);
        const options = opened('root_brisket', ADD);
        const { result, rerender } = renderDialogHook(options, client);

        await waitFor(() => expect(result.current.state.name).toBe('longList'));
        act(() => result.current.onQueryChange('navel'));
        rerender({ ...options, open: false });
        rerender(options);

        expect(result.current.query).toBe('');
        expect(result.current.state.name).toBe('longList');
    });
});

describe('the commit port', () => {
    it('reports a pick once, as a commit carrying the variant', async () => {
        const client = guardedClient();
        const onOutcome = vi.fn();

        vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const { result } = renderDialogHook(opened('root_thighs', ADD, onOutcome), client);

        await waitFor(() => expect(result.current.state.name).toBe('combined'));
        const state = result.current.state;
        const row = state.name === 'combined' ? state.rows[0]! : undefined;

        act(() => result.current.onPick(row!));

        expect(onOutcome).toHaveBeenCalledTimes(1);
        expect(onOutcome).toHaveBeenCalledWith({
            kind: 'committed',
            mode: 'add',
            variant: { id: row!.variant.id, parts: row!.variant.parts },
        });
    });

    it('reports the current row as a dismissal, which writes nothing', async () => {
        const client = guardedClient();
        const onOutcome = vi.fn();

        vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const { result } = renderDialogHook(opened('root_thighs', EDIT, onOutcome), client);

        await waitFor(() => expect(result.current.state.name).toBe('combined'));
        const state = result.current.state;
        const current = state.name === 'combined' ? state.rows.find((row) => row.variant.id === THIGH.id) : undefined;

        act(() => result.current.onPick(current!));

        expect(onOutcome).toHaveBeenCalledWith({ kind: 'dismissed' });
    });

    it('offers removal only when opened to edit, and reports it', async () => {
        const client = guardedClient();
        const onOutcome = vi.fn();

        vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const add = renderDialogHook(opened('root_thighs', ADD), client);

        await waitFor(() => expect(add.result.current.state.name).toBe('combined'));
        expect(add.result.current.onRemove).toBeUndefined();

        const edit = renderDialogHook(opened('root_thighs', EDIT, onOutcome), client);

        await waitFor(() => expect(edit.result.current.state.name).toBe('combined'));
        act(() => edit.result.current.onRemove?.());
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'removed' });
    });

    it('settles once: a second press after an outcome reports nothing, and reopening arms it again', async () => {
        const client = guardedClient();
        const onOutcome = vi.fn();

        vi.spyOn(client, 'getById').mockResolvedValue(THIGHS);
        const options = opened('root_thighs', EDIT, onOutcome);
        const { result, rerender } = renderDialogHook(options, client);

        await waitFor(() => expect(result.current.state.name).toBe('combined'));
        const state = result.current.state;
        const row = state.name === 'combined' ? state.rows.find((entry) => entry.variant.id !== THIGH.id) : undefined;

        act(() => result.current.onPick(row!));
        act(() => result.current.onPick(row!));
        act(() => result.current.onRemove?.());
        act(() => result.current.onClose());

        expect(onOutcome).toHaveBeenCalledTimes(1);

        rerender({ ...options, open: false });
        rerender(options);
        act(() => result.current.onClose());

        expect(onOutcome).toHaveBeenCalledTimes(2);
        expect(onOutcome).toHaveBeenLastCalledWith({ kind: 'dismissed' });
    });

    it('carries the entry mode, so the leaves cannot disagree with the hook about it', () => {
        const client = guardedClient();

        vi.spyOn(client, 'getById').mockReturnValue(new Promise(() => undefined));

        expect(renderDialogHook(opened('root_thighs', EDIT), client).result.current.mode).toBe('edit');
        expect(renderDialogHook(opened('root_thighs', ADD), client).result.current.mode).toBe('add');
    });

    it('reports a close as a dismissal from any state, loading included', () => {
        const client = guardedClient();
        const onOutcome = vi.fn();

        vi.spyOn(client, 'getById').mockReturnValue(new Promise(() => undefined));
        const { result } = renderDialogHook(opened('root_thighs', EDIT, onOutcome), client);

        act(() => result.current.onClose());

        expect(result.current.state.name).toBe('loading');
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'dismissed' });
    });
});
