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
import type { ParseJobResponse } from '@kitchensink/schema-recipe';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { EMPTY_OUTBOX, createMemoryOutboxStore, loadOutbox, saveOutbox, type OutboxStore } from '@kitchensink/sync';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { defaultRecipeFormValues, mintLineKey, recipeFormMessages } from '@commise/features-recipes';

import { RecipeEditorContainer } from '@/components/recipes/RecipeEditorContainer';
import { webDeviceStore } from '@/components/recipes/deviceSession';
import { editorDraftsFor } from '@commise/features-recipes/editor';

import { makeRecipeDetail as makeBaseRecipeDetail } from './__fixtures__/recipeFixtures';

/**
 * A recipe as the editor meets one: with a cuisine, which Publish needs since 2026-10-13. These cases are about the
 * container's hand-offs, not the cuisine rule (`validate.test.ts` owns that).
 */
const makeRecipeDetail = (...[overrides]: Parameters<typeof makeBaseRecipeDetail>) =>
    makeBaseRecipeDetail({ cuisine: 'Italian', ...overrides });

const { pushMock, replaceMock, profile, auth } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
    // `undefined` = the profile read is still pending; `'failed'` = it errored with no cached answer.
    profile: { paidFeatures: undefined as 'granted' | 'upsell' | 'hidden' | 'failed' | undefined },
    auth: { userId: 'user_cook' },
}));

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en' }),
    useRouter: () => ({ push: pushMock, replace: replaceMock }),
    useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ userId: auth.userId }) }));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () =>
        profile.paidFeatures === undefined
            ? { status: 'pending', data: undefined }
            : profile.paidFeatures === 'failed'
              ? { status: 'error', data: undefined }
              : { status: 'success', data: { account: { paidFeatures: profile.paidFeatures } } },
}));
// The photo uploader is its own container, covered by its own suite.
// The spy records the props the editor hands it, so the empty-state cover test below can read them.
const uploader = vi.hoisted(() => ({ props: vi.fn() }));
vi.mock('@/components/recipes/RecipePhotoUploaderContainer', () => ({
    RecipePhotoUploaderContainer: (props: object) => {
        uploader.props(props);

        return null;
    },
}));

afterEach(() => {
    cleanup();
    pushMock.mockReset();
    replaceMock.mockReset();
    vi.restoreAllMocks();
    profile.paidFeatures = undefined;
    auth.userId = 'user_cook';
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
});

