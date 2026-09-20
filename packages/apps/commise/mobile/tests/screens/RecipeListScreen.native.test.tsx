/**
 * Component tests for the mobile RecipeListScreen (react-native-web under jsdom — see `vitest.native.config.ts`). The
 * screen puts the shared native recipe-list FRAME around a suspense read of the caller's library: `Suspense` renders the
 * loading fallback, the error boundary the load error (its retry refetches, and it keeps the create dial), and once
 * settled the RESULTS render the chips, the narrowed rows and the refresh notice.
 *
 * REWRITTEN for the suspense conversion: the read goes through the REAL hooks over a network-guarded fake client
 * (`renderWithRecipeClient`), with a settled page SEEDED into the query cache so it renders synchronously — where the
 * old file mocked `useRecipes` and fed the screen status flags a suspense read no longer exposes. The transport-level
 * chain (a real client over a fetch double, including a hung request) stays in `RecipeListScreen.liveSeam.native.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { Recipe } from '@kitchensink/recipe-core';
import type { ReactElement } from 'react';

import { renderWithRecipeClient } from '@commise/test-utils';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { RecipeListScreen } from '../../src/screens/RecipeListScreen.js';
import { makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

// react-native-web does not implement `sendAccessibilityEvent`; the heading hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// This file is not about nutrition, so the lookup is stubbed to "no batch covers this recipe" — the branch that renders
// no nutrition line at all. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

/** The fake client and request cache each test renders over. */
let client: ReturnType<typeof createFakeRecipeServiceClient>;
let queryClient: QueryClient;

/** Put a SETTLED library in the cache, so the suspense read renders it with no fetch. */
function seedLibrary(recipes: readonly Recipe[]): void {
    queryClient.setQueryData(recipeQueries(client).list().queryKey, makeRecipePage(recipes));
}

function render(ui: ReactElement) {
    return renderWithRecipeClient(ui, client, { queryClient });
}

const noop = (): void => undefined;

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
    client = createFakeRecipeServiceClient();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // Unseeded, a read stays pending — the loading state.
    vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));
});

describe('RecipeListScreen — while the library loads', () => {
    it('keeps the heading and search field on screen, and shows the loading region under them', () => {
        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByLabelText('Quick filters')).toBeNull();
    });

    it('mounts NO create control while the library is loading, so none can vanish as it settles', () => {
        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
    });
});

describe('RecipeListScreen — a failed load', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('shows an alert and loads the library from Try again', async () => {
        const list = vi
            .spyOn(client, 'listRecipes')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeRecipePage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]));

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(await screen.findByRole('alert')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('⛔ keeps the create dial, reaching the paste destination', async () => {
        vi.spyOn(client, 'listRecipes').mockRejectedValue(new Error('network down'));
        const onPasteIngredients = vi.fn();

        render(<RecipeListScreen onSelectRecipe={noop} onPasteIngredients={onPasteIngredients} />);
        await screen.findByRole('alert');

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('⛔ keeps the typed search term across Try again — the term lives above the boundary', async () => {
        vi.spyOn(client, 'listRecipes')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(
                makeRecipePage([
                    makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                    makeRecipe({ id: 'rec_2', title: 'Fish Tacos' }),
                ]),
            );

        render(<RecipeListScreen onSelectRecipe={noop} />);
        await screen.findByRole('alert');
        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'taco' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.getByLabelText<HTMLInputElement>('Search recipes').value).toBe('taco');
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).toBeNull();
    });
});

describe('RecipeListScreen — a failed refresh of the rows on screen', () => {
    it('⛔ keeps the rows and says the refresh failed, never the list error, and Try again refetches', async () => {
        seedLibrary([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]);
        const list = vi
            .spyOn(client, 'listRecipes')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeRecipePage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]));

        render(<RecipeListScreen onSelectRecipe={noop} />);
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeQueries(client).list().queryKey });
        });

        // TanStack batches observer notifications onto a later tick, so the notice is awaited, not read synchronously.
        expect((await screen.findAllByText('We couldn’t refresh your recipes.')).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.queryByText('We couldn’t load your recipes.')).toBeNull();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(list).toHaveBeenCalledTimes(2);
    });

    it('⛔ moves the screen-reader cursor to the heading when a retry from the notice succeeds', async () => {
        seedLibrary([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]);
        vi.spyOn(client, 'listRecipes')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeRecipePage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]));

        render(<RecipeListScreen onSelectRecipe={noop} />);
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeQueries(client).list().queryKey });
        });
        await screen.findAllByText('We couldn’t refresh your recipes.');

        // The notice is inside the read boundary and the heading outside it: the recovery has to cross.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        await vi.waitFor(() =>
            expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
                screen.getByRole('heading', { name: 'Recipes' }),
                'focus',
            ),
        );
    });
});

