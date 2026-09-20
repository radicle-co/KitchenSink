/**
 * Component tests for the mobile RecipeCreateScreen (react-native-web under jsdom). The screen seeds a blank
 * editor and wires submit to the (mocked) `useCreateRecipe` mutation. Covers the create-heading chrome, the
 * validation gate (an invalid form never reaches the mutation), and the happy path (a valid form maps to the
 * wire contract, runs the mutation, and reports the new id upward). The editor's ingredient typeahead reads
 * the (mocked) ingredient search/create hooks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import * as ImagePicker from 'expo-image-picker';

import {
    useAddIngredientByFood,
    useCreateIngredient,
    useCreateRecipe,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';

import { BackInterceptProvider } from '@commise/ui/back-intercept';

import { RecipeCreateScreen } from '../../src/screens/RecipeCreateScreen.js';
import { makeIngredient, makeRecipeDetail } from '../__fixtures__/recipes.js';

/**
 * Render `ui` inside the back-intercept provider.
 *
 * The editor installs a hardware-back interceptor, and `useBackIntercept` THROWS without a provider above it
 * — deliberately, so a back guard can never be silently absent. In the app that provider is `RecipesScreen`'s,
 * which wraps every pushed surface; here it is supplied directly. `onUnhandled` answers `false`, standing in
 * for a host with nothing left to pop.
 */
function render(ui: ReactElement) {
    return rtlRender(<BackInterceptProvider onUnhandled={() => false}>{ui}</BackInterceptProvider>);
}

const { photoCalls } = vi.hoisted(() => ({
    // The presign and confirm calls the screen's own upload queue makes, so a test can see WHICH recipe id a
    // photo was uploaded against.
    photoCalls: { presign: [] as unknown[], confirm: [] as unknown[] },
}));

vi.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images' },
    launchImageLibraryAsync: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    // U16: the create-your-own-food mutation the picker now reads — inert idle default.
    useCreateAuthoredFoodViaPicker: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
    useCreateRecipe: vi.fn(),
    // U33 — the create screen now composes the real photo surface (a pick lands in the draft and flushes
    // once the recipe has an id), so its hooks must exist even though this suite never picks a file.
    useRecipePhotos: () => ({ data: [], isLoading: false, isError: false }),
    useCreatePhotoUploadUrl: () => ({
        mutateAsync: async (variables: unknown) => {
            photoCalls.presign.push(variables);

            return {
                uploadUrl: 'https://s3.example.com/put',
                key: 'uploads/rec_new/p.jpg',
                expiresIn: 900,
                maxBytes: 5_242_880,
            };
        },
        isPending: false,
        reset: () => undefined,
    }),
    useConfirmPhotoUpload: () => ({
        mutateAsync: async (variables: unknown) => {
            photoCalls.confirm.push(variables);

            return {};
        },
        isPending: false,
        reset: () => undefined,
    }),
    useDeleteRecipePhoto: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
    useReorderRecipePhotos: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
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
}));

const useCreateRecipeMock = vi.mocked(useCreateRecipe);
const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);

function createRecipeMutation(
    overrides: Partial<ReturnType<typeof useCreateRecipe>> = {},
): ReturnType<typeof useCreateRecipe> {
    return { mutate: vi.fn(), isPending: false, isError: false, ...overrides } as unknown as ReturnType<
        typeof useCreateRecipe
    >;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

beforeEach(() => {
    photoCalls.presign.length = 0;
    photoCalls.confirm.length = 0;
    useCreateRecipeMock.mockReset();
    useSuggestIngredientsMock.mockReset();
    useAddIngredientByFoodMock.mockReset();
    useCreateIngredientMock.mockReset();
    useCreateRecipeMock.mockReturnValue(createRecipeMutation());
    // Search Stage 2: the picker reads the BLENDED envelope, not a bare array. This screen only exercises the
    // "pick one of your own ingredients" path, so the one fixture row is a `local` suggestion and the food
    // catalog contributes nothing.
    useSuggestIngredientsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: {
            suggestions: [{ provenance: 'local', ingredient: makeIngredient({ id: 'ing_1', name: 'Olive oil' }) }],
            catalogAvailability: 'ok',
        },
    } as unknown as ReturnType<typeof useSuggestIngredients>);
    useAddIngredientByFoodMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddIngredientByFood>);
    useCreateIngredientMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useCreateIngredient>);
});

