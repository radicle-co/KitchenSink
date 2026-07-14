/**
 * Component tests for the mobile IngredientPicker (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The picker resolves a free-typed name to a catalog `ingredientId` via the
 * (mocked) `useSearchIngredients` query and `useCreateIngredient` mutation, reporting the resolved ingredient
 * upward. Covers the search-results, empty, select, and create-freeform paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCreateIngredient, useSearchIngredients } from '@kitchensink/recipe-service-client/hooks';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchIngredients: vi.fn(),
    useCreateIngredient: vi.fn(),
}));

const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);

/** Build a `useSearchIngredients` result double from the fields the picker reads. */
function searchResult(
    overrides: Partial<ReturnType<typeof useSearchIngredients>> = {},
): ReturnType<typeof useSearchIngredients> {
    return { isLoading: false, isError: false, data: [], ...overrides } as unknown as ReturnType<
        typeof useSearchIngredients
    >;
}

/** Build a `useCreateIngredient` mutation double. */
function createMutation(
    overrides: Partial<ReturnType<typeof useCreateIngredient>> = {},
): ReturnType<typeof useCreateIngredient> {
    return { mutate: vi.fn(), isPending: false, ...overrides } as unknown as ReturnType<typeof useCreateIngredient>;
}

afterEach(cleanup);

beforeEach(() => {
    useSearchIngredientsMock.mockReset();
    useCreateIngredientMock.mockReset();
    useSearchIngredientsMock.mockReturnValue(searchResult());
    useCreateIngredientMock.mockReturnValue(createMutation());
});

describe('IngredientPicker — search + select', () => {
    it('lists catalog matches and resolves the selected one, then clears the query', () => {
        useSearchIngredientsMock.mockReturnValue(
            searchResult({ data: [makeIngredient({ id: 'ing_7', name: 'Basil' })] }),
        );
        const onResolve = vi.fn();

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'bas' } });
        fireEvent.click(screen.getByRole('button', { name: 'Basil' }));

        expect(onResolve).toHaveBeenCalledWith({ id: 'ing_7', name: 'Basil' });
        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('');
    });
});

describe('IngredientPicker — empty state', () => {
    it('shows the empty message when a non-empty query returns no matches', () => {
        useSearchIngredientsMock.mockReturnValue(searchResult({ data: [] }));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zzz' } });

        expect(screen.getByText('No matching ingredients. Create a new one below.')).toBeTruthy();
    });
});

describe('IngredientPicker — create freeform', () => {
    it('creates a freeform ingredient and resolves it on success', () => {
        const created = makeIngredient({ id: 'ing_new', name: 'Nduja' });
        const mutate = vi.fn((_name: string, options?: { onSuccess?: (ingredient: typeof created) => void }) => {
            options?.onSuccess?.(created);
        });
        useCreateIngredientMock.mockReturnValue(createMutation({ mutate: mutate as never }));
        const onResolve = vi.fn();

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Nduja' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create “Nduja”' }));

        expect(mutate).toHaveBeenCalledWith('Nduja', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onResolve).toHaveBeenCalledWith({ id: 'ing_new', name: 'Nduja' });
    });
});
