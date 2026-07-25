/**
 * Component tests for the mobile RecipeCreateScreen (react-native-web under jsdom). The screen seeds a blank
 * editor and wires submit to the (mocked) `useCreateRecipe` mutation. Covers the create-heading chrome, the
 * validation gate (an invalid form never reaches the mutation), and the happy path (a valid form maps to the
 * wire contract, runs the mutation, and reports the new id upward). The editor's ingredient typeahead reads
 * the (mocked) ingredient search/create hooks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCreateIngredient, useCreateRecipe, useSearchIngredients } from '@kitchensink/recipe-service-client/hooks';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';

import { RecipeCreateScreen } from '../../src/screens/RecipeCreateScreen.js';
import { makeIngredient, makeRecipeDetail } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCreateRecipe: vi.fn(),
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
}));

const useCreateRecipeMock = vi.mocked(useCreateRecipe);
const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);

function createRecipeMutation(
    overrides: Partial<ReturnType<typeof useCreateRecipe>> = {},
): ReturnType<typeof useCreateRecipe> {
    return { mutate: vi.fn(), isPending: false, isError: false, ...overrides } as unknown as ReturnType<
        typeof useCreateRecipe
    >;
}

afterEach(cleanup);

beforeEach(() => {
    useCreateRecipeMock.mockReset();
    useSearchIngredientsMock.mockReset();
    useCreateIngredientMock.mockReset();
    useCreateRecipeMock.mockReturnValue(createRecipeMutation());
    useSearchIngredientsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: [makeIngredient({ id: 'ing_1', name: 'Olive oil' })],
    } as unknown as ReturnType<typeof useSearchIngredients>);
    useCreateIngredientMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useCreateIngredient>);
});

describe('RecipeCreateScreen — chrome', () => {
    it('renders the create wizard, seeded at step 1, with the Publish submit label (w3/e7)', () => {
        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    });
});

describe('RecipeCreateScreen — validation gate', () => {
    it('shows validation errors and does not run the mutation for an empty form', () => {
        const mutate = vi.fn();
        useCreateRecipeMock.mockReturnValue(createRecipeMutation({ mutate: mutate as never }));

        render(<RecipeCreateScreen onCreated={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

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

        // Step 3: add and fill an instruction step.
        fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
        fireEvent.change(screen.getByLabelText('Step 1 instruction'), { target: { value: 'Boil the pasta.' } });

        // Publish is the top-bar action, reachable from any step (w3/e7: labeled "Publish" in every mode).
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(mutate).toHaveBeenCalledTimes(1);
        const [input] = mutate.mock.calls[0] as [{ title: string; ingredients: unknown[]; steps: unknown[] }];
        expect(input.title).toBe('Weeknight Pasta');
        expect(input.ingredients).toHaveLength(1);
        expect(input.steps).toHaveLength(1);
        expect(onCreated).toHaveBeenCalledWith('rec_new');
    });
});
