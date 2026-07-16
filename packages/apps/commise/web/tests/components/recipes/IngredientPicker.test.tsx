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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

const {
    useSearchIngredientsMock,
    useAddIngredientByNameMock,
    useCreateIngredientMock,
    useIngredientCandidatesMock,
    useResolveIngredientMock,
} = vi.hoisted(() => ({
    useSearchIngredientsMock: vi.fn(),
    useAddIngredientByNameMock: vi.fn(),
    useCreateIngredientMock: vi.fn(),
    useIngredientCandidatesMock: vi.fn(),
    useResolveIngredientMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchIngredients: useSearchIngredientsMock,
    useAddIngredientByName: useAddIngredientByNameMock,
    useCreateIngredient: useCreateIngredientMock,
    useIngredientCandidates: useIngredientCandidatesMock,
    useResolveIngredient: useResolveIngredientMock,
}));

/** A default (idle) search-query result: not fetching, no data. */
function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** A default (idle) candidates-query result. */
function idleCandidates(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** A candidates query in its loaded/success state with the given rows. */
function loadedCandidates(data: readonly unknown[]): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: true, data };
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

/**
 * A default add-by-name mutation whose `mutate` invokes `onSuccess` with `added` (the food-backed ingredient
 * the food service returns — `PENDING` by default). Idle (never resolves) when `added` is `null`.
 */
