/**
 * Component tests for the mobile RecipeEditScreen (react-native-web under jsdom). The screen loads the recipe
 * via (mocked) `useRecipe`, seeds the editor from it, and wires submit to (mocked) `useUpdateRecipe`, carrying
 * the loaded `currentVersion` as `expectedVersion`. Covers loading, error, the seeded ready state, the save
 * path, and — the concurrent-edit conflict resolution (T070) — entering conflict mode on a 409, keep-mine
 * re-submitting against the server's fresh version (with a repeat-conflict staying in conflict mode), and
 * use-theirs discarding the draft by reseeding the editor. Conflict resolution mirrors the web container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { RecipeDetail } from '@kitchensink/recipe-core';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import {
    useConfirmPhotoUpload,
    useCreateIngredient,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipe,
    useRecipePhotos,
    useSearchIngredients,
    useUpdateRecipe,
} from '@kitchensink/recipe-service-client/hooks';

import type { UseRecipeEditorResult } from '@commise/features-recipes/hooks';

import { RecipeEditScreen } from '../../src/screens/RecipeEditScreen.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

const { useRecipeEditorMock } = vi.hoisted(() => ({ useRecipeEditorMock: vi.fn() }));

// Partial mock: every OTHER export (`usePollIngredientStatus`, `useRecipePhotoUpload`, `useIngredientResolver`)
// stays the REAL implementation — the picker/poller/uploader children this screen renders depend on them.
// `useRecipeEditor` itself defaults to delegating to the REAL hook too (still exercised end-to-end against the
// mocked `useRecipe`/`useUpdateRecipe` below, for every existing test); only the seed-gap regression test
// overrides it with `mockReturnValueOnce`, to construct — deterministically, without racing React's effect
// flush — the exact `query.isLoading: false` + `state.status: 'loading'` combination a committed render can
// land on between a successful query and the hook's (real, synchronous-in-tests) seed-once effect.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/features-recipes/hooks')>();
    useRecipeEditorMock.mockImplementation(actual.useRecipeEditor);

    return { ...actual, useRecipeEditor: useRecipeEditorMock };
});

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: vi.fn(),
    useUpdateRecipe: vi.fn(),
    useSearchIngredients: vi.fn(),
    useCreateIngredient: vi.fn(),
    // The ingredient picker + editor also read the async-resolution hooks; inert idle defaults keep them in
    // the search branch (this screen never drives an UNRESOLVED disambiguation or a poll-after-add).
    useAddIngredientByName: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
    useIngredientStatus: () => ({ data: undefined }),
    useIngredientCandidates: () => ({ isLoading: false, isError: false, isSuccess: false, data: undefined }),
    useResolveIngredient: () => ({ mutate: () => undefined, isPending: false, isError: false, reset: () => undefined }),
    // The screen now mounts the RecipePhotoUploader below the editor; stub its photo hooks so the screen's
    // own render paths (this suite) don't reach the network. The uploader has its own dedicated test.
    useRecipePhotos: vi.fn(),
    useCreatePhotoUploadUrl: vi.fn(),
    useConfirmPhotoUpload: vi.fn(),
    useDeleteRecipePhoto: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);
const useUpdateRecipeMock = vi.mocked(useUpdateRecipe);
const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useRecipePhotosMock = vi.mocked(useRecipePhotos);
const useCreatePhotoUploadUrlMock = vi.mocked(useCreatePhotoUploadUrl);
const useConfirmPhotoUploadMock = vi.mocked(useConfirmPhotoUpload);
const useDeleteRecipePhotoMock = vi.mocked(useDeleteRecipePhoto);

function recipeResult(overrides: Partial<ReturnType<typeof useRecipe>> = {}): ReturnType<typeof useRecipe> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useRecipe>;
}

function updateMutation(
    overrides: Partial<ReturnType<typeof useUpdateRecipe>> = {},
): ReturnType<typeof useUpdateRecipe> {
    return {
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        error: undefined,
        ...overrides,
    } as unknown as ReturnType<typeof useUpdateRecipe>;
}

/** One scripted outcome the (mocked) update mutation replays, in order, per `mutate` call. */
type Outcome =
    | { readonly type: 'success'; readonly recipe: RecipeDetail }
    | { readonly type: 'conflict'; readonly error: VersionConflictError };

