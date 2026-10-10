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
import { EMPTY_OUTBOX, loadOutbox, saveOutbox, type OutboxStore } from '@kitchensink/sync';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { defaultRecipeFormValues, mintLineKey, recipeFormMessages } from '@commise/features-recipes';

import { RecipeEditorContainer } from '@/components/recipes/RecipeEditorContainer';
import { webDeviceStore } from '@/components/recipes/deviceSession';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { pushMock, replaceMock, profile, auth } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
    profile: { tier: undefined as string | undefined },
    auth: { userId: 'user_cook' },
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock, replace: replaceMock }),
    useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ userId: auth.userId }) }));
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
    replaceMock.mockReset();
    vi.restoreAllMocks();
    profile.tier = undefined;
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
 * The URL follows a new recipe without a navigation, through Next's OWN shallow-update path (code-reviewer High 4 of the
 * 2026-10-09 review). Passing `history.state` carried Next's `__NA` flag, so Next skipped its router sync: it never
 * learned the new URL, its next commit rewrote it, a reload opened a blank editor, and Back restored the new-recipe tree
 * under the edit address, where typing made a second recipe. The URL now stays on the new route, `?draft=` naming the
 * local ref and then the server id; the new route, reopened on a recipe the server holds, goes to its edit route.
 */
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
