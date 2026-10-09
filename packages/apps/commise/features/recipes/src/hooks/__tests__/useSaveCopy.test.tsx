/**
 * Saving a copy from a card (`docs/architecture/uiOverhaulBlueprint.md` A14; `docs/design/uiOverhaul/buildSpec.md`
 * §4.1). The card's control is derived from the clone MUTATION (the source of truth), never from local state, so each
 * recipe's state is asserted separately: saving while pending, saved once it settles (and it stays saved), failed on an
 * error (and a retry is allowed). A second press while saving or saved sends nothing. A saved copy offers Edit.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SnackbarHost } from '@commise/ui/snackbar';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSaveCopy } from '../useSaveCopy.js';

/** A recipe-id control that reports its copy state as text and saves on press. */
const Probe: FC<{ readonly ids: readonly string[]; readonly onEdit: (copyId: string) => void }> = ({ ids, onEdit }) => {
    const copy = useSaveCopy(onEdit);

    return (
        <>
            {ids.map((id) => (
                <button key={id} type="button" onClick={() => copy.save(id)}>
                    {`${id}: ${copy.stateOf(id).kind}`}
                </button>
            ))}
        </>
    );
};

function renderProbe(clone: (id: string) => Promise<RecipeDetail>, onEdit: (copyId: string) => void = vi.fn()) {
    const client = createFakeRecipeServiceClient();
    const cloneRecipe = vi.spyOn(client, 'cloneRecipe').mockImplementation(clone);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>
                    <Probe ids={['a', 'b']} onEdit={onEdit} />
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );

    return { cloneRecipe, onEdit };
}

const press = (name: string): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

describe('useSaveCopy', () => {
    it('starts idle for every recipe', () => {
        renderProbe(() => Promise.resolve(makeRecipeDetail({ id: 'copy' })));

        expect(screen.getByRole('button', { name: 'a: idle' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'b: idle' })).toBeTruthy();
    });

    it('is saving for that recipe only while its copy is being made, then saved, and stays saved', async () => {
        let resolve: (recipe: RecipeDetail) => void = () => undefined;
        renderProbe(() => new Promise<RecipeDetail>((done) => (resolve = done)));

        press('a: idle');

        await screen.findByRole('button', { name: 'a: saving' });
        expect(screen.getByRole('button', { name: 'b: idle' })).toBeTruthy();

        await act(async () => resolve(makeRecipeDetail({ id: 'copy-a' })));

        await screen.findByRole('button', { name: 'a: saved' });
        expect(screen.getByRole('button', { name: 'b: idle' })).toBeTruthy();
    });

    it('sends nothing on a second press while saving, and nothing once saved', async () => {
        let resolve: (recipe: RecipeDetail) => void = () => undefined;
        const { cloneRecipe } = renderProbe(() => new Promise<RecipeDetail>((done) => (resolve = done)));

        press('a: idle');
        await screen.findByRole('button', { name: 'a: saving' });
        press('a: saving');
        await act(async () => resolve(makeRecipeDetail({ id: 'copy-a' })));
        await screen.findByRole('button', { name: 'a: saved' });
        press('a: saved');
        press('a: saved');

        expect(cloneRecipe).toHaveBeenCalledTimes(1);
        expect(cloneRecipe).toHaveBeenCalledWith('a');
    });

    it('is failed after an error, and a second press tries again', async () => {
        const clone = vi
            .fn<(id: string) => Promise<RecipeDetail>>()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(makeRecipeDetail({ id: 'copy-a' }));
        renderProbe(clone);

        press('a: idle');
        await screen.findByRole('button', { name: 'a: failed' });

        press('a: failed');
        await screen.findByRole('button', { name: 'a: saved' });

        expect(clone).toHaveBeenCalledTimes(2);
    });

    it('says a copy was saved, and its Edit opens the COPY (not the source)', async () => {
        const { onEdit } = renderProbe(() => Promise.resolve(makeRecipeDetail({ id: 'copy-a' })));

        press('a: idle');

        const snackbar = await screen.findByRole('status');
        await waitFor(() => expect(snackbar.textContent).toContain('Saved a copy to My recipes.'));

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

        expect(onEdit).toHaveBeenCalledExactlyOnceWith('copy-a');
    });

    it('shows no snackbar for a failed copy', async () => {
        renderProbe(() => Promise.reject(new Error('offline')));

        press('a: idle');
        await screen.findByRole('button', { name: 'a: failed' });

        expect(screen.getByRole('status').textContent).toBe('');
    });
});
