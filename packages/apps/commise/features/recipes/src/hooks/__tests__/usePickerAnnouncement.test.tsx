/**
 * What the add-recipes picker says (`docs/architecture/uiOverhaulBlueprint.md` A15): the latest toggle that did not fail,
 * read off the mutation cache. A refused toggle is not announced as done (the row's own alert says it failed); a repeat of
 * the same toggle is a new occurrence, so a live region says it again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useMemberToggle } from '../useMemberToggle.js';
import { usePickerAnnouncement } from '../usePickerAnnouncement.js';

const COLLECTION_ID = 'col_1';
const soup = makeRecipe({ id: 'soup', title: 'Soup' });

const Harness: FC = () => {
    const toggle = useMemberToggle(COLLECTION_ID, soup);
    const announcement = usePickerAnnouncement(COLLECTION_ID);

    return (
        <>
            <button type="button" onClick={() => toggle.press(true)}>
                add
            </button>
            <button type="button" onClick={() => toggle.press(false)}>
                remove
            </button>
            <output>
                {announcement === undefined
                    ? 'nothing'
                    : `${announcement.member ? 'added' : 'removed'} ${announcement.title} @${announcement.at}`}
            </output>
        </>
    );
};

function setup() {
    const client = createFakeRecipeServiceClient();
    const add = vi.spyOn(client, 'addRecipeToCollection').mockResolvedValue({
        collectionId: COLLECTION_ID,
        recipeId: 'soup',
        addedVia: 'manual',
        createdAt: '2026-04-01T09:00:00.000Z',
    });
    const remove = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <RecipeServiceProvider client={client}>
                <Harness />
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );

    return { add, remove };
}

describe('usePickerAnnouncement', () => {
    it('says nothing before the first toggle', () => {
        setup();

        expect(screen.getByRole('status').textContent).toBe('nothing');
    });

    it('names the recipe and the direction of the latest toggle', async () => {
        setup();

        fireEvent.click(screen.getByRole('button', { name: 'add' }));
        await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^added Soup @/u));

        fireEvent.click(screen.getByRole('button', { name: 'remove' }));
        await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^removed Soup @/u));
    });

    it('does not announce a toggle the server refused', async () => {
        const { add } = setup();
        add.mockRejectedValue(new Error('nope'));

        fireEvent.click(screen.getByRole('button', { name: 'add' }));

        await waitFor(() => expect(add).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('status').textContent).toBe('nothing'));
    });
});
