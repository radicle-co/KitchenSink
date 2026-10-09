/**
 * Component tests for the mobile CollectionDetailScreen (react-native-web under jsdom; slice 5 of the UI overhaul,
 * `docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3). Covers every state the screen renders — loading, ready, generic error
 * (with retry), a distinct not-found — and the wired flows: a removal that hides the row and commits when its Undo snackbar
 * times out; a visibility change at once, with Undo, and the Premium sheet; rename in the sheet; delete in its dialog;
 * Save a copy; Pull updates for a copy; and the add-recipes picker, whose toggles save at once and whose Done says what
 * changed.
 *
 * ⚠️ REWRITTEN for slice 5. The screen used to wire a sidebar of actions (a Save-changes visibility toggle, Pull, Clone), a
 * bespoke Remove button per row and a rename ROUTE, with the mutation hooks stubbed; a ⋯ menu, an Undo snackbar and sheets
 * replace them. Every mutation is now the REAL hook over a network-guarded fake `RecipeServiceClient`
 * (`createFakeRecipeServiceClient`), stubbed per test with type-checked `vi.spyOn(client, '<method>')`, so a test sees the
 * request that would have left the device. The pull machine's invariants (preview, commit, drift, never a blind commit) are
 * covered by `useCollectionPull.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';

import { renderWithRecipeClient } from '@commise/test-utils';
import { SnackbarHost } from '@commise/ui/snackbar';
import {
    NotFoundError,
    type CollectionWithRecipes,
    type RecipeServiceClient,
} from '@kitchensink/recipe-service-client';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { CollectionDetailScreen } from '../../src/screens/CollectionDetailScreen.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { makeCollectionWithRecipes, makeRecipe } from '../__fixtures__/recipes.js';

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

// The list/grid choice reads `AsyncStorage`; this file is not about it, so the stored choice is "none".
vi.mock('../../src/hooks/useStoredViewMode.js', () => ({
    useStoredViewMode: () => ['list', vi.fn()],
}));

// The screen starts the deferred calorie batch (ADR-0021 §6) through this shared hook. This file is not about nutrition,
// so the lookup is stubbed to "no batch covers this recipe". The wiring is covered by `screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

const useUserProfileMock = vi.mocked(useUserProfile);

/** The fake client the current test renders against. */
let client: RecipeServiceClient;

/** A `useUserProfile` double exposing only the tier the premium gate reads. */
function profile(tier: 'free' | 'premium' = 'premium'): ReturnType<typeof useUserProfile> {
    return {
        data: { user: { id: 'usr_1' }, account: { subscriptionTier: tier } },
        isLoading: false,
    } as unknown as ReturnType<typeof useUserProfile>;
}

/** Serve `collection` from the fake client for the rest of this test. */
function seed(collection: CollectionWithRecipes): void {
    vi.spyOn(client, 'getCollectionById').mockImplementation(async () => collection);
}

/** Render `ui` over the fake client, inside the one `SnackbarHost` the app mounts. */
function renderOver(ui: ReactElement, queryClient?: QueryClient) {
    return renderWithRecipeClient(
        <SnackbarHost>{ui}</SnackbarHost>,
        client,
        queryClient === undefined ? undefined : { queryClient },
    );
}

const props = {
    collectionId: 'col_1',
    onSelectRecipe: vi.fn(),
    onCreateRecipe: vi.fn(),
    onDeleted: vi.fn(),
    onCloned: vi.fn(),
    onViewSource: vi.fn(),
    onBack: vi.fn(),
};

/** The ⋯ menu of the collection, opened. */
function openMenu(name: string) {
    fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));

    return screen.getAllByRole('menuitem');
}