/** Render the container under the real outbox (the app's store when given), sending with `client`. */
function renderEditor(client: RecipeServiceClient, recipeId?: string, store?: OutboxStore): void {
    renderWithRecipeClient(
        withFoodClient(
            <SyncProvider
                subject="user_cook"
                send={recipeSender(() => client)}
                {...(store === undefined ? {} : { store })}
            >
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

    /**
     * A-010 / buildSpec §7.7: the photos empty state previews the recipe's own generated cover, which is made from its
     * TITLE and CUISINE. The editor must hand the uploader both, from the draft, or the preview is a blank tint.
     */
    it('hands the photo uploader the draft’s title and cuisine, for the empty-state cover', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew', cuisine: 'French' }),
        );

        renderEditor(client, 'rec_1');
        await screen.findByDisplayValue('Stored Stew');

        await waitFor(() =>
            expect(uploader.props).toHaveBeenCalledWith(
                expect.objectContaining({ recipeId: 'rec_1', title: 'Stored Stew', cuisine: 'French' }),
            ),
        );
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
        expect(screen.getByRole('link', { name: 'Back to My recipes' }).getAttribute('href')).toBe('/en/recipes');
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

        // E8: the recipe page tells the cook how the editor finished, through a one-shot parameter it clears.
        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1?done=firstPublish'));
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]?.[1]).toMatchObject({ status: 'published', expectedVersion: 2 });
    });

    /**
     * Visibility rides behind the recipe's write (C-004), so the follow-up must compare against what the SERVER holds.
     * A new recipe has no read to compare against: comparing against the read dropped a private choice on the floor
     * whenever the server stored the recipe public (a create at the draft floor, before the cook chose private).
     */
    it('Save changes on a published recipe opens it with the parameter that says so', async () => {
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({
            id: 'rec_1',
            title: 'Stored Stew',
            status: RecipeStatus.PUBLISHED,
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(stored);
        vi.spyOn(client, 'updateRecipe').mockResolvedValue({ ...stored, currentVersion: 3 } as RecipeDetail);

        renderEditor(client, 'rec_1');
        const title = await screen.findByDisplayValue('Stored Stew');
        await userEvent.type(title, ' Deluxe');
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1?done=changesSaved'));
    });

    /**
     * The stuck-save defect, end to end through the real outbox: the editor opened on a private recipe that had been made
     * public elsewhere (a stale read), for a cook whose paid features are hidden. Save changes sends no Private the server
     * would refuse after the editor had gone, and the recipe page is told the recipe stayed public.
     */
    // REWRITTEN for ADR-0073: a free cook's own recipe is no longer refused Private for want of Premium, so the Premium
    // refusal is exercised on an imported public-web recipe (where it is still the rule). The slots refusal follows.
    it('⛔ a stale Private the server would refuse is not sent, and the recipe page is told it stayed public', async () => {
        profile.paidFeatures = 'hidden';
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({
            id: 'rec_1',
            title: 'Stored Stew',
            status: RecipeStatus.PUBLISHED,
            visibility: RecipeVisibility.PRIVATE,
            sourceType: 'imported_public',
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(stored);
        vi.spyOn(client, 'updateRecipe').mockResolvedValue({
            ...stored,
            visibility: RecipeVisibility.PUBLIC,
            currentVersion: 3,
        } as RecipeDetail);
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');

        renderEditor(client, 'rec_1');
        const title = await screen.findByDisplayValue('Stored Stew');
        await userEvent.type(title, ' Deluxe');
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1?done=changesSaved.final'));
        expect(setVisibility).not.toHaveBeenCalled();
    });

    // ADR-0073: the same hand-off for a free cook's own recipe, refused because every private slot is KNOWN used.
    it('⛔ a stale Private with every slot known used is not sent, and the recipe page is told it stayed public', async () => {
        profile.paidFeatures = 'upsell';
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getPrivateSlots').mockResolvedValue({ kind: 'limited', used: 50, limit: 50 });
        const stored = makeRecipeDetail({
            id: 'rec_full',
            title: 'Stored Stew',
            status: RecipeStatus.PUBLISHED,
            visibility: RecipeVisibility.PRIVATE,
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(stored);
        vi.spyOn(client, 'updateRecipe').mockResolvedValue({
            ...stored,
            visibility: RecipeVisibility.PUBLIC,
            currentVersion: 3,
        } as RecipeDetail);
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');

        renderEditor(client, 'rec_full');
        const title = await screen.findByDisplayValue('Stored Stew');
        await waitFor(() => expect(client.getPrivateSlots).toHaveBeenCalled());
        await userEvent.type(title, ' Deluxe');
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_full?done=changesSaved.slots'));
        expect(setVisibility).not.toHaveBeenCalled();
    });

    // Review B1: a FAILED profile read shows as `hidden`, but it is not the server's answer. The Private is sent, and the
    // server — which would grant an entitled cook — decides; nothing claims the recipe stayed public.
    it('⛔ after a failed profile read, the Private is still sent: an unknown state is not a refusal', async () => {
        profile.paidFeatures = 'failed';
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({
            id: 'rec_failed_read',
            title: 'Stored Stew',
            status: RecipeStatus.PUBLISHED,
            visibility: RecipeVisibility.PRIVATE,
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(stored);
        vi.spyOn(client, 'updateRecipe').mockResolvedValue({
            ...stored,
            visibility: RecipeVisibility.PUBLIC,
            currentVersion: 3,
        } as RecipeDetail);
        const setVisibility = vi
            .spyOn(client, 'setRecipeVisibility')
            .mockResolvedValue({ ...stored, currentVersion: 3 } as RecipeDetail);

        renderEditor(client, 'rec_failed_read');
        const title = await screen.findByDisplayValue('Stored Stew');
        await userEvent.type(title, ' Deluxe');
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_failed_read?done=changesSaved'));
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_failed_read', RecipeVisibility.PRIVATE));
    });

    it('a new recipe published private, that the server holds public, is made private', async () => {
        profile.paidFeatures = 'granted';
        const ref = 'local:recipe:visibility';
        // A draft keeps no photo picks (`DraftValues`).
        const { photos: _photos, ...values } = {
            ...defaultRecipeFormValues(),
            title: 'Private Stew',
            cuisine: 'Irish',
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
        await editorDraftsFor(webDeviceStore, 'user_cook')!.save({
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

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_new?done=firstPublish'));
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
 * The URL follows a new recipe without a navigation, through Next's OWN shallow-update path (code-reviewer High 4 of the
 * 2026-10-09 review). Passing `history.state` carried Next's `__NA` flag, so Next skipped its router sync: it never
 * learned the new URL, its next commit rewrote it, a reload opened a blank editor, and Back restored the new-recipe tree
 * under the edit address, where typing made a second recipe. The URL now stays on the new route, `?draft=` naming the
 * local ref and then the server id; the new route, reopened on a recipe the server holds, goes to its edit route.
 */
/**
 * "Who can see it" end to end through the real container (E1), REWRITTEN for ADR-0073 and the owner ruling of 2026-10-26.
 * A recipe is under the SLOTS rule (a free cook's own, book or paid-site recipe: Private works while the server says a
 * slot is free, whatever the paid features say) or the PREMIUM rule (an imported public-web recipe: the paid-feature table
 * it always had). Public is NEVER final: no confirm says a recipe "can't go private again".
 */
describe('RecipeEditorContainer (web) — Private (E1, private slots and Premium)', () => {
    const choosePrivate = async (): Promise<void> => {
        await userEvent.click(await screen.findByRole('radio', { name: /^Private/u }));
    };

    /** A client whose slot read answers `usage`. */
    const clientWithSlots = (usage: { used: number; limit: number } | 'unlimited'): RecipeServiceClient => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getPrivateSlots').mockResolvedValue(
            usage === 'unlimited' ? { kind: 'unlimited' } : { kind: 'limited', ...usage },
        );

        return client;
    };

    /** Open a stored recipe with the given label and visibility; each case has its own id (the tab's device session outlives a case). */
    const openRecipe = async (
        client: RecipeServiceClient,
        id: string,
        visibility: RecipeVisibility,
        sourceType: 'user_created' | 'imported_public' = 'user_created',
    ): Promise<void> => {
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id, title: 'Secret Stew', visibility, sourceType }),
        );
        renderEditor(client, id);
        await screen.findByDisplayValue('Secret Stew');
    };

    describe('a recipe the cook wrote: the slots rule', () => {
        it('shows how many private slots are left, from the server`s read', async () => {
            profile.paidFeatures = 'upsell';
            renderEditor(clientWithSlots({ used: 38, limit: 50 }));

            expect(await screen.findByText('12 of 50 private slots left')).toBeTruthy();
        });

        it('⛔ lets a free cook choose Private even when paid features are hidden: a slot, not Premium', async () => {
            profile.paidFeatures = 'hidden';
            renderEditor(clientWithSlots({ used: 3, limit: 50 }));

            await choosePrivate();

            expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
            expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull();
            expect(await screen.findByText('This recipe uses 1 slot. 46 of 50 left after it.')).toBeTruthy();
        });

        it('⛔ with every slot used, refuses Private with its ways forward; the first two go to My recipes', async () => {
            profile.paidFeatures = 'upsell';
            renderEditor(clientWithSlots({ used: 50, limit: 50 }));

            expect(await screen.findByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();
            await choosePrivate();
            expect((screen.getByRole('radio', { name: /^Public/u }) as HTMLInputElement).checked).toBe(true);

            await userEvent.click(screen.getByRole('button', { name: /Make a private recipe public/u }));

            expect(pushMock).toHaveBeenCalledWith('/en/recipes');
            expect(screen.getByRole('button', { name: /Get Premium/u })).toBeTruthy();
        });

        it('"Get Premium" in the refusal opens the Premium sheet', async () => {
            profile.paidFeatures = 'upsell';
            renderEditor(clientWithSlots({ used: 50, limit: 50 }));

            await userEvent.click(await screen.findByRole('button', { name: /Get Premium/u }));

            expect(await screen.findByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
        });

        it('offers no Premium way when paid features are hidden', async () => {
            profile.paidFeatures = 'hidden';
            renderEditor(clientWithSlots({ used: 50, limit: 50 }));

            await screen.findByText('Not available. All 50 of your private slots are in use.');

            expect(screen.queryByRole('button', { name: /Get Premium/u })).toBeNull();
            expect(screen.getByRole('button', { name: /Delete a private recipe/u })).toBeTruthy();
        });

        it('Premium sees no count, and no sheet', async () => {
            profile.paidFeatures = 'granted';
            renderEditor(clientWithSlots('unlimited'));

            await choosePrivate();

            expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
            expect(screen.queryByText(/private slots/u)).toBeNull();
            expect(screen.queryByText('Premium')).toBeNull();
        });

        it('⛔ Public asks first and says it frees a slot; confirmed, the recipe is Public and can come back while a slot is free', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 20, limit: 50 }), 'rec_frees', RecipeVisibility.PRIVATE);
            // The confirm is decided from the server's count: wait for it, or Public goes at once.
            await screen.findByText('30 of 50 private slots left');

            await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));

            const dialog = await screen.findByRole('alertdialog', { name: 'Make this recipe public?' });
            expect(
                within(dialog).getByText(
                    'Anyone can see a public recipe and save a copy. It frees one of your private slots, and you can make it private again while you have a free slot.',
                ),
            ).toBeTruthy();
            await userEvent.click(within(dialog).getByRole('button', { name: 'Make public' }));
            await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

            // Public is never final: Private is still offered.
            await choosePrivate();
            expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
        });

        it('Keep private leaves the recipe private', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 20, limit: 50 }), 'rec_kept', RecipeVisibility.PRIVATE);
            await screen.findByText('30 of 50 private slots left');

            await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));
            await userEvent.click(await screen.findByRole('button', { name: 'Keep private' }));

            await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
            expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
        });

        it('a Premium owner moves a private recipe to Public with no confirm', async () => {
            profile.paidFeatures = 'granted';
            await openRecipe(clientWithSlots('unlimited'), 'rec_secret_granted', RecipeVisibility.PRIVATE);

            await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));

            expect((screen.getByRole('radio', { name: /^Public/u }) as HTMLInputElement).checked).toBe(true);
            expect(screen.queryByRole('alertdialog')).toBeNull();
        });
    });

    describe('an imported public-web recipe: Premium is still the rule', () => {
        it('⛔ under upsell, the Premium sheet opens for Private, and Public stays chosen', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(createFakeRecipeServiceClient(), 'rec_web_up', RecipeVisibility.PUBLIC, 'imported_public');

            await choosePrivate();

            expect(await screen.findByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
            expect((screen.getByRole('radio', { name: /^Public/u, hidden: true }) as HTMLInputElement).checked).toBe(
                true,
            );
        });

        it('Not now closes the sheet and leaves the recipe public', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_not_now',
                RecipeVisibility.PUBLIC,
                'imported_public',
            );
            await choosePrivate();

            await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

            await waitFor(() => expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull());
            expect((screen.getByRole('radio', { name: /^Public/u }) as HTMLInputElement).checked).toBe(true);
        });

        it('lets a granted cook choose Private, with no sheet and no Premium badge', async () => {
            profile.paidFeatures = 'granted';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_granted',
                RecipeVisibility.PUBLIC,
                'imported_public',
            );

            await choosePrivate();

            expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
            expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull();
            expect(screen.queryByText('Premium')).toBeNull();
        });

        it('⛔ under upsell, Public asks first with the Premium words; confirmed, going back asks for Premium', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_private',
                RecipeVisibility.PRIVATE,
                'imported_public',
            );

            await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));
            const dialog = await screen.findByRole('alertdialog', { name: 'Make this recipe public?' });
            expect(
                within(dialog).getByText(
                    "Anyone can see a public recipe and save a copy. To make this one private again, you'll need Premium.",
                ),
            ).toBeTruthy();
            await userEvent.click(within(dialog).getByRole('button', { name: 'Make public' }));
            await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

            await choosePrivate();

            expect(await screen.findByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
            expect((screen.getByRole('radio', { name: /^Public/u, hidden: true }) as HTMLInputElement).checked).toBe(
                true,
            );
        });

        // Public is never final, so under hidden there is nothing to confirm: Public is at once, and the recipe then shows
        // the plain statement because the paid features offer no way back (the stuck-save defect stays closed).
        it('⛔ under hidden, Public is at once, with no claim that it is final; then the editor offers no Private', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_hidden',
                RecipeVisibility.PRIVATE,
                'imported_public',
            );

            await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));

            await waitFor(() => expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull());
            expect(screen.queryByRole('alertdialog')).toBeNull();
            expect(screen.queryByText(/won.t be able|may not be able/u)).toBeNull();
            expect(screen.getByText('Who can see it')).toBeTruthy();
        });

        it.each([
            ['hidden', 'hidden'],
            ['a failed profile read', 'failed'],
            ['a profile still loading', undefined],
        ] as const)(
            '⛔ under %s, says "Who can see it: Public" and offers no Private and no Premium',
            async (_label, state) => {
                profile.paidFeatures = state;
                await openRecipe(
                    createFakeRecipeServiceClient(),
                    `rec_web_${String(state)}`,
                    RecipeVisibility.PUBLIC,
                    'imported_public',
                );

                expect(await screen.findByText('Who can see it')).toBeTruthy();
                expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
                expect(screen.queryByRole('radio', { name: /^Public/u })).toBeNull();
                expect(screen.queryByText('Premium')).toBeNull();
                expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull();
            },
        );
    });
});