describe('RecipeListScreen — an empty library', () => {
    it('shows the empty message and forwards the first-run CTA to onCreateRecipe', () => {
        seedLibrary([]);
        const onCreateRecipe = vi.fn();

        render(<RecipeListScreen onSelectRecipe={noop} onCreateRecipe={onCreateRecipe} />);

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListScreen — a populated library', () => {
    beforeEach(() => {
        seedLibrary([
            makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
            makeRecipe({ id: 'rec_2', title: 'Fish Tacos' }),
        ]);
    });

    it('renders a pluralized count and one row per recipe', () => {
        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByText('2 recipes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
    });

    it('forwards the selected recipe id upward', () => {
        const onSelectRecipe = vi.fn();

        render(<RecipeListScreen onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('filters the loaded recipes by title as the search value changes', () => {
        render(<RecipeListScreen onSelectRecipe={noop} />);
        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'taco' } });

        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).toBeNull();
        expect(screen.getByText('1 recipe')).toBeTruthy();
    });

    it('says NO MATCH — not first-run copy — when the search filters every row out, and keeps the dial', () => {
        render(<RecipeListScreen onSelectRecipe={noop} />);
        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'zzz' } });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });
});

describe('RecipeListScreen — quick-filter chips (L4)', () => {
    it('derives chips from the loaded dietary flags + cuisine and filters by an active chip', () => {
        seedLibrary([
            makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta', dietaryFlags: ['Vegetarian'], cuisine: 'Italian' }),
            makeRecipe({ id: 'rec_2', title: 'Sunday Roast', dietaryFlags: [], cuisine: 'British' }),
        ]);

        render(<RecipeListScreen onSelectRecipe={noop} />);
        fireEvent.click(screen.getByText('Vegetarian'));

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Sunday Roast' })).toBeNull();
    });

    it('says NO MATCH when pressed CHIPS alone filter every row out', () => {
        // One chip can never empty the list (each is derived from a recipe carrying it); two that no recipe
        // satisfies together can — with no search term involved.
        seedLibrary([
            makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta', dietaryFlags: ['Vegetarian'], cuisine: 'British' }),
            makeRecipe({ id: 'rec_2', title: 'Sunday Roast', dietaryFlags: [], cuisine: 'Italian' }),
        ]);

        render(<RecipeListScreen onSelectRecipe={noop} />);
        fireEvent.click(screen.getByText('Vegetarian'));
        fireEvent.click(screen.getByText('Italian'));

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
    });

    it('surfaces a "Quick (<30m)" chip that filters to recipes under the 30-minute threshold (#4)', () => {
        seedLibrary([
            makeRecipe({ id: 'rec_1', title: 'Overnight Oats', totalTimeMinutes: 5 }),
            makeRecipe({ id: 'rec_2', title: "Grandma's Pasta", totalTimeMinutes: 45 }),
        ]);

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.queryByText('quick')).toBeNull();
        fireEvent.click(screen.getByText('Quick (<30m)'));

        expect(screen.getByRole('button', { name: 'Overnight Oats' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: "Grandma's Pasta" })).toBeNull();
    });

    it('omits the "Quick (<30m)" chip when no loaded recipe qualifies (other facets still render)', () => {
        seedLibrary([makeRecipe({ id: 'rec_1', title: "Grandma's Pasta", totalTimeMinutes: 45, cuisine: 'Italian' })]);

        render(<RecipeListScreen onSelectRecipe={noop} />);

        const chips = screen.getByLabelText('Quick filters');
        expect(within(chips).getByText('Italian')).toBeTruthy();
        expect(within(chips).queryByText('Quick (<30m)')).toBeNull();
    });
});