/** Build a `mutate` spy that replays `outcomes` in order — invoking the caller's `onSuccess`/`onError`. */
function mutateWith(outcomes: readonly Outcome[]) {
    const queue = [...outcomes];

    return vi.fn(
        (
            _vars: unknown,
            options?: { onSuccess?: (recipe: RecipeDetail) => void; onError?: (error: unknown) => void },
        ) => {
            const outcome = queue.shift();

            if (outcome?.type === 'success') {
                options?.onSuccess?.(outcome.recipe);
            } else if (outcome?.type === 'conflict') {
                options?.onError?.(outcome.error);
            }
        },
    );
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
    useUpdateRecipeMock.mockReset();
    useSearchIngredientsMock.mockReset();
    useCreateIngredientMock.mockReset();
    useUpdateRecipeMock.mockReturnValue(updateMutation());
    useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, data: [] } as unknown as ReturnType<
        typeof useSearchIngredients
    >);
    useCreateIngredientMock.mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
        typeof useCreateIngredient
    >);
    useRecipePhotosMock.mockReset();
    useCreatePhotoUploadUrlMock.mockReset();
    useConfirmPhotoUploadMock.mockReset();
    useDeleteRecipePhotoMock.mockReset();
    useRecipePhotosMock.mockReturnValue({ data: [], isLoading: false, isError: false } as unknown as ReturnType<
        typeof useRecipePhotos
    >);
    useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: vi.fn() } as unknown as ReturnType<
        typeof useCreatePhotoUploadUrl
    >);
    useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() } as unknown as ReturnType<
        typeof useConfirmPhotoUpload
    >);
    useDeleteRecipePhotoMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        variables: undefined,
    } as unknown as ReturnType<typeof useDeleteRecipePhoto>);
});

describe('RecipeEditScreen — loading and error', () => {
    it('shows the loading indicator while the recipe loads', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isLoading: true }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });

    it('shows an alert when the recipe fails to load', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isError: true }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });

    // Regression for the seed-gap false-alert bug: on a SUCCESSFUL load there is a committed render where
    // `query.isLoading` is already false (data present) but the hook's seed-once effect has not yet run, so
    // `editor.state.status` is still `'loading'`. That combination must route to the SAME loading affordance as
    // the network fetch — never to the error/alert branch, which would announce a false load-failure to screen
    // readers on every successful edit-open. `useRecipeEditor` itself is overridden (see the mock above) to
    // construct this exact combination deterministically — a real render's seed effect flushes synchronously
    // within `act()`/`render()`, so it converges to `'editing'` before any query could observe the transient
    // state through the real hook.
    it('shows the loading affordance — never the error alert — at the seed-gap between query success and the seed effect', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isLoading: false, isError: false, data: makeRecipeDetail() }));
        useRecipeEditorMock.mockReturnValueOnce({
            state: { status: 'loading' },
            values: undefined,
            errors: {},
            setValues: vi.fn(),
            setField: vi.fn(),
            submit: vi.fn(),
            submitError: false,
            query: { isLoading: false, isError: false, error: undefined, refetch: vi.fn() },
            resolutions: {
                keepMine: vi.fn(),
                useTheirs: vi.fn(),
                merge: vi.fn(),
                setMergeSelections: vi.fn(),
            },
        } as unknown as UseRecipeEditorResult);

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('We couldn’t load this recipe.')).toBeNull();
        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });
});

describe('RecipeEditScreen — ready state', () => {
    it('seeds the editor from the loaded recipe', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta' }) }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Weeknight Pasta');
    });
});

