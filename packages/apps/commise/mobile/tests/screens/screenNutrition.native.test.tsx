/**
 * ⛔ THE HOST WIRING TEST (mobile): every screen that paints recipe cards starts ONE deferred calorie batch
 * and mounts a `RecipeNutritionSlot` per card — in every state (ADR-0021 §6).
 *
 * The shared leaves are proved to RENDER a supplied node by `cardSurfaces.nutrition.native.test.tsx`. What
 * only a container can get wrong lives here, and it is mostly about WHICH ids reach the batch:
 *
 *   - `RecipeListScreen` batches the loaded PAGE, never the client-filtered rows — filtering runs on every
 *     keystroke, and filtered ids would mint a new query key (and a new promise, and a new request) per
 *     character typed while the figures already on screen blinked back to skeletons.
 *   - `RecipeDiscoveryScreen` passes ONE PAGE PER FETCHED PAGE, never a flattened list — a flattened list
 *     changes on every "load more", which re-batches page one for nothing.
 *   - `CollectionDetailScreen` batches EVERY member, not the revealed window, for the same reason (the
 *     window grows on tap), and chunks at the published cap so a 501-member collection loses nothing.
 *   - `RecipeWidgetSlot` (Home) batches the four recent recipes.
 *
 * `useRecipeNutritionBatches` is mocked here: it owns `ensureQueryData`, promise identity and the one-request
 * -per-page guarantee, and those are pinned against a real `QueryClient` in its own test
 * (`features/recipes/src/hooks/__tests__/useRecipeNutritionBatches.test.tsx`). Mocking it lets each state be
 * driven from a promise this file controls.
 *
 * ⚠️ SUSPENSE TEST CONVENTION: resolve a Suspense with `await act(...)`, NEVER `findBy`/`waitFor` — the
 * latter wedges in a Vitest worker.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeHomeWidgetDescriptor } from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import {
    useCloneCollection,
    useCloneRecipe,
    useCollection,
    useDeleteCollection,
    useInfiniteSearchRecipes,
    usePreviewPull,
    usePullCollectionFromSource,
    useRecipes,
    useRemoveRecipeFromCollection,
    useSearchIngredients,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeWidgetSlot } from '../../src/components/home/RecipeWidgetSlot.js';
import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { CollectionDetailScreen } from '../../src/screens/CollectionDetailScreen.js';
import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { RecipeListScreen } from '../../src/screens/RecipeListScreen.js';
import {
    makeCollectionWithRecipes,
    makeRecipe,
    makeRecipePage,
    makeRecipeSearchResult,
    makeSearchResponse,
} from '../__fixtures__/recipes.js';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: async () => null, setItem: async () => undefined },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useRecipes: vi.fn(),
    useInfiniteSearchRecipes: vi.fn(),
    useCloneRecipe: vi.fn(),
    useSearchIngredients: vi.fn(),
    useCollection: vi.fn(),
    useDeleteCollection: vi.fn(),
    useRemoveRecipeFromCollection: vi.fn(),
    useUpdateCollection: vi.fn(),
    useCloneCollection: vi.fn(),
    usePreviewPull: vi.fn(),
    usePullCollectionFromSource: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({ useUserProfile: vi.fn() }));

/**
 * Only `useRecipeNutritionBatches` is replaced; the rest of the hooks barrel (the discovery screen composes
 * `useBrowseRails`, `useDebouncedValue`, `useIngredientFilterSearch`, `useRecentSearches`) stays REAL, so a
 * screen cannot pass this file by losing one of them.
 */
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: vi.fn(),
}));

const useRecipesMock = vi.mocked(useRecipes);
const useInfiniteSearchRecipesMock = vi.mocked(useInfiniteSearchRecipes);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);
const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useCollectionMock = vi.mocked(useCollection);
const useUserProfileMock = vi.mocked(useUserProfile);
const useNutritionMock = vi.mocked(useRecipeNutritionBatches);

const RECIPE_ID = '00000000-0000-4000-8000-00000000000a';
const OTHER_ID = '00000000-0000-4000-8000-00000000000b';

const KNOWN_RESPONSE: RecipeNutritionResponse = {
    nutrition: {
        [RECIPE_ID]: {
            state: 'known',
            caloriesPerServing: 420,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        },
    },
};

/** A settled response that says nothing about this recipe — the "not for you" absence. */
const OMITTING_RESPONSE: RecipeNutritionResponse = { nutrition: {} };

const noop = (): void => undefined;

function mutation<T>(overrides: Partial<T> = {}): T {
    return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
        error: null,
        reset: vi.fn(),
        variables: undefined,
        ...overrides,
    } as unknown as T;
}

/** Record the pages each screen batches, and hand every recipe the SAME controlled promise. */
function nutritionLookup(batch: Promise<RecipeNutritionResponse> | null): void {
    useNutritionMock.mockImplementation(() => () => batch);
}

