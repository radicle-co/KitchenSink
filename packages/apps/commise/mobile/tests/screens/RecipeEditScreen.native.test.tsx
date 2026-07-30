/**
 * Component tests for the mobile RecipeEditScreen (react-native-web under jsdom). The screen loads the recipe
 * via (mocked) `useRecipe`, seeds the editor from it, and wires submit to (mocked) `useUpdateRecipe`, carrying
 * the loaded `currentVersion` as `expectedVersion`. Covers loading, error, the seeded ready state, the save
 * path, and — the concurrent-edit conflict resolution (T070/W7) — entering conflict mode on a 409 (the
 * server-first banner + A/B/C option cards, W7 Task 3), Option B ("overwrite") re-submitting against the
 * server's fresh version (with a repeat-conflict staying in conflict mode), Option C ("merge") re-submitting
 * the field-by-field merged draft, and Option A ("keep server") exiting conflict without a write. Conflict
 * resolution mirrors the web container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { RecipeDetail, RecipeSnapshot, VersionConflictSide } from '@kitchensink/recipe-core';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import {
    useConfirmPhotoUpload,
    useCreateIngredient,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipe,
    useRecipePhotos,
    useAddIngredientByFood,
    useSuggestIngredients,
    useUpdateRecipe,
} from '@kitchensink/recipe-service-client/hooks';

import type { UseRecipeEditorResult } from '@commise/features-recipes/hooks';

import { mobileMessages } from '../../src/i18n/messages.js';
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
    useSuggestIngredients: vi.fn(),
    useAddIngredientByFood: vi.fn(),
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
    useReorderRecipePhotos: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
}));

const useRecipeMock = vi.mocked(useRecipe);
const useUpdateRecipeMock = vi.mocked(useUpdateRecipe);
const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
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

/**
 * Project a {@link RecipeDetail} to the {@link VersionConflictSide} shape a real 409's `server`/`base` side
 * carries (W8-a.5) — `useRecipeEditor` reads this straight off the error (NO refetch, W7 Task 2), so a fake
 * conflict must carry the winning content on the error itself.
 */
