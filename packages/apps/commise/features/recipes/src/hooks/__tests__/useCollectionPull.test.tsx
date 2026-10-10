/**
 * The Pull-Updates preview → commit → drift machine (FR-011), moved out of both detail screens into one hook. Opening
 * previews; confirming commits the PREVIEWED diff and never a blind pull; a 409 re-previews and lands in `drift`, not a
 * retry and not a spinner; any other failure is `generic`; cancel resets everything.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { PullDriftError, type PullDiff } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCollectionPull } from '../useCollectionPull.js';

const diffOf = (added: number): PullDiff =>
    ({ added: Array.from({ length: added }, (_, i) => `r${i}`), removed: [], unchanged: 0 }) as unknown as PullDiff;

function setup() {
    const client = createFakeRecipeServiceClient();
    const preview = vi.spyOn(client, 'previewPullFromSource');
    const commit = vi.spyOn(client, 'pullCollectionFromSource');
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
    const hook = renderHook(() => useCollectionPull('col_1'), { wrapper });

    return { ...hook, preview, commit };
}

describe('useCollectionPull', () => {
    it('is closed until started, then opens and loads a preview', async () => {
        const { result, preview } = setup();
        preview.mockResolvedValue(diffOf(2));

        expect(result.current.open).toBe(false);

        await act(async () => result.current.start());

        expect(result.current.open).toBe(true);
        expect(result.current.diff).toEqual(diffOf(2));
        expect(result.current.error).toBeUndefined();
    });

    it('falls to the generic error when the preview fails', async () => {
        const { result, preview } = setup();
        preview.mockRejectedValue(new Error('nope'));

        await act(async () => result.current.start());

        expect(result.current.error).toBe('generic');
    });

    it('commits the previewed diff, then closes', async () => {
        const { result, preview, commit } = setup();
        preview.mockResolvedValue(diffOf(1));
        commit.mockResolvedValue({} as never);
        await act(async () => result.current.start());

        await act(async () => result.current.confirm());

        expect(commit).toHaveBeenCalledWith('col_1', { previewedDiff: diffOf(1) });
        expect(result.current.open).toBe(false);
    });

    it('never commits without a previewed diff', async () => {
        const { result, preview, commit } = setup();
        preview.mockRejectedValue(new Error('nope'));
        await act(async () => result.current.start());

        await act(async () => result.current.confirm());

        expect(commit).not.toHaveBeenCalled();
    });

    it('re-previews on a drift error and stays open in the drift state with the fresh diff', async () => {
        const { result, preview, commit } = setup();
        preview.mockResolvedValueOnce(diffOf(1)).mockResolvedValueOnce(diffOf(3));
        commit.mockRejectedValue(new PullDriftError(diffOf(3)));
        await act(async () => result.current.start());

        await act(async () => result.current.confirm());

        expect(result.current.open).toBe(true);
        expect(result.current.error).toBe('drift');
        expect(result.current.diff).toEqual(diffOf(3));
    });

    it('falls to the generic error when the re-preview after a drift also fails', async () => {
        const { result, preview, commit } = setup();
        preview.mockResolvedValueOnce(diffOf(1)).mockRejectedValueOnce(new Error('nope'));
        commit.mockRejectedValue(new PullDriftError(diffOf(3)));
        await act(async () => result.current.start());

        await act(async () => result.current.confirm());

        expect(result.current.error).toBe('generic');
    });

    it('cancel closes and clears the diff and the error', async () => {
        const { result, preview } = setup();
        preview.mockRejectedValue(new Error('nope'));
        await act(async () => result.current.start());

        act(() => result.current.cancel());

        expect(result.current.open).toBe(false);
        expect(result.current.error).toBeUndefined();
        expect(result.current.diff).toBeUndefined();
    });
});
