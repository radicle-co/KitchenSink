/**
 * Component tests for the mobile RecipeCreateScreen (react-native-web under jsdom). The screen seeds a blank
 * editor and wires submit to the (mocked) `useCreateRecipe` mutation. Covers the create-heading chrome, the
 * validation gate (an invalid form never reaches the mutation), and the happy path (a valid form maps to the
 * wire contract, runs the mutation, and reports the new id upward). The editor's trailing add row searches a real
 * food client over a fetch double, and admits a pick through the (mocked) recipe admission hooks.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactElement } from 'react';
import * as ImagePicker from 'expo-image-picker';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { useAddIngredientByFood, useCreateIngredient, useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';

import { makeQuietFoodClient, withFoodClient } from '@commise/test-utils';
import { BackInterceptProvider } from '@commise/ui/back-intercept';

import { RecipeCreateScreen } from '../../src/screens/RecipeCreateScreen.js';
import { makeIngredient, makeRecipeDetail } from '../__fixtures__/recipes.js';

/** The catalog food the trailing add row finds for "olive" (plan 002 S5: the editor searches food directly). */
const OLIVE_OIL = { id: 'food_oil', name: 'Olive oil', score: 0.9 } as const;

/**
 * Render `ui` inside the back-intercept provider.
 *
 * The editor installs a hardware-back interceptor, and `useBackIntercept` THROWS without a provider above it
 * — deliberately, so a back guard can never be silently absent. In the app that provider is `RecipesScreen`'s,
 * which wraps every pushed surface; here it is supplied directly. `onUnhandled` answers `false`, standing in
 * for a host with nothing left to pop.
 */
function render(ui: ReactElement) {
    // Plan 002 V1: a FAILED row's Try again (`useLookupRetry`) reads through the query cache, as the app's root does.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return rtlRender(
        <QueryClientProvider client={queryClient}>
            <BackInterceptProvider onUnhandled={() => false}>
                {withFoodClient(ui, makeQuietFoodClient([OLIVE_OIL]))}
            </BackInterceptProvider>
        </QueryClientProvider>,
    );
}

const { photoCalls } = vi.hoisted(() => ({
    // The presign and confirm calls the screen's own upload queue makes, so a test can see WHICH recipe id a
    // photo was uploaded against.
    photoCalls: { presign: [] as unknown[], confirm: [] as unknown[] },
}));

// The real ScrollView, its element marked: jsdom has no layout, so "can the cook reach Finish without" is asserted as
// "Finish without sits inside the scroll region".
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        ScrollView: (props: ComponentProps<typeof actual.ScrollView>) =>
            createElement('div', { 'data-scroll-region': true }, createElement(actual.ScrollView, props)),
    };
});

vi.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images' },
    launchImageLibraryAsync: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // Plan 002 V1 B7 — the row editor's commit port reads these two as well. Inert: these suites commit no row pick.
    useAddIngredientByFoodVariant: () => ({ mutateAsync: () => new Promise(() => undefined), isPaused: false }),
    useRebindIngredientLine: () => ({ mutateAsync: () => new Promise(() => undefined), isPaused: false }),
    // Plan 002 V1 B5 — the editor's one background nutrition read. Answered empty: these suites do not read figures.
    useIngredientFoodNutrition: () => ({
        data: { entries: [] },
        isPlaceholderData: false,
        isError: false,
        refetch: async () => undefined,
    }),
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
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
    useAddIngredientByFood: vi.fn(),
    useCreateIngredient: vi.fn(),
    // The row editor reads the add-by-name and status hooks too; inert idle defaults (this screen never drives a
    // poll-after-add).
    useAddIngredientByName: () => ({
        mutateAsync: () => new Promise(() => undefined),
        isPending: false,
        isPaused: false,
        isError: false,
        reset: () => undefined,
    }),
    useIngredientStatus: () => ({ data: undefined }),
}));