/** Press one item of the ⋯ menu. */
function pressMenuItem(menuName: string, itemName: string): void {
    openMenu(menuName);
    fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

/** A copy of another collection, with the source-provenance fields the read adds (they are not on the stored row). */
function makeCopyOfCollection(): CollectionWithRecipes {
    return {
        ...makeCollectionWithRecipes([], { id: 'col_1', name: 'Dinners', sourceCollectionId: 'col_src' }),
        sourceCollectionName: 'Origin dinners',
        sourceOwnerHandle: 'sourcechef',
    };
}

const tacos = makeRecipe({ id: 'rec_2', title: 'Fish Tacos' });
const pasta = makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' });

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.clearAllMocks();
    client = createFakeRecipeServiceClient();
    seed(makeCollectionWithRecipes([pasta, tacos], { id: 'col_1', name: 'Weeknight favourites' }));
    useUserProfileMock.mockReturnValue(profile('premium'));
    // react-native-web reports a screen reader as ON, which holds a snackbar open (SC 2.2.1); the timeout test needs it off.
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

describe('CollectionDetailScreen — loading and error', () => {
    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

        renderOver(<CollectionDetailScreen {...props} />);

        const label = mobileMessages.en.collections.detailLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('shows an alert with a retry and a way back when the collection fails to load', async () => {
        const onBack = vi.fn();
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(new Error('network down'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} onBack={onBack} />);

        expect((await screen.findByRole('alert')).textContent).toBe(mobileMessages.en.collections.detailError);
        expect(screen.getByRole('button', { name: mobileMessages.en.collections.detailRetry })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.collections.back }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('⛔ Try again REFETCHES and the collection renders', async () => {
        const collection = makeCollectionWithRecipes([], { id: 'col_1', name: 'Weeknight favourites' });
        const read = vi
            .spyOn(client, 'getCollectionById')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce(collection);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        fireEvent.click(await screen.findByRole('button', { name: mobileMessages.en.collections.detailRetry }));

        expect(await screen.findByRole('heading', { name: 'Weeknight favourites' })).toBeTruthy();
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('says the collection is not there — with no retry, and a way back — for a 404', async () => {
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(new NotFoundError());
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);

        expect((await screen.findByRole('alert')).textContent).toBe(mobileMessages.en.collections.detailNotFound);
        expect(screen.queryByRole('button', { name: mobileMessages.en.collections.detailRetry })).toBeNull();
        expect(screen.getByRole('button', { name: mobileMessages.en.collections.back })).toBeTruthy();
    });

    it('⛔ keeps a loaded collection when a background refetch fails, says so, and a Try again that works clears it', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        renderOver(<CollectionDetailScreen {...props} />, queryClient);
        await screen.findByRole('heading', { name: 'Weeknight favourites' });
        const getCollection = vi.mocked(client.getCollectionById).mockRejectedValueOnce(new Error('network down'));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.collection('col_1') });
        });
        // TanStack batches observer notifications onto a timer; let that batch reach React before asserting absence.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(screen.getByRole('heading', { name: 'Weeknight favourites' })).toBeTruthy();
        expect(screen.queryByRole('alert', { name: /load/i })).toBeNull();
        expect(screen.getAllByText('We couldn’t refresh this collection.').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(screen.queryAllByText('We couldn’t refresh this collection.')).toHaveLength(0));
        expect(getCollection).toHaveBeenCalledTimes(3);
    });

    it('scrubs the previous collection’s sheets when the screen moves to another collection', async () => {
        vi.spyOn(client, 'getCollectionById').mockImplementation(async (collectionId) =>
            makeCollectionWithRecipes([], {
                id: collectionId,
                name: collectionId === 'col_a' ? 'Collection A' : 'Collection B',
            }),
        );

        const { rerender } = renderOver(<CollectionDetailScreen {...props} collectionId="col_a" />);
        await screen.findByRole('heading', { name: 'Collection A' });
        pressMenuItem('Collection A', 'Delete collection');
        expect(await screen.findByText('Delete Collection A?')).toBeTruthy();

        rerender(
            <SnackbarHost>
                <CollectionDetailScreen {...props} collectionId="col_b" />
            </SnackbarHost>,
        );

        expect(await screen.findByRole('heading', { name: 'Collection B' })).toBeTruthy();
        expect(screen.queryByText('Delete Collection A?')).toBeNull();
    });
});

