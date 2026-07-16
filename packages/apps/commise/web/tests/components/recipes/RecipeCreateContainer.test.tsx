/**
 * Component tests for RecipeCreateContainer (T067 web recipe-create wiring). Covers: the create form
 * renders; an invalid form blocks submission (no mutation, validation surfaced); a valid form maps to the
 * `CreateRecipeInput` wire shape (with the ingredient resolved via the picker) and navigates to the new
 * recipe on success; and a persistence failure surfaces. The recipe-service hooks + Next router are mocked,
 * so no backend or QueryClient is needed. Queries use role/label/text only.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { CreateRecipeInput } from '@kitchensink/recipe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeCreateContainer } from '@/components/recipes/RecipeCreateContainer';

import { makeIngredient } from './__fixtures__/ingredientFixtures';
import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const {
    useCreateRecipeMock,
    useSearchIngredientsMock,
    useCreateIngredientMock,
    useAddIngredientByNameMock,
    useIngredientStatusMock,
    pushMock,
} = vi.hoisted(() => ({
    useCreateRecipeMock: vi.fn(),
    useSearchIngredientsMock: vi.fn(),
    useCreateIngredientMock: vi.fn(),
    useAddIngredientByNameMock: vi.fn(),
    useIngredientStatusMock: vi.fn(),
    pushMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCreateRecipe: useCreateRecipeMock,
    useSearchIngredients: useSearchIngredientsMock,
    useCreateIngredient: useCreateIngredientMock,
    useAddIngredientByName: useAddIngredientByNameMock,
    // The container renders one status poller per PENDING line — this is the poll-after-add source.
    useIngredientStatus: useIngredientStatusMock,
    // The ingredient picker also reads the async-resolution hooks; inert idle defaults keep it in its
    // search branch (this container never drives an UNRESOLVED disambiguation).
    useIngredientCandidates: () => ({ isLoading: false, isError: false, isSuccess: false, data: undefined }),
    useResolveIngredient: () => ({ mutate: () => undefined, isPending: false, isError: false, reset: () => undefined }),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

/** A create-recipe mutation whose `mutate` invokes `onSuccess` with `created`. */
function createRecipeMutation(created = makeRecipeDetail({ id: 'rec_new' })): Record<string, unknown> {
    return {
        mutate: vi.fn((_input: CreateRecipeInput, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(created);
        }),
        isPending: false,
        isError: false,
    };
}

/** No ingredient search results by default (the picker sits idle unless a test provides matches). */
function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** An inert create-ingredient mutation (freeform path unused by these tests). */
function idleCreateIngredient(): Record<string, unknown> {
    return { mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() };
}

/** An add-by-name mutation whose `mutate` invokes `onSuccess` with `added`. */
function addByNameMutation(added: ReturnType<typeof makeIngredient>): Record<string, unknown> {
    return {
        mutate: vi.fn((_name: string, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(added);
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    };
}

/** An inert add-by-name mutation (the async-resolution add path unused by a given test). */
function idleAddByName(): Record<string, unknown> {
    return { mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() };
}

afterEach(() => {
    vi.clearAllMocks();
});

beforeEach(() => {
    // Default: no pending line is polling, so the status poll returns nothing.
    useIngredientStatusMock.mockReturnValue({ data: undefined });
    useAddIngredientByNameMock.mockReturnValue(idleAddByName());
});

describe('RecipeCreateContainer', () => {
    it('renders the create form', () => {
        useCreateRecipeMock.mockReturnValue(createRecipeMutation());
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeCreateContainer locale="en" />);

        expect(screen.getByRole('heading', { level: 1, name: 'New recipe' })).toBeInTheDocument();
    });

    it('blocks submission and surfaces validation when the form is invalid', async () => {
        const user = userEvent.setup();
        const mutation = createRecipeMutation();
        useCreateRecipeMock.mockReturnValue(mutation);
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeCreateContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(mutation['mutate']).not.toHaveBeenCalled();
        expect(screen.getByText('A title is required.')).toBeInTheDocument();
    });

    it('maps a valid form to the wire input and navigates to the new recipe on success', async () => {
        const user = userEvent.setup();
        const mutation = createRecipeMutation(makeRecipeDetail({ id: 'rec_created' }));
        useCreateRecipeMock.mockReturnValue(mutation);
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [
                makeIngredient({ id: 'ing_9', name: 'Olive oil', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
            ],
        });
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeCreateContainer locale="en" />);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Test Recipe');

        // Resolve an ingredient via the picker so the line carries an ingredientId.
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(screen.getByRole('button', { name: 'Olive oil' }));

        // Add and fill one instruction step.
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        await user.type(screen.getByRole('textbox', { name: 'Step 1 instruction' }), 'Combine everything.');

        await user.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(mutation['mutate']).toHaveBeenCalledTimes(1);
        const [input] = (mutation['mutate'] as ReturnType<typeof vi.fn>).mock.calls[0] as [CreateRecipeInput];
        expect(input.title).toBe('Test Recipe');
        expect(input.ingredients).toEqual([{ ingredientId: 'ing_9', name: 'Olive oil', quantity: 1 }]);
        expect(input.steps).toEqual([{ instruction: 'Combine everything.' }]);
        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_created');
    });

    it('poll-after-add: a line added PENDING is polled and its badge resolves to RESOLVED', async () => {
        const user = userEvent.setup();
        useCreateRecipeMock.mockReturnValue(createRecipeMutation());
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());
        // addByName returns a PENDING food-backed ingredient (the line is added still resolving).
        useAddIngredientByNameMock.mockReturnValue(
            addByNameMutation(
                makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
            ),
        );
        // The poll (useIngredientStatus) reports the food has RESOLVED — this is what must flip the line badge.
        useIngredientStatusMock.mockReturnValue({
            data: makeIngredient({
                id: 'ing_food',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        });

        render(<RecipeCreateContainer locale="en" />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Quinoa');
        await user.click(screen.getByRole('button', { name: 'Find nutrition for “Quinoa”' }));

        // Mutation lens: the poll wired the RESOLVED status onto the line's badge. Had the poller not updated
        // the line (regression), the badge would still read the PENDING label 'Resolving…'.
        const badge = await screen.findByLabelText('Ingredient 1 status');
        expect(badge).toHaveTextContent('Resolved');
        // The poll drove the line to a non-PENDING state and stopped there.
        expect(screen.queryByText('Resolving…')).not.toBeInTheDocument();
    });

    it('surfaces an error when creating the recipe fails', () => {
        useCreateRecipeMock.mockReturnValue({ ...createRecipeMutation(), isError: true });
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(idleCreateIngredient());

        render(<RecipeCreateContainer locale="en" />);

        expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t save this recipe. Please try again.');
    });
});
