// @vitest-environment jsdom
/**
 * Whether Home's floating create button yields (`docs/design/uiOverhaul/buildSpec.md` §3.4, §4.2): while the recent
 * recipes load, and on the first run. It must follow the very entry the widget writes (`recentRecipesQuery`), never a
 * hand-built key.
 *
 * ⚠️ REWRITTEN from `useHomeFirstRun.test.tsx`, which asked only "settled empty?" — and so called loading "not a first
 * run" and let the button mount, then vanish when the empty page arrived. Loading now yields too.
 */
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { recentRecipesQuery } from '../recentRecipesQuery.js';
import { useHomeCreateEntryYields } from '../useHomeCreateEntryYields.js';

const page = (total: number) => ({ data: [], total, page: 1, pageSize: 4, hasMore: false });

function harness() {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { queryKey } = recentRecipesQuery(createFakeRecipeServiceClient());

    return { queryClient, queryKey, hook: renderHook(() => useHomeCreateEntryYields(), { wrapper }) };
}

describe('useHomeCreateEntryYields', () => {
    it('yields while nothing is cached (loading: the button never appears, so it cannot vanish)', () => {
        expect(harness().hook.result.current).toBe(true);
    });

    it('yields when the recent page settles empty, and shows once it holds a recipe', async () => {
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

    it('shows when the recent read is paused (offline) with nothing cached', async () => {
        const { queryClient, queryKey, hook } = harness();

        await act(async () => {
            queryClient.getQueryCache().build(queryClient, { queryKey }).setState({ fetchStatus: 'paused' });
        });
        await waitFor(() => expect(hook.result.current).toBe(false));
    });

    it('ignores an empty page cached under any other key', async () => {
        const { queryClient, hook } = harness();

        await act(async () => {
            queryClient.setQueryData(['recipe-service', 'recipes', 'list', { pageSize: 99 }], page(0));
        });

        expect(hook.result.current).toBe(true);
    });
});
