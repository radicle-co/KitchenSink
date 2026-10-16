// @vitest-environment jsdom
/**
 * Tests for the shared {@link DiscoveryScreen} against its two ports — the criteria store and the platform — with
 * neither app present. The app suites (`RecipeDiscoveryContainer.test.tsx`, `RecipeDiscoveryScreen.native.test.tsx`) pin
 * the whole screen over each platform's real adapters; these pin the CONTRACT the adapters implement, so a third host
 * (or a change to one adapter) cannot silently depend on more than the port promises.
 */
import { QueryClient } from '@tanstack/react-query';
import { QueryBoundary } from '@commise/query/boundary';
import { renderWithRecipeClient } from '@commise/test-utils';
import { SnackbarHost } from '@commise/ui/snackbar';
import type { RecipeSearchResponse } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { cleanup, fireEvent, screen, waitFor, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { EMPTY_RECIPE_FILTERS } from '../../filters/model.js';
import type { RecipeFilterState } from '../../filters/model.js';
import { DiscoveryScreen } from '../DiscoveryScreen.js';
import type { DiscoveryCriteriaStore, DiscoveryPlatform } from '../discoveryScreenModel.js';

const EMPTY_PAGE: RecipeSearchResponse = {
    results: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
};

const noNutrition = () => () => null;

/** The smallest platform: the plain boundary, no nutrition, a store that remembers nothing. */
const platform: DiscoveryPlatform = {
    Boundary: QueryBoundary,
    useRenderNutrition: noNutrition,
    recentSearchStore: { getItem: async () => null, setItem: async () => undefined },
};

let client: ReturnType<typeof createFakeRecipeServiceClient>;

beforeEach(() => {
    client = createFakeRecipeServiceClient();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(cleanup);

/** The screen over `store`, as the app mounts it: inside the snackbar host, over the fake client. */
const screenOver = (store: DiscoveryCriteriaStore): ReactElement => (
    <SnackbarHost>
        <DiscoveryScreen
            criteria={store}
            platform={platform}
            onSelectRecipe={() => undefined}
            onEditCopy={() => undefined}
        />
    </SnackbarHost>
);

function renderScreen(store: DiscoveryCriteriaStore): RenderResult {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return renderWithRecipeClient(screenOver(store), client, { queryClient });
}

const storeOf = (
    filters: RecipeFilterState,
    query: string,
    commit: DiscoveryCriteriaStore['commit'],
): DiscoveryCriteriaStore => ({ filters, query, commit });

describe('DiscoveryScreen — the criteria port', () => {
    it('starts the field on the store’s query and searches the store’s filters', async () => {
        const search = vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);

        renderScreen(storeOf({ tags: ['grill'] }, 'soup', vi.fn()));

        expect((screen.getByLabelText('Search recipes') as HTMLInputElement).value).toBe('soup');
        await waitFor(() => expect(search).toHaveBeenCalled());
        expect(search.mock.calls[0]?.[0]).toMatchObject({ tags: ['grill'], query: 'soup' });
    });

    it('commits each keystroke — filters unchanged, the typed term — and echoes it at once', () => {
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);
        const commit = vi.fn();

        renderScreen(storeOf({ tags: ['grill'] }, '', commit));
        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'pie' } });

        expect((screen.getByLabelText('Search recipes') as HTMLInputElement).value).toBe('pie');
        expect(commit).toHaveBeenLastCalledWith({ filters: { tags: ['grill'] }, query: 'pie' });
    });

    it('commits a filter action over the store’s filters, keeping the typed term', async () => {
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);
        const commit = vi.fn();

        renderScreen(storeOf({ tags: ['grill'] }, 'pie', commit));
        fireEvent.click(await screen.findByRole('button', { name: /clear filters/i }));

        expect(commit).toHaveBeenLastCalledWith({ filters: EMPTY_RECIPE_FILTERS, query: 'pie' });
    });

    it('follows a filter change that arrives through the store (a URL navigation), not only its own commits', async () => {
        const search = vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);
        const commit = vi.fn();
        const view = renderScreen(storeOf({ tags: ['grill'] }, '', commit));

        await waitFor(() => expect(search).toHaveBeenCalled());
        search.mockClear();

        view.rerender(screenOver(storeOf({ tags: ['vegan'] }, '', commit)));

        await waitFor(() => expect(search).toHaveBeenCalled());
        expect(search.mock.calls.at(-1)?.[0]).toMatchObject({ tags: ['vegan'] });
    });
});
