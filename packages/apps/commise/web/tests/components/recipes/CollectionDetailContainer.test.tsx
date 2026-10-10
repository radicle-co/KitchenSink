/**
 * Component tests for CollectionDetailContainer (T072 web collection-detail wiring; slice 5 of the UI overhaul,
 * `docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3). Covers every state the container renders — loading, ready, generic
 * error (with retry), a distinct not-found — and the wired flows: a removal that hides the row and commits when its Undo
 * snackbar times out; a visibility change at once, with Undo, and the Premium sheet; rename in the sheet; delete in its
 * dialog; Save a copy; and the add-recipes picker, whose toggles save at once and whose Done says what changed.
 *
 * The container mounts through the REAL query/mutation hooks over a real, network-guarded `RecipeServiceClient`
 * (`createFakeRecipeServiceClient`), stubbed per test with type-checked `vi.spyOn(client, '<method>')`. The Next router
 * stays mocked — routing is not part of the recipe-service hooks seam. The app's one `SnackbarHost` is mounted around it,
 * as the shell does.
 *
 * ⚠️ REWRITTEN for slice 5. The container used to compose a sidebar of actions (a Save-changes visibility toggle, Pull,
 * Clone), a bespoke "Remove" button per row and a rename PAGE; a ⋯ menu, an Undo snackbar and a sheet replace them. The
 * loading, error, not-found, server-render, background-refresh and remount-scrub cases are kept; the pull machine is
 * covered by `useCollectionPull.test.tsx` and its guard test.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SnackbarHost } from '@commise/ui/snackbar';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

import { makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';
import { renderWithSnackbar } from './__fixtures__/renderCollectionDetail';
import { makeRecipe } from './__fixtures__/recipeFixtures';

const { pushMock, useAuthMock, useUserProfileMock } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    useAuthMock: vi.fn(),
    useUserProfileMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('@clerk/nextjs', () => ({
    useAuth: useAuthMock,
}));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: useUserProfileMock,
}));

/** Build a profile-query stub carrying only the subscription tier the visibility gate reads. */
function profileWithTier(subscriptionTier: 'free' | 'premium') {
    return { data: { account: { subscriptionTier } } };
}

beforeEach(() => {
    // Signed-in viewer with a premium tier by default (so the premium gate is OPEN unless a test overrides it).
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_1' } });
    useUserProfileMock.mockReturnValue(profileWithTier('premium'));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** A fake client whose `getCollectionById` resolves to the given collection-with-recipes. */
function clientSeededWith(collection: ReturnType<typeof makeCollectionWithRecipes>): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection);

    return client;
}

/** A copy of another collection, with its source-provenance fields populated (drives the copy line and Pull updates). */
function makeClonedCollection(overrides: Partial<ReturnType<typeof makeCollectionWithRecipes>> = {}) {
    return makeCollectionWithRecipes({
        id: 'col_9',
        sourceCollectionId: 'col_src',
        sourceCollectionName: 'Origin dinners',
        sourceOwnerHandle: 'sourcechef',
        ...overrides,
    });
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(await screen.findByRole('button', { name: `More actions for ${name}` }));

    return within(await screen.findByRole('menu'));
};