function toVersionConflictSide(detail: RecipeDetail): VersionConflictSide {
    const snapshot: RecipeSnapshot = {
        version: detail.currentVersion,
        title: detail.title,
        description: detail.description,
        servings: detail.servings,
        prepTimeMinutes: detail.prepTimeMinutes,
        cookTimeMinutes: detail.cookTimeMinutes,
        steps: detail.steps.map((step, index) => ({
            id: `step_${index}`,
            recipeId: detail.id,
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
        ingredients: detail.ingredients.map((ingredient, index) => ({
            id: `ri_${index}`,
            recipeId: detail.id,
            ingredientId: ingredient.ingredientId,
            quantity: ingredient.quantity,
            unit: ingredient.unit ?? '',
            sortOrder: index,
            ingredientName: ingredient.name,
            isUserEntered: ingredient.isUserEntered,
            ...(ingredient.notes === undefined ? {} : { displayText: ingredient.notes }),
        })),
    };

    return {
        versionNumber: detail.currentVersion,
        deviceLabel: 'iPhone',
        updatedAt: '2026-05-09T14:30:00.000Z',
        snapshot,
    };
}

/** Build a {@link VersionConflictError} carrying `theirs` as the enriched `server` side (W8-a.5). */
function conflictError(currentVersion: number, conflictingVersion: number, theirs: RecipeDetail): VersionConflictError {
    return new VersionConflictError(currentVersion, conflictingVersion, 'Recipe version conflict', {
        server: toVersionConflictSide(theirs),
    });
}

/**
 * Navigate the (seeded, valid) edit wizard to step 4 (Photos) and click the footer Publish primary. U6 moved
 * Publish from an always-present top-bar button to the ONE contextual footer primary, live only on step 4;
 * every seeded edit fixture here is fully valid, so the `Next` footer primary advances cleanly to Photos.
 */
function publish(): void {
    fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
    fireEvent.click(screen.getByLabelText(/Next: Instructions/));
    fireEvent.click(screen.getByLabelText(/Next: Photos/));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
    useUpdateRecipeMock.mockReset();
    useSuggestIngredientsMock.mockReset();
    useAddIngredientByFoodMock.mockReset();
    useCreateIngredientMock.mockReset();
    useUpdateRecipeMock.mockReturnValue(updateMutation());
    // Search Stage 2: the picker reads the BLENDED envelope, not a bare array. These screen suites do not
    // exercise the typeahead, so an empty, healthy-catalog envelope plus an inert admit mutation is enough.
    useSuggestIngredientsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { suggestions: [], catalogAvailability: 'ok' },
    } as unknown as ReturnType<typeof useSuggestIngredients>);
    useAddIngredientByFoodMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddIngredientByFood>);
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

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isLoading: true }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        const label = mobileMessages.en.recipes.detailLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
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
                overwrite: vi.fn(),
                keepServer: vi.fn(),
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
        publish();

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
        const loaded = makeRecipeDetail({ id: 'rec_1' });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        // Enriched (carries a `server` side) — a well-formed 409, NOT the un-enriched `conflictDataUnavailable`
        // case (its own dedicated test below), so only `submitError`'s own exclusion is under test here.
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({
                isError: true,
                error: new VersionConflictError(5, 3, undefined, { server: toVersionConflictSide(loaded) }) as never,
            }),
        );

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('RecipeEditScreen — concurrent-edit conflict (T070/W7)', () => {
    it('enters conflict mode on a version conflict, showing the server-first banner and the three option cards — built from the 409 itself, never a refetch', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3, servings: 4 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5, servings: 8 });
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded, refetch }));
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({ mutate: mutateWith([{ type: 'conflict', error: conflictError(5, 3, theirs) }]) as never }),
        );

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);
        publish();

        expect(await screen.findByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        expect(screen.getByText(/^Server version \(v5\): Saved .* on iPhone$/)).toBeTruthy();
        expect(screen.getByText('Your version: local unsaved changes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Keep server version' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Overwrite with your version' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Merge manually' })).toBeTruthy();
        expect(screen.getByText(/Server Saved Recipe/)).toBeTruthy();
        expect(refetch).not.toHaveBeenCalled();
    });

    // Phantom fast-path (W7 Task 2, wired through the screen in Task 6): a 409 whose 3-way diff is EMPTY (the
    // in-progress edit already matches what the server saved) never interrupts the user with the conflict UI.
    it('a phantom zero-diff 409 auto-resolves without ever showing the conflict UI', async () => {
        // `theirs` already carries the title `My Draft Recipe Deluxe` this recipe is seeded with — every other
        // field matches the shared fixture defaults, so mine/theirs agree on every field: the diff is empty.
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe Deluxe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe Deluxe', currentVersion: 5 });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        const mutate = mutateWith([
            { type: 'conflict', error: conflictError(5, 3, theirs) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        publish();

        expect(mutate).toHaveBeenCalledTimes(2);
        const [secondVars] = mutate.mock.calls[1] as [{ input: { expectedVersion: number } }];
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(screen.queryByRole('heading', { name: 'This recipe changed while you were editing' })).toBeNull();
        expect(onSaved).toHaveBeenCalledWith('rec_1');
    });

    it('Option B (overwrite) re-submits against the server’s current version and navigates on success', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5 });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        const mutate = mutateWith([
            { type: 'conflict', error: conflictError(5, 3, theirs) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        publish();
        // This fake conflict carries no `base` (W8-a.5 real conflicts may also lack one — the base-evicted
        // case), so the W7 Task 5 / X6 stale-base gate applies: confirm before Overwrite proceeds.
        await screen.findByRole('button', { name: 'Overwrite with your version' });
        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with your version' }));

        expect(mutate).toHaveBeenCalledTimes(2);
        const [firstVars] = mutate.mock.calls[0] as [{ input: { expectedVersion: number } }];
        const [secondVars] = mutate.mock.calls[1] as [{ input: { expectedVersion: number } }];
        expect(firstVars.input.expectedVersion).toBe(3);
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(onSaved).toHaveBeenCalledWith('rec_1');
    });

    it('a repeat conflict on overwrite stays in conflict mode with the newer saved version', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirsV5 = makeRecipeDetail({ id: 'rec_1', title: 'Saved At Five', currentVersion: 5 });
        const theirsV6 = makeRecipeDetail({ id: 'rec_1', title: 'Saved At Six', currentVersion: 6 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        const mutate = mutateWith([
            { type: 'conflict', error: conflictError(5, 3, theirsV5) },
            { type: 'conflict', error: conflictError(6, 5, theirsV6) },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        publish();
        await screen.findByRole('button', { name: 'Overwrite with your version' });
        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with your version' }));

        expect(await screen.findByText(/Saved At Six/)).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        const [secondVars] = mutate.mock.calls[1] as [{ input: { expectedVersion: number } }];
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('Option C (merge) re-submits the field-by-field merged draft against the fresh version and reports the id', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3, servings: 4 });
        const theirs = makeRecipeDetail({
            id: 'rec_1',
            title: 'Server Saved Recipe',
            currentVersion: 5,
            servings: 8,
        });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        const mutate = mutateWith([
            { type: 'conflict', error: conflictError(5, 3, theirs) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        publish();

        // Enter the merge panel, keep my title (default), pull servings from the latest saved version. This
        // fake conflict carries no `base`, so the W7 Task 5 / X6 stale-base gate applies here too.
        fireEvent.click(await screen.findByRole('button', { name: 'Merge manually' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 8' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
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

    // Option A ("keep server") is a DISTINCT terminal outcome (`status: 'discarded'`, no write). OQ-1 (W7
    // Task 6): a discard still navigates away — via `onCancel`, the navigator's own "go back to the recipe
    // I was editing" callback — NEVER `onSaved` (a discard is not a save, so it must never report a saved id).
    it('Option A (keep server) discards without a write, then navigates via onCancel (never reports a saved id)', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        const mutate = mutateWith([{ type: 'conflict', error: conflictError(5, 3, theirs) }]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();
        const onCancel = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={onCancel} />);
        publish();
        fireEvent.click(await screen.findByRole('button', { name: 'Keep server version' }));

        expect(screen.queryByText('This recipe changed while you were editing')).toBeNull();
        expect(mutate).toHaveBeenCalledTimes(1); // only the original (rejected) submit — no resubmit.
        expect(onSaved).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // "Discard and close" (wireframe gap #1 — MAJOR wireframe-parity fix) is the conflict view's header exit:
    // unlike the three A/B/C options, it never resolves anything — it reuses the SAME `status: 'discarded'`
    // terminal `keepServer` produces, so this screen's existing `discarded` → `onCancel` `useEffect` fires
    // identically, with no separate wiring.
    it('"Discard and close" exits the conflict view WITHOUT submitting any resolution, then navigates via onCancel', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Saved Recipe', currentVersion: 5 });
        useRecipeMock.mockReturnValue(recipeResult({ data: loaded }));
        const mutate = mutateWith([{ type: 'conflict', error: conflictError(5, 3, theirs) }]);
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();
        const onCancel = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={onCancel} />);
        publish();
        await screen.findByRole('heading', { name: 'This recipe changed while you were editing' });
        mutate.mockClear(); // isolate the assertion below to what "Discard and close" itself does.

        fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));

        expect(screen.queryByText('This recipe changed while you were editing')).toBeNull();
        // The mutate boundary was never touched by the discard itself — no resolution was submitted.
        expect(mutate).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // Opus-review-class gap (W7 Task 2's `conflictDataUnavailable`, wired through the screen in Task 6): a 409
    // that IS a VersionConflictError but carries no `server` side (a malformed/un-enriched body) cannot be
    // 3-way-diffed or displayed — without this flag the user would tap Save, eat a 409, and see nothing.
    // `useUpdateRecipe` is mocked wholesale here (unlike the other conflict tests above, which drive the
    // 409 through `mutateWith`'s `onError` callback) — `conflictDataUnavailable` reads `isError`/`error`
    // straight off the mutation's OWN return value (mirroring `submitError`, see the hook's JSDoc), so the
    // fixture sets that return value statically, the SAME pattern the generic save-error test above uses.
    it('shows a localized, actionable error when the 409 cannot be resolved into a conflict view, and stays editing (retryable)', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ id: 'rec_1' }) }));
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({
                isError: true,
                error: new VersionConflictError(undefined, 3, 'Recipe version conflict') as never,
            }),
        );

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByText('This recipe was changed elsewhere. Reload and try again.')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'This recipe changed while you were editing' })).toBeNull();
        // Stays editing — the wizard form is still rendered and interactive (the retry path is preserved). Under
        // the U6 chrome the step-1 primary is the footer "Next", not Publish (Publish is the step-4 primary).
        expect(screen.getByLabelText(/Next: Ingredients/)).toBeTruthy();
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });
});
