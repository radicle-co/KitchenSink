// @vitest-environment jsdom
/**
 * Home's first run: the recent-recipes page, settled empty, in the cache. It must follow the very entry the widget
 * writes (`recentRecipesQuery`), never a hand-built key, and unknown (nothing cached) is not a first run.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { recentRecipesQuery } from '../recentRecipesQuery.js';
import { useHomeFirstRun } from '../useHomeFirstRun.js';

const page = (total: number) => ({ data: [], total, page: 1, pageSize: 4, hasMore: false });

function harness() {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { queryKey } = recentRecipesQuery(createFakeRecipeServiceClient());

    return { queryClient, queryKey, hook: renderHook(() => useHomeFirstRun(), { wrapper }) };
}

describe('useHomeFirstRun', () => {
    it('is false while nothing is cached (unknown is not a first run)', () => {
        expect(harness().hook.result.current).toBe(false);
    });

    it('is true once the recent-recipes page settles empty, and false when it holds a recipe', async () => {
        const { queryClient, queryKey, hook } = harness();

        await act(async () => {
            queryClient.setQueryData(queryKey, page(0));
        });
        await waitFor(() => expect(hook.result.current).toBe(true));

        await act(async () => {
            queryClient.setQueryData(queryKey, page(1));
        });
        await waitFor(() => expect(hook.result.current).toBe(false));
    });

    it('ignores an empty page cached under any other key', async () => {
        const { queryClient, hook } = harness();

        await act(async () => {
            queryClient.setQueryData(['recipe-service', 'recipes', 'list', { pageSize: 99 }], page(0));
        });

        expect(hook.result.current).toBe(false);
    });
});
