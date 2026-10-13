/**
 * The native one-page editor screen (slice 7): the read boundary, the device draft, and the editor's writes going
 * through the REAL outbox (`SyncProvider` + `recipeSender`) to the recipe client — the client is the type-checked fake
 * (`createFakeRecipeServiceClient`), stubbed per test. REPLACES `RecipeCreateScreen`, `RecipeEditScreen` and
 * `RecipeEditor` suites: their coverage of the wizard's steps, Save Draft and the five-minute auto-save retired with
 * the wizard; the editor's lifecycle is pinned by `useRecipeEditor.test.tsx`, and the frame by
 * `RecipeEditorView.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithRecipeClient, withFoodClient } from '@commise/test-utils';
import { SyncProvider } from '@commise/query/sync';
import { recipeSender } from '@commise/query/recipe-sender';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { createMemoryOutboxStore, loadOutbox } from '@kitchensink/sync';
import { onlineManager } from '@tanstack/react-query';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { recipeFormMessages } from '@commise/features-recipes';

import { RecipeEditorScreen } from '../../src/screens/RecipeEditorScreen.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

/** The window's width: a phone unless a test widens it to a tablet (the section index's rail shows from 960). */
const win = vi.hoisted(() => ({ width: undefined as number | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        useWindowDimensions: () => {
            const real = actual.useWindowDimensions();

            return win.width === undefined ? real : { ...real, width: win.width };
        },
    };
});

/** The signed-in cook: one unless a test switches it (Clerk multi-session). */
const auth = vi.hoisted(() => ({ userId: 'user_cook' }));

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: auth.userId }) }));

// The device draft over a memory store: this suite is about the screen and the outbox, not AsyncStorage.
vi.mock('../../src/storage/editorDrafts.js', async () => {
    const { draftStoreFor } = await import('@commise/features-recipes');
    const store = createMemoryOutboxStore();

    return {
        editorDraftsFor: (subject: string | undefined) =>
            subject === undefined ? undefined : draftStoreFor(store, subject),
    };
});

// The photo uploader records the props the editor hands it, so the empty-state cover test below can read them.
const uploader = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock('../../src/components/RecipePhotoUploader.js', () => ({
    RecipePhotoUploader: (props: object) => {
        uploader.props(props);

        return null;
    },
}));

/** The viewer's plan: undefined while the profile loads (the default), or a tier. */
const profile = vi.hoisted(() => ({ tier: undefined as string | undefined }));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({
        data: profile.tier === undefined ? undefined : { account: { subscriptionTier: profile.tier } },
    }),
}));

afterEach(() => {
    cleanup();
    auth.userId = 'user_cook';
    profile.tier = undefined;
});

/** Render the screen under the real outbox, sending with `client`. */
function renderScreen(client: RecipeServiceClient, props: Partial<Parameters<typeof RecipeEditorScreen>[0]> = {}) {
    const handlers = { onFinished: vi.fn(), onClose: vi.fn(), onDiscarded: vi.fn() };

    renderWithRecipeClient(
        withFoodClient(
            <SyncProvider subject="user_cook" send={recipeSender(() => client)}>
                <RecipeEditorScreen {...handlers} {...props} />
            </SyncProvider>,
        ),
        client,
    );

    return handlers;
}