describe('CollectionDetailContainer — states', () => {
    it('renders the loading state while the query is pending, with its label as the visible content', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

        renderWithSnackbar(<CollectionDetailContainer id="col_1" locale="en" />, client);

        const status = screen.getByRole('status', { name: 'Loading collection' });
        expect(status).toBeInTheDocument();
        // A status rendered EMPTY is zero-height and silent: the localized label must be the visible caption.
        expect(status).toHaveTextContent('Loading collection');
    });

    it('renders the collection with its member recipes, as links, when it loads', async () => {
        const client = clientSeededWith(makeCollectionWithRecipes({ name: 'Weeknight dinners' }));

        renderWithSnackbar(<CollectionDetailContainer id="col_1" locale="en" />, client);

        expect(await screen.findByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Weeknight Pasta' })).toHaveAttribute('href', '/en/recipes/rec_1');
        expect(screen.getByRole('link', { name: 'Sunday Roast' })).toBeInTheDocument();
        // The meta line and the list's own count both say it.
        expect(screen.getAllByText('2 recipes')).toHaveLength(2);
    });

    it('navigates to a recipe when a member card is selected', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes());

        renderWithSnackbar(<CollectionDetailContainer id="col_1" locale="en" />, client);
        await user.click(await screen.findByRole('link', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('goes back to the collections list', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes());

        renderWithSnackbar(<CollectionDetailContainer id="col_1" locale="en" />, client);
        await user.click(await screen.findByRole('link', { name: 'Back to Collections' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections');
    });

    it('renders a generic error with retry when the load fails', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const getCollectionSpy = vi.spyOn(client, 'getCollectionById').mockRejectedValue(new Error('network down'));

        renderWithSnackbar(<CollectionDetailContainer id="col_1" locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/couldn.t load this collection/i)).toBeInTheDocument();
        expect(getCollectionSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(getCollectionSpy).toHaveBeenCalledTimes(2));
    });

    it('renders a distinct not-found with no retry for a 404, and a way back to Collections', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(new NotFoundError());

        renderWithSnackbar(<CollectionDetailContainer id="missing" locale="en" />, client);

        expect(await screen.findByText(/couldn.t find that collection/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Back to Collections' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections');
    });

    it('reports a failure instead of spinning forever for an id that cannot be read (B21)', () => {
        const client = createFakeRecipeServiceClient();
        const getCollectionSpy = vi.spyOn(client, 'getCollectionById');

        renderWithSnackbar(<CollectionDetailContainer id="" locale="en" />, client);

        expect(getCollectionSpy).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        expect(screen.queryByText(/couldn.t find that collection/i)).not.toBeInTheDocument();
    });

    it('⛔ issues NO request during the server render', () => {
        const client = clientSeededWith(makeCollectionWithRecipes());

        const html = renderToString(
            <LocaleProvider locale="en">
                <QueryClientProvider client={new QueryClient()}>
                    <RecipeServiceProvider client={client}>
                        <SnackbarHost>
                            <CollectionDetailContainer id="col_1" locale="en" />
                        </SnackbarHost>
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>,
        );

        expect(html).toContain('Loading collection');
        expect(client.getCollectionById).not.toHaveBeenCalled();
    });

    it('⛔ keeps a loaded collection when a background refetch fails, says so, and a Try again that works clears it', async () => {
        const user = userEvent.setup();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_1', name: 'Weeknight dinners' }));

        renderWithSnackbar(<CollectionDetailContainer id="col_1" locale="en" />, client, { queryClient });
        await screen.findByRole('heading', { level: 1, name: 'Weeknight dinners' });

        vi.mocked(client.getCollectionById).mockRejectedValueOnce(new Error('network down'));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.collection('col_1') });
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(screen.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.queryByRole('alert', { name: /load/i })).not.toBeInTheDocument();
        expect(screen.getAllByText('We couldn’t refresh this collection.')).not.toHaveLength(0);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(screen.queryAllByText('We couldn’t refresh this collection.')).toHaveLength(0));
    });

    it('scrubs the previous collection’s sheets when the route moves to another collection', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockImplementation(async (collectionId) =>
            makeCollectionWithRecipes({
                id: collectionId,
                name: collectionId === 'col_a' ? 'Collection A' : 'Collection B',
            }),
        );

        const { rerender } = renderWithSnackbar(<CollectionDetailContainer id="col_a" locale="en" />, client);
        const menu = await openMenu(user, 'Collection A');
        await user.click(menu.getByRole('menuitem', { name: 'Delete collection' }));
        expect(await screen.findByRole('alertdialog', { name: 'Delete Collection A?' })).toBeInTheDocument();

        rerender(
            <SnackbarHost>
                <CollectionDetailContainer id="col_b" locale="en" />
            </SnackbarHost>,
        );

        expect(await screen.findByRole('heading', { level: 1, name: 'Collection B' })).toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
});

