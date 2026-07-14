/**
 * Component tests for IngredientPicker (T067 web ingredient typeahead). Covers every state the picker
 * renders: idle (no query → no results region), searching (loading), populated results → select resolves a
 * line, empty results, search error, freeform create → resolves a line, and the terminal NOT_FOUND status
 * (surfaced + freeform fallback offered, per FR-007). The recipe-service hooks are mocked, so no backend or
 * QueryClient is needed. Queries use role/label/text only.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

const { useSearchIngredientsMock, useCreateIngredientMock } = vi.hoisted(() => ({
    useSearchIngredientsMock: vi.fn(),
    useCreateIngredientMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchIngredients: useSearchIngredientsMock,
    useCreateIngredient: useCreateIngredientMock,
}));

/** A default (idle) search-query result: not fetching, no data. */
function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** A default create-ingredient mutation whose `mutate` invokes `onSuccess` with `created`. */
function createMutation(created = makeIngredient()): Record<string, unknown> {
    return {
        mutate: vi.fn((_name: string, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(created);
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('IngredientPicker', () => {
    it('shows no results region until the search box has a query', () => {
        useSearchIngredientsMock.mockReturnValue(idleSearch());
        useCreateIngredientMock.mockReturnValue(createMutation());

        render(<IngredientPicker onSelect={vi.fn()} />);

        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders a loading indicator while the search is in flight', async () => {
        const user = userEvent.setup();
        useSearchIngredientsMock.mockReturnValue({
            isLoading: true,
            isError: false,
            isSuccess: false,
            data: undefined,
        });
        useCreateIngredientMock.mockReturnValue(createMutation());

        render(<IngredientPicker onSelect={vi.fn()} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(screen.getByRole('status', { name: 'Searching ingredients' })).toBeInTheDocument();
    });

    it('selects a catalog match, resolving the line to its ingredientId + name', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [
                makeIngredient({ id: 'ing_9', name: 'Olive oil', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
            ],
        });
        useCreateIngredientMock.mockReturnValue(createMutation());

        render(<IngredientPicker onSelect={onSelect} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(screen.getByRole('button', { name: 'Olive oil' }));

        expect(onSelect).toHaveBeenCalledWith({
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('shows an empty state and a freeform option when nothing matches', async () => {
        const user = userEvent.setup();
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
        useCreateIngredientMock.mockReturnValue(createMutation());

        render(<IngredientPicker onSelect={vi.fn()} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

        expect(screen.getByText('No matching ingredients found.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
    });

    it('surfaces a search error', async () => {
        const user = userEvent.setup();
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: true,
            isSuccess: false,
            data: undefined,
        });
        useCreateIngredientMock.mockReturnValue(createMutation());

        render(<IngredientPicker onSelect={vi.fn()} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t search ingredients.');
    });

    it('creates a freeform ingredient and resolves the line to the new id + status', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const created = makeIngredient({
            id: 'ing_new',
            name: 'Heirloom tomato',
            isUserEntered: true,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
        useCreateIngredientMock.mockReturnValue(createMutation(created));

        render(<IngredientPicker onSelect={onSelect} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Heirloom tomato');
        await user.click(screen.getByRole('button', { name: 'Add “Heirloom tomato” as a custom ingredient' }));

        expect(onSelect).toHaveBeenCalledWith({
            ingredientId: 'ing_new',
            name: 'Heirloom tomato',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.PENDING,
        });
    });

    it('surfaces a terminal NOT_FOUND match and still offers the freeform fallback (FR-007)', async () => {
        const user = userEvent.setup();
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [
                makeIngredient({
                    id: 'ing_x',
                    name: 'Mystery spice',
                    foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
                }),
            ],
        });
        useCreateIngredientMock.mockReturnValue(createMutation());

        render(<IngredientPicker onSelect={vi.fn()} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'mystery');

        expect(screen.getByText('No match found')).toBeInTheDocument();
        expect(screen.getByRole('note')).toHaveTextContent(/custom ingredient or remove it/i);
        expect(screen.getByRole('button', { name: 'Add “mystery” as a custom ingredient' })).toBeInTheDocument();
    });
});
