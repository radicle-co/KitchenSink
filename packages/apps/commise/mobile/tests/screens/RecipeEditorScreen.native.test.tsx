/**
 * The native one-page editor screen (slice 7): the read boundary, the device draft, and the editor's writes going
 * through the REAL outbox (`SyncProvider` + `recipeSender`) to the recipe client — the client is the type-checked fake
 * (`createFakeRecipeServiceClient`), stubbed per test. REPLACES `RecipeCreateScreen`, `RecipeEditScreen` and
 * `RecipeEditor` suites: their coverage of the wizard's steps, Save Draft and the five-minute auto-save retired with
 * the wizard; the editor's lifecycle is pinned by `useRecipeEditor.test.tsx`, and the frame by
 * `RecipeEditorView.native.test.tsx`.
 */
import { recipeLoadMessages } from '@commise/features-recipes/detail';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { renderWithRecipeClient, withFoodClient } from '@commise/test-utils';
import { SyncProvider } from '@commise/query/sync';
import { recipeSender } from '@commise/query/recipe-sender';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { createMemoryOutboxStore, loadOutbox } from '@kitchensink/sync';
import { focusManager, onlineManager } from '@tanstack/react-query';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import type { ParseJobResponse, ParseProposalMatch } from '@kitchensink/schema-recipe';
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

    // The shared `RecipeLoadError` replaced this screen's hand-built Text + Button: a failed read of the recipe being
    // edited says so, retries, and names the way back (× is not on screen while the editor has not opened).
    it('a failed read of the recipe being edited says so, offers Try again, and names the way back', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new Error('network down'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const handlers = renderScreen(client, { recipeId: 'rec_1' });

        expect((await screen.findByRole('alert')).textContent).toContain(recipeLoadMessages.en.errorTitle);
        expect(screen.getByRole('button', { name: recipeLoadMessages.en.retry })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Back to / }));

        expect(handlers.onClose).toHaveBeenCalledTimes(1);
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
    // REWRITTEN for ADR-0073: a free cook's own recipe is no longer refused Private for want of Pro, so the Pro
    // refusal is exercised on an imported public-web recipe (where it is still the rule). The slots refusal follows.
    it('⛔ under hidden, sends no Private the server would refuse, and the hand-off says so', async () => {
        profile.paidFeatures = 'hidden';
        const client = createFakeRecipeServiceClient();
        const draft = makeRecipeDetail({
            id: 'rec_stale',
            title: 'Ready Stew',
            cuisine: 'Irish',
            status: RecipeStatus.DRAFT,
            visibility: RecipeVisibility.PRIVATE,
            sourceType: 'imported_public',
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

    // ADR-0073, REWRITTEN for the owner ruling of 2026-10-26 (section 12): a draft holds no slot, and PUBLISHING a private
    // one takes it. With every slot KNOWN used, Publish is refused before anything is sent - the old hand-off published the
    // recipe public behind the cook's back and told them afterwards. The editor stays open, draws the refusal, and keeps
    // Private chosen.
    it('⛔ with every slot known used, Publish of a private draft opens the dialog: nothing is sent, Private stays chosen; Keep as draft closes it', async () => {
        profile.paidFeatures = 'upsell';
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getPrivateSlots').mockResolvedValue({ kind: 'limited', used: 50, limit: 50 });
        const draft = makeRecipeDetail({
            id: 'rec_full',
            title: 'Ready Stew',
            cuisine: 'Irish',
            status: RecipeStatus.DRAFT,
            visibility: RecipeVisibility.PRIVATE,
            currentVersion: 2,
        });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(draft);
        const update = vi.spyOn(client, 'updateRecipe');
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');
        const handlers = renderScreen(client, { recipeId: 'rec_full' });

        await screen.findByRole('heading', { name: 'Edit recipe' });
        await waitFor(() => expect(client.getPrivateSlots).toHaveBeenCalled());
        // Not yet: a private draft shows no refusal.
        expect(screen.queryByText('Not available. All 50 of your private slots are in use.')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        expect(await screen.findByRole('heading', { name: 'Your private slots are full' })).toBeTruthy();
        expect(screen.queryByText('Not available. All 50 of your private slots are in use.')).toBeNull();
        expect(update).not.toHaveBeenCalled();
        expect(setVisibility).not.toHaveBeenCalled();
        expect(handlers.onFinished).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));
        });

        expect(screen.queryByRole('heading', { name: 'Your private slots are full' })).toBeNull();
        expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
        expect(update).not.toHaveBeenCalled();
        expect(handlers.onFinished).not.toHaveBeenCalled();
    });

    // Review B1: a FAILED profile read is not the server's answer, so the Private is sent and the server decides.
    it('⛔ after a failed profile read, the Private is still sent: an unknown state is not a refusal', async () => {
        profile.paidFeatures = 'failed';
        const client = createFakeRecipeServiceClient();
        const draft = makeRecipeDetail({
            id: 'rec_failed_read',
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
        const handlers = renderScreen(client, { recipeId: 'rec_failed_read' });

        await screen.findByRole('heading', { name: 'Edit recipe' });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        });

        await waitFor(() =>
            expect(handlers.onFinished).toHaveBeenCalledWith('rec_failed_read', {
                outcome: 'firstPublish',
                privateRefused: undefined,
            }),
        );
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_failed_read', RecipeVisibility.PRIVATE));
    });
});