describe('CollectionDetailContainer — removing a member, with Undo', () => {
    async function removePasta(user: ReturnType<typeof userEvent.setup>) {
        await user.click(await screen.findByRole('button', { name: 'More actions for Weeknight Pasta' }));
        await user.click(
            within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove from collection' }),
        );
    }

    it('hides the row at once and says so, sending nothing yet', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await removePasta(user);

        await waitFor(() => expect(screen.queryByRole('link', { name: 'Weeknight Pasta' })).not.toBeInTheDocument());
        expect(screen.getByText('Removed Weeknight Pasta from Dinners.')).toBeInTheDocument();
        expect(screen.getAllByText('1 recipe')).toHaveLength(2);
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('brings the row back on Undo, and never sends the removal', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await removePasta(user);
        await user.click(await screen.findByRole('button', { name: 'Undo' }));

        expect(await screen.findByRole('link', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('sends the removal when the snackbar times out', async () => {
        const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await removePasta(user);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });

        expect(removeSpy).toHaveBeenCalledExactlyOnceWith('col_9', 'rec_1');
    });
});

describe('CollectionDetailContainer — visibility, with Undo and the Premium sheet', () => {
    it('makes a public collection private at once, says so, and Undo changes it back', async () => {
        const user = userEvent.setup();
        let server = 'public';
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockImplementation(async () =>
            makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners', visibility: server as 'public' | 'private' }),
        );
        const update = vi.spyOn(client, 'updateCollection').mockImplementation(async (_id, request) => {
            server = request.visibility ?? server;

            return makeCollectionWithRecipes();
        });

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Make private' }));

        expect(await screen.findByText('Collection is now private.')).toBeInTheDocument();
        await waitFor(() => expect(update).toHaveBeenCalledWith('col_9', { visibility: 'private' }));
        expect(screen.getByText('Private')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Undo' }));

        await waitFor(() => expect(update).toHaveBeenLastCalledWith('col_9', { visibility: 'public' }));
        expect(await screen.findByText('Public')).toBeInTheDocument();
    });

    it('opens the Premium sheet for a free-tier cook making a collection private, and sends nothing', async () => {
        const user = userEvent.setup();
        useUserProfileMock.mockReturnValue(profileWithTier('free'));
        const client = clientSeededWith(
            makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners', visibility: 'public' }),
        );
        const update = vi.spyOn(client, 'updateCollection');

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Make private' }));

        const sheet = await screen.findByRole('dialog', { name: 'Private collections are part of Premium.' });
        expect(within(sheet).getByRole('button', { name: 'See Premium' })).toBeInTheDocument();
        expect(update).not.toHaveBeenCalled();

        await user.click(within(sheet).getByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});

describe('CollectionDetailContainer — rename, delete and Save a copy', () => {
    it('renames in the sheet, which opens filled in, and closes when it is saved', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(
            makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners', description: 'Quick' }),
        );
        const update = vi.spyOn(client, 'updateCollection').mockResolvedValue(makeCollectionWithRecipes());

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Rename' }));
        const sheet = await screen.findByRole('dialog', { name: 'Rename collection' });
        const name = within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Name' });

        expect(name.value).toBe('Dinners');

        await user.clear(name);
        await user.type(name, 'Weeknights');
        await user.click(within(sheet).getByRole('button', { name: 'Save name' }));

        await waitFor(() => expect(update).toHaveBeenCalledWith('col_9', { name: 'Weeknights', description: 'Quick' }));
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Rename collection' })).not.toBeInTheDocument(),
        );
    });

    it('says a failed rename and keeps the sheet open', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));
        vi.spyOn(client, 'updateCollection').mockRejectedValue(new Error('nope'));

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Rename' }));
        await user.click(await screen.findByRole('button', { name: 'Save name' }));

        expect(await screen.findByText('We couldn’t rename the collection. Try again.')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Rename collection' })).toBeInTheDocument();
    });

    it('deletes after confirmation and navigates back to the list; Keep collection leaves it alone', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));
        const deleteSpy = vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Delete collection' }));
        await user.click(await screen.findByRole('button', { name: 'Keep collection' }));

        expect(deleteSpy).not.toHaveBeenCalled();

        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Delete collection' }));
        expect(await screen.findByText('The 2 recipes stay in your library.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Delete collection' }));

        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/collections'));
        expect(deleteSpy).toHaveBeenCalledWith('col_9');
    });

    it('says a failed delete in the dialog, which stays open', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));
        vi.spyOn(client, 'deleteCollection').mockRejectedValue(new Error('nope'));

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Delete collection' }));
        await user.click(await screen.findByRole('button', { name: 'Delete collection' }));

        expect(await screen.findByText('We couldn’t delete this collection. Try again.')).toBeInTheDocument();
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('saves a copy of the collection and opens the copy', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));
        const cloneSpy = vi
            .spyOn(client, 'cloneCollection')
            .mockResolvedValue(makeCollectionWithRecipes({ id: 'col_copy' }));

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Save a copy' }));

        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/collections/col_copy'));
        expect(cloneSpy).toHaveBeenCalledWith('col_9', undefined);
    });

    it('says a failed copy', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));
        vi.spyOn(client, 'cloneCollection').mockRejectedValue(new Error('nope'));

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Save a copy' }));

        expect(await screen.findByText('We couldn’t save a copy of this collection. Try again.')).toBeInTheDocument();
    });

    it('offers Pull updates for a copy only, and opens the preview', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeClonedCollection({ name: 'Dinners' }));
        const preview = vi
            .spyOn(client, 'previewPullFromSource')
            .mockResolvedValue({ added: ['rec_new'], removed: [], unchanged: ['rec_1'] });

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click((await openMenu(user, 'Dinners')).getByRole('menuitem', { name: 'Pull updates' }));

        expect(await screen.findByRole('heading', { name: 'Pull Updates from Source Collection' })).toBeInTheDocument();
        expect(preview).toHaveBeenCalledWith('col_9');
        expect(screen.getByText('Copied from @sourcechef')).toBeInTheDocument();
    });

    it('draws no Pull updates for an original collection', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners' }));

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);

        expect((await openMenu(user, 'Dinners')).queryByRole('menuitem', { name: 'Pull updates' })).toBeNull();
    });

    it('opens the original from “Copied from …”', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeClonedCollection());

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click(await screen.findByRole('button', { name: 'Copied from @sourcechef' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/col_src');
    });
});