describe('RecipeCreateScreen — chrome', () => {
    it('renders the create wizard seeded at step 1 with first-step guidance and a Next footer primary (U6)', () => {
        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
        // U6: empty-state first-step guidance on a brand-new form.
        expect(screen.getByText('Let’s build your recipe')).toBeTruthy();
        // U6 chrome: the contextual footer primary is "Next" on step 1 — Publish is the step-4 primary, not here.
        expect(screen.getByLabelText(/Next: Ingredients/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    });
});

describe('RecipeCreateScreen — validation gate', () => {
    it('shows validation errors and does not run the mutation for an empty Save Draft (U32 action bar)', () => {
        const mutate = vi.fn();
        useCreateRecipeMock.mockReturnValue(createRecipeMutation({ mutate: mutate as never }));

        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);
        // REWRITTEN for U32: Save Draft is a first-class control in the pinned action bar now, not an item a
        // phone user had to open a kebab to reach. There is no overflow menu on native at all.
        fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

        expect(screen.getByText('A title is required.')).toBeTruthy();
        expect(mutate).not.toHaveBeenCalled();
    });
});

describe('RecipeCreateScreen — happy path', () => {
    it('maps a valid form to the wire contract, runs the create mutation, and reports the new id', () => {
        const created = makeRecipeDetail({ id: 'rec_new', title: 'Weeknight Pasta' });
        const mutate = vi.fn((_input: unknown, options?: { onSuccess?: (recipe: typeof created) => void }) =>
            options?.onSuccess?.(created),
        );
        useCreateRecipeMock.mockReturnValue(createRecipeMutation({ mutate: mutate as never }));
        const onCreated = vi.fn();

        render(<RecipeCreateScreen onCreated={onCreated} onCancel={vi.fn()} />);

        // Step 1: Title.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weeknight Pasta' } });
        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        // Step 2: resolve an ingredient via the typeahead (appends a resolved line with quantity 1). The
        // picker only surfaces search results once a query is typed AND the REQ-057 debounce (~300ms,
        // real even though the search hook itself is mocked — it lives in `useDebouncedValue`) settles
        // (`deriveViewState` gates on a non-empty `trimmed` that has caught up to the debounced query).
        vi.useFakeTimers();
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'olive' } });
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        vi.useRealTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Olive oil' }));
        fireEvent.click(screen.getByLabelText(/Next: Instructions/));

        // Step 3: add and fill an instruction step, then advance to step 4 (Review).
        fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
        fireEvent.change(screen.getByLabelText('Step 1 instruction'), { target: { value: 'Boil the pasta.' } });
        fireEvent.click(screen.getByLabelText(/Next: Review/));

        // Publish is the action bar's primary on the last step (create no longer dead-ends on Photos).
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(mutate).toHaveBeenCalledTimes(1);
        const [input] = mutate.mock.calls[0] as [{ title: string; ingredients: unknown[]; steps: unknown[] }];
        expect(input.title).toBe('Weeknight Pasta');
        expect(input.ingredients).toHaveLength(1);
        expect(input.steps).toHaveLength(1);
        expect(onCreated).toHaveBeenCalledWith('rec_new');
    });
});

/** Make the create mutation succeed with `rec_new`, synchronously, the way the happy-path suite does. */
function succeedingCreate(): void {
    const created = makeRecipeDetail({ id: 'rec_new', title: 'Weeknight Pasta' });

    useCreateRecipeMock.mockReturnValue(
        createRecipeMutation({
            mutate: vi.fn((_input: unknown, options?: { onSuccess?: (recipe: typeof created) => void }) =>
                options?.onSuccess?.(created),
            ) as never,
        }),
    );
}