const pending = (): Promise<RecipeNutritionResponse> => new Promise<RecipeNutritionResponse>(() => undefined);

const rejected = (): Promise<RecipeNutritionResponse> => {
    const failed = Promise.reject(new Error('food service unavailable'));
    failed.catch(() => undefined);

    return failed as Promise<RecipeNutritionResponse>;
};

afterEach(cleanup);

/**
 * Load the Home widget's code-split chunk ONCE, before any render.
 *
 * `RecipeWidgetSlot` reaches its widget through `React.lazy` + the descriptor's `import()`. Under Vitest that
 * dynamic import resolves through Vite's module runner, which can take longer than the `act(...)` window —
 * and when the widget's first render then suspends on a still-pending nutrition batch, nothing in the test
 * ever schedules the retry that would commit it, so the whole widget stays behind its `fallback={null}` and
 * the assertion fails for a reason that has nothing to do with nutrition. (Verified: pre-loading the module
 * makes the SAME pending batch render its skeleton.) Metro serves the module from one bundle, so this is a
 * harness artifact, not the device behaviour — the cold-start path is Maestro's to prove.
 */
beforeAll(async () => {
    await recipeHomeWidgetDescriptor.load();
});

beforeEach(() => {
    vi.clearAllMocks();
    // React logs the caught render error from the rejected-batch case.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    useRecipesMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: makeRecipePage([makeRecipe({ id: RECIPE_ID, title: 'Weeknight Pasta' })]),
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipes>);

    useInfiniteSearchRecipesMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: {
            pages: [makeSearchResponse([makeRecipeSearchResult({ id: RECIPE_ID, title: 'Weeknight Pasta' })])],
        },
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteSearchRecipes>);

    useCloneRecipeMock.mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>());
    useSearchIngredientsMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
    } as unknown as ReturnType<typeof useSearchIngredients>);

    useCollectionMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: makeCollectionWithRecipes([makeRecipe({ id: RECIPE_ID, title: 'Weeknight Pasta' })]),
    } as unknown as ReturnType<typeof useCollection>);
    vi.mocked(useDeleteCollection).mockReturnValue(mutation<ReturnType<typeof useDeleteCollection>>());
    vi.mocked(useRemoveRecipeFromCollection).mockReturnValue(
        mutation<ReturnType<typeof useRemoveRecipeFromCollection>>(),
    );
    vi.mocked(useUpdateCollection).mockReturnValue(mutation<ReturnType<typeof useUpdateCollection>>());
    vi.mocked(useCloneCollection).mockReturnValue(mutation<ReturnType<typeof useCloneCollection>>());
    vi.mocked(usePreviewPull).mockReturnValue(mutation<ReturnType<typeof usePreviewPull>>());
    vi.mocked(usePullCollectionFromSource).mockReturnValue(mutation<ReturnType<typeof usePullCollectionFromSource>>());
    useUserProfileMock.mockReturnValue({
        data: { user: { id: 'usr_1' }, account: { subscriptionTier: 'premium' } },
        isLoading: false,
    } as unknown as ReturnType<typeof useUserProfile>);
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** The four wired mobile surfaces, each rendered the way its navigator renders it. */
const SCREENS: readonly (readonly [string, () => ReactElement])[] = [
    ['RecipeListScreen', () => <RecipeListScreen onSelectRecipe={noop} />],
    // A preset filter puts discovery in RESULT-LIST mode (with no query or filter it browses).
    [
        'RecipeDiscoveryScreen',
        () => <RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={{ tags: ['grill'] }} />,
    ],
    [
        'CollectionDetailScreen',
        () => (
            <CollectionDetailScreen
                collectionId="col_1"
                onSelectRecipe={noop}
                onAddRecipe={noop}
                onRename={noop}
                onDeleted={noop}
                onCloned={noop}
                onViewSource={noop}
                onBack={noop}
            />
        ),
    ],
    ['RecipeWidgetSlot (Home)', () => <RecipeWidgetSlot onSeeAllRecipes={noop} onSelectRecipe={noop} />],
];

