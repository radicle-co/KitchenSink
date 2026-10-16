// @vitest-environment jsdom
/**
 * Tests for the shared {@link DiscoveryScreen} against its two ports — the criteria store and the platform — with
 * neither app present. The app suites (`RecipeDiscoveryContainer.test.tsx`, `RecipeDiscoveryScreen.native.test.tsx`) pin
 * the whole screen over each platform's real adapters; these pin the CONTRACT the adapters implement, so a third host
 * (or a change to one adapter) cannot silently depend on more than the port promises.
 */
import { QueryClient } from '@tanstack/react-query';
import { renderWithRecipeClient } from '@commise/test-utils';
import { SnackbarHost } from '@commise/ui/snackbar';
import type { RecipeSearchResponse } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { cleanup, fireEvent, screen, waitFor, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, useReducer, type ReactElement } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { EMPTY_RECIPE_FILTERS } from '../../filters/model.js';
import type { RecipeFilterState } from '../../filters/model.js';
import { DiscoveryScreen } from '../DiscoveryScreen.js';
import type {
    DiscoveryBoundaryProps,
    DiscoveryCriteriaState,
    DiscoveryCriteriaStore,
    DiscoveryPlatform,
    DiscoveryRefreshableQuery,
} from '../discoveryScreenModel.js';

const EMPTY_PAGE: RecipeSearchResponse = {
    results: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
};

const noNutrition = () => () => null;

/** The smallest read boundary the port promises: a failure shows `renderError`, a pending read shows `loading`. */
const TestBoundary = ({ loading, renderError, resetKeys, children }: DiscoveryBoundaryProps): ReactElement => (
    <ErrorBoundary fallbackRender={renderError} {...(resetKeys === undefined ? {} : { resetKeys: [...resetKeys] })}>
        <Suspense fallback={loading}>{children}</Suspense>
    </ErrorBoundary>
);

const useTestRefreshNotice = (
    query: DiscoveryRefreshableQuery,
    options?: { readonly onRecovered?: () => void },
): ReturnType<DiscoveryPlatform['useRefreshNotice']> => ({
    failed: query.isRefetchError,
    refreshing: query.isRefetching,
    onRetry: () => {
        void query.refetch().then(() => options?.onRecovered?.());
    },
    recoveries: 0,
});

const useTestRecoverySignal = (): ReturnType<DiscoveryPlatform['useRecoverySignal']> => {
    const [signal, onRecovered] = useReducer((count: number) => count + 1, 0);

    return { signal, onRecovered };
};

/** The smallest platform: a plain boundary, no nutrition, a store that remembers nothing. */
const platform: DiscoveryPlatform = {
    Boundary: TestBoundary,
    useRenderNutrition: noNutrition,
    useRefreshNotice: useTestRefreshNotice,
    useRecoverySignal: useTestRecoverySignal,
    recentSearchStore: { getItem: async () => null, setItem: async () => undefined },
};

let client: ReturnType<typeof createFakeRecipeServiceClient>;

beforeEach(() => {
    client = createFakeRecipeServiceClient();
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

/** What a `commit` argument resolves to over `current`: the port takes the next criteria or an update of the current. */
const resolved = (
    arg: Parameters<DiscoveryCriteriaStore['commit']>[0],
    current: DiscoveryCriteriaState,
): DiscoveryCriteriaState => (typeof arg === 'function' ? arg(current) : arg);

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
        expect(resolved(commit.mock.lastCall?.[0], { filters: { tags: ['grill'] }, query: '' })).toEqual({
            filters: { tags: ['grill'] },
            query: 'pie',
        });
    });

    it('commits a filter action over the store’s filters, keeping the typed term', async () => {
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);
        const commit = vi.fn();

        renderScreen(storeOf({ tags: ['grill'] }, 'pie', commit));
        fireEvent.click(await screen.findByRole('button', { name: /clear filters/i }));

        expect(resolved(commit.mock.lastCall?.[0], { filters: { tags: ['grill'] }, query: 'pie' })).toEqual({
            filters: EMPTY_RECIPE_FILTERS,
            query: 'pie',
        });
    });

    it('commits a filter action as an UPDATE of the criteria current at commit time, not of this render’s snapshot', async () => {
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);
        const commit = vi.fn();

        renderScreen(storeOf({ tags: ['grill'] }, 'pie', commit));
        fireEvent.click(await screen.findByRole('button', { name: /clear filters/i }));

        // Two actions in one event, or a keystroke between render and commit, must compose: the update is handed the
        // store's CURRENT criteria, so what an earlier commit wrote is kept.
        expect(typeof commit.mock.lastCall?.[0]).toBe('function');
        expect(resolved(commit.mock.lastCall?.[0], { filters: { tags: ['vegan'] }, query: 'stew' })).toEqual({
            filters: EMPTY_RECIPE_FILTERS,
            query: 'stew',
        });
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

describe('DiscoveryScreen — the platform port', () => {
    it('reads the failed-refresh notice and the recovery count through the platform’s hooks', async () => {
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(EMPTY_PAGE);
        const useRefreshNotice = vi.fn(useTestRefreshNotice);
        const useRecoverySignal = vi.fn(useTestRecoverySignal);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        renderWithRecipeClient(
            <SnackbarHost>
                <DiscoveryScreen
                    criteria={storeOf({ tags: ['grill'] }, '', vi.fn())}
                    platform={{ ...platform, useRefreshNotice, useRecoverySignal }}
                    onSelectRecipe={() => undefined}
                    onEditCopy={() => undefined}
                />
            </SnackbarHost>,
            client,
            { queryClient },
        );

        await waitFor(() => expect(useRefreshNotice).toHaveBeenCalled());
        expect(useRecoverySignal).toHaveBeenCalled();
        // The settled results hand the notice a way to report a recovery to the frame's counter.
        expect(useRefreshNotice.mock.calls[0]?.[1]).toEqual({ onRecovered: expect.any(Function) });
    });
});