function addByNameMutation(
    added: ReturnType<typeof makeIngredient> | null = makeIngredient({
        foodResolutionStatus: FoodResolutionStatus.PENDING,
    }),
): Record<string, unknown> {
    return {
        mutate: vi.fn((_name: string, options?: { onSuccess?: (value: unknown) => void }) => {
            if (added !== null) {
                options?.onSuccess?.(added);
            }
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    };
}

/** A resolve-ingredient mutation whose `mutate` invokes `onSuccess` with `resolved`. */
function resolveMutation(
    resolved = makeIngredient({ foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
): Record<string, unknown> {
    return {
        mutate: vi.fn(
            (
                _vars: { id: string; candidateIds: readonly string[] },
                options?: { onSuccess?: (value: unknown) => void },
            ) => {
                options?.onSuccess?.(resolved);
            },
        ),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    };
}

beforeEach(() => {
    // Sensible defaults so the (many) non-disambiguation tests need only set search + create.
    useIngredientCandidatesMock.mockReturnValue(idleCandidates());
    useResolveIngredientMock.mockReturnValue(resolveMutation());
    useAddIngredientByNameMock.mockReturnValue(addByNameMutation());
});

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

    describe('addByName — the async-resolution entry point (R5)', () => {
        it('offers "Find nutrition for …" (addByName) as the PRIMARY action for a typed name', async () => {
            const user = userEvent.setup();
            useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
            useCreateIngredientMock.mockReturnValue(createMutation());

            render(<IngredientPicker onSelect={vi.fn()} />);

            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

            // Both the primary (find nutrition) and the fallback (custom ingredient) are available.
            expect(screen.getByRole('button', { name: 'Find nutrition for “zzz”' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });

        it('addByName adds a PENDING line the container will poll — via addByName, NOT createFreeform', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
            const create = createMutation();
            const add = addByNameMutation(
                makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
            );
            useCreateIngredientMock.mockReturnValue(create);
            useAddIngredientByNameMock.mockReturnValue(add);

            render(<IngredientPicker onSelect={onSelect} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Quinoa');
            await user.click(screen.getByRole('button', { name: 'Find nutrition for “Quinoa”' }));

            // Mutation guard: the primary add path MUST call addByName (the food-resolving route) with the typed
            // name — a regression that routed it to createFreeform (the plain freeform create) fails BOTH lines.
            expect(add.mutate).toHaveBeenCalledWith('Quinoa', expect.anything());
            expect(create.mutate).not.toHaveBeenCalled();
            // The line is added PENDING (the container polls it to RESOLVED).
            expect(onSelect).toHaveBeenCalledWith({
                ingredientId: 'ing_food',
                name: 'Quinoa',
                quantity: 1,
                resolutionStatus: FoodResolutionStatus.PENDING,
            });
        });

        it('addByName that comes back UNRESOLVED opens disambiguation instead of adding a line', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
            useCreateIngredientMock.mockReturnValue(createMutation());
            useAddIngredientByNameMock.mockReturnValue(
                addByNameMutation(
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Pepper',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ),
            );
            useIngredientCandidatesMock.mockReturnValue(
                loadedCandidates([
                    { candidateId: 'cand-a', source: 'usda', externalKey: 'k1', name: 'Black pepper', summary: null },
                ]),
            );

            render(<IngredientPicker onSelect={onSelect} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Pepper');
            await user.click(screen.getByRole('button', { name: 'Find nutrition for “Pepper”' }));

            // No line yet — the UNRESOLVED add routes into disambiguation (keyed on the new food-backed id).
            expect(onSelect).not.toHaveBeenCalled();
            expect(screen.getByRole('group', { name: 'Which “Pepper” did you mean?' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Black pepper/ })).toBeInTheDocument();
        });

        it('surfaces an addByName failure and keeps the freeform fallback available', async () => {
            const user = userEvent.setup();
            useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
            useCreateIngredientMock.mockReturnValue(createMutation());
            useAddIngredientByNameMock.mockReturnValue({
                mutate: vi.fn(),
                isPending: false,
                isError: true,
                reset: vi.fn(),
            });

            render(<IngredientPicker onSelect={vi.fn()} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

            expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t add that ingredient/i);
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });
    });

    describe('UNRESOLVED disambiguation (R5)', () => {
        const CANDIDATE = {
            candidateId: 'cand-a',
            source: 'usda',
            externalKey: 'k1',
            name: 'Quinoa, cooked',
            summary: 'Boiled',
        };

        /** Search returning a single UNRESOLVED match named "Quinoa". */
        function searchWithUnresolved(): void {
            useSearchIngredientsMock.mockReturnValue({
                isLoading: false,
                isError: false,
                isSuccess: true,
                data: [
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Quinoa',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ],
            });
            useCreateIngredientMock.mockReturnValue(createMutation());
        }

        it('opens the disambiguation panel (candidates), and does NOT resolve the line yet', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue(loadedCandidates([CANDIDATE]));

            render(<IngredientPicker onSelect={onSelect} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));

            // The line is NOT added on the UNRESOLVED click — disambiguation is required first.
            expect(onSelect).not.toHaveBeenCalled();
            expect(screen.getByRole('group', { name: 'Which “Quinoa” did you mean?' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Quinoa, cooked/ })).toBeInTheDocument();
        });

        it('resolves the line from the picked candidate — sending the RIGHT candidate id', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue(
                loadedCandidates([CANDIDATE, { ...CANDIDATE, candidateId: 'cand-b', name: 'Quinoa, raw' }]),
            );
            const resolved = makeIngredient({
                id: 'ing_u',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            const resolveMut = resolveMutation(resolved);
            useResolveIngredientMock.mockReturnValue(resolveMut);

            render(<IngredientPicker onSelect={onSelect} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));
            await user.click(screen.getByRole('button', { name: /Quinoa, cooked/ }));

            // Mutation guard: the picked candidate's id must be the one sent — picking "cooked" (cand-a),
            // not "raw" (cand-b). A wrong/swapped id fails here.
            expect(resolveMut.mutate).toHaveBeenCalledWith(
                { id: 'ing_u', candidateIds: ['cand-a'] },
                expect.anything(),
            );
            expect(onSelect).toHaveBeenCalledWith({
                ingredientId: 'ing_u',
                name: 'Quinoa',
                quantity: 1,
                resolutionStatus: FoodResolutionStatus.RESOLVED,
            });
        });

        it('shows a loading indicator while candidates load', async () => {
            const user = userEvent.setup();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue({
                isLoading: true,
                isError: false,
                isSuccess: false,
                data: undefined,
            });

            render(<IngredientPicker onSelect={vi.fn()} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));

            expect(screen.getByRole('status', { name: 'Loading options' })).toBeInTheDocument();
        });

        it('surfaces a candidates-load error', async () => {
            const user = userEvent.setup();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue({
                isLoading: false,
                isError: true,
                isSuccess: false,
                data: undefined,
            });

            render(<IngredientPicker onSelect={vi.fn()} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));

            expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load options for that ingredient.');
        });

        it('offers the freeform fallback when there are no candidates to choose from', async () => {
            const user = userEvent.setup();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue(loadedCandidates([]));

            render(<IngredientPicker onSelect={vi.fn()} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));

            expect(screen.getByText(/No options to choose from/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “Quinoa” as a custom ingredient' })).toBeInTheDocument();
        });

        it('surfaces a resolve failure without adding a line', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue(loadedCandidates([CANDIDATE]));
            useResolveIngredientMock.mockReturnValue({
                mutate: vi.fn(),
                isPending: false,
                isError: true,
                reset: vi.fn(),
            });

            render(<IngredientPicker onSelect={onSelect} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));

            expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t resolve that ingredient.');
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('returns to search from the disambiguation panel', async () => {
            const user = userEvent.setup();
            searchWithUnresolved();
            useIngredientCandidatesMock.mockReturnValue(loadedCandidates([CANDIDATE]));

            render(<IngredientPicker onSelect={vi.fn()} />);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(screen.getByRole('button', { name: 'Quinoa' }));
            expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Back to search' }));
            expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
        });
    });
});
