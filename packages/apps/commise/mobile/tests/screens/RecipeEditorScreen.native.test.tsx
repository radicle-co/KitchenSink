/**
 * The native one-page editor screen (slice 7): the read boundary, the device draft, and the editor's writes going
 * through the REAL outbox (`SyncProvider` + `recipeSender`) to the recipe client — the client is the type-checked fake
 * (`createFakeRecipeServiceClient`), stubbed per test. REPLACES `RecipeCreateScreen`, `RecipeEditScreen` and
 * `RecipeEditor` suites: their coverage of the wizard's steps, Save Draft and the five-minute auto-save retired with
 * the wizard; the editor's lifecycle is pinned by `useRecipeEditor.test.tsx`, and the frame by
 * `RecipeEditorView.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

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

// The editor's error reporter reaches the Sentry SDK, which needs the native runtime; the reporter is its own unit.
vi.mock('../../src/observability/sentryErrorReporter.js', () => ({ reportErrorToSentry: vi.fn() }));

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

/** The viewer's paid features: undefined while the profile loads (the default), `failed` for a read that errored. */
const profile = vi.hoisted(() => ({
    paidFeatures: undefined as 'granted' | 'upsell' | 'hidden' | 'failed' | undefined,
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () =>
        profile.paidFeatures === undefined
            ? { status: 'pending', data: undefined }
            : profile.paidFeatures === 'failed'
              ? { status: 'error', data: undefined }
              : { status: 'success', data: { account: { paidFeatures: profile.paidFeatures } } },
}));

afterEach(() => {
    cleanup();
    auth.userId = 'user_cook';
    profile.paidFeatures = undefined;
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
            cuisine: 'Irish',
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
        await waitFor(() =>
            expect(handlers.onFinished).toHaveBeenCalledWith('rec_1', {
                outcome: 'firstPublish',
                privateRefused: undefined,
            }),
        );
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
            cuisine: 'Irish',
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
        await waitFor(() =>
            expect(handlers.onFinished).toHaveBeenCalledWith('rec_1', {
                outcome: 'firstPublish',
                privateRefused: undefined,
            }),
        );
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_1', RecipeVisibility.PRIVATE));
    });

    /**
     * The same stale read for a cook whose paid features are hidden: the Private would be refused after the editor had
     * gone, so it is not sent, and the hand-off says the recipe stayed public (the stuck-save defect).
     */
    it('⛔ under hidden, sends no Private the server would refuse, and the hand-off says so', async () => {
        profile.paidFeatures = 'hidden';
        const client = createFakeRecipeServiceClient();
        const draft = makeRecipeDetail({
            id: 'rec_stale',
            title: 'Ready Stew',
            cuisine: 'Irish',
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
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');
        const handlers = renderScreen(client, { recipeId: 'rec_stale' });

        await screen.findByRole('heading', { name: 'Edit recipe' });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        await waitFor(() =>
            expect(handlers.onFinished).toHaveBeenCalledWith('rec_stale', {
                outcome: 'firstPublish',
                privateRefused: 'final',
            }),
        );
        expect(setVisibility).not.toHaveBeenCalled();
    });
});

/**
 * E1 (build spec §6.4, §7.7 item 2) + plan 2026-10-14-009 D14, mirroring the web suite: "Who can see it" renders from the
 * viewer's paid features alone. `upsell` opens the Premium sheet for Private; `granted` gets Private; `hidden`, a failed
 * profile read and a profile still loading show the plain statement — no Private, no Premium, no upsell.
 *
 * REWRITTEN 2026-10-14: the loading case used to tap a Private that waited; loading now fails closed to the statement.
 */