/**
 * Clerk multi-session: the signed-in cook changes from A to B with the editor open (finding 3 of the 2026-10-10 review).
 * The scope ends A's session (`useDeviceSessionScope`), but a container that was not keyed by the cook kept the editor
 * mounted across the switch: Suspense keeps a subtree's state, so the core still held A's draft and resumed with B's
 * draft store and B's outbox — A's recipe saved into B's drafts and created on B's account.
 *
 * Offline, so both journals hold what each port queued; no scope is mounted, so A's data stays to be inspected.
 */
describe('RecipeEditorContainer (web) — the signed-in cook changes', () => {
    afterEach(() => {
        onlineManager.setOnline(true);
    });

    it('⛔ A`s exit checkpoint goes to A`s outbox, B`s stores hold nothing of A`s, and B gets a fresh editor', async () => {
        onlineManager.setOnline(false);
        window.history.replaceState(null, '', '/en/recipes/new');
        auth.userId = 'user_a';
        const client = createFakeRecipeServiceClient();
        const tree = () =>
            withFoodClient(
                <SyncProvider subject={auth.userId} send={recipeSender(() => client)} store={webDeviceStore}>
                    <RecipeEditorContainer locale="en" />
                </SyncProvider>,
            );
        const view = renderWithRecipeClient(tree(), client);
        await userEvent.type(await screen.findByRole('textbox', { name: /title/iu }), 'Soup of A');

        auth.userId = 'user_b';
        view.rerender(tree());

        await waitFor(() => expect(screen.getByRole('textbox', { name: /title/iu })).toHaveProperty('value', ''));
        // B's editor leaves too, so any checkpoint still holding A's draft would have run against B's ports by now.
        view.unmount();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const titlesIn = async (subject: string) =>
            (await loadOutbox(webDeviceStore, subject)).records.map(
                (record) => (record.payload as { readonly input?: { readonly title?: string } }).input?.title,
            );
        expect(await titlesIn('user_a')).toEqual(['Soup of A']);
        expect(await titlesIn('user_b')).toEqual([]);
        const keptForB = Object.keys(window.sessionStorage)
            .filter((key) => key.endsWith('user_b'))
            .map((key) => window.sessionStorage.getItem(key) ?? '');
        expect(keptForB.filter((value) => value.includes('Soup of A'))).toEqual([]);
        expect(
            Object.keys(window.sessionStorage).some((key) => key.startsWith('editor.draft') && key.endsWith('user_a')),
        ).toBe(true);
    });
    it('⛔ the same on the edit route: A`s update goes to A`s outbox and B opens the recipe as the server holds it', async () => {
        // Online, so B can read the recipe; the update never answers, so it stays in the journal that queued it.
        auth.userId = 'user_a';
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({ id: 'rec_1', title: 'Stew', status: RecipeStatus.DRAFT, currentVersion: 2 });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(stored);
        vi.spyOn(client, 'updateRecipe').mockReturnValue(new Promise(() => undefined));
        const tree = () =>
            withFoodClient(
                <SyncProvider subject={auth.userId} send={recipeSender(() => client)} store={webDeviceStore}>
                    <RecipeEditorContainer locale="en" recipeId="rec_1" />
                </SyncProvider>,
            );
        const view = renderWithRecipeClient(tree(), client);
        const title = await screen.findByRole('textbox', { name: /title/iu });
        await userEvent.clear(title);
        await userEvent.type(title, 'Stew of A');

        auth.userId = 'user_b';
        view.rerender(tree());

        await waitFor(() => expect(screen.getByRole('textbox', { name: /title/iu })).toHaveProperty('value', 'Stew'));
        view.unmount();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const titlesIn = async (subject: string) =>
            (await loadOutbox(webDeviceStore, subject)).records.map(
                (record) => (record.payload as { readonly input?: { readonly title?: string } }).input?.title,
            );
        expect(await titlesIn('user_a')).toEqual(['Stew of A']);
        expect(await titlesIn('user_b')).toEqual([]);
    });
});