describe('RecipeEditorScreen (native)', () => {
    it('opens a new recipe blank, under its task title, with the four sections', () => {
        renderScreen(createFakeRecipeServiceClient());

        const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
        expect(headings[0]).toBe('New recipe');
        // The section headings, in page order (Details' own groups are headings too).
        expect(
            headings.filter((text) => ['Details', 'Ingredients', 'Steps', 'Photos & publish'].includes(text ?? '')),
        ).toEqual(['Details', 'Ingredients', 'Steps', 'Photos & publish']);
    });

    // Build spec §7.2 and §7.5.6: on a wide tablet the rail's foot shows the Ingredients total too.
    it('a wide tablet’s section rail carries the running total in its foot', () => {
        win.width = 1280;

        try {
            renderScreen(createFakeRecipeServiceClient());

            // Once at the section's foot, once at the rail's: the same line, never "0 cal" (F7).
            expect(screen.getAllByText(recipeFormMessages.en.nutritionEmpty)).toHaveLength(2);
        } finally {
            win.width = undefined;
        }
    });

    it('× leaves without asking', () => {
        const handlers = renderScreen(createFakeRecipeServiceClient());

        fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(handlers.onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    /**
     * System Back and the swipe do what × does (build spec §3.5), so the screen hears the leave through its port (the
     * route wires it to React Navigation's `beforeRemove`) and runs the same exit checkpoint: a new recipe the cook
     * titled is created, not lost. The native new-recipe screen always opens blank, so a draft never sent has no way
     * back.
     */
    it('a leave that is not × still runs the exit checkpoint: a titled new recipe is created', async () => {
        const client = createFakeRecipeServiceClient();
        const create = vi
            .spyOn(client, 'createRecipe')
            .mockResolvedValue(makeRecipeDetail({ id: 'rec_new', title: 'Left by Back', status: RecipeStatus.DRAFT }));
        let leave: (() => void) | undefined;
        const unsubscribe = vi.fn();
        renderScreen(client, {
            subscribeToLeave: (listener) => {
                leave = listener;

                return unsubscribe;
            },
        });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Left by Back' } });
        await act(async () => {
            leave?.();
        });

        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        expect(create.mock.calls[0]?.[0]).toMatchObject({ title: 'Left by Back', status: 'draft' });
    });

    it('opens a stored recipe from its read', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew', status: RecipeStatus.DRAFT }),
        );

        renderScreen(client, { recipeId: 'rec_1' });

        expect(await screen.findByRole('heading', { name: 'Edit recipe' })).toBeTruthy();
        expect(screen.getByDisplayValue('Stored Stew')).toBeTruthy();
    });

    /**
     * A-010 / buildSpec §7.7: the photos empty state previews the recipe's own generated cover, made from its TITLE and
     * CUISINE. The screen must hand the uploader both, from the draft, or the preview is a blank tint.
     */
    it('hands the photo uploader the draft’s title and cuisine, for the empty-state cover', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew', cuisine: 'French', status: RecipeStatus.DRAFT }),
        );

        renderScreen(client, { recipeId: 'rec_1' });
        await screen.findByDisplayValue('Stored Stew');

        await waitFor(() =>
            expect(uploader.props).toHaveBeenCalledWith(
                expect.objectContaining({ recipeId: 'rec_1', title: 'Stored Stew', cuisine: 'French' }),
            ),
        );
    });

    it('publishes a complete draft through the outbox, then hands off to the recipe', async () => {
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
        const handlers = renderScreen(client, { recipeId: 'rec_1' });

        await screen.findByRole('heading', { name: 'Edit recipe' });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        await waitFor(() => expect(update).toHaveBeenCalled());
        // E8: the hand-off says how the editor finished, for the snackbar over the recipe the cook lands on.
        await waitFor(() => expect(handlers.onFinished).toHaveBeenCalledWith('rec_1', 'firstPublish'));
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]?.[1]).toMatchObject({ status: 'published', expectedVersion: 2 });
    });

    /**
     * Visibility follows the recipe's write (C-004), compared against what the write's ANSWER says the server holds.
     * Here the read says private and the answer says public (changed elsewhere meanwhile): comparing against the read
     * — which also leaves a new recipe, with no read, never made private — would send nothing.
     */
    it('makes the recipe private after publishing when the server answers public', async () => {
        const client = createFakeRecipeServiceClient();
        const draft = makeRecipeDetail({
            id: 'rec_1',
            title: 'Ready Stew',
            status: RecipeStatus.DRAFT,
            visibility: RecipeVisibility.PRIVATE,
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(draft);
        vi.spyOn(client, 'updateRecipe').mockResolvedValue({
            ...draft,
            status: RecipeStatus.PUBLISHED,
            visibility: RecipeVisibility.PUBLIC,
            currentVersion: 3,
        } as RecipeDetail);
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility').mockResolvedValue(draft);
        const handlers = renderScreen(client, { recipeId: 'rec_1' });

        await screen.findByRole('heading', { name: 'Edit recipe' });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        // E8: the hand-off says how the editor finished, for the snackbar over the recipe the cook lands on.
        await waitFor(() => expect(handlers.onFinished).toHaveBeenCalledWith('rec_1', 'firstPublish'));
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_1', RecipeVisibility.PRIVATE));
    });
});

/**
 * E1 (build spec §6.4, §7.7 item 2): choosing Private did nothing for a free-tier cook, because no host passed
 * `onPremiumRequired` and no recipe upsell existed. It opens the Premium sheet now; a Premium cook gets Private; and a
 * profile that is still loading is not the free tier (§6.4 F8).
 */
describe('RecipeEditorScreen (native) — Private (E1)', () => {
    const choosePrivate = (): void => {
        fireEvent.click(screen.getByRole('radio', { name: /^Private/u }));
    };

    it('⛔ tells a free-tier cook why: the Premium sheet opens, and Public stays chosen', async () => {
        profile.tier = 'free';
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });

        choosePrivate();

        expect(await screen.findByRole('heading', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: /^Public/u, hidden: true }).getAttribute('aria-checked')).toBe('true');
    });

    it('Not now closes the sheet and leaves the recipe public', async () => {
        profile.tier = 'free';
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });
        choosePrivate();

        fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(screen.queryByRole('heading', { name: /Premium/u })).toBeNull());
        expect(screen.getByRole('radio', { name: /^Public/u }).getAttribute('aria-checked')).toBe('true');
    });

    it('lets a Premium cook choose Private, with no sheet', async () => {
        profile.tier = 'premium';
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });

        choosePrivate();

        expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByRole('heading', { name: /Premium/u })).toBeNull();
    });

    it('⛔ never sends a loading profile to the upsell: no sheet until it settles', async () => {
        profile.tier = undefined;
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });

        choosePrivate();

        expect(screen.queryByRole('heading', { name: /Premium/u })).toBeNull();
        expect(screen.getByRole('radio', { name: /^Public/u }).getAttribute('aria-checked')).toBe('true');
    });
});

