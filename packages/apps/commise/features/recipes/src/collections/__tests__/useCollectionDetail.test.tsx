/**
 * `useCollectionDetail` — the ONE collection-detail session web's `CollectionDetailContainer` and mobile's
 * `CollectionDetailScreen` sit on. Written FIRST, from the two rules the copies disagreed on:
 *
 * - DELETE: the confirm dialog closes, THEN the app leaves, exactly once (mobile's Android crash fix; web used to
 *   navigate from the mutation's own `onSuccess` with the dialog still mounted);
 * - "Add a recipe" from the empty picker: the picker closes, THEN the app opens the editor (web used to navigate with
 *   the picker still open).
 *
 * `@kitchensink/recipe-service-client/hooks` runs for real over a fake, network-guarded client stubbed per test.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PaidFeatureState } from '@commise/features-account';

import { useCollectionDetail, type CollectionDetail, type CollectionDetailNav } from '../useCollectionDetail.js';

afterEach(() => {
    vi.restoreAllMocks();
});

const collectionOf = (overrides: Partial<CollectionWithRecipes> = {}): CollectionWithRecipes => ({
    id: 'col_1',
    ownerId: 'usr_1',
    name: 'Dinners',
    visibility: RecipeVisibility.PUBLIC,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: [],
    ...overrides,
});

function setup(
    options: { readonly paidFeatures?: PaidFeatureState; readonly collection?: CollectionWithRecipes } = {},
) {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue(options.collection ?? collectionOf());
    const nav: CollectionDetailNav = { onDeleted: vi.fn(), onCloned: vi.fn(), onCreateRecipe: vi.fn() };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>{children}</SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    // The latest RENDER's value: an effect that fires during a commit sees this, while `result.current` is only updated
    // after the effects of that commit have run.
    let rendered: CollectionDetail | undefined;

    const latest = (): CollectionDetail => {
        if (rendered === undefined) {
            throw new Error('The hook has not rendered.');
        }

        return rendered;
    };

    // The host passes a FRESH `nav` object every render, as both apps' inline closures do.
    const view = renderHook(
        () =>
            (rendered = useCollectionDetail({
                collection: options.collection ?? collectionOf(),
                refreshNotice: undefined,
                paidFeatures: options.paidFeatures ?? 'granted',
                viewChoice: undefined,
                onViewChoice: vi.fn(),
                nav: {
                    onDeleted: () => nav.onDeleted(),
                    onCloned: (id) => nav.onCloned(id),
                    onCreateRecipe: () => nav.onCreateRecipe(),
                },
            })),
        { wrapper },
    );

    return { client, nav, latest, ...view };
}

describe('useCollectionDetail — delete', () => {
    it('confirms by deleting the collection, closing the dialog, and only THEN leaving', async () => {
        const { client, nav, result, latest } = setup();
        const deleteSpy = vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);
        const dialogOpenWhenLeaving: boolean[] = [];
        vi.mocked(nav.onDeleted).mockImplementation(() => {
            dialogOpenWhenLeaving.push(latest().deletion.open);
        });

        act(() => result.current.deletion.onStart());
        expect(result.current.deletion.open).toBe(true);
        act(() => result.current.deletion.onConfirm());

        await waitFor(() => expect(nav.onDeleted).toHaveBeenCalledTimes(1));
        expect(deleteSpy).toHaveBeenCalledWith('col_1');
        expect(dialogOpenWhenLeaving).toEqual([false]);
        expect(result.current.deletion.open).toBe(false);
    });

    it('leaves exactly once however often the host re-renders after the delete', async () => {
        const { client, nav, result, rerender } = setup();
        vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        act(() => result.current.deletion.onStart());
        act(() => result.current.deletion.onConfirm());
        await waitFor(() => expect(nav.onDeleted).toHaveBeenCalledTimes(1));
        rerender();
        rerender();

        expect(nav.onDeleted).toHaveBeenCalledTimes(1);
    });

    it('Keep collection closes the dialog and neither deletes nor leaves', () => {
        const { client, nav, result } = setup();
        const deleteSpy = vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        act(() => result.current.deletion.onStart());
        act(() => result.current.deletion.onKeep());

        expect(result.current.deletion.open).toBe(false);
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(nav.onDeleted).not.toHaveBeenCalled();
    });

    it('a refused delete keeps the dialog open, says so, and does not leave', async () => {
        const { client, nav, result } = setup();
        vi.spyOn(client, 'deleteCollection').mockRejectedValue(new Error('nope'));

        act(() => result.current.deletion.onStart());
        act(() => result.current.deletion.onConfirm());

        await waitFor(() => expect(result.current.deletion.failed).toBe(true));
        expect(result.current.deletion.open).toBe(true);
        expect(nav.onDeleted).not.toHaveBeenCalled();
    });

    it('opening the dialog again clears a previous failure', async () => {
        const { client, result } = setup();
        vi.spyOn(client, 'deleteCollection').mockRejectedValue(new Error('nope'));

        act(() => result.current.deletion.onStart());
        act(() => result.current.deletion.onConfirm());
        await waitFor(() => expect(result.current.deletion.failed).toBe(true));
        act(() => result.current.deletion.onKeep());
        act(() => result.current.deletion.onStart());

        expect(result.current.deletion.failed).toBe(false);
    });
});

describe('useCollectionDetail — the add-recipes picker', () => {
    it('opens with a clean search and remembers the members it opened over', () => {
        const recipe = { id: 'rec_1', title: 'Pasta' } as CollectionWithRecipes['recipes'][number];
        const { result } = setup({ collection: collectionOf({ recipes: [recipe] }) });

        act(() => result.current.picker.onQueryChange('soup'));
        act(() => result.current.picker.onOpen());

        expect(result.current.picker.open).toBe(true);
        expect(result.current.picker.query).toBe('');
        expect(result.current.picker.summary).toEqual({ added: 0, removed: 0 });
    });

    it('"Add a recipe" closes the picker, THEN opens the editor, once', async () => {
        const { nav, result, rerender, latest } = setup();
        const pickerOpenWhenLeaving: boolean[] = [];
        vi.mocked(nav.onCreateRecipe).mockImplementation(() => {
            pickerOpenWhenLeaving.push(latest().picker.open);
        });

        act(() => result.current.picker.onOpen());
        act(() => result.current.picker.onCreateRecipe());

        await waitFor(() => expect(nav.onCreateRecipe).toHaveBeenCalledTimes(1));
        rerender();
        expect(nav.onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(pickerOpenWhenLeaving).toEqual([false]);
        expect(result.current.picker.open).toBe(false);
    });

    it('reopening and merely closing the picker afterwards does not open the editor again', async () => {
        const { nav, result } = setup();

        act(() => result.current.picker.onOpen());
        act(() => result.current.picker.onCreateRecipe());
        await waitFor(() => expect(nav.onCreateRecipe).toHaveBeenCalledTimes(1));
        act(() => result.current.picker.onOpen());
        act(() => result.current.picker.onClose());

        expect(nav.onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('useCollectionDetail — save a copy, rename and visibility', () => {
    it('Save a copy sends the clone and hands the new id to the app', async () => {
        const { client, nav, result } = setup();
        vi.spyOn(client, 'cloneCollection').mockResolvedValue(collectionOf({ id: 'col_copy' }));

        act(() => result.current.saveCopy.onSave());

        await waitFor(() => expect(nav.onCloned).toHaveBeenCalledWith('col_copy'));
    });

    it('a refused copy is said, and nothing opens', async () => {
        const { client, nav, result } = setup();
        vi.spyOn(client, 'cloneCollection').mockRejectedValue(new Error('nope'));

        act(() => result.current.saveCopy.onSave());

        await waitFor(() => expect(result.current.saveCopy.failed).toBe(true));
        expect(nav.onCloned).not.toHaveBeenCalled();
    });

    it('rename sends the new name and closes its sheet when it is saved', async () => {
        const { client, result } = setup();
        const update = vi.spyOn(client, 'updateCollection').mockResolvedValue(collectionOf({ name: 'Suppers' }));

        act(() => result.current.rename.onStart());
        expect(result.current.rename.open).toBe(true);
        act(() => result.current.rename.onSubmit({ name: 'Suppers' }));

        await waitFor(() => expect(result.current.rename.open).toBe(false));
        expect(update).toHaveBeenCalledWith('col_1', { name: 'Suppers' });
    });

    it('offers the visibility toggle only when the viewer may use it', () => {
        expect(setup({ paidFeatures: 'granted' }).result.current.onToggleVisibility).toBeTypeOf('function');
        expect(setup({ paidFeatures: 'hidden' }).result.current.onToggleVisibility).toBeUndefined();
    });
});
