/**
 * Component tests for RecipeEditContainer (T067 web recipe-edit wiring + T070 concurrent-edit conflict
 * resolution). Covers: loading while the recipe loads; a distinct not-found affordance (no retry) and a
 * generic error (with retry) mirroring the detail route; seeding the form from the loaded RecipeDetail; a
 * valid edit mapping to the update wire shape (carrying `expectedVersion` for optimistic concurrency) then
 * navigating back to the detail on success; and the version-conflict path — a 409 enters conflict mode
 * (rendering both sides), "keep mine" re-submits against the FRESH server version then navigates, and
 * "use theirs" reseeds the form from the latest recipe without navigating. The recipe-service hooks + Next
 * router are mocked. Queries use role/label/text only.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError, VersionConflictError } from '@kitchensink/recipe-service-client';
import type { UpdateRecipeInput } from '@kitchensink/recipe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeEditContainer } from '@/components/recipes/RecipeEditContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { useRecipeMock, useUpdateRecipeMock, useSearchIngredientsMock, useCreateIngredientMock, pushMock, refetchMock } =
    vi.hoisted(() => ({
        useRecipeMock: vi.fn(),
        useUpdateRecipeMock: vi.fn(),
        useSearchIngredientsMock: vi.fn(),
        useCreateIngredientMock: vi.fn(),
        pushMock: vi.fn(),
        refetchMock: vi.fn(),
    }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: useRecipeMock,
    useUpdateRecipe: useUpdateRecipeMock,
    useSearchIngredients: useSearchIngredientsMock,
    useCreateIngredient: useCreateIngredientMock,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

// The photo uploader is its own container with its own hooks (covered by RecipePhotoUploaderContainer.test);
// stub it here so this suite exercises only the edit form / conflict logic and needs no photo-hook mocks.
vi.mock('@/components/recipes/RecipePhotoUploaderContainer', () => ({
    RecipePhotoUploaderContainer: () => null,
}));

/** An update-recipe mutation whose `mutate` invokes `onSuccess`. */
function updateRecipeMutation(): Record<string, unknown> {
    return {
        mutate: vi.fn((_vars: unknown, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(makeRecipeDetail({ id: 'rec_1' }));
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    };
}

type MutateVars = { id: string; input: UpdateRecipeInput };
type MutateOptions = { onSuccess?: (value: unknown) => void; onError?: (err: unknown) => void };

/**
 * An update-recipe mutation that models optimistic concurrency: a `mutate` carrying the FRESH
 * `expectedVersion` succeeds; any stale version fails with a {@link VersionConflictError} reporting
 * `freshVersion` as the server's current version. Mirrors what the server does on a 409.
 */
function versionAwareMutation(freshVersion: number): Record<string, unknown> {
    return {
        mutate: vi.fn((vars: MutateVars, options?: MutateOptions) => {
            if (vars.input.expectedVersion === freshVersion) {
                options?.onSuccess?.(makeRecipeDetail({ id: 'rec_1', currentVersion: freshVersion + 1 }));
            } else {
                options?.onError?.(new VersionConflictError(freshVersion, vars.input.expectedVersion));
            }
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    };
}

function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

function idleCreateIngredient(): Record<string, unknown> {
    return { mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('RecipeEditContainer', () => {
    it('renders the loading state while the recipe loads', () => {
        useRecipeMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: refetchMock });
        useUpdateRecipeMock.mockReturnValue(updateRecipeMutation());
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
    });

    it('renders a distinct not-found message with no retry for a 404', () => {
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: true,
            error: new NotFoundError(),
            data: undefined,
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(updateRecipeMutation());
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="missing" />);

        expect(screen.getByText(/couldn.t find that recipe/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('renders a generic error with retry when the load fails', async () => {
        const user = userEvent.setup();
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: true,
            error: new Error('network down'),
            data: undefined,
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(updateRecipeMutation());
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it('seeds the form from the loaded recipe', () => {
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipeDetail({ title: 'Weeknight Pasta' }),
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(updateRecipeMutation());
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        expect(screen.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Weeknight Pasta');
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' })).toHaveValue('Olive oil');
        expect(screen.getByRole('textbox', { name: 'Step 1 instruction' })).toHaveValue('Combine the ingredients.');
    });

    it('maps the edited form to the update input (with expectedVersion) and navigates on success', async () => {
        const user = userEvent.setup();
        const mutation = updateRecipeMutation();
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 }),
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(mutation);
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(mutation['mutate']).toHaveBeenCalledTimes(1);
        const [vars] = (mutation['mutate'] as ReturnType<typeof vi.fn>).mock.calls[0] as [
            { id: string; input: UpdateRecipeInput },
        ];
        expect(vars.id).toBe('rec_1');
        expect(vars.input.title).toBe('Weeknight Pasta Deluxe');
        expect(vars.input.expectedVersion).toBe(3);
        expect(vars.input.ingredients).toEqual([
            { ingredientId: 'ing_1', name: 'Olive oil', quantity: 2, unit: 'tbsp' },
        ]);
        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('enters conflict mode on a 409, rendering the user’s edit beside the latest saved version', async () => {
        const user = userEvent.setup();
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        refetchMock.mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 }),
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(versionAwareMutation(4));
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        // The conflict view replaces the form and shows both sides.
        expect(await screen.findByText('This recipe changed while you were editing')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Your version' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Latest saved version' })).toBeInTheDocument();
        // "Mine" carries the in-progress title; "theirs" carries the freshly refetched server title.
        expect(screen.getByText('Weeknight Pasta Deluxe')).toBeInTheDocument();
        expect(screen.getByText('Server Pasta')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Keep my version' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Use the latest version' })).toBeInTheDocument();
        // The edit form is gone while resolving the conflict.
        expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('keep-mine re-submits against the server’s fresh currentVersion and navigates on success', async () => {
        const user = userEvent.setup();
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        refetchMock.mockResolvedValue({ data: theirs });
        const mutation = versionAwareMutation(4);
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 }),
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(mutation);
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await user.click(await screen.findByRole('button', { name: 'Keep my version' }));

        const mutate = mutation['mutate'] as ReturnType<typeof vi.fn>;
        expect(mutate).toHaveBeenCalledTimes(2);
        // First submit carried the stale version (3, → 409); the re-submit carries the fresh server version (4).
        const [firstVars] = mutate.mock.calls[0] as [MutateVars];
        const [secondVars] = mutate.mock.calls[1] as [MutateVars];
        expect(firstVars.input.expectedVersion).toBe(3);
        expect(secondVars.input.expectedVersion).toBe(4);
        expect(secondVars.input.title).toBe('Weeknight Pasta Deluxe');
        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('use-theirs reseeds the form from the latest saved recipe and stays on the edit form', async () => {
        const user = userEvent.setup();
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        refetchMock.mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 }),
            refetch: refetchMock,
        });
        useUpdateRecipeMock.mockReturnValue(versionAwareMutation(4));
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeEditContainer locale="en" recipeId="rec_1" />);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await user.click(await screen.findByRole('button', { name: 'Use the latest version' }));

        // The conflict view is dismissed and the form is reseeded from the latest saved recipe.
        expect(screen.queryByText('This recipe changed while you were editing')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Server Pasta');
        // The user is NOT navigated away — they land back on the up-to-date edit form.
        expect(pushMock).not.toHaveBeenCalled();
    });
});
