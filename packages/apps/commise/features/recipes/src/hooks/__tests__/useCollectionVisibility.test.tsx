/**
 * Changing a collection's visibility from its ⋯ menu (`docs/design/uiOverhaul/buildSpec.md` §5.2; blueprint Part C,
 * slice 5). It happens at once (the cached collection changes before the server answers), says so in a snackbar, and
 * Undo is a COMPENSATING change ordered after the first. A free-tier cook choosing private gets the Premium sheet
 * instead and nothing is sent; one who made a private collection public gets no Undo, because the reverse would be
 * refused. A refused change rolls back and says so.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { SnackbarHost } from '@commise/ui/snackbar';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { collectionQueries, type CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCollectionVisibility } from '../useCollectionVisibility.js';

afterEach(cleanup);

const detailOf = (visibility: RecipeVisibility): CollectionWithRecipes => ({
    id: 'col_1',
    ownerId: 'usr_1',
    name: 'Dinners',
    visibility,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: [],
});

const Screen: FC<{ readonly canGoPrivate: boolean }> = ({ canGoPrivate }) => {
    const { data } = useQuery(collectionQueries(useRecipeServiceClient()).detail('col_1'));
    const control = useCollectionVisibility({ id: 'col_1', canGoPrivate });
    const visibility = data?.visibility ?? RecipeVisibility.PRIVATE;

    return (
        <>
            <p>{`now ${visibility}`}</p>
            <button type="button" onClick={() => control.change(RecipeVisibility.PRIVATE)}>
                make private
            </button>
            <button type="button" onClick={() => control.change(RecipeVisibility.PUBLIC)}>
                make public
            </button>
            {control.upsellOpen ? <p>upsell open</p> : null}
            {control.failed ? <p role="alert">change failed</p> : null}
        </>
    );
};

async function setup(start: RecipeVisibility, canGoPrivate: boolean) {
    const client = createFakeRecipeServiceClient();
    // A server that remembers what it was told, so the refetch after the last change agrees with the cache.
    let server = start;
    vi.spyOn(client, 'getCollectionById').mockImplementation(() => Promise.resolve(detailOf(server)));
    const update = vi.spyOn(client, 'updateCollection').mockImplementation((_id, request) => {
        server = request.visibility ?? server;

        return Promise.resolve({} as never);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>
                    <Screen canGoPrivate={canGoPrivate} />
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );
    await screen.findByText(`now ${start}`);

    return { update };
}

const press = (name: string): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

describe('useCollectionVisibility', () => {
    it('changes the cached collection at once, sends the change, and offers Undo', async () => {
        const { update } = await setup(RecipeVisibility.PUBLIC, true);
        update.mockReturnValue(new Promise(() => undefined));

        press('make private');

        await screen.findByText('now private');
        expect(update).toHaveBeenCalledWith('col_1', { visibility: 'private' });
        expect(screen.getByRole('status').textContent).toContain('Collection is now private.');
        expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    });

    it('Undo changes it back, as a second change after the first', async () => {
        const { update } = await setup(RecipeVisibility.PUBLIC, true);

        press('make private');
        await screen.findByText('now private');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await screen.findByText('now public');
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
        expect(update).toHaveBeenLastCalledWith('col_1', { visibility: 'public' });
    });

    it('opens the Premium sheet for a cook who may not go private, and sends nothing', async () => {
        const { update } = await setup(RecipeVisibility.PUBLIC, false);

        press('make private');

        await screen.findByText('upsell open');
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText('now public')).toBeTruthy();
    });

    it('offers no Undo when the way back would be refused (private → public for a cook without the plan)', async () => {
        await setup(RecipeVisibility.PRIVATE, false);

        press('make public');

        await screen.findByText('now public');
        expect(screen.getByRole('status').textContent).toContain('Collection is now public.');
        expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });

    it('rolls back and says so when the server refuses', async () => {
        const { update } = await setup(RecipeVisibility.PUBLIC, true);
        update.mockRejectedValue(new Error('nope'));

        press('make private');

        await screen.findByRole('alert');
        await screen.findByText('now public');
    });

    it('does nothing for a change to the visibility it already has', async () => {
        const { update } = await setup(RecipeVisibility.PUBLIC, true);

        await act(async () => press('make public'));

        expect(update).not.toHaveBeenCalled();
    });
});