/** Walk a blank create to a publishable draft and press Publish. Shared by the flush-surface suite below. */
function publishMinimalRecipe(onCreated: (id: string) => void): void {
    succeedingCreate();
    render(<RecipeCreateScreen onCreated={onCreated} onCancel={vi.fn()} />);
    walkToPublish();
}

/** From a rendered blank create on step 1, fill the minimum and press Publish. */
function walkToPublish(): void {
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weeknight Pasta' } });
    fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'olive' } });
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Olive oil' }));
    fireEvent.click(screen.getByLabelText(/Next: Instructions/));

    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.change(screen.getByLabelText('Step 1 instruction'), { target: { value: 'Boil the pasta.' } });
    fireEvent.click(screen.getByLabelText(/Next: Review/));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
}

/**
 * U33 — THE POST-SAVE PHOTO-FLUSH SURFACE, and the cross-platform parity gap it closes.
 *
 * ⛔ A save is create-THEN-upload, so the screen must not hand the id upward while photos are outstanding —
 * doing so unmounts the queue mid-flight and loses them. The first version of this screen only WITHHELD
 * `onCreated` and rendered nothing new, which produced four bad outcomes the web container had already
 * designed away:
 *
 *  - the cook pressed Publish and nothing visibly happened, with no word that the recipe was already saved;
 *  - a permanently failed upload's Retry lived three steps back on step 1, with nothing pointing at it;
 *  - the only exit was the back arrow, which asks "Discard unsaved changes?" about a saved recipe;
 *  - `create.isPending` was false again, so Publish was live and a SECOND press created a SECOND recipe.
 *
 * The screen now renders the same shape the web container does: the recipe-saved notice, the photo surface
 * with each file's own state, and an explicit way to leave without the stragglers.
 */
describe('RecipeCreateScreen — the post-save photo flush (U33)', () => {
    it('hands the id upward immediately when no photo was chosen', () => {
        // The control case. Without it, a screen that never handed the id upward would satisfy the next test.
        const onCreated = vi.fn();

        publishMinimalRecipe(onCreated);

        expect(onCreated).toHaveBeenCalledWith('rec_new');
    });

    it('does NOT render the flush surface when there is nothing to flush', () => {
        publishMinimalRecipe(vi.fn());

        expect(screen.queryByLabelText('Finish without the remaining photos')).toBeFalsy();
    });

    it('uploads a photo picked before the create against the CREATED recipe id, holding the id until then', async () => {
        // The create's `onSuccess` hands the draft to the upload queue. Without that hand-off the photo is never
        // uploaded; with a hand-off that ran before the id existed, it would be presigned against `''`.
        vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
            canceled: false,
            assets: [{ uri: 'file:///tmp/p.jpg', fileName: 'p.jpg', mimeType: 'image/jpeg', width: 1, height: 1 }],
        } as never);
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
                .mockResolvedValue({ ok: true, status: 200 }),
        );
        succeedingCreate();
        const onCreated = vi.fn();

        render(<RecipeCreateScreen onCreated={onCreated} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Remove p\.jpg/u })).toBeTruthy());
        walkToPublish();

        await waitFor(() => expect(photoCalls.confirm).toHaveLength(1));
        expect(photoCalls.presign).toEqual([expect.objectContaining({ id: 'rec_new' })]);
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rec_new'));
    });

    it('withholds photo add while the create is saving', () => {
        // The flush hands over the draft as it stood when the save was pressed, so a pick made during the save
        // would never be uploaded. Draft Remove is withheld the same way — see the uploader's own suite.
        useCreateRecipeMock.mockReturnValue(createRecipeMutation({ isPending: true }));

        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
    });
});
