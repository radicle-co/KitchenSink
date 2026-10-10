/**
 * The web one-page editor container (slice 7): the read boundary, the device draft in the tab's session storage, and
 * the editor's writes going through the REAL outbox (`SyncProvider` + `recipeSender`) to the type-checked fake client.
 * REPLACES `RecipeCreateContainer.test.tsx` and `RecipeEditContainer.test.tsx`: the wizard, Save Draft and the
 * five-minute auto-save retired; the lifecycle is pinned by `useRecipeEditor.test.tsx`, the frame by
 * `RecipeEditorView.test.tsx`, and the browser behaviour by `recipeEditor.spec.ts`.
 */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient, withFoodClient } from '@commise/test-utils';
import { recipeSender } from '@commise/query/recipe-sender';
import { SyncProvider } from '@commise/query/sync';
import { NotFoundError, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { defaultRecipeFormValues, mintLineKey, recipeFormMessages } from '@commise/features-recipes';

import { RecipeEditorContainer } from '@/components/recipes/RecipeEditorContainer';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { pushMock, profile } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    profile: { tier: undefined as string | undefined },
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ userId: 'user_cook' }) }));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({
        data: profile.tier === undefined ? undefined : { account: { subscriptionTier: profile.tier } },
    }),
}));
// The photo uploader is its own container, covered by its own suite.
vi.mock('@/components/recipes/RecipePhotoUploaderContainer', () => ({ RecipePhotoUploaderContainer: () => null }));

afterEach(() => {
    cleanup();
    pushMock.mockReset();
    profile.tier = undefined;
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
});

/** Render the container under the real outbox, sending with `client`. */
function renderEditor(client: RecipeServiceClient, recipeId?: string): void {
    renderWithRecipeClient(
        withFoodClient(
            <SyncProvider subject="user_cook" send={recipeSender(() => client)}>
                <RecipeEditorContainer locale="en" {...(recipeId === undefined ? {} : { recipeId })} />
            </SyncProvider>,
        ),
        client,
    );
}

describe('RecipeEditorContainer (web)', () => {
    it('opens a new recipe blank, as "New recipe"', async () => {
        renderEditor(createFakeRecipeServiceClient());

        expect(await screen.findByRole('heading', { level: 1, name: 'New recipe' })).toBeTruthy();
        expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
            'Details',
            'Ingredients',
            'Steps',
            'Photos & publish',
        ]);
    });

    it('opens a stored recipe from its read, as "Edit recipe"', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew' }));

        renderEditor(client, 'rec_1');

        expect(await screen.findByRole('heading', { level: 1, name: 'Edit recipe' })).toBeTruthy();
        expect(screen.getByDisplayValue('Stored Stew')).toBeTruthy();
    });

    // Build spec §7.2 and §7.5.6: the rail's foot shows the Ingredients total too (the rail itself shows from @wide).
    it('the section index’s rail foot carries the running total, the same line as the section’s foot', async () => {
        renderEditor(createFakeRecipeServiceClient());

        const rail = (await screen.findAllByRole('navigation', { name: 'Recipe sections' }))[0];

        expect(rail).toBeDefined();
        // A new recipe counts nothing yet: the rail says so in the section foot's own words, never "0 cal" (F7).
        expect(within(rail!).getByText(recipeFormMessages.en.nutritionEmpty)).toBeTruthy();
    });

    it('says a missing recipe is not found, with no retry', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError('gone'));

        renderEditor(client, 'rec_gone');

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toBe('');
        expect(screen.queryByRole('button', { name: /retry|try again/iu })).toBeNull();
    });

    it('publishes a complete draft through the outbox, then opens the recipe', async () => {
        const client = createFakeRecipeServiceClient();
        const draft = makeRecipeDetail({
            id: 'rec_1',
            title: 'Ready Stew',
            status: RecipeStatus.DRAFT,
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(draft);
        const update = vi
            .spyOn(client, 'updateRecipe')
            .mockResolvedValue({ ...draft, status: RecipeStatus.PUBLISHED, currentVersion: 3 } as RecipeDetail);

        renderEditor(client, 'rec_1');
        await screen.findByRole('heading', { level: 1, name: 'Edit recipe' });

        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]?.[1]).toMatchObject({ status: 'published', expectedVersion: 2 });
    });

    /**
     * Visibility rides behind the recipe's write (C-004), so the follow-up must compare against what the SERVER holds.
     * A new recipe has no read to compare against: comparing against the read dropped a private choice on the floor
     * whenever the server stored the recipe public (a create at the draft floor, before the cook chose private).
     */
    it('a new recipe published private, that the server holds public, is made private', async () => {
        profile.tier = 'premium';
        const ref = 'local:recipe:visibility';
        // A draft keeps no photo picks (`DraftValues`).
        const { photos: _photos, ...values } = {
            ...defaultRecipeFormValues(),
            title: 'Private Stew',
            visibility: RecipeVisibility.PRIVATE,
            ingredients: [
                {
                    key: mintLineKey(),
                    isUserEntered: false,
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Beef',
                    quantity: 500,
                    unit: 'g',
                },
            ],
            steps: [{ instruction: 'Simmer.' }],
        };
        await editorDraftsFor('user_cook')!.save({
            recipeRef: ref,
            baseVersion: null,
            savedAt: '2026-10-09T09:00:00.000Z',
            pendingRebinds: [],
            values,
        });
        window.history.replaceState(null, '', `/?draft=${ref}`);
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({
            id: 'rec_new',
            title: 'Private Stew',
            status: RecipeStatus.PUBLISHED,
            visibility: RecipeVisibility.PUBLIC,
        });
        vi.spyOn(client, 'createRecipe').mockResolvedValue(stored);
        const setVisibility = vi
            .spyOn(client, 'setRecipeVisibility')
            .mockResolvedValue({ ...stored, visibility: RecipeVisibility.PRIVATE });

        renderEditor(client);
        await screen.findByDisplayValue('Private Stew');

        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_new'));
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_new', RecipeVisibility.PRIVATE));
    });

    it('× leaves for the recipe it was editing, without asking', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1' }));

        renderEditor(client, 'rec_1');
        await screen.findByRole('heading', { level: 1, name: 'Edit recipe' });
        await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });
});