/**
 * Pressing the sidebar's New recipe while already on the new-recipe page navigates to the same path with a new
 * `?fresh=` token. Next keeps a page's state on a search-param-only navigation, so without a key on that token the
 * editor kept the old draft and the press looked dead.
 */
describe('RecipeEditorContainer (web) — a New recipe press on the new-recipe page', () => {
    const SERVER_ID = '0b7f8a52-3c1d-4e2f-9a6b-5c4d3e2f1a0b';

    function renderNewEditor(client: RecipeServiceClient) {
        const tree = () =>
            withFoodClient(
                <SyncProvider subject="user_cook" send={recipeSender(() => client)}>
                    <RecipeEditorContainer locale="en" />
                </SyncProvider>,
            );

        return { view: renderWithRecipeClient(tree(), client), tree };
    }

    it('⛔ a new press token opens a blank editor, not the draft in front of the cook', async () => {
        window.history.replaceState(null, '', '/en/recipes/new?fresh=press-1');
        const { view, tree } = renderNewEditor(createFakeRecipeServiceClient());
        await userEvent.type(await screen.findByRole('textbox', { name: /title/iu }), 'Old soup');

        window.history.replaceState(null, '', '/en/recipes/new?fresh=press-2');
        view.rerender(tree());

        await waitFor(() => expect(screen.getByRole('textbox', { name: /title/iu })).toHaveProperty('value', ''));
    });

    it('⛔ the same token, with the editor`s own ?draft= added, keeps the cook`s typing', async () => {
        window.history.replaceState(null, '', '/en/recipes/new?fresh=press-1');
        const { view, tree } = renderNewEditor(createFakeRecipeServiceClient());
        await userEvent.type(await screen.findByRole('textbox', { name: /title/iu }), 'Old soup');

        window.history.replaceState(null, '', '/en/recipes/new?fresh=press-1&draft=local%3Arecipe%3Aabc');
        view.rerender(tree());

        expect(screen.getByRole('textbox', { name: /title/iu })).toHaveProperty('value', 'Old soup');
    });

    it('⛔ the editor`s URL follow keeps the press token, so the follow itself cannot remount the editor', async () => {
        window.history.replaceState(null, '', '/en/recipes/new?fresh=press-1');
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'createRecipe').mockResolvedValue(
            makeRecipeDetail({ id: SERVER_ID, title: 'Soup', status: RecipeStatus.DRAFT }),
        );

        renderNewEditor(client);
        await userEvent.type(await screen.findByRole('textbox', { name: /title/iu }), 'Soup');
        act(() => {
            focusManager.setFocused(false);
        });
        focusManager.setFocused(undefined);

        await waitFor(() =>
            expect(replaceState).toHaveBeenLastCalledWith(null, '', `?fresh=press-1&draft=${SERVER_ID}`),
        );
    });
});