describe('RecipeEditScreen — save', () => {
    it('runs the update mutation carrying the expected version, then reports the id', () => {
        const updated = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' });
        useRecipeMock.mockReturnValue(
            recipeResult({ data: makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 }) }),
        );
        const mutate = vi.fn((_vars: unknown, options?: { onSuccess?: (recipe: typeof updated) => void }) =>
            options?.onSuccess?.(updated),
        );
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(mutate).toHaveBeenCalledTimes(1);
        const [vars] = mutate.mock.calls[0] as [{ id: string; input: { expectedVersion: number; title: string } }];
        expect(vars.id).toBe('rec_1');
        expect(vars.input.expectedVersion).toBe(3);
        expect(vars.input.title).toBe('Weeknight Pasta');
        expect(onSaved).toHaveBeenCalledWith('rec_1');
    });

    it('surfaces the generic save-error alert for a non-conflict failure', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ id: 'rec_1' }) }));
        useUpdateRecipeMock.mockReturnValue(updateMutation({ isError: true, error: new Error('network') as never }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('We couldn’t save your changes. Please try again.')).toBeTruthy();
    });

    it('does not surface the generic save-error alert for a version conflict', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ id: 'rec_1' }) }));
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({ isError: true, error: new VersionConflictError(5, 3) as never }),
        );

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('RecipeEditScreen — concurrent-edit conflict (T070)', () => {
    it('enters conflict mode on a version conflict, showing both the draft and the latest saved version', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3, servings: 4 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5, servings: 8 });
        const refetch = vi.fn().mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded, refetch }));
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({
                mutate: mutateWith([{ type: 'conflict', error: new VersionConflictError(5, 3) }]) as never,
            }),
        );

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        const mineGroup = screen.getByLabelText('Your version');
        expect(within(mineGroup).getByText('My Draft Recipe')).toBeTruthy();
        const theirsGroup = screen.getByLabelText('Latest saved version');
        expect(within(theirsGroup).getByText('Server Saved Recipe')).toBeTruthy();
        expect(within(theirsGroup).getByText('8')).toBeTruthy();
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('keep-mine re-submits against the server’s current version and navigates on success', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5 });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const refetch = vi.fn().mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded, refetch }));
        const mutate = mutateWith([
            { type: 'conflict', error: new VersionConflictError(5, 3) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Keep my version' }));

        expect(mutate).toHaveBeenCalledTimes(2);
        const [firstVars] = mutate.mock.calls[0] as [{ input: { expectedVersion: number } }];
        const [secondVars] = mutate.mock.calls[1] as [{ input: { expectedVersion: number } }];
        expect(firstVars.input.expectedVersion).toBe(3);
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(onSaved).toHaveBeenCalledWith('rec_1');
    });

    it('a repeat conflict on keep-mine stays in conflict mode with the newer saved version', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirsV5 = makeRecipeDetail({ id: 'rec_1', title: 'Saved At Five', currentVersion: 5 });
        const theirsV6 = makeRecipeDetail({ id: 'rec_1', title: 'Saved At Six', currentVersion: 6 });
        const refetch = vi.fn().mockResolvedValueOnce({ data: theirsV5 }).mockResolvedValueOnce({ data: theirsV6 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded, refetch }));
        const mutate = mutateWith([
            { type: 'conflict', error: new VersionConflictError(5, 3) },
            { type: 'conflict', error: new VersionConflictError(6, 5) },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Keep my version' }));

        expect(await screen.findByText('Saved At Six')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        const [secondVars] = mutate.mock.calls[1] as [{ input: { expectedVersion: number } }];
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('merge re-submits the field-by-field merged draft against the fresh version and reports the id', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3, servings: 4 });
        const theirs = makeRecipeDetail({
            id: 'rec_1',
            title: 'Server Saved Recipe',
            currentVersion: 5,
            servings: 8,
        });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const refetch = vi.fn().mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded, refetch }));
        const mutate = mutateWith([
            { type: 'conflict', error: new VersionConflictError(5, 3) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        // Enter the merge panel, keep my title (default), pull servings from the latest saved version.
        fireEvent.click(await screen.findByRole('button', { name: 'Merge field by field' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 8' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        expect(mutate).toHaveBeenCalledTimes(2);
        const [firstVars] = mutate.mock.calls[0] as [{ input: { expectedVersion: number } }];
        const [secondVars] = mutate.mock.calls[1] as [
            { input: { expectedVersion: number; title: string; servings: number } },
        ];
        // Stale-version lens: resubmit carries the fresh server version (5), not the stale 3.
        expect(firstVars.input.expectedVersion).toBe(3);
        expect(secondVars.input.expectedVersion).toBe(5);
        // Per-field lens: my title + their servings.
        expect(secondVars.input.title).toBe('My Draft Recipe');
        expect(secondVars.input.servings).toBe(8);
        expect(onSaved).toHaveBeenCalledWith('rec_1');
    });

    it('use-theirs discards the draft, reseeds the editor from the latest version, and does not navigate', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5 });
        const refetch = vi.fn().mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded, refetch }));
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({
                mutate: mutateWith([{ type: 'conflict', error: new VersionConflictError(5, 3) }]) as never,
            }),
        );
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Use the latest version' }));

        expect(await screen.findByLabelText('Title')).toBeTruthy();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Server Saved Recipe');
        expect(onSaved).not.toHaveBeenCalled();
    });
});
