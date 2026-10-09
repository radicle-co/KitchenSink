/**
 * The add-recipes picker's toggles (`docs/architecture/uiOverhaulBlueprint.md` A15). Each row flips the collection's
 * cached membership AT ONCE and the server catches up; a failure undoes only THAT row's flip, never another row's
 * pending one; two presses on one row reach the server in order; and the cache is reconciled with the server only once
 * the last toggle has settled, so a refetch cannot overwrite a flip still in flight.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { RecipeCollectionAddedVia, type Recipe } from '@kitchensink/recipe-core';
import { collectionQueries, type CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useMemberToggle } from '../useMemberToggle.js';

const COLLECTION_ID = 'col_1';
const pasta = makeRecipe({ id: 'pasta', title: 'Pasta' });
const soup = makeRecipe({ id: 'soup', title: 'Soup' });

const member = (recipe: Recipe) => ({ ...recipe, addedVia: RecipeCollectionAddedVia.MANUAL });

const detailWith = (...members: readonly Recipe[]): CollectionWithRecipes => ({
    id: COLLECTION_ID,
    ownerId: 'usr_1',
    name: 'Dinners',
    visibility: 'private',
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: members.map(member),
});

/** A row for one recipe: its checked state is read off the collection query, and pressing it flips it. */
const Row: FC<{ readonly recipe: Recipe }> = ({ recipe }) => {
    const client = useRecipeServiceClient();
    const { data } = useQuery(collectionQueries(client).detail(COLLECTION_ID));
    const toggle = useMemberToggle(COLLECTION_ID, recipe);
    const checked = data?.recipes.some((entry) => entry.id === recipe.id) ?? false;

    return (
        <button type="button" onClick={() => toggle.press(!checked)}>
            {`${recipe.title}: ${checked ? 'in' : 'out'}${toggle.failed ? ' (failed)' : ''}`}
        </button>
    );
};

function setup(initial: CollectionWithRecipes) {
    const client = createFakeRecipeServiceClient();
    const getCollection = vi.spyOn(client, 'getCollectionById').mockResolvedValue(initial);
    const add = vi.spyOn(client, 'addRecipeToCollection');
    const remove = vi.spyOn(client, 'removeRecipeFromCollection');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <Row recipe={pasta} />
                <Row recipe={soup} />
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );

    return { add, remove, getCollection, queryClient };
}

/** A promise the test settles by hand. */
function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });

    return { promise, resolve, reject };
}

const press = (name: string): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

describe('useMemberToggle', () => {
    it('flips the row at once, before the server answers', async () => {
        const { add } = setup(detailWith());
        const answer = deferred<never>();
        add.mockReturnValue(answer.promise);
        await screen.findByRole('button', { name: 'Pasta: out' });

        press('Pasta: out');

        await screen.findByRole('button', { name: 'Pasta: in' });
        expect(add).toHaveBeenCalledWith(COLLECTION_ID, 'pasta');
    });

    it('removes a member the same way', async () => {
        const { remove } = setup(detailWith(pasta));
        remove.mockReturnValue(deferred<void>().promise);
        await screen.findByRole('button', { name: 'Pasta: in' });

        press('Pasta: in');

        await screen.findByRole('button', { name: 'Pasta: out' });
        expect(remove).toHaveBeenCalledWith(COLLECTION_ID, 'pasta');
    });

    it('flips the row back and marks it failed when the server refuses', async () => {
        const { add } = setup(detailWith());
        add.mockRejectedValue(new Error('nope'));
        await screen.findByRole('button', { name: 'Pasta: out' });

        press('Pasta: out');

        await screen.findByRole('button', { name: 'Pasta: out (failed)' });
    });

    it('undoes only the failed row: another row still in flight keeps its flip', async () => {
        const { add } = setup(detailWith());
        const pastaAnswer = deferred<never>();
        const soupAnswer = deferred<never>();
        add.mockImplementation((_collection, recipeId) =>
            recipeId === 'pasta' ? pastaAnswer.promise : soupAnswer.promise,
        );
        await screen.findByRole('button', { name: 'Pasta: out' });

        press('Pasta: out');
        press('Soup: out');
        await screen.findByRole('button', { name: 'Soup: in' });

        await act(async () => pastaAnswer.reject(new Error('nope')));

        await screen.findByRole('button', { name: 'Pasta: out (failed)' });
        expect(screen.getByRole('button', { name: 'Soup: in' })).toBeTruthy();
    });

    it('sends on → off → on for one row in order, one at a time', async () => {
        const { add, remove } = setup(detailWith());
        const first = deferred<never>();
        const second = deferred<void>();
        const order: string[] = [];
        add.mockImplementationOnce(() => {
            order.push('add#1');

            return first.promise;
        }).mockImplementationOnce(() => {
            order.push('add#2');

            return Promise.resolve(undefined as never);
        });
        remove.mockImplementationOnce(() => {
            order.push('remove');

            return second.promise;
        });
        await screen.findByRole('button', { name: 'Pasta: out' });

        press('Pasta: out');
        await screen.findByRole('button', { name: 'Pasta: in' });
        press('Pasta: in');
        await screen.findByRole('button', { name: 'Pasta: out' });
        press('Pasta: out');
        await screen.findByRole('button', { name: 'Pasta: in' });

        // Nothing has been answered yet, so only the first request can have gone out.
        expect(order).toEqual(['add#1']);

        await act(async () => first.resolve(undefined as never));
        await waitFor(() => expect(order).toEqual(['add#1', 'remove']));

        await act(async () => second.resolve());
        await waitFor(() => expect(order).toEqual(['add#1', 'remove', 'add#2']));
    });

    it('refetches the collection once, after the LAST toggle settles — not after each', async () => {
        const { add, getCollection } = setup(detailWith());
        const pastaAnswer = deferred<never>();
        const soupAnswer = deferred<never>();
        add.mockImplementation((_collection, recipeId) =>
            recipeId === 'pasta' ? pastaAnswer.promise : soupAnswer.promise,
        );
        await screen.findByRole('button', { name: 'Pasta: out' });
        expect(getCollection).toHaveBeenCalledTimes(1);

        press('Pasta: out');
        press('Soup: out');
        await screen.findByRole('button', { name: 'Soup: in' });

        await act(async () => pastaAnswer.resolve(undefined as never));
        // One toggle is still in flight: a refetch now would overwrite its optimistic flip with the server's old view.
        expect(getCollection).toHaveBeenCalledTimes(1);

        getCollection.mockResolvedValue(detailWith(pasta, soup));
        await act(async () => soupAnswer.resolve(undefined as never));

        await waitFor(() => expect(getCollection).toHaveBeenCalledTimes(2));
    });
});