describe('RecipeEditorContainer (web) — the URL after the first save', () => {
    const SERVER_ID = '0b7f8a52-3c1d-4e2f-9a6b-5c4d3e2f1a0b';

    it('⛔ names the server id in ?draft= through Next`s history sync, never with Next`s own state', async () => {
        // The entry as Next leaves it: its own state, flagged `__NA`, which its patched `replaceState` passes through
        // untouched (`next/dist/client/components/app-router.js`), skipping the router sync.
        window.history.replaceState({ __NA: true }, '', '/en/recipes/new');
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'createRecipe').mockResolvedValue(
            makeRecipeDetail({ id: SERVER_ID, title: 'Soup', status: RecipeStatus.DRAFT }),
        );

        renderEditor(client);
        const title = await screen.findByRole('textbox', { name: /title/iu });
        await userEvent.type(title, 'Soup');
        // The tab going to the background is a checkpoint: the draft floor passes, so the create goes out.
        act(() => {
            focusManager.setFocused(false);
        });
        focusManager.setFocused(undefined);

        await waitFor(() => expect(replaceState).toHaveBeenLastCalledWith(null, '', `?draft=${SERVER_ID}`));
        expect(replaceState.mock.calls.every(([state]) => state === null)).toBe(true);
    });

    it('⛔ reopened on a ?draft= the server holds (a reload, or Back), goes to that recipe`s edit route', async () => {
        window.history.replaceState(null, '', `/en/recipes/new?draft=${SERVER_ID}#steps`);

        renderEditor(createFakeRecipeServiceClient());

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/en/recipes/${SERVER_ID}/edit#steps`));
        expect(screen.queryByRole('heading', { level: 1, name: 'New recipe' })).toBeNull();
    });

    /**
     * The editor closed before its create answered (browser Back runs the exit checkpoint as it unmounts), so the outbox's
     * observer moved the draft to the server id. The history entry still names the local ref: the journal's resolution
     * of it leads to the recipe, where reading the draft under the local ref would open a blank form.
     */
    it('⛔ reopened on a local ref whose create the outbox resolved, goes to the recipe`s edit route', async () => {
        await saveOutbox(webDeviceStore, 'user_cook', {
            ...EMPTY_OUTBOX,
            resolutions: { 'local:recipe:gone': SERVER_ID },
        });
        window.history.replaceState(null, '', '/en/recipes/new?draft=local:recipe:gone');

        renderEditor(createFakeRecipeServiceClient(), undefined, webDeviceStore);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/en/recipes/${SERVER_ID}/edit`));
    });

    /**
     * Browser Back or a link moves the URL first, then unmounts the editor, whose exit checkpoint mints the recipe's ref
     * (and later adopts its server id). Following that ref then rewrote the URL of the page the cook had gone to.
     */
    it('⛔ never rewrites the URL of a page the cook has already gone to', async () => {
        window.history.replaceState(null, '', '/en/recipes/new');
        const view = renderWithRecipeClient(
            withFoodClient(
                <SyncProvider subject="user_cook" send={recipeSender(() => createFakeRecipeServiceClient())}>
                    <RecipeEditorContainer locale="en" />
                </SyncProvider>,
            ),
            createFakeRecipeServiceClient(),
        );
        await userEvent.type(await screen.findByRole('textbox', { name: /title/iu }), 'Soup');

        // Back: the router has moved the URL to My recipes; then the editor unmounts.
        window.history.replaceState(null, '', '/en/recipes');
        view.unmount();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(window.location.pathname + window.location.search).toBe('/en/recipes');
    });

    /**
     * E3: × runs the exit checkpoint and THEN pushes. The create the checkpoint sent answers before the push commits, so
     * the URL is still the new route's and the guard above lets the replaceState through; Next turns it into a restore
     * that discards the push, and the editor stays. The address bar stops following the recipe once the cook has left.
     */
    it('⛔ × then the create`s answer: the URL is not rewritten under the pending navigation', async () => {
        window.history.replaceState(null, '', '/en/recipes/new');
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        let answer: (detail: RecipeDetail) => void = () => undefined;
        vi.spyOn(client, 'createRecipe').mockReturnValue(
            new Promise<RecipeDetail>((resolve) => {
                answer = resolve;
            }),
        );

        renderEditor(client);
        await userEvent.type(await screen.findByRole('textbox', { name: /title/iu }), 'Soup');
        await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));
        await waitFor(() => expect(client.createRecipe).toHaveBeenCalled());
        // What the focus change on the way out minted is before the leave; only the answer is under test.
        replaceState.mockClear();

        await act(async () => {
            answer(makeRecipeDetail({ id: SERVER_ID, title: 'Soup', status: RecipeStatus.DRAFT }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(pushMock).toHaveBeenCalledWith('/en/recipes');
        expect(replaceState).not.toHaveBeenCalled();
    });

    it('a ?draft= that names neither a local ref nor a recipe id opens a blank new recipe', async () => {
        window.history.replaceState(null, '', '/en/recipes/new?draft=..%2F..%2Fadmin');

        renderEditor(createFakeRecipeServiceClient());

        expect(await screen.findByRole('heading', { level: 1, name: 'New recipe' })).toBeTruthy();
        expect(replaceMock).not.toHaveBeenCalled();
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
                progress: status === 'complete' ? null : { phase: 'queued' as const },
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

    /**
     * REWRITTEN for ADR-0071 (2026-10-26): the pasted line used to join through `addIngredientByName`, which bound a
     * ranked guess (milk crackers for milk). It now asks for the job's MATCHES and binds a confident one by food
     * (`addIngredientByFood`); the by-name assertion was deleted with the path, and this test pins that the container
     * never reaches it. The wire cases are in `features/recipes`' `pasteMatch.integration.test.tsx`.
     */
    it('a new recipe’s empty Ingredients section offers it; the pasted line reads, is matched, then joins the recipe', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const matched = job('complete');
        const withMatch: ParseJobResponse = {
            ...matched,
            lines: matched.lines.map((line) => ({
                ...line,
                proposal:
                    line.proposal === null
                        ? null
                        : {
                              ...line.proposal,
                              foods: [
                                  {
                                      name: 'flour',
                                      prep: null,
                                      match: {
                                          state: 'confident',
                                          reason: 'exactName',
                                          proposed: { kind: 'root', id: 'food_flour', name: 'Plain flour' },
                                          candidates: [],
                                      },
                                  },
                              ],
                          },
            })),
        };
        const create = vi.spyOn(client, 'createParseJob').mockResolvedValue(job('running'));
        vi.spyOn(client, 'getParseJob').mockResolvedValue(job('complete'));
        const matches = vi.spyOn(client, 'proposeParseJobMatches').mockResolvedValue(withMatch);
        const byName = vi.spyOn(client, 'addIngredientByName');
        const byFood = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f1',
            name: 'Plain flour',
            foodId: 'food_flour',
            isUserEntered: false,
        } as Awaited<ReturnType<RecipeServiceClient['addIngredientByFood']>>);

        renderEditor(client);
        await user.click(await screen.findByRole('button', { name: 'Paste a list' }));
        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups flour');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));

        expect(create).toHaveBeenCalledWith({ text: '2 cups flour' });
        await waitFor(() => expect(matches).toHaveBeenCalledWith(JOB_ID));
        await waitFor(() => expect(byFood).toHaveBeenCalledWith('food_flour'));
        expect(byName).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste a list' })).toBeNull());
        expect(
            await screen.findByText(
                (_, node) => node?.textContent === 'Added 1 ingredient.' && node.getAttribute('role') === 'status',
            ),
        ).toBeTruthy();
        expect(await screen.findByText('Plain flour')).toBeTruthy();
    });

    /**
     * ⛔ THE PASTE LIST MEETS THE REAL EDITOR LIFECYCLE (the one place every other tier is blind to). The unit and
     * integration suites run it over a bare draft; here the recipe is CREATED on the server once the
     * paste's lines have joined (the paste holds the create until then), the create STORES the joined line, and the
     * cook's pick on that stored line goes through the REBIND COMMAND at its stored position (ADR-0045), not a draft
     * transition. If any of those re-keyed the draft, the overlay would read its lines as deleted (removal is terminal)
     * and the list would vanish.
     */
    it('keeps the paste list through the server create and a pick on the stored line (the rebind command)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const parsed: ParseJobResponse = {
            id: JOB_ID,
            status: 'complete',
            createdAt: '2026-10-09T10:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
            lines: [
                {
                    lineIndex: 0,
                    sourceLine: '2 cups milk',
                    status: 'parsed',
                    progress: null,
                    proposal: {
                        raw: '2 cups milk',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cup',
                        statedMeasure: '2 cups',
                        foods: [{ name: 'milk', prep: null }],
                        reviewReasons: [],
                    },
                },
            ],
        };
        const matched: ParseJobResponse = {
            ...parsed,
            lines: parsed.lines.map((line) => ({
                ...line,
                proposal:
                    line.proposal === null
                        ? null
                        : {
                              ...line.proposal,
                              foods: [
                                  {
                                      name: 'milk',
                                      prep: null,
                                      match: {
                                          state: 'default',
                                          reason: 'defaultApplies',
                                          proposed: null,
                                          candidates: [
                                              { kind: 'root', id: 'food_whole', name: 'Whole milk', isDefault: true },
                                              { kind: 'root', id: 'food_skim', name: 'Skim milk', isDefault: false },
                                          ],
                                      },
                                  },
                              ],
                          },
            })),
        };
        vi.spyOn(client, 'createParseJob').mockResolvedValue({ ...parsed, status: 'running' });
        // The service keeps the matches it wrote: a read after the matches call answers them.
        let held = parsed;

        vi.spyOn(client, 'getParseJob').mockImplementation(() => Promise.resolve(held));
        vi.spyOn(client, 'proposeParseJobMatches').mockImplementation(() => {
            held = matched;

            return Promise.resolve(matched);
        });
        const freeform = vi.spyOn(client, 'createIngredient').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f2',
            name: 'milk',
            isUserEntered: true,
        } as Awaited<ReturnType<RecipeServiceClient['createIngredient']>>);
        const byFood = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f3',
            name: 'Skim milk',
            foodId: 'food_skim',
            isUserEntered: false,
        } as Awaited<ReturnType<RecipeServiceClient['addIngredientByFood']>>);
        const milkView = {
            ingredientId: '00000000-0000-4000-8000-0000000000f2',
            name: 'milk',
            quantity: { kind: 'exact' as const, value: 2 },
            unit: 'cups',
            isUserEntered: true,
        };
        const skimView = {
            ingredientId: '00000000-0000-4000-8000-0000000000f3',
            name: 'Skim milk',
            foodId: 'food_skim',
            quantity: { kind: 'exact' as const, value: 2 },
            unit: 'cups',
            isUserEntered: false,
        };
        const draftRecipe = (version: number, ingredients: RecipeDetail['ingredients']) =>
            makeRecipeDetail({
                id: 'rec_new',
                title: 'Pudding',
                status: RecipeStatus.DRAFT,
                currentVersion: version,
                ingredients,
            });
        const create = vi.spyOn(client, 'createRecipe').mockResolvedValue(draftRecipe(1, [milkView]));
        const update = vi.spyOn(client, 'updateRecipe').mockResolvedValue(draftRecipe(2, [milkView]));
        // A rebind makes one version, and its answer carries the re-pointed line at its stored position.
        const rebind = vi.spyOn(client, 'rebindIngredientLine').mockResolvedValue(draftRecipe(2, [skimView]));

        renderEditor(client);
        await user.click(await screen.findByRole('button', { name: 'Paste a list' }));
        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups milk');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));

        // Joined as written (a default is never chosen); the paste holds the server create until its lines have joined.
        expect(await screen.findByText('Choose the milk you use')).toBeTruthy();
        expect(freeform).toHaveBeenCalledWith('milk');

        // The recipe is CREATED with the line in it: the app going to the background is a checkpoint.
        await user.type(screen.getByLabelText('Title'), 'Pudding');
        act(() => focusManager.setFocused(false));
        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        act(() => focusManager.setFocused(true));
        expect(create.mock.calls[0]?.[0].ingredients).toHaveLength(1);
        expect(update).not.toHaveBeenCalled();
        // The create's answer re-keyed nothing: the paste list still draws the line, still asking.
        expect(screen.getByText('Choose the milk you use')).toBeTruthy();

        // The pick on a STORED line is the rebind command, at the line's stored position.
        await user.click(screen.getByRole('button', { name: 'Skim milk' }));

        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(rebind.mock.calls[0]?.[0]).toBe('rec_new');
        expect(rebind.mock.calls[0]?.[1]).toBe(0);
        expect(rebind.mock.calls[0]?.[2]).toMatchObject({ target: { kind: 'catalogFood', foodId: 'food_skim' } });
        // The command carries the food itself, so no separate admission is made.
        expect(byFood).not.toHaveBeenCalled();
        await new Promise((r) => setTimeout(r, 800));
        console.log('DBG', document.body.textContent?.slice(600, 1200));
        // And the line is still the paste list's, now the cook's.
        expect(await screen.findByText(/Skim milk\s+· your choice/u)).toBeTruthy();
        expect(screen.queryByText('Choose the milk you use')).toBeNull();
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