describe('CollectionDetailContainer — the add-recipes picker', () => {
    const library = [
        makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
        makeRecipe({ id: 'rec_3', title: 'Tomato Soup' }),
    ];

    function pickerClient() {
        // A server that remembers who is in the collection, so the refetch after the last toggle agrees with the cache.
        const members = [
            { ...makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }), addedVia: 'manual' as const },
            { ...makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }), addedVia: 'manual' as const },
        ];
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockImplementation(async () =>
            makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners', recipes: [...members] }),
        );
        vi.spyOn(client, 'addRecipeToCollection').mockImplementation(async (_id, recipeId) => {
            const added = library.find((recipe) => recipe.id === recipeId);

            if (added !== undefined) {
                members.push({ ...added, addedVia: 'manual' });
            }

            return { collectionId: 'col_9', recipeId, addedVia: 'manual', createdAt: 'x' };
        });
        vi.spyOn(client, 'removeRecipeFromCollection').mockImplementation(async (_id, recipeId) => {
            members.splice(
                members.findIndex((member) => member.id === recipeId),
                1,
            );
        });
        vi.spyOn(client, 'listRecipes').mockResolvedValue({
            data: library,
            total: library.length,
            page: 1,
            pageSize: 100,
            hasMore: false,
        });

        return client;
    }

    it('opens a sheet "Add to Dinners" with the cook’s recipes, the members already checked', async () => {
        const user = userEvent.setup();
        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, pickerClient());

        await user.click(await screen.findByRole('button', { name: 'Add recipes' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add to Dinners' });

        expect(await within(sheet).findByRole('checkbox', { name: 'Weeknight Pasta' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        expect(within(sheet).getByRole('checkbox', { name: 'Tomato Soup' })).toHaveAttribute('aria-checked', 'false');
    });

    it('saves a toggle at once, announces it, and Done says what changed', async () => {
        const user = userEvent.setup();
        const client = pickerClient();
        const add = vi.mocked(client.addRecipeToCollection);

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click(await screen.findByRole('button', { name: 'Add recipes' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add to Dinners' });

        await user.click(await within(sheet).findByRole('checkbox', { name: 'Tomato Soup' }));

        await waitFor(() => expect(add).toHaveBeenCalledWith('col_9', 'rec_3'));
        expect(within(sheet).getByRole('checkbox', { name: 'Tomato Soup' })).toHaveAttribute('aria-checked', 'true');
        expect(within(sheet).getByRole('button', { name: 'Done · 1 added' })).toBeInTheDocument();
        expect(
            within(sheet)
                .getAllByRole('status')
                .some((node) => node.textContent === 'Added Tomato Soup'),
        ).toBe(true);
    });

    it('flips a refused toggle back and says so', async () => {
        const user = userEvent.setup();
        const client = pickerClient();
        vi.mocked(client.addRecipeToCollection).mockRejectedValue(new Error('nope'));

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click(await screen.findByRole('button', { name: 'Add recipes' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add to Dinners' });
        await user.click(await within(sheet).findByRole('checkbox', { name: 'Tomato Soup' }));

        expect(await within(sheet).findByText('Couldn’t add Tomato Soup. Try again.')).toBeInTheDocument();
        expect(within(sheet).getByRole('checkbox', { name: 'Tomato Soup' })).toHaveAttribute('aria-checked', 'false');
        expect(within(sheet).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('reads add → remove as no change on Done', async () => {
        const user = userEvent.setup();
        const client = pickerClient();

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);
        await user.click(await screen.findByRole('button', { name: 'Add recipes' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add to Dinners' });
        const soup = await within(sheet).findByRole('checkbox', { name: 'Tomato Soup' });

        await user.click(soup);
        await user.click(soup);

        await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Done' })).toBeInTheDocument());
    });

    it('narrows the rows by the search, and Done closes the sheet', async () => {
        const user = userEvent.setup();
        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, pickerClient());

        await user.click(await screen.findByRole('button', { name: 'Add recipes' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add to Dinners' });
        await within(sheet).findByRole('checkbox', { name: 'Tomato Soup' });
        await user.type(within(sheet).getByRole('searchbox', { name: 'Search your recipes' }), 'soup');

        expect(within(sheet).queryByRole('checkbox', { name: 'Weeknight Pasta' })).toBeNull();

        await user.click(within(sheet).getByRole('button', { name: 'Done' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add to Dinners' })).not.toBeInTheDocument());
    });
});

describe('CollectionDetailContainer — an empty collection', () => {
    it('says so, and Add recipes opens the picker', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', name: 'Dinners', recipes: [] }));
        vi.spyOn(client, 'listRecipes').mockResolvedValue({
            data: [],
            total: 0,
            page: 1,
            pageSize: 100,
            hasMore: false,
        });

        renderWithSnackbar(<CollectionDetailContainer id="col_9" locale="en" />, client);

        expect(await screen.findByRole('heading', { level: 2, name: 'No recipes here yet' })).toBeInTheDocument();

        await user.click(screen.getAllByRole('button', { name: 'Add recipes' })[1] as HTMLElement);

        expect(await screen.findByRole('dialog', { name: 'Add to Dinners' })).toBeInTheDocument();
        expect(await screen.findByText('You have no recipes yet.')).toBeInTheDocument();
    });
});