describe.each(SCREENS)('%s — the deferred calorie figure', (_name, renderScreen) => {
    it('shows the calorie SKELETON while the batch is in flight', async () => {
        nutritionLookup(pending());

        await act(async () => {
            render(renderScreen());
        });

        expect(screen.getAllByLabelText('Loading calories').length).toBeGreaterThan(0);
    });

    it('shows the CHIP once the batch resolves', async () => {
        nutritionLookup(Promise.resolve(KNOWN_RESPONSE));

        await act(async () => {
            render(renderScreen());
        });

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    it('shows NOTHING when the batch OMITS this recipe — and no lingering skeleton', async () => {
        nutritionLookup(Promise.resolve(OMITTING_RESPONSE));

        await act(async () => {
            render(renderScreen());
        });

        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });

    it('shows NOTHING, and no spinner, when the batch REJECTS', async () => {
        nutritionLookup(rejected());

        await act(async () => {
            render(renderScreen());
        });

        expect(screen.queryByLabelText('Loading calories'), 'a failed batch must not leave a spinner').toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });

    it('renders no nutrition line when no batch covers the recipe (the host branches on `null`)', async () => {
        nutritionLookup(null);

        await act(async () => {
            render(renderScreen());
        });

        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });
});

describe('which ids each screen batches', () => {
    beforeEach(() => {
        nutritionLookup(Promise.resolve(KNOWN_RESPONSE));
    });

    it('⛔ RecipeListScreen batches the LOADED PAGE, not the rows left after client-side filtering', async () => {
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipePage([
                makeRecipe({ id: RECIPE_ID, title: 'Weeknight Pasta' }),
                makeRecipe({ id: OTHER_ID, title: 'Chana Masala' }),
            ]),
            refetch: vi.fn(),
        } as unknown as ReturnType<typeof useRecipes>);

        await act(async () => {
            render(<RecipeListScreen onSelectRecipe={noop} />);
        });
        expect(useNutritionMock).toHaveBeenCalledWith([[RECIPE_ID, OTHER_ID]]);

        // ⛔ NOW NARROW IT. Without a search term, the filtered rows and the loaded page are the same array,
        // so the assertion above cannot tell a correct container from one that batches the filtered rows.
        // Typing hides one row — and the batch must NOT change: a per-keystroke id set means a new query key,
        // a new promise, a new request, and every figure on screen dropping back to a skeleton mid-typing.
        useNutritionMock.mockClear();
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'Chana' } });
        });

        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' }), 'the row really was filtered out').toBeNull();

        for (const call of useNutritionMock.mock.calls) {
            expect(call[0]).toEqual([[RECIPE_ID, OTHER_ID]]);
        }

        expect(useNutritionMock.mock.calls.length).toBeGreaterThan(0);
    });

    it('⛔ RecipeDiscoveryScreen batches ONE PAGE PER FETCHED PAGE, never a flattened list', async () => {
        useInfiniteSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: {
                pages: [
                    makeSearchResponse([makeRecipeSearchResult({ id: RECIPE_ID, title: 'Weeknight Pasta' })]),
                    makeSearchResponse([makeRecipeSearchResult({ id: OTHER_ID, title: 'Chana Masala' })]),
                ],
            },
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
            refetch: vi.fn(),
        } as unknown as ReturnType<typeof useInfiniteSearchRecipes>);

        await act(async () => {
            render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={{ tags: ['grill'] }} />);
        });

        // Two pages, kept apart: page one's promise must survive a "load more" untouched.
        expect(useNutritionMock).toHaveBeenCalledWith([[RECIPE_ID], [OTHER_ID]]);
    });

    it('⛔ CollectionDetailScreen batches EVERY member, not just the revealed window', async () => {
        const members = Array.from({ length: 12 }, (_unused, index) =>
            makeRecipe({ id: `0000000-0000-4000-8000-0000000000${index}`, title: `Member ${index}` }),
        );
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionWithRecipes(members),
        } as unknown as ReturnType<typeof useCollection>);

        await act(async () => {
            render(
                <CollectionDetailScreen
                    collectionId="col_1"
                    onSelectRecipe={noop}
                    onAddRecipe={noop}
                    onRename={noop}
                    onDeleted={noop}
                    onCloned={noop}
                    onViewSource={noop}
                    onBack={noop}
                />,
            );
        });

        // The member list reveals a window at a time; batching only the window would re-batch on every
        // "show more" and blink the figures already on screen.
        expect(useNutritionMock).toHaveBeenCalledWith([members.map((member) => member.id)]);
    });

    it('⛔ RecipeDiscoveryScreen wires its BROWSE RAILS too — the default state is a card grid as well', async () => {
        // No query and no filters ⇒ the screen is BROWSING, and the rails (not the result list) are what a
        // viewer sees first. The rails section runs its own `useBrowseRails` and therefore its own batch;
        // forgetting to pass its renderer would leave Discover's opening view the one card grid with no
        // figure, and every other test in this file would still pass.
        await act(async () => {
            render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        });

        expect(screen.getAllByRole('img', { name: '420 cal' }).length).toBeGreaterThan(0);
        // One batch per rail — three curated rails, each settling on its own.
        expect(useNutritionMock).toHaveBeenCalledWith([[RECIPE_ID], [RECIPE_ID], [RECIPE_ID]]);
    });

    it('RecipeWidgetSlot batches the recent recipes it renders', async () => {
        await act(async () => {
            render(<RecipeWidgetSlot onSeeAllRecipes={noop} onSelectRecipe={noop} />);
        });

        expect(useNutritionMock).toHaveBeenCalledWith([[RECIPE_ID]]);
    });
});
