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
import { focusManager, onlineManager } from '@tanstack/react-query';
import { EMPTY_OUTBOX, createMemoryOutboxStore, loadOutbox, saveOutbox, type OutboxStore } from '@kitchensink/sync';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { defaultRecipeFormValues, mintLineKey, recipeFormMessages } from '@commise/features-recipes';

import { RecipeEditorContainer } from '@/components/recipes/RecipeEditorContainer';
import { webDeviceStore } from '@/components/recipes/deviceSession';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';

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
    it('⛔ a stale Private the server would refuse is not sent, and the recipe page is told it stayed public', async () => {
        profile.paidFeatures = 'hidden';
        const client = createFakeRecipeServiceClient();
        const stored = makeRecipeDetail({
            id: 'rec_1',
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

        renderEditor(client, 'rec_1');
        const title = await screen.findByDisplayValue('Stored Stew');
        await userEvent.type(title, ' Deluxe');
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1?done=changesSaved.final'));
        expect(setVisibility).not.toHaveBeenCalled();
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
 * E1 (build spec §6.4, §7.7 item 2) + plan 2026-10-14-009 D14: "Who can see it" renders from the viewer's paid features
 * alone (owner ruling 2026-10-13). `upsell` opens the Premium sheet for Private; `granted` gets Private; `hidden`, a
 * failed profile read and a profile still loading show the plain "Who can see it: Public" statement — no Private, no
 * Premium, no upsell.
 *
 * REWRITTEN 2026-10-14: the loading case used to assert a Private tap that waited; loading now fails closed to the
 * statement, so there is no Private to tap.
 */
describe('RecipeEditorContainer (web) — Private (E1, paid features)', () => {
    const choosePrivate = async (): Promise<void> => {
        await userEvent.click(await screen.findByRole('radio', { name: /^Private/u }));
    };

    it('⛔ under upsell, the Premium sheet opens for Private, and Public stays chosen', async () => {
        profile.paidFeatures = 'upsell';
        renderEditor(createFakeRecipeServiceClient());

        await choosePrivate();

        expect(await screen.findByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
        // The page behind the open sheet is hidden from the accessibility tree.
        expect((screen.getByRole('radio', { name: /^Public/u, hidden: true }) as HTMLInputElement).checked).toBe(true);
    });

    it('Not now closes the sheet and leaves the recipe public', async () => {
        profile.paidFeatures = 'upsell';
        renderEditor(createFakeRecipeServiceClient());
        await choosePrivate();

        await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull());
        expect((screen.getByRole('radio', { name: /^Public/u }) as HTMLInputElement).checked).toBe(true);
    });

    it('lets a granted cook choose Private, with no sheet and no Premium badge', async () => {
        profile.paidFeatures = 'granted';
        renderEditor(createFakeRecipeServiceClient());

        await choosePrivate();

        expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
        expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull();
        expect(screen.queryByText('Premium')).toBeNull();
    });

    /**
     * The stuck-save defect (plan 2026-10-14-009 Q5 follow-up): under `hidden` the owner of a private recipe could move
     * it to Public and back to Private, and the server refused the second write. Leaving Private is now confirmed first
     * (UX SPECIFY 2026-10-15), and once the draft has left it the editor offers it no more: the field gives way to the
     * statement, which takes the focus the unmounted radio had (WCAG 2.4.3).
     *
     * Each case edits its own recipe: the tab's device session outlives one case, so a draft left under a shared id
     * would reopen in the next.
     */
    const openPrivateRecipe = async (id: string): Promise<void> => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id, title: 'Secret Stew', visibility: RecipeVisibility.PRIVATE }),
        );
        renderEditor(client, id);
        await screen.findByRole('radio', { name: /^Private/u });
    };

    it('⛔ under hidden, Public asks first; confirmed, the recipe is not offered Private again', async () => {
        profile.paidFeatures = 'hidden';
        await openPrivateRecipe('rec_secret_hidden');
        expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);

        await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));

        const dialog = await screen.findByRole('alertdialog', { name: 'Make this recipe public?' });
        expect(
            within(dialog).getByText(
                "Anyone can see a public recipe and save a copy. You won't be able to make this one private again.",
            ),
        ).toBeTruthy();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Make public' }));

        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(screen.getByText('Who can see it')).toBeTruthy();
        expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
        expect(screen.queryByRole('radio', { name: /^Public/u })).toBeNull();
        expect(screen.queryByText('Premium')).toBeNull();
        await waitFor(() => expect(document.activeElement?.textContent).toContain('Who can see it'));
    });

    it('under hidden, Keep private leaves the recipe private and still offered', async () => {
        profile.paidFeatures = 'hidden';
        await openPrivateRecipe('rec_secret_kept');

        await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));
        await userEvent.click(await screen.findByRole('button', { name: 'Keep private' }));

        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect((screen.getByRole('radio', { name: /^Private/u }) as HTMLInputElement).checked).toBe(true);
    });

    it('⛔ under upsell, Public asks first with the Premium words; confirmed, going back asks for Premium', async () => {
        profile.paidFeatures = 'upsell';
        await openPrivateRecipe('rec_secret_upsell');

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
        expect((screen.getByRole('radio', { name: /^Public/u, hidden: true }) as HTMLInputElement).checked).toBe(true);
    });

    it('a granted owner moves a private recipe to Public with no confirm', async () => {
        profile.paidFeatures = 'granted';
        await openPrivateRecipe('rec_secret_granted');

        await userEvent.click(screen.getByRole('radio', { name: /^Public/u }));

        expect((screen.getByRole('radio', { name: /^Public/u }) as HTMLInputElement).checked).toBe(true);
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it.each([
        ['hidden', 'hidden'],
        ['a failed profile read', 'failed'],
        ['a profile still loading', undefined],
    ] as const)(
        '⛔ under %s, says "Who can see it: Public" and offers no Private and no Premium',
        async (_label, state) => {
            profile.paidFeatures = state;
            renderEditor(createFakeRecipeServiceClient());

            expect(await screen.findByText('Who can see it')).toBeTruthy();
            expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
            expect(screen.queryByRole('radio', { name: /^Public/u })).toBeNull();
            expect(screen.queryByText('Premium')).toBeNull();
            expect(screen.queryByRole('dialog', { name: /Premium/u })).toBeNull();
        },
    );
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
