/**
 * Component tests for CollectionRecipePickerContainer — the add-a-recipe-to-collection route (the ADD half of
 * FR-009 / T072). The container keeps the picker FRAME (heading, Done, search) outside its read boundary and the
 * candidates inside it, so these tests pin the behaviour that shape exists for: the search field is the same element
 * before and after the read settles, Done is reachable while loading and after a failure, a retry REFETCHES, the
 * heading can name the collection even when the recipe read fails, and nothing is read during the server render.
 *
 * It renders through the REAL query and mutation hooks over a network-guarded fake client
 * (`createFakeRecipeServiceClient`), stubbed per test with `vi.spyOn`. `next/navigation` is mocked because the
 * container navigates with `useRouter`, which throws outside an app-router tree.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { CollectionRecipePickerContainer } from '@/components/recipes/CollectionRecipePickerContainer';

import { makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';
import { makeRecipe, makeRecipesPage } from './__fixtures__/recipeFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

const RECIPES = makeRecipesPage([
    makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
    makeRecipe({ id: 'rec_2', title: 'Sheet-Pan Chicken' }),
]);

/** A client whose collection (no members yet) and recipes both resolve. */
function readyClient(): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue(
        makeCollectionWithRecipes({ id: 'col_1', name: 'Weeknight Dinners', recipes: [] }),
    );
    vi.spyOn(client, 'listRecipes').mockResolvedValue(RECIPES);

    return client;
}

function renderContainer(client: RecipeServiceClient) {
    return renderWithRecipeClient(<CollectionRecipePickerContainer id="col_1" locale="en" />, client);
}

describe('CollectionRecipePickerContainer — loading', () => {
    it('shows the loading body inside the frame, with search and Done already there', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));

        renderContainer(client);

        expect(screen.getByRole('status', { name: 'Loading your recipes' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search your recipes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('keeps the SAME search field, and what was typed, when the candidates settle', async () => {
        const user = userEvent.setup();
        let resolveRecipes: (page: typeof RECIPES) => void = () => undefined;
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockResolvedValue(
            makeCollectionWithRecipes({ id: 'col_1', name: 'Weeknight Dinners', recipes: [] }),
        );
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise((settle) => (resolveRecipes = settle)));

        renderContainer(client);
        const search = screen.getByRole('searchbox', { name: 'Search your recipes' });
        await user.type(search, 'pasta');

        resolveRecipes(RECIPES);

        expect(await screen.findByRole('button', { name: 'Add Weeknight Pasta' })).toBeInTheDocument();
        // A frame remounted by the settle would hand the cook a fresh, empty, unfocused input.
        expect(screen.getByRole('searchbox', { name: 'Search your recipes' })).toBe(search);
        expect(search).toHaveValue('pasta');
        expect(search).toHaveFocus();
        expect(screen.queryByRole('button', { name: 'Add Sheet-Pan Chicken' })).not.toBeInTheDocument();
    });

    it('reads the collection ONCE, although the heading and the candidates both use it', async () => {
        const client = readyClient();

        renderContainer(client);

        expect(await screen.findByRole('button', { name: 'Add Weeknight Pasta' })).toBeInTheDocument();
        expect(client.getCollectionById).toHaveBeenCalledTimes(1);
    });

    it('⛔ issues NO request during the server render', () => {
        const client = readyClient();

        const html = renderToString(
            <LocaleProvider locale="en">
                <QueryClientProvider client={new QueryClient()}>
                    <RecipeServiceProvider client={client}>
                        <CollectionRecipePickerContainer id="col_1" locale="en" />
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>,
        );

        expect(html).toContain('Loading your recipes');
        expect(client.getCollectionById).not.toHaveBeenCalled();
        expect(client.listRecipes).not.toHaveBeenCalled();
    });
});

describe('CollectionRecipePickerContainer — a failed read', () => {
    it('shows the load error with Done still reachable', async () => {
        const user = userEvent.setup();
        const client = readyClient();
        vi.mocked(client.listRecipes).mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderContainer(client);

        expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i);
        await user.click(screen.getByRole('button', { name: 'Done' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/col_1');
    });

    it('still names the collection when only the recipes failed', async () => {
        const client = readyClient();
        vi.mocked(client.listRecipes).mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderContainer(client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.getByRole('heading', { level: 1, name: 'Add recipes to Weeknight Dinners' }),
            ).toBeInTheDocument(),
        );
    });

    it('⛔ Try again REFETCHES and the candidates render', async () => {
        const user = userEvent.setup();
        const client = readyClient();
        vi.mocked(client.listRecipes).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(RECIPES);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderContainer(client);
        await user.click(await screen.findByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: 'Add Weeknight Pasta' })).toBeInTheDocument();
        expect(client.listRecipes).toHaveBeenCalledTimes(2);
    });
});

describe('CollectionRecipePickerContainer — adding', () => {
    it('adds the chosen recipe to THIS collection', async () => {
        const user = userEvent.setup();
        const client = readyClient();
        const addSpy = vi.spyOn(client, 'addRecipeToCollection').mockReturnValue(new Promise(() => {}));

        renderContainer(client);
        await user.click(await screen.findByRole('button', { name: 'Add Sheet-Pan Chicken' }));

        expect(addSpy).toHaveBeenCalledWith('col_1', 'rec_2');
        expect(await screen.findByText('Adding…')).toBeInTheDocument();
    });

    it('announces a successful add and marks the row a member once the collection refreshes', async () => {
        const user = userEvent.setup();
        const client = readyClient();
        vi.mocked(client.getCollectionById)
            .mockResolvedValueOnce(makeCollectionWithRecipes({ id: 'col_1', name: 'Weeknight Dinners', recipes: [] }))
            .mockResolvedValue(makeCollectionWithRecipes({ id: 'col_1', name: 'Weeknight Dinners' }));
        vi.spyOn(client, 'addRecipeToCollection').mockResolvedValue(undefined as never);

        renderContainer(client);
        await user.click(await screen.findByRole('button', { name: 'Add Weeknight Pasta' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Added Weeknight Pasta');
        expect(
            await screen.findByRole('button', { name: 'Weeknight Pasta is in this collection' }),
        ).toBeInTheDocument();
    });

    it('surfaces a failed add without hiding the rows', async () => {
        const user = userEvent.setup();
        const client = readyClient();
        vi.spyOn(client, 'addRecipeToCollection').mockRejectedValue(new Error('network down'));

        renderContainer(client);
        await user.click(await screen.findByRole('button', { name: 'Add Weeknight Pasta' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t add that recipe. Please try again.');
        expect(screen.getByRole('button', { name: 'Add Weeknight Pasta' })).toBeInTheDocument();
    });

    it('offers to create a recipe when the cook owns none', async () => {
        const user = userEvent.setup();
        const client = readyClient();
        vi.mocked(client.listRecipes).mockResolvedValue(makeRecipesPage([]));

        renderContainer(client);
        await user.click(await screen.findByRole('button', { name: 'New recipe' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/new');
    });
});
