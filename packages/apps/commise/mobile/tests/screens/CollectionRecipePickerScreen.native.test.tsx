/**
 * Component tests for the mobile CollectionRecipePickerScreen (react-native-web under jsdom) — the ADD half
 * of FR-009 (T072). The screen keeps the picker FRAME (heading, Done, search) outside its read boundary and reads
 * the collection and the caller's own recipes with suspense queries inside it, then wires the add to
 * `useAddRecipeToCollection`. These cover the screen's OWN logic — the boundary's loading and failure (whose retry
 * refetches), Done reachable in every state (it is the screen's only way out), the client-side search filter, the
 * membership derivation, the in-flight/success/failure signals from the mutation, and the add/create/done wiring —
 * not the block's presentational branches (owned by the block's own suite).
 *
 * The screen renders through the REAL hooks over a network-guarded fake client (`createFakeRecipeServiceClient`), so
 * a retry is proven by a second request and an add by the client call it issues.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { renderWithRecipeClient } from '@commise/test-utils';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { CollectionRecipePickerScreen } from '../../src/screens/CollectionRecipePickerScreen.js';
import { makeCollectionWithRecipes, makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const noop = (): void => undefined;

/** A client whose collection (named, with the given members) and recipe page both resolve. */
function readyClient(
    members: readonly ReturnType<typeof makeRecipe>[],
    candidates: readonly ReturnType<typeof makeRecipe>[],
): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue(
        makeCollectionWithRecipes(members, { id: 'col_1', name: 'Weeknight favourites' }),
    );
    vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipePage(candidates));

    return client;
}

function renderScreen(
    client: RecipeServiceClient,
    overrides: { onCreateRecipe?: () => void; onDone?: () => void } = {},
) {
    renderWithRecipeClient(
        <CollectionRecipePickerScreen
            collectionId="col_1"
            onCreateRecipe={overrides.onCreateRecipe ?? noop}
            onDone={overrides.onDone ?? noop}
        />,
        client,
    );
}

describe('CollectionRecipePickerScreen — fetch states', () => {
    it('shows the loading state with Done already reachable', () => {
        const onDone = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));

        renderScreen(client, { onDone });

        expect(screen.getByLabelText('Loading your recipes')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('shows an alert when a read fails, with Done still reachable', async () => {
        const onDone = vi.fn();
        const client = readyClient([], []);
        vi.mocked(client.getCollectionById).mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderScreen(client, { onDone });

        expect(await screen.findByRole('alert')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('⛔ Try again REFETCHES and the candidates render', async () => {
        const client = readyClient([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);
        vi.mocked(client.listRecipes)
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(makeRecipePage([makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderScreen(client);
        fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: 'Add Fish Tacos' })).toBeTruthy();
        expect(client.listRecipes).toHaveBeenCalledTimes(2);
    });

    it('keeps the search field and what was typed when the candidates settle', async () => {
        let resolveRecipes: (page: ReturnType<typeof makeRecipePage>) => void = () => undefined;
        const client = readyClient([], []);
        vi.mocked(client.listRecipes).mockReturnValue(new Promise((settle) => (resolveRecipes = settle)));

        renderScreen(client);
        const search = screen.getByLabelText('Search your recipes');
        fireEvent.change(search, { target: { value: 'soup' } });

        resolveRecipes(
            makeRecipePage([
                makeRecipe({ id: 'rec_9', title: 'Fish Tacos' }),
                makeRecipe({ id: 'rec_2', title: 'Lentil Soup' }),
            ]),
        );

        expect(await screen.findByRole('button', { name: 'Add Lentil Soup' })).toBeTruthy();
        expect(screen.getByLabelText('Search your recipes')).toBe(search);
        expect((search as HTMLInputElement).value).toBe('soup');
        expect(screen.queryByRole('button', { name: 'Add Fish Tacos' })).toBeNull();
    });

    it('offers to create a recipe when the caller owns none', async () => {
        const onCreateRecipe = vi.fn();

        renderScreen(readyClient([], []), { onCreateRecipe });
        fireEvent.click(await screen.findByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionRecipePickerScreen — adding', () => {
    it('names the collection and adds a chosen recipe to it', async () => {
        const client = readyClient([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);
        const addSpy = vi.spyOn(client, 'addRecipeToCollection').mockReturnValue(new Promise(() => {}));

        renderScreen(client);
        fireEvent.click(await screen.findByRole('button', { name: 'Add Fish Tacos' }));

        expect(screen.getByRole('heading', { name: 'Add recipes to Weeknight favourites' })).toBeTruthy();
        await vi.waitFor(() => expect(addSpy).toHaveBeenCalledWith('col_1', 'rec_9'));
    });

    it('marks a recipe already in this collection as a member (no add control)', async () => {
        const member = makeRecipe({ id: 'rec_9', title: 'Fish Tacos' });
        // The candidate list (the caller's recipes) includes the recipe that is already a member.
        renderScreen(readyClient([member], [member, makeRecipe({ id: 'rec_2', title: 'Lentil Soup' })]));

        expect(await screen.findByText('In this collection')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Fish Tacos' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Add Lentil Soup' })).toBeTruthy();
    });

    it('marks the in-flight recipe as busy while its add is pending', async () => {
        const client = readyClient([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);
        vi.spyOn(client, 'addRecipeToCollection').mockReturnValue(new Promise(() => {}));

        renderScreen(client);
        fireEvent.click(await screen.findByRole('button', { name: 'Add Fish Tacos' }));

        expect(await screen.findByText('Adding…')).toBeTruthy();
    });

    it('announces the last successful add', async () => {
        const recipe = makeRecipe({ id: 'rec_9', title: 'Fish Tacos' });
        const client = readyClient([], [recipe]);
        vi.mocked(client.getCollectionById)
            .mockResolvedValueOnce(makeCollectionWithRecipes([], { id: 'col_1', name: 'Weeknight favourites' }))
            .mockResolvedValue(makeCollectionWithRecipes([recipe], { id: 'col_1', name: 'Weeknight favourites' }));
        vi.spyOn(client, 'addRecipeToCollection').mockResolvedValue(undefined as never);

        renderScreen(client);
        fireEvent.click(await screen.findByRole('button', { name: 'Add Fish Tacos' }));

        expect(await screen.findByText('Added Fish Tacos')).toBeTruthy();
    });

    it('surfaces an add failure as an alert', async () => {
        const client = readyClient([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);
        vi.spyOn(client, 'addRecipeToCollection').mockRejectedValue(new Error('network down'));

        renderScreen(client);
        fireEvent.click(await screen.findByRole('button', { name: 'Add Fish Tacos' }));

        expect((await screen.findByRole('alert')).textContent).toContain(
            'We couldn’t add that recipe. Please try again.',
        );
    });
});