/**
 * E1 (build spec §6.4, §7.7 item 2) + plan 2026-10-14-009 D14, mirroring the web suite, REWRITTEN for ADR-0073 and the
 * owner ruling of 2026-10-26. A recipe is under the SLOTS rule (a free cook's own, book or paid-site recipe: Private works
 * while the server says a slot is free, whatever the paid features say) or the PREMIUM rule (an imported public-web
 * recipe: the paid-feature table it always had). Public is NEVER final: no confirm says a recipe "can't go private again".
 */
describe('RecipeEditorScreen (native) — Private (E1, private slots and Pro)', () => {
    const choosePrivate = (): void => {
        fireEvent.click(screen.getByRole('radio', { name: /^Private/u }));
    };

    /** A client whose slot read answers `usage`. */
    const clientWithSlots = (usage: { used: number; limit: number } | 'unlimited'): RecipeServiceClient => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getPrivateSlots').mockResolvedValue(
            usage === 'unlimited' ? { kind: 'unlimited' } : { kind: 'limited', ...usage },
        );

        return client;
    };

    /**
     * Each case edits its own recipe: the device draft store is one memory store for the whole file, so a draft left
     * under a shared id would reopen in a later case.
     */
    const openRecipe = async (
        client: RecipeServiceClient,
        id: string,
        visibility: RecipeVisibility,
        sourceType: 'user_created' | 'imported_public' | 'imported_physical' | 'imported_paid' = 'user_created',
        status: RecipeStatus = RecipeStatus.PUBLISHED,
    ): Promise<ReturnType<typeof renderScreen>> => {
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id, title: 'Secret Stew', visibility, sourceType, status }),
        );
        const handlers = renderScreen(client, { recipeId: id });
        await screen.findByRole('heading', { name: 'Edit recipe' });

        return handlers;
    };

    const confirmDialog = (): HTMLElement =>
        screen.getByRole('heading', { name: 'Make this recipe public?' }).closest('[role="alert"]') as HTMLElement;

    describe('a recipe the cook wrote: the slots rule', () => {
        it('shows how many private slots are left, from the server`s read, on a published recipe', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(clientWithSlots({ used: 38, limit: 50 }), 'rec_count', RecipeVisibility.PUBLIC);

            expect(await screen.findByText('12 of 50 private slots left')).toBeTruthy();
        });

        it('⛔ a NEW recipe is a draft: it shows no count and no refusal, even with every slot used', async () => {
            profile.paidFeatures = 'upsell';
            renderScreen(clientWithSlots({ used: 50, limit: 50 }));
            await screen.findByRole('heading', { name: 'New recipe' });

            choosePrivate();

            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
            expect(screen.getAllByText('A private draft uses no slot. Publishing it uses one.').length).toBeGreaterThan(
                0,
            );
            expect(screen.queryByText('Not available. All 50 of your private slots are in use.')).toBeNull();
        });

        it('⛔ lets a free cook choose Private even when paid features are hidden: a slot, not Pro', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 3, limit: 50 }), 'rec_choose', RecipeVisibility.PUBLIC);

            choosePrivate();

            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByRole('heading', { name: /Pro/u })).toBeNull();
            expect(await screen.findByText('This recipe uses 1 slot. 46 of 50 left after it.')).toBeTruthy();
        });

        it('⛔ with every slot used, refuses Private with its ways forward; the first two go to My recipes', async () => {
            profile.paidFeatures = 'upsell';
            const handlers = await openRecipe(
                clientWithSlots({ used: 50, limit: 50 }),
                'rec_full_ways',
                RecipeVisibility.PUBLIC,
            );

            expect(await screen.findByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();
            choosePrivate();
            expect(screen.getByRole('radio', { name: /^Public/u }).getAttribute('aria-checked')).toBe('true');

            fireEvent.click(screen.getByRole('button', { name: /Make a private recipe public/u }));

            expect(handlers.onDiscarded).toHaveBeenCalledTimes(1);
            expect(screen.getByRole('button', { name: /Get Pro/u })).toBeTruthy();
        });

        // REMOVED (owner ruling 2026-10-26): "leaving by Make a private recipe public keeps what the cook typed" drove the ways
        // forward a refused Publish of a private DRAFT used to draw inline. That Publish now opens the "Your private slots are
        // full" dialog (below) with two choices, Publish as public and Keep as draft, and no way forward leaves the editor.
        // The exit checkpoint itself is covered by the sibling leave tests.

        it('"Get Pro" in the refusal opens the Pro sheet', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(clientWithSlots({ used: 50, limit: 50 }), 'rec_premium', RecipeVisibility.PUBLIC);

            fireEvent.click(await screen.findByRole('button', { name: /Get Pro/u }));

            expect(await screen.findByRole('heading', { name: 'Keep more recipes private' })).toBeTruthy();
        });

        it('offers no Pro way when paid features are hidden', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 50, limit: 50 }), 'rec_hidden', RecipeVisibility.PUBLIC);

            await screen.findByText('Not available. All 50 of your private slots are in use.');

            expect(screen.queryByRole('button', { name: /Get Pro/u })).toBeNull();
            expect(screen.getByRole('button', { name: /Delete a private recipe/u })).toBeTruthy();
        });

        it('Pro sees no count, and no sheet', async () => {
            profile.paidFeatures = 'granted';
            renderScreen(clientWithSlots('unlimited'));
            await screen.findByRole('heading', { name: 'New recipe' });

            choosePrivate();

            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByText(/private slots/u)).toBeNull();
            expect(screen.queryByText('Pro')).toBeNull();
        });

        it('⛔ Public asks first and says it frees a slot; confirmed, Private is still offered while a slot is free', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 20, limit: 50 }), 'rec_frees', RecipeVisibility.PRIVATE);
            // The confirm is decided from the server's count: wait for it, or Public goes at once.
            await screen.findByText('30 of 50 private slots left');

            fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));
            expect(
                within(confirmDialog()).getByText(
                    'Anyone can see a public recipe and save a copy. It frees one of your private slots, and you can make it private again while you have a free slot.',
                ),
            ).toBeTruthy();
            fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Make public' }));
            await waitFor(() => expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull());

            // Public is never final.
            choosePrivate();
            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
        });

        it('Keep private leaves the recipe private', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 20, limit: 50 }), 'rec_kept', RecipeVisibility.PRIVATE);
            await screen.findByText('30 of 50 private slots left');

            fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));
            fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Keep private' }));

            expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull();
            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
        });

        it('a Pro owner moves a private recipe to Public with no confirm', async () => {
            profile.paidFeatures = 'granted';
            await openRecipe(clientWithSlots('unlimited'), 'rec_secret_granted', RecipeVisibility.PRIVATE);

            fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));

            expect(screen.getByRole('radio', { name: /^Public/u }).getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull();
        });
    });

    describe('a book or paid-site recipe: private only', () => {
        const REASON = 'Not for this recipe. Its source is a book or a paid site, not a public web page.';

        it.each(['imported_physical', 'imported_paid'] as const)(
            '⛔ shows Public refused on a private %s recipe, with the reason in its words',
            async (sourceType) => {
                profile.paidFeatures = 'upsell';
                await openRecipe(
                    clientWithSlots({ used: 10, limit: 50 }),
                    `rec_book_${sourceType}`,
                    RecipeVisibility.PRIVATE,
                    sourceType,
                );

                const pub = screen.getByRole('radio', { name: /^Public/u });

                // The card's dimmed state and its hint are asserted on the field's own suite (jsdom drops them here).
                expect(within(pub).getByText(REASON)).toBeTruthy();
            },
        );

        it('⛔ choosing the refused Public changes nothing and opens no confirm', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(
                clientWithSlots({ used: 10, limit: 50 }),
                'rec_book_choice',
                RecipeVisibility.PRIVATE,
                'imported_physical',
            );

            fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));

            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull();
        });

        it('does not refuse Public on a recipe the cook wrote', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(clientWithSlots({ used: 10, limit: 50 }), 'rec_own_pub', RecipeVisibility.PRIVATE);

            expect(screen.queryByText(REASON)).toBeNull();
        });
    });

    describe('over the limit after a downgrade', () => {
        const SENTENCE =
            'You have 60 private recipes and 50 private slots. They stay private. To make another recipe private, first bring your private recipes under 50.';

        it('⛔ says what the cook holds and that it stays private, from the server`s numbers', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(clientWithSlots({ used: 60, limit: 50 }), 'rec_over', RecipeVisibility.PUBLIC);

            expect(await screen.findByText(SENTENCE)).toBeTruthy();
        });

        it('⛔ About Pro opens the noSlot sheet with the server`s limit', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(clientWithSlots({ used: 60, limit: 50 }), 'rec_over', RecipeVisibility.PUBLIC);

            fireEvent.click(await screen.findByRole('button', { name: 'About Pro' }));

            expect(await screen.findByRole('heading', { name: 'Keep more recipes private' })).toBeTruthy();
            expect(
                screen.getByText(
                    'All 50 of your private slots are in use. Pro has no limit. To free a slot, make a private recipe public or delete one.',
                ),
            ).toBeTruthy();
        });

        it('⛔ with paid features hidden, says the sentence and offers no Pro link', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(clientWithSlots({ used: 60, limit: 50 }), 'rec_over', RecipeVisibility.PUBLIC);

            expect(await screen.findByText(SENTENCE)).toBeTruthy();
            expect(screen.queryByRole('button', { name: /Pro/u })).toBeNull();
        });
    });

    describe('an imported public-web recipe: Pro is still the rule', () => {
        it('⛔ under upsell, the Pro sheet opens for Private, and Public stays chosen', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(createFakeRecipeServiceClient(), 'rec_web_up', RecipeVisibility.PUBLIC, 'imported_public');

            choosePrivate();

            expect(await screen.findByRole('heading', { name: 'Private needs Pro for this recipe' })).toBeTruthy();
            expect(screen.getByRole('radio', { name: /^Public/u, hidden: true }).getAttribute('aria-checked')).toBe(
                'true',
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
            choosePrivate();

            fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

            await waitFor(() => expect(screen.queryByRole('heading', { name: /Pro/u })).toBeNull());
            expect(screen.getByRole('radio', { name: /^Public/u }).getAttribute('aria-checked')).toBe('true');
        });

        it('lets a granted cook choose Private, with no sheet', async () => {
            profile.paidFeatures = 'granted';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_granted',
                RecipeVisibility.PUBLIC,
                'imported_public',
            );

            choosePrivate();

            expect(screen.getByRole('radio', { name: /^Private/u }).getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByRole('heading', { name: /Pro/u })).toBeNull();
        });

        it('⛔ under upsell, Public asks first with the Pro words; confirmed, going back asks for Pro', async () => {
            profile.paidFeatures = 'upsell';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_private',
                RecipeVisibility.PRIVATE,
                'imported_public',
            );

            fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));
            expect(
                within(confirmDialog()).getByText(
                    "Anyone can see a public recipe and save a copy. To make this one private again, you'll need Pro.",
                ),
            ).toBeTruthy();
            fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Make public' }));
            choosePrivate();

            expect(await screen.findByRole('heading', { name: 'Private needs Pro for this recipe' })).toBeTruthy();
            expect(screen.getByRole('radio', { name: /^Public/u, hidden: true }).getAttribute('aria-checked')).toBe(
                'true',
            );
        });

        // Public is never final, so under hidden there is nothing to confirm: Public is at once, and the recipe then shows
        // the plain statement because the paid features offer no way back (the stuck-save defect stays closed).
        it('⛔ under hidden, Public is at once with no claim that it is final; then the editor offers no Private', async () => {
            profile.paidFeatures = 'hidden';
            await openRecipe(
                createFakeRecipeServiceClient(),
                'rec_web_hidden',
                RecipeVisibility.PRIVATE,
                'imported_public',
            );

            fireEvent.click(screen.getByRole('radio', { name: /^Public/u }));

            expect(
                await screen.findByLabelText('Who can see it: Public. Anyone can find it in Discover.'),
            ).toBeTruthy();
            expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull();
            expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
            expect(screen.queryByText(/won.t be able|may not be able/u)).toBeNull();
        });

        it.each([
            ['hidden', 'hidden'],
            ['a failed profile read', 'failed'],
            ['a profile still loading', undefined],
        ] as const)('⛔ under %s, says "Who can see it: Public" and offers no Private', async (_label, state) => {
            profile.paidFeatures = state;
            await openRecipe(
                createFakeRecipeServiceClient(),
                `rec_web_${String(state)}`,
                RecipeVisibility.PUBLIC,
                'imported_public',
            );

            expect(screen.getByLabelText('Who can see it: Public. Anyone can find it in Discover.')).toBeTruthy();
            expect(screen.queryByRole('radio', { name: /^Private/u })).toBeNull();
            expect(screen.queryByText('Pro')).toBeNull();
        });
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
    /**
     * REWRITTEN for ADR-0071 (2026-10-26): the pasted line used to be looked up by name (`addIngredientByName`), which
     * bound a ranked guess (milk crackers for milk). It now asks for the job's MATCHES and binds a confident one by food;
     * the by-name assertion was deleted with the path, and this test pins that the screen never reaches it.
     */
    it('a new recipe’s empty Ingredients section offers it; the pasted line is matched, then bound by food', async () => {
        const client = createFakeRecipeServiceClient();
        const base = {
            id: '00000000-0000-4000-8000-00000000e201',
            status: 'complete' as const,
            createdAt: '2026-10-09T10:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
        };
        const lineWith = (match?: ParseProposalMatch): ParseJobResponse['lines'][number] => ({
            lineIndex: 0,
            sourceLine: '2 cups flour',
            status: 'parsed' as const,
            progress: null,
            proposal: {
                raw: '2 cups flour',
                quantity: { kind: 'exact' as const, value: 2 },
                unit: 'cup',
                statedMeasure: '2 cups',
                foods: [{ name: 'flour', prep: null, ...(match === undefined ? {} : { match }) }],
                reviewReasons: [],
            },
        });
        const parsed: ParseJobResponse = { ...base, lines: [lineWith()] };
        const matched: ParseJobResponse = {
            ...base,
            lines: [
                lineWith({
                    state: 'confident',
                    reason: 'exactName',
                    proposed: { kind: 'root', id: 'food_flour', name: 'Plain flour' },
                    candidates: [],
                }),
            ],
        };
        const create = vi.spyOn(client, 'createParseJob').mockResolvedValue(parsed);
        vi.spyOn(client, 'getParseJob').mockResolvedValue(parsed);
        const matches = vi.spyOn(client, 'proposeParseJobMatches').mockResolvedValue(matched);
        const byName = vi.spyOn(client, 'addIngredientByName');
        const byFood = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f1',
            name: 'Plain flour',
            foodId: 'food_flour',
            isUserEntered: false,
        } as Awaited<ReturnType<RecipeServiceClient['addIngredientByFood']>>);
        renderScreen(client);

        fireEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Ingredient lines' }), {
            target: { value: '2 cups flour' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add 1 ingredient' }));

        await waitFor(() => expect(create).toHaveBeenCalledWith({ text: '2 cups flour' }));
        await waitFor(() => expect(matches).toHaveBeenCalledWith(base.id));
        await waitFor(() => expect(byFood).toHaveBeenCalledWith('food_flour'));
        expect(byName).not.toHaveBeenCalled();
        expect(await screen.findByText('Plain flour')).toBeTruthy();
    });

    /**
     * ⛔ THE PASTE LIST MEETS THE REAL EDITOR LIFECYCLE, on the phone as on the web (`RecipeEditorContainer.test.tsx`): the
     * recipe is CREATED on the server once the paste's lines have joined, the create STORES the joined line, and the
     * cook's pick on that stored line is the REBIND COMMAND at its stored position (ADR-0045). If the create re-keyed the
     * draft, the paste list would read its lines as deleted (removal is terminal) and vanish.
     */
    it('keeps the paste list through the server create and a pick on the stored line (the rebind command)', async () => {
        const client = createFakeRecipeServiceClient();
        const base = {
            id: '00000000-0000-4000-8000-00000000e202',
            createdAt: '2026-10-09T10:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
        };
        const lineWith = (match?: ParseProposalMatch): ParseJobResponse['lines'][number] => ({
            lineIndex: 0,
            sourceLine: '2 cups milk',
            status: 'parsed',
            progress: null,
            proposal: {
                raw: '2 cups milk',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                statedMeasure: '2 cups',
                foods: [{ name: 'milk', prep: null, ...(match === undefined ? {} : { match }) }],
                reviewReasons: [],
            },
        });
        const parsed: ParseJobResponse = { ...base, status: 'complete', lines: [lineWith()] };
        const matched: ParseJobResponse = {
            ...base,
            status: 'complete',
            lines: [
                lineWith({
                    state: 'default',
                    reason: 'defaultApplies',
                    proposed: null,
                    candidates: [
                        { kind: 'root', id: 'food_whole', name: 'Whole milk', isDefault: true },
                        { kind: 'root', id: 'food_skim', name: 'Skim milk', isDefault: false },
                    ],
                }),
            ],
        };
        // The service keeps the matches it wrote: a read after the matches call answers them.
        let held = parsed;

        vi.spyOn(client, 'createParseJob').mockResolvedValue({ ...parsed, status: 'running' });
        vi.spyOn(client, 'getParseJob').mockImplementation(() => Promise.resolve(held));
        vi.spyOn(client, 'proposeParseJobMatches').mockImplementation(() => {
            held = matched;

            return Promise.resolve(matched);
        });
        vi.spyOn(client, 'createIngredient').mockResolvedValue({
            id: '00000000-0000-4000-8000-0000000000f2',
            name: 'milk',
            isUserEntered: true,
        } as Awaited<ReturnType<RecipeServiceClient['createIngredient']>>);
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
        const rebind = vi.spyOn(client, 'rebindIngredientLine').mockResolvedValue(draftRecipe(2, [skimView]));
        renderScreen(client);

        fireEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Ingredient lines' }), {
            target: { value: '2 cups milk' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add 1 ingredient' }));
        expect(await screen.findByText('Choose the milk you use')).toBeTruthy();

        // The recipe is CREATED with the line in it: the app going to the background is a checkpoint.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pudding' } });
        act(() => focusManager.setFocused(false));
        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        act(() => focusManager.setFocused(true));
        expect(create.mock.calls[0]?.[0].ingredients).toHaveLength(1);
        // The create's answer re-keyed nothing: the paste list still draws the line, still asking.
        expect(screen.getByText('Choose the milk you use')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Skim milk' }));

        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(rebind.mock.calls[0]?.[0]).toBe('rec_new');
        expect(rebind.mock.calls[0]?.[1]).toBe(0);
        expect(rebind.mock.calls[0]?.[2]).toMatchObject({ target: { kind: 'catalogFood', foodId: 'food_skim' } });
        expect(await screen.findByText(/Skim milk\s+· your choice/u)).toBeTruthy();
        expect(screen.queryByText('Choose the milk you use')).toBeNull();
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