/**
 * ⛔ A PUBLISHED RECIPE'S PARKED SAVE CHANGES DOES NOT OUTLIVE THE DISCARD (plan 2026-10-13-004, item 5). Over the real
 * outbox: Save changes meets a dropped connection and parks with an unknown outcome, so the changes may already stand.
 * The confirm says so, Discard withdraws the parked save, the sync failure is gone, and the cook goes to the recipe
 * page — whose read is marked stale, so it shows the server's copy and the cook sees which outcome happened.
 */
describe('RecipeEditorContainer (web) — Discard with a parked save', () => {
    it('says the save may have gone through, withdraws it, and opens the recipe the server holds', async () => {
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew', status: RecipeStatus.PUBLISHED });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(stored);
        const update = vi.spyOn(client, 'updateRecipe').mockRejectedValue(new TypeError('Failed to fetch'));
        const store = createMemoryOutboxStore();

        renderEditor(client, 'rec_1', store);
        await userEvent.type(await screen.findByDisplayValue('Stored Stew'), ' Deluxe');
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await screen.findByText("We couldn't tell if your changes were saved.");
        expect((await loadOutbox(store, 'user_cook')).records.map((record) => record.state)).toEqual(['parked']);

        await userEvent.click(screen.getByRole('button', { name: 'More editor actions' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Discard your changes?' });
        expect(within(dialog).getByText(/Your last save may have gone through/u)).toBeTruthy();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
        await waitFor(async () => expect((await loadOutbox(store, 'user_cook')).records).toEqual([]));
        expect(update).toHaveBeenCalledTimes(1);
    });
});
