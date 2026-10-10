/**
 * Removing a member from a collection's detail, with Undo (`docs/architecture/uiOverhaulBlueprint.md` A15). Undo
 * CANCELS BEFORE SENDING: the row hides at once, the removal is sent only when the snackbar commits (it timed out, a
 * newer snackbar replaced it), and Undo means it was never sent. It never re-adds afterwards, because a member carries
 * provenance a re-add would lose. The commit survives the screen going away, and a commit that fails brings the row
 * back with an alert.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { SnackbarHost, useSnackbar } from '@commise/ui/snackbar';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { collectionQueries, type CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';

import { useMemberRemoval } from '../useMemberRemoval.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const detailOf = (...ids: readonly string[]): CollectionWithRecipes => ({
    id: 'col_1',
    ownerId: 'usr_1',
    name: 'Dinners',
    visibility: 'private',
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: ids.map((id) => ({ ...makeRecipe({ id, title: id }), addedVia: RecipeCollectionAddedVia.MANUAL })),
});

/** A detail screen: one button per member that is not hidden, plus a button that raises some other snackbar. */
const Screen: FC = () => {
    const removal = useMemberRemoval({ id: 'col_1', name: 'Dinners' });
    const snackbar = useSnackbar();
    const { data } = useQuery(collectionQueries(useRecipeServiceClient()).detail('col_1'));
    const ids = (data?.recipes ?? []).map((recipe) => recipe.id);

    return (
        <>
            {ids
                .filter((id) => !removal.hiddenIds.includes(id))
                .map((id) => (
                    <button key={id} type="button" onClick={() => removal.remove({ id, title: id })}>
                        {`remove ${id}`}
                    </button>
                ))}
            <button type="button" onClick={() => snackbar.show({ message: 'something else' })}>
                other snackbar
            </button>
            {removal.failedTitle === undefined ? null : <p role="alert">{`failed ${removal.failedTitle}`}</p>}
        </>
    );
};

function setup(remove: (collectionId: string, recipeId: string) => Promise<void> = () => Promise.resolve()) {
    const client = createFakeRecipeServiceClient();
    const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockImplementation(remove);
    const getCollection = vi.spyOn(client, 'getCollectionById').mockResolvedValue(detailOf('pasta', 'soup'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const tree = (shown: boolean) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>{shown ? <Screen /> : null}</SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = render(tree(true));

    return { removeSpy, getCollection, hideScreen: () => view.rerender(tree(false)) };
}

const advance = async (ms: number): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
};

const press = (name: string): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

/** Let the first read of the collection settle. */
const loaded = async (): Promise<void> => {
    await advance(0);
};

describe('useMemberRemoval', () => {
    it('hides the row at once, says so, and sends nothing yet', async () => {
        const { removeSpy } = setup();
        await loaded();

        press('remove pasta');

        expect(screen.queryByRole('button', { name: 'remove pasta' })).toBeNull();
        expect(screen.getByRole('status').textContent).toContain('Removed pasta from Dinners.');
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('sends the removal once, when the snackbar times out', async () => {
        const { removeSpy } = setup();
        await loaded();

        press('remove pasta');
        await advance(6000);

        expect(removeSpy).toHaveBeenCalledExactlyOnceWith('col_1', 'pasta');
    });

    it('brings the row back on Undo and never sends the removal', async () => {
        const { removeSpy } = setup();
        await loaded();

        press('remove pasta');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await advance(10_000);

        expect(screen.getByRole('button', { name: 'remove pasta' })).toBeTruthy();
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('commits the first removal the moment a newer snackbar replaces it', async () => {
        const { removeSpy } = setup();
        await loaded();

        press('remove pasta');
        press('other snackbar');
        await advance(0);

        expect(removeSpy).toHaveBeenCalledExactlyOnceWith('col_1', 'pasta');
    });

    it('commits the first removal when a second removal replaces its snackbar, and the second after its own timeout', async () => {
        const { removeSpy } = setup();
        await loaded();

        press('remove pasta');
        press('remove soup');
        await advance(0);

        expect(removeSpy).toHaveBeenCalledExactlyOnceWith('col_1', 'pasta');

        await advance(6000);

        expect(removeSpy).toHaveBeenCalledTimes(2);
        expect(removeSpy).toHaveBeenLastCalledWith('col_1', 'soup');
    });

    it('still commits when the screen has gone before the snackbar times out', async () => {
        const { removeSpy, hideScreen } = setup();
        await loaded();

        press('remove pasta');
        hideScreen();
        await advance(6000);

        expect(removeSpy).toHaveBeenCalledExactlyOnceWith('col_1', 'pasta');
    });

    it('brings the row back with an alert when the committed removal fails', async () => {
        setup(() => Promise.reject(new Error('nope')));
        await loaded();

        press('remove pasta');
        await advance(6000);

        expect(screen.getByRole('button', { name: 'remove pasta' })).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toBe('failed pasta');
    });

    it('keeps the row hidden after the removal succeeds, until the refreshed collection arrives', async () => {
        const { getCollection } = setup();
        await loaded();
        getCollection.mockImplementation(() => new Promise(() => undefined));

        press('remove pasta');
        await advance(6000);

        expect(screen.queryByRole('button', { name: 'remove pasta' })).toBeNull();
    });

    it('lets go of the hidden id once the refreshed collection has arrived', async () => {
        const { getCollection } = setup();
        await loaded();
        getCollection.mockResolvedValue(detailOf('soup'));

        press('remove pasta');
        await advance(6000);

        expect(screen.queryByRole('button', { name: 'remove pasta' })).toBeNull();
        expect(screen.getByRole('button', { name: 'remove soup' })).toBeTruthy();
    });
});
