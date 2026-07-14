/**
 * Component tests for RecipeEditContainer (T067 web recipe-edit wiring). Covers: loading while the recipe
 * loads; a distinct not-found affordance (no retry) and a generic error (with retry) mirroring the detail
 * route; seeding the form from the loaded RecipeDetail; and a valid edit mapping to the update wire shape
 * (carrying `expectedVersion` for optimistic concurrency) then navigating back to the detail on success.
 * The recipe-service hooks + Next router are mocked. Queries use role/label/text only.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError } from '@kitchensink/recipe-service-client';
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

/** An update-recipe mutation whose `mutate` invokes `onSuccess`. */
function updateRecipeMutation(): Record<string, unknown> {
    return {
        mutate: vi.fn((_vars: unknown, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(makeRecipeDetail({ id: 'rec_1' }));
        }),
        isPending: false,
        isError: false,
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
});
