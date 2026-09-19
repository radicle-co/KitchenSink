/**
 * Component tests for the mobile RecipeEditScreen (react-native-web under jsdom). The screen reads the recipe through
 * a suspense read under `QueryBoundary` (REWRITTEN for that conversion: the recipe is SEEDED into a real query cache, or
 * `getRecipeById` on the client stub stays pending or rejects, where the old file mocked `useRecipe`), seeds the editor
 * from it, and wires submit to (mocked) `useUpdateRecipe`, carrying
 * the loaded `currentVersion` as `expectedVersion`. Covers loading, error, the seeded ready state, the save
 * path, and — the concurrent-edit conflict resolution (T070/W7) — entering conflict mode on a 409 (the
 * server-first banner + A/B/C option cards, W7 Task 3), Option B ("overwrite") re-submitting against the
 * server's fresh version (with a repeat-conflict staying in conflict mode), Option C ("merge") re-submitting
 * the field-by-field merged draft, and Option A ("keep server") exiting conflict without a write. Conflict
 * resolution mirrors the web container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import type { RecipeDetail, RecipeSnapshot, VersionConflictSide } from '@kitchensink/recipe-core';
import { NotFoundError, VersionConflictError, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useConfirmPhotoUpload,
    useCreateIngredient,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipePhotos,
    useAddIngredientByFood,
    useSuggestIngredients,
    useUpdateRecipe,
} from '@kitchensink/recipe-service-client/hooks';

import { mobileMessages } from '../../src/i18n/messages.js';
import { RecipeEditScreen } from '../../src/screens/RecipeEditScreen.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

const { getRecipeByIdMock } = vi.hoisted(() => ({ getRecipeByIdMock: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    // The screen's suspense read goes through this client's `getRecipeById`, via the query cache.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined, getRecipeById: getRecipeByIdMock }),
    // U16: the create-your-own-food mutation the picker now reads — inert idle default.
    useCreateAuthoredFoodViaPicker: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
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
    useSearchIngredientsLive: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
    // U14 — the picker mounted inside this screen now also mounts the CORRECTION command. A module mock that
    // omits a hook the tree calls fails the whole render, so this list must name every hook mounted below it.
    // Inert here on purpose: the correction's own states are covered in
    // `tests/components/IngredientPickerCorrection.native.test.tsx`.
    useRecordIngredientCorrection: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
        data: undefined,
    }),
    // The screen now mounts the RecipePhotoUploader below the editor; stub its photo hooks so the screen's
    // own render paths (this suite) don't reach the network. The uploader has its own dedicated test.
    useRecipePhotos: vi.fn(),
    useCreatePhotoUploadUrl: vi.fn(),
    useConfirmPhotoUpload: vi.fn(),
    useDeleteRecipePhoto: vi.fn(),
    useReorderRecipePhotos: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
}));

const useUpdateRecipeMock = vi.mocked(useUpdateRecipe);
const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useRecipePhotosMock = vi.mocked(useRecipePhotos);
const useCreatePhotoUploadUrlMock = vi.mocked(useCreatePhotoUploadUrl);
const useConfirmPhotoUploadMock = vi.mocked(useConfirmPhotoUpload);
const useDeleteRecipePhotoMock = vi.mocked(useDeleteRecipePhoto);

/** The request cache each test renders over. */
let queryClient: QueryClient;

/** Put a SETTLED recipe in the cache, so the screen's suspense read renders it with no fetch. */
function seedRecipe(recipe: RecipeDetail): void {
    queryClient.setQueryData(recipeQueries({} as never).detail(recipe.id).queryKey, recipe);
}