const useCreateRecipeMock = vi.mocked(useCreateRecipe);
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
    useAddIngredientByFoodMock.mockReset();
    useCreateIngredientMock.mockReset();
    useCreateRecipeMock.mockReturnValue(createRecipeMutation());
    // A pick of the catalog's olive oil is admitted by recipe (`POST /ingredients/by-food`) as the binding a line names.
    useAddIngredientByFoodMock.mockReturnValue({
        mutateAsync: vi.fn(async () =>
            makeIngredient({
                id: 'ing_1',
                name: 'Olive oil',
                foodId: OLIVE_OIL.id,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        ),
        isPending: false,
        isPaused: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddIngredientByFood>);
    useCreateIngredientMock.mockReturnValue({
        mutateAsync: () => new Promise(() => undefined),
        isPaused: false,
        isPending: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useCreateIngredient>);
});

/** Pick olive oil in the trailing add row (plan 002 V1 B8): the search settles, the pick is admitted, the line appends. */
async function pickOliveOil(): Promise<void> {
    fireEvent.change(screen.getByLabelText('Add an ingredient'), { target: { value: 'olive' } });
    const option = await screen.findByRole('button', { name: 'Olive oil' });

    await act(async () => {
        fireEvent.click(option);
    });
    await screen.findByLabelText('Ingredient 1 name');
}

describe('RecipeCreateScreen — chrome', () => {
    it('renders the create wizard seeded at step 1 with first-step guidance and a Next footer primary (U6)', () => {
        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
        // U6: empty-state first-step guidance on a brand-new form (its name is said once: the N1 describe below).
        expect(screen.getByRole('heading', { name: 'Let’s build your recipe' })).toBeTruthy();
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

describe('RecipeCreateScreen — a refusal for text a row holds points at that row (`rowEditorOpenDecisions.md` R7)', () => {
    it('Save Draft refused from step 3 lands on step 2, in the field, whose own alert says why', async () => {
        const mutate = vi.fn();
        useCreateRecipeMock.mockReturnValue(createRecipeMutation({ mutate: mutate as never }));

        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weeknight Pasta' } });
        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
        await pickOliveOil();
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Olive oil' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Change food' }));
        fireEvent.change(screen.getByLabelText('Ingredient 1 name'), { target: { value: 'Olive oil x' } });
        // The rail is ungated (R6), so the cook can be elsewhere when the save is refused.
        fireEvent.click(screen.getByRole('button', { name: /^Instructions:/ }));
        act(() => screen.getByRole('button', { name: 'Save Draft' }).focus());
        fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

        expect(mutate).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 1 name'));
        // The list opens with it, so a food can be chosen without editing the text first.
        expect(screen.getByLabelText('Food suggestions for ingredient 1')).toBeTruthy();
        // Once under the field, once in its assertive channel.
        expect(
            screen.getAllByText(
                '“Olive oil x” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep Olive oil.',
            ),
        ).toHaveLength(2);
    });
});

describe('RecipeCreateScreen — happy path', () => {
    it('maps a valid form to the wire contract, runs the create mutation, and reports the new id', async () => {
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

        // Step 2: pick an ingredient in the trailing add row (appends a resolved line with quantity 1).
        await pickOliveOil();
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
async function publishMinimalRecipe(onCreated: (id: string) => void): Promise<void> {
    succeedingCreate();
    render(<RecipeCreateScreen onCreated={onCreated} onCancel={vi.fn()} />);
    await walkToPublish();
}

/** From a rendered blank create on step 1, fill the minimum and press Publish. */
async function walkToPublish(): Promise<void> {
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weeknight Pasta' } });
    fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

    await pickOliveOil();
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
    it('hands the id upward immediately when no photo was chosen', async () => {
        // The control case. Without it, a screen that never handed the id upward would satisfy the next test.
        const onCreated = vi.fn();

        await publishMinimalRecipe(onCreated);

        expect(onCreated).toHaveBeenCalledWith('rec_new');
    });

    it('does NOT render the flush surface when there is nothing to flush', async () => {
        await publishMinimalRecipe(vi.fn());

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
        await walkToPublish();

        await waitFor(() => expect(photoCalls.confirm).toHaveLength(1));
        expect(photoCalls.presign).toEqual([expect.objectContaining({ id: 'rec_new' })]);
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rec_new'));
    });

    // In landscape a phone is about 360 dp tall: the notice, one row of square photo cells and the button do not fit,
    // and a panel that does not scroll strands the cook's only way out (staff-ux-engineer landscape EVALUATE,
    // finding 3; WCAG 2.2 SC 1.3.4).
    it('keeps "Finish without the remaining photos" inside a scroll region while photos are still uploading', async () => {
        vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
            canceled: false,
            assets: [{ uri: 'file:///tmp/p.jpg', fileName: 'p.jpg', mimeType: 'image/jpeg', width: 1, height: 1 }],
        } as never);
        // The picked file reads, and its upload never settles, so the flush surface stays up.
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
                .mockReturnValue(new Promise(() => undefined)),
        );
        succeedingCreate();

        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Remove p\.jpg/u })).toBeTruthy());
        await walkToPublish();

        const finish = await screen.findByLabelText('Finish without the remaining photos');

        expect(finish.closest('[data-scroll-region]')).not.toBeNull();
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

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the first step's guidance has a title, so the title is its header and
 * the guidance carries no name; the title is said once (N4).
 */
describe('RecipeCreateScreen — N1: the first-step guidance is named once, by its title header', () => {
    it('says "Let’s build your recipe" through one header, and no node is labelled with it', () => {
        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getAllByRole('heading', { name: 'Let’s build your recipe' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Let’s build your recipe')).toEqual([]);
    });
});