describe('CollectionDetailScreen — populated', () => {
    it('renders the members as links and forwards a selected one upward', async () => {
        const onSelectRecipe = vi.fn();

        renderOver(<CollectionDetailScreen {...props} onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(await screen.findByRole('link', { name: 'Fish Tacos' }));

        expect(screen.getByRole('link', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('keeps its content off the screen edges, by the gutter the Collections list keeps (16 pt)', async () => {
        renderOver(<CollectionDetailScreen {...props} />);
        const heading = await screen.findByRole('heading', { name: 'Weeknight favourites' });

        // Measured on the API 34 emulator: the title, the meta line and Add recipes all started at x = 0.
        const gutters: string[] = [];

        for (let node = heading.parentElement; node !== null; node = node.parentElement) {
            gutters.push(getComputedStyle(node).paddingLeft);
        }

        expect(gutters).toContain('16px');
    });

    it('goes back from the header', async () => {
        const onBack = vi.fn();

        renderOver(<CollectionDetailScreen {...props} onBack={onBack} />);
        await screen.findByRole('heading', { name: 'Weeknight favourites' });
        fireEvent.click(screen.getByRole('button', { name: /^Back to/ }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('opens the original from “Copied from …”', async () => {
        seed(makeCopyOfCollection());
        const onViewSource = vi.fn();

        renderOver(<CollectionDetailScreen {...props} onViewSource={onViewSource} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Copied from @sourcechef' }));

        expect(onViewSource).toHaveBeenCalledWith('col_src');
    });
});

describe('CollectionDetailScreen — removing a member, with Undo', () => {
    async function removeTacos(): Promise<void> {
        await screen.findByRole('link', { name: 'Fish Tacos' });
        pressMenuItem('Fish Tacos', 'Remove from collection');
    }

    it('hides the row at once and says so, sending nothing yet', async () => {
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        await removeTacos();

        await waitFor(() => expect(screen.queryByRole('link', { name: 'Fish Tacos' })).toBeNull());
        expect(screen.getByText('Removed Fish Tacos from Weeknight favourites.')).toBeTruthy();
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('brings the row back on Undo, and never sends the removal', async () => {
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        await removeTacos();
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

        expect(await screen.findByRole('link', { name: 'Fish Tacos' })).toBeTruthy();
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('sends the removal when the snackbar times out', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        await removeTacos();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });

        await vi.waitFor(() => expect(removeSpy).toHaveBeenCalledExactlyOnceWith('col_1', 'rec_2'));
    });
});

describe('CollectionDetailScreen — visibility, with Undo and the Premium sheet', () => {
    it('makes a public collection private at once, says so, and Undo changes it back', async () => {
        let server: 'public' | 'private' = 'public';
        vi.spyOn(client, 'getCollectionById').mockImplementation(async () =>
            makeCollectionWithRecipes([], { id: 'col_1', name: 'Dinners', visibility: server }),
        );
        const update = vi.spyOn(client, 'updateCollection').mockImplementation(async (_id, request) => {
            server = request.visibility ?? server;

            return makeCollectionWithRecipes([]);
        });

        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Make private');

        expect(await screen.findByText('Collection is now private.')).toBeTruthy();
        await waitFor(() => expect(update).toHaveBeenCalledWith('col_1', { visibility: 'private' }));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await waitFor(() => expect(update).toHaveBeenLastCalledWith('col_1', { visibility: 'public' }));
    });

    it('opens the Premium sheet for a free-tier cook making a collection private, and sends nothing', async () => {
        useUserProfileMock.mockReturnValue(profile('free'));
        seed(makeCollectionWithRecipes([], { id: 'col_1', name: 'Dinners', visibility: 'public' }));
        const update = vi.spyOn(client, 'updateCollection');

        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Make private');

        expect(await screen.findByText('Private collections are part of Premium.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'See Premium' })).toBeTruthy();
        expect(update).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(screen.queryByText('Private collections are part of Premium.')).toBeNull());
    });
});

describe('CollectionDetailScreen — rename, delete and Save a copy', () => {
    beforeEach(() => {
        seed(makeCollectionWithRecipes([pasta, tacos], { id: 'col_1', name: 'Dinners', description: 'Quick' }));
    });

    it('renames in the sheet, which opens filled in, and closes when it is saved', async () => {
        const update = vi.spyOn(client, 'updateCollection').mockResolvedValue(makeCollectionWithRecipes([]));

        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Rename');
        const name = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Name' });

        expect(name.value).toBe('Dinners');

        fireEvent.change(name, { target: { value: 'Weeknights' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

        await waitFor(() => expect(update).toHaveBeenCalledWith('col_1', { name: 'Weeknights', description: 'Quick' }));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull());
    });

    it('says a failed rename and keeps the sheet open', async () => {
        vi.spyOn(client, 'updateCollection').mockRejectedValue(new Error('nope'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Rename');
        fireEvent.click(await screen.findByRole('button', { name: 'Save name' }));

        expect(await screen.findByText('We couldn’t rename the collection. Try again.')).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    });

    it('deletes after confirmation and leaves; Keep collection leaves it alone', async () => {
        const deleteSpy = vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);
        const onDeleted = vi.fn();

        renderOver(<CollectionDetailScreen {...props} onDeleted={onDeleted} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Delete collection');
        fireEvent.click(await screen.findByRole('button', { name: 'Keep collection' }));

        expect(deleteSpy).not.toHaveBeenCalled();

        pressMenuItem('Dinners', 'Delete collection');
        expect(await screen.findByText('The 2 recipes stay in your library.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Delete collection' }));

        await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
        expect(deleteSpy).toHaveBeenCalledWith('col_1');
    });

    it('says a failed delete in the dialog, which stays open', async () => {
        vi.spyOn(client, 'deleteCollection').mockRejectedValue(new Error('nope'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onDeleted = vi.fn();

        renderOver(<CollectionDetailScreen {...props} onDeleted={onDeleted} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Delete collection');
        fireEvent.click(await screen.findByRole('button', { name: 'Delete collection' }));

        expect(await screen.findByText('We couldn’t delete this collection. Try again.')).toBeTruthy();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it('saves a copy of the collection and opens the copy', async () => {
        const cloneSpy = vi
            .spyOn(client, 'cloneCollection')
            .mockResolvedValue(makeCollectionWithRecipes([], { id: 'col_copy' }));
        const onCloned = vi.fn();

        renderOver(<CollectionDetailScreen {...props} onCloned={onCloned} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Save a copy');

        await waitFor(() => expect(onCloned).toHaveBeenCalledWith('col_copy'));
        expect(cloneSpy).toHaveBeenCalledWith('col_1', undefined);
    });

    it('says a failed copy', async () => {
        vi.spyOn(client, 'cloneCollection').mockRejectedValue(new Error('nope'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Save a copy');

        expect(await screen.findByText('We couldn’t save a copy of this collection. Try again.')).toBeTruthy();
    });

    it('offers Pull updates for a copy only, and opens the preview', async () => {
        seed(makeCopyOfCollection());
        const preview = vi
            .spyOn(client, 'previewPullFromSource')
            .mockResolvedValue({ added: ['rec_new'], removed: [], unchanged: ['rec_1'] });

        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        pressMenuItem('Dinners', 'Pull updates');

        expect(await screen.findByText('Pull Updates from Source Collection')).toBeTruthy();
        expect(preview).toHaveBeenCalledWith('col_1');
    });

    it('draws no Pull updates for an original collection', async () => {
        renderOver(<CollectionDetailScreen {...props} />);
        await screen.findByRole('heading', { name: 'Dinners' });
        openMenu('Dinners');

        expect(screen.queryByRole('menuitem', { name: 'Pull updates' })).toBeNull();
    });
});

describe('CollectionDetailScreen — the add-recipes picker', () => {
    const soup = makeRecipe({ id: 'rec_3', title: 'Tomato Soup' });
    const library = [pasta, soup];

    /** A server that remembers who is in the collection, so the refetch after the last toggle agrees with the cache. */
    function serveLibrary(): void {
        const members = [
            { ...pasta, addedVia: 'manual' as const },
            { ...tacos, addedVia: 'manual' as const },
        ];
        vi.spyOn(client, 'getCollectionById').mockImplementation(async () =>
            makeCollectionWithRecipes([...members], { id: 'col_1', name: 'Dinners' }),
        );
        vi.spyOn(client, 'addRecipeToCollection').mockImplementation(async (_id, recipeId) => {
            const added = library.find((recipe) => recipe.id === recipeId);

            if (added !== undefined) {
                members.push({ ...added, addedVia: 'manual' });
            }

            return { collectionId: 'col_1', recipeId, addedVia: 'manual', createdAt: 'x' };
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
    }

    async function openPicker(): Promise<void> {
        await screen.findByRole('heading', { name: 'Dinners' });
        fireEvent.click(screen.getAllByRole('button', { name: 'Add recipes' })[0] as HTMLElement);
        await screen.findByText('Add to Dinners');
    }

    beforeEach(serveLibrary);

    it('opens a sheet "Add to Dinners" with the cook’s recipes, the members already checked', async () => {
        renderOver(<CollectionDetailScreen {...props} />);
        await openPicker();

        const pastaRow = await screen.findByRole('checkbox', { name: 'Weeknight Pasta' });
        expect(pastaRow.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: 'Tomato Soup' }).getAttribute('aria-checked')).toBe('false');
    });

    it('saves a toggle at once, announces it, and Done says what changed', async () => {
        renderOver(<CollectionDetailScreen {...props} />);
        await openPicker();

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Tomato Soup' }));

        await waitFor(() => expect(client.addRecipeToCollection).toHaveBeenCalledWith('col_1', 'rec_3'));
        expect(screen.getByRole('checkbox', { name: 'Tomato Soup' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('button', { name: 'Done · 1 added' })).toBeTruthy();
        expect(screen.getByText('Added Tomato Soup')).toBeTruthy();
    });

    it('flips a refused toggle back and says so', async () => {
        vi.mocked(client.addRecipeToCollection).mockRejectedValue(new Error('nope'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        await openPicker();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Tomato Soup' }));

        expect(await screen.findByText('Couldn’t add Tomato Soup. Try again.')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Tomato Soup' }).getAttribute('aria-checked')).toBe('false');
        expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    });

    it('narrows the rows by the search, and Done closes the sheet', async () => {
        renderOver(<CollectionDetailScreen {...props} />);
        await openPicker();
        await screen.findByRole('checkbox', { name: 'Tomato Soup' });
        fireEvent.change(screen.getByLabelText('Search your recipes'), { target: { value: 'soup' } });

        expect(screen.queryByRole('checkbox', { name: 'Weeknight Pasta' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        await waitFor(() => expect(screen.queryByText('Add to Dinners')).toBeNull());
    });
});

describe('CollectionDetailScreen — an empty collection', () => {
    it('says so, and Add recipes opens the picker', async () => {
        seed(makeCollectionWithRecipes([], { id: 'col_1', name: 'Dinners' }));
        vi.spyOn(client, 'listRecipes').mockResolvedValue({
            data: [],
            total: 0,
            page: 1,
            pageSize: 100,
            hasMore: false,
        });

        renderOver(<CollectionDetailScreen {...props} />);

        expect(await screen.findByRole('heading', { name: 'No recipes here yet' })).toBeTruthy();

        fireEvent.click(screen.getAllByRole('button', { name: 'Add recipes' })[1] as HTMLElement);

        expect(await screen.findByText('Add to Dinners')).toBeTruthy();
        expect(await screen.findByText('You have no recipes yet.')).toBeTruthy();
    });
});