/** Render `ui` over the test's query cache. */
function render(ui: ReactElement) {
    return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
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
 * Navigate the (seeded, valid) edit wizard to step 4 (Review) and click the action bar's Publish primary.
 * Publish from an always-present top-bar button to the ONE contextual footer primary, live only on step 4;
 * Every seeded edit fixture here is fully valid, so `Next` advances cleanly to Review.
 */
function publish(): void {
    fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
    fireEvent.click(screen.getByLabelText(/Next: Instructions/));
    fireEvent.click(screen.getByLabelText(/Next: Review/));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
}

afterEach(cleanup);

beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // Unseeded, the read stays pending — the loading state.
    getRecipeByIdMock.mockReset();
    getRecipeByIdMock.mockReturnValue(new Promise(() => {}));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        const label = mobileMessages.en.recipes.detailLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('shows an alert with a retry that loads the editor when the recipe fails to load', async () => {
        getRecipeByIdMock
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(await screen.findByRole('alert')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.recipes.detailRetry }));
        });

        expect(((await screen.findByLabelText('Title')) as HTMLInputElement).value).toBe('Weeknight Pasta');
    });

    it('shows a not-found alert with no retry — only the way back — for a recipe that does not exist', async () => {
        getRecipeByIdMock.mockRejectedValue(new NotFoundError());
        const onCancel = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={onCancel} />);

        expect(await screen.findByText(mobileMessages.en.recipes.detailNotFound)).toBeTruthy();
        expect(screen.queryByRole('button', { name: mobileMessages.en.recipes.detailRetry })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.recipes.back }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('⛔ keeps the editor AND the draft when a background refetch of the recipe fails', async () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));
        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weeknight Pasta Deluxe' } });

        // A focus or reconnect refetch that fails over the cached recipe: it does not throw into the boundary.
        getRecipeByIdMock.mockRejectedValue(new Error('network down'));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeQueries({} as never).detail('rec_1').queryKey });
        });

        // Swapping the editor for the load alert would unmount the wizard and throw the cook's draft away; a stale
        // base is caught at save by the 409 conflict view instead.
        expect(screen.queryByRole('alert')).toBeNull();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Weeknight Pasta Deluxe');
    });

    it('⛔ remounts a fresh editor seeded from the NEW recipe when the screen is handed another id', () => {
        seedRecipe(makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' }));
        seedRecipe(makeRecipeDetail({ id: 'rec_2', title: 'Sunday Roast' }));
        const { rerender } = render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved edit' } });

        rerender(
            <QueryClientProvider client={queryClient}>
                <RecipeEditScreen recipeId="rec_2" onSaved={vi.fn()} onCancel={vi.fn()} />
            </QueryClientProvider>,
        );

        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Sunday Roast');
    });
});

describe('RecipeEditScreen — ready state', () => {
    it('seeds the editor from the loaded recipe', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Weeknight Pasta');
    });

    it('⛔ keeps the editor on screen while the photo read is still pending', () => {
        // A non-suspension check. The photo hook is module-mocked here, so this pins the pending SHAPE a plain
        // `useQuery` hands the uploader, not the hook's implementation: a pending read must render inside the
        // editor. Were the uploader's read a suspense read with no `<Suspense>` of its own, the editor's boundary
        // would catch it and swap the whole wizard for the recipe's loading indicator.
        useRecipePhotosMock.mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
        } as unknown as ReturnType<typeof useRecipePhotos>);
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(useRecipePhotosMock).toHaveBeenCalledWith('rec_1');
        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Weeknight Pasta');
        expect(screen.queryByLabelText('Loading recipe…')).toBeNull();
    });
});

describe('RecipeEditScreen — save', () => {
    it('runs the update mutation carrying the expected version, then reports the id', () => {
        const updated = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' });
        seedRecipe(makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 }));
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
        seedRecipe(makeRecipeDetail({ id: 'rec_1' }));
        useUpdateRecipeMock.mockReturnValue(updateMutation({ isError: true, error: new Error('network') as never }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('We couldn’t save your changes. Please try again.')).toBeTruthy();
    });

    it('does not surface the generic save-error alert for a version conflict', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1' });
        seedRecipe(loaded);
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
        seedRecipe(loaded);
        useUpdateRecipeMock.mockReturnValue(
            updateMutation({ mutate: mutateWith([{ type: 'conflict', error: conflictError(5, 3, theirs) }]) as never }),
        );

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);
        publish();

        expect(await screen.findByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        expect(screen.getByText(/^Server version \(v5\): Saved .*ago$/u)).toBeTruthy();
        expect(screen.getByText('Your version: local unsaved changes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Keep server version' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Overwrite with your version' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Merge manually' })).toBeTruthy();
        expect(screen.getByText(/Server Saved Recipe/)).toBeTruthy();
    });

    // Phantom fast-path (W7 Task 2, wired through the screen in Task 6): a 409 whose 3-way diff is EMPTY (the
    // in-progress edit already matches what the server saved) never interrupts the user with the conflict UI.
    it('a phantom zero-diff 409 auto-resolves without ever showing the conflict UI', async () => {
        // `theirs` already carries the title `My Draft Recipe Deluxe` this recipe is seeded with — every other
        // field matches the shared fixture defaults, so mine/theirs agree on every field: the diff is empty.
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe Deluxe', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'My Draft Recipe Deluxe', currentVersion: 5 });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        seedRecipe(loaded);
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
        seedRecipe(loaded);
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
        seedRecipe(loaded);
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
        seedRecipe(loaded);
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
        seedRecipe(loaded);
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
        seedRecipe(loaded);
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
        seedRecipe(makeRecipeDetail({ id: 'rec_1' }));
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