describe('RecipeEditorScreen (native) — Private (E1, paid features)', () => {
    const choosePrivate = (): void => {
        fireEvent.click(screen.getByRole('radio', { name: /^Private/u }));
    };

    it('⛔ under upsell, the Premium sheet opens for Private, and Public stays chosen', async () => {
        profile.paidFeatures = 'upsell';
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });

        choosePrivate();

        expect(await screen.findByRole('heading', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: /^Public/u, hidden: true }).getAttribute('aria-checked')).toBe('true');
    });

    it('Not now closes the sheet and leaves the recipe public', async () => {
        profile.paidFeatures = 'upsell';
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });
        choosePrivate();

        fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(screen.queryByRole('heading', { name: /Premium/u })).toBeNull());
        expect(screen.getByRole('radio', { name: /^Public/u }).getAttribute('aria-checked')).toBe('true');
    });

    it('lets a granted cook choose Private, with no sheet', async () => {
        profile.paidFeatures = 'granted';
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });

        choosePrivate();

        expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByRole('heading', { name: /Premium/u })).toBeNull();
    });

    /**
     * Each case edits its own recipe: the device draft store is one memory store for the whole file, so a draft left
     * under a shared id would reopen in a later case.
     *
     * The stuck-save defect: under `hidden` the owner of a private recipe could move it to Public and back to Private,
     * and the server refused the second write. Once the draft leaves Private the editor offers it no more.
     */
    it('⛔ under hidden, a private recipe moved to Public is not offered Private again', async () => {
        profile.paidFeatures = 'hidden';
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_secret_hidden', title: 'Secret Stew', visibility: RecipeVisibility.PRIVATE }),
        );
        renderScreen(client, { recipeId: 'rec_secret_hidden' });
        await screen.findByRole('heading', { name: 'Edit recipe' });
        expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));

        expect(await screen.findByLabelText('Who can see it: Public. Anyone can find it in Discover.')).toBeTruthy();
        expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
        expect(screen.queryByText('Premium')).toBeNull();
    });

    it('⛔ under upsell, a private recipe moved to Public asks for Premium to go back', async () => {
        profile.paidFeatures = 'upsell';
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_secret_upsell', title: 'Secret Stew', visibility: RecipeVisibility.PRIVATE }),
        );
        renderScreen(client, { recipeId: 'rec_secret_upsell' });
        await screen.findByRole('heading', { name: 'Edit recipe' });

        fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));
        choosePrivate();

        expect(await screen.findByRole('heading', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: /^Public/u, hidden: true }).getAttribute('aria-checked')).toBe('true');
    });

    it.each([
        ['hidden', 'hidden'],
        ['a failed profile read', 'failed'],
        ['a profile still loading', undefined],
    ] as const)('⛔ under %s, says "Who can see it: Public" and offers no Private', async (_label, state) => {
        profile.paidFeatures = state;
        renderScreen(createFakeRecipeServiceClient());
        await screen.findByRole('heading', { name: 'New recipe' });

        expect(screen.getByLabelText('Who can see it: Public. Anyone can find it in Discover.')).toBeTruthy();
        expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
        expect(screen.queryByText('Premium')).toBeNull();
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
                    progress: null,
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

/**
 * ⛔ A PUBLISHED RECIPE'S PARKED SAVE CHANGES DOES NOT OUTLIVE THE DISCARD (plan 2026-10-13-004, item 5), on the phone
 * as on the web: the same copy, the same withdrawal, the same hand-off. Over the real outbox, Save changes meets a
 * dropped connection and parks with an unknown outcome, so the changes may already stand.
 */
describe('RecipeEditorScreen (native) — Discard with a parked save', () => {
    it('says the save may have gone through, withdraws it, and leaves for the recipe', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Stored Stew', cuisine: 'Irish', status: RecipeStatus.PUBLISHED }),
        );
        const update = vi.spyOn(client, 'updateRecipe').mockRejectedValue(new TypeError('Failed to fetch'));
        const store = createMemoryOutboxStore();
        const handlers = { onFinished: vi.fn(), onClose: vi.fn(), onDiscarded: vi.fn() };

        renderWithRecipeClient(
            withFoodClient(
                <SyncProvider subject="user_cook" send={recipeSender(() => client)} store={store}>
                    <RecipeEditorScreen {...handlers} recipeId="rec_1" />
                </SyncProvider>,
            ),
            client,
        );

        fireEvent.change(await screen.findByDisplayValue('Stored Stew'), { target: { value: 'Stored Stew Deluxe' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        await screen.findByText("We couldn't tell if your changes were saved.");
        expect((await loadOutbox(store, 'user_cook')).records.map((record) => record.state)).toEqual(['parked']);

        fireEvent.click(screen.getByRole('button', { name: 'More editor actions' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }));
        // The native dialog is announced as an interrupting `alert`, its title a heading (`ConfirmDialog.native`); the
        // parked write's own alert is one too, so the dialog is found by its title.
        const dialog = (await screen.findByRole('heading', { name: 'Discard your changes?' })).closest(
            '[role="alert"]',
        ) as HTMLElement;
        expect(within(dialog).getByText(/Your last save may have gone through/u)).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

        await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
        await waitFor(async () => expect((await loadOutbox(store, 'user_cook')).records).toEqual([]));
        expect(update).toHaveBeenCalledTimes(1);
    });
});