/**
 * Paste a list (build spec §7.5.4; blueprint A5; owner decision D10), through the container: the real hooks over a fake
 * client whose parse job answers at once.
 */
describe('RecipeEditorContainer (web) — Paste a list', () => {
    const JOB_ID = '00000000-0000-4000-8000-00000000e101';
    const job = (status: 'running' | 'complete') => ({
        id: JOB_ID,
        status,
        createdAt: '2026-10-09T10:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        lines: [
            {
                lineIndex: 0,
                sourceLine: '2 cups flour',
                status: status === 'complete' ? ('parsed' as const) : ('pending' as const),
                proposal:
                    status === 'complete'
                        ? {
                              raw: '2 cups flour',
                              quantity: { kind: 'exact' as const, value: 2 },
                              unit: 'cup',
                              statedMeasure: '2 cups',
                              foods: [{ name: 'flour', prep: null }],
                              reviewReasons: [],
                          }
                        : null,
            },
        ],
    });

    it('a new recipe’s empty Ingredients section offers it; the pasted line reads, then joins the recipe', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const create = vi.spyOn(client, 'createParseJob').mockResolvedValue(job('running'));
        vi.spyOn(client, 'getParseJob').mockResolvedValue(job('complete'));
        const byName = vi.spyOn(client, 'addIngredientByName').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f1',
            name: 'flour',
            isUserEntered: false,
        } as Awaited<ReturnType<RecipeServiceClient['addIngredientByName']>>);

        renderEditor(client);
        await user.click(await screen.findByRole('button', { name: 'Paste a list' }));
        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups flour');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));

        expect(create).toHaveBeenCalledWith({ text: '2 cups flour' });
        await waitFor(() => expect(byName).toHaveBeenCalledWith('flour'));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste a list' })).toBeNull());
        expect(
            await screen.findByText(
                (_, node) => node?.textContent === 'Added 1 ingredient.' && node.getAttribute('role') === 'status',
            ),
        ).toBeTruthy();
    });

    it('opens with the sheet up when Home’s first-run Paste ingredients asks for it', async () => {
        // The deep link's jump scrolls; jsdom has no layout to scroll.
        Element.prototype.scrollIntoView ??= (): void => undefined;
        window.history.replaceState(null, '', '/en/recipes/new?paste=1#ingredients');

        renderEditor(createFakeRecipeServiceClient());

        expect(await screen.findByRole('dialog', { name: 'Paste a list' })).toBeTruthy();
    });

    it('a stored draft never published still offers it: paste lasts until the first publish (D10, 2026-10-09)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Draft Stew', status: RecipeStatus.DRAFT }),
        );

        renderEditor(client, 'rec_1');
        await screen.findByRole('heading', { level: 1, name: 'Edit recipe' });

        expect(screen.getByRole('button', { name: 'Paste a list' })).toBeTruthy();
    });

    it('⛔ a published recipe offers no paste anywhere (D10)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew' }));

        renderEditor(client, 'rec_1');
        await screen.findByRole('heading', { level: 1, name: 'Edit recipe' });

        expect(screen.queryByRole('button', { name: 'Paste a list' })).toBeNull();
    });
});