/** Paste a list (build spec §7.5.4; blueprint A5; owner decision D10), through the screen over a fake client. */
/**
 * The signed-in cook changes from A to B with the editor open (finding 3 of the 2026-10-10 review): the screen must
 * remount the editor, so A's exit checkpoint runs against A's outbox and B opens a fresh editor. Unkeyed, the editor kept
 * A's draft and wrote it through B's outbox. Offline, so each journal keeps what it was given.
 */
describe('RecipeEditorScreen (native) — the signed-in cook changes', () => {
    afterEach(() => {
        onlineManager.setOnline(true);
    });

    it('⛔ A`s exit checkpoint goes to A`s outbox, B`s holds nothing of A`s, and B gets a fresh editor', async () => {
        onlineManager.setOnline(false);
        auth.userId = 'user_a';
        const client = createFakeRecipeServiceClient();
        const store = createMemoryOutboxStore();
        const handlers = { onFinished: vi.fn(), onClose: vi.fn(), onDiscarded: vi.fn() };
        const tree = () =>
            withFoodClient(
                <SyncProvider subject={auth.userId} send={recipeSender(() => client)} store={store}>
                    <RecipeEditorScreen {...handlers} />
                </SyncProvider>,
            );
        const view = renderWithRecipeClient(tree(), client);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Soup of A' } });

        auth.userId = 'user_b';
        view.rerender(tree());

        await waitFor(() => expect(screen.getByLabelText('Title')).toHaveProperty('value', ''));
        view.unmount();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const titlesIn = async (subject: string) =>
            (await loadOutbox(store, subject)).records.map(
                (record) => (record.payload as { readonly input?: { readonly title?: string } }).input?.title,
            );
        expect(await titlesIn('user_a')).toEqual(['Soup of A']);
        expect(await titlesIn('user_b')).toEqual([]);
    });
});

describe('RecipeEditorScreen (native) — Paste a list', () => {
    it('a new recipe’s empty Ingredients section offers it; the pasted line is looked up by name', async () => {
        const client = createFakeRecipeServiceClient();
        const job = {
            id: '00000000-0000-4000-8000-00000000e201',
            status: 'complete' as const,
            createdAt: '2026-10-09T10:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
            lines: [
                {
                    lineIndex: 0,
                    sourceLine: '2 cups flour',
                    status: 'parsed' as const,
                    proposal: {
                        raw: '2 cups flour',
                        quantity: { kind: 'exact' as const, value: 2 },
                        unit: 'cup',
                        statedMeasure: '2 cups',
                        foods: [{ name: 'flour', prep: null }],
                        reviewReasons: [],
                    },
                },
            ],
        };
        const create = vi.spyOn(client, 'createParseJob').mockResolvedValue(job);
        vi.spyOn(client, 'getParseJob').mockResolvedValue(job);
        const byName = vi.spyOn(client, 'addIngredientByName').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f1',
            name: 'flour',
            isUserEntered: false,
        } as Awaited<ReturnType<RecipeServiceClient['addIngredientByName']>>);
        renderScreen(client);

        fireEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Ingredient lines' }), {
            target: { value: '2 cups flour' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add 1 ingredient' }));

        await waitFor(() => expect(create).toHaveBeenCalledWith({ text: '2 cups flour' }));
        await waitFor(() => expect(byName).toHaveBeenCalledWith('flour'));
    });

    it('opens with the sheet up when Home’s first-run Paste ingredients asks for it', () => {
        renderScreen(createFakeRecipeServiceClient(), { openPaste: true });

        expect(screen.getByRole('textbox', { name: 'Ingredient lines' })).toBeTruthy();
    });

    it('a stored draft never published still offers it: paste lasts until the first publish (D10, 2026-10-09)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Draft Stew', status: RecipeStatus.DRAFT }),
        );

        renderScreen(client, { recipeId: 'rec_1' });
        await screen.findByText('Edit recipe');

        expect(screen.getByRole('button', { name: 'Paste a list' })).toBeTruthy();
    });

    it('⛔ a published recipe offers no paste (D10)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew' }));

        renderScreen(client, { recipeId: 'rec_1' });
        await screen.findByText('Edit recipe');

        expect(screen.queryByRole('button', { name: 'Paste a list' })).toBeNull();
    });
});
