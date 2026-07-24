/**
 * Component tests for the mobile IngredientPicker (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The picker resolves a free-typed name to a catalog `ingredientId` via the
 * (mocked) `useSearchIngredients` query and `useCreateIngredient` mutation, reporting the resolved ingredient
 * upward. Covers the search-results, empty, select, and create-freeform paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import {
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useResolveIngredient,
    useSearchIngredients,
} from '@kitchensink/recipe-service-client/hooks';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchIngredients: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientCandidates: vi.fn(),
    useResolveIngredient: vi.fn(),
}));

const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientCandidatesMock = vi.mocked(useIngredientCandidates);
const useResolveIngredientMock = vi.mocked(useResolveIngredient);

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
    return { mutate: vi.fn(), isPending: false, reset: vi.fn(), ...overrides } as unknown as ReturnType<
        typeof useCreateIngredient
    >;
}

/** Build a `useAddIngredientByName` mutation double. */
function addByNameMutation(
    overrides: Partial<ReturnType<typeof useAddIngredientByName>> = {},
): ReturnType<typeof useAddIngredientByName> {
    return { mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn(), ...overrides } as unknown as ReturnType<
        typeof useAddIngredientByName
    >;
}

/** Build a `useIngredientCandidates` query double from the fields the picker reads. */
function candidatesResult(
    overrides: Partial<ReturnType<typeof useIngredientCandidates>> = {},
): ReturnType<typeof useIngredientCandidates> {
    return {
        isLoading: false,
        isError: false,
        isSuccess: false,
        data: undefined,
        ...overrides,
    } as unknown as ReturnType<typeof useIngredientCandidates>;
}

/** Build a `useResolveIngredient` mutation double. */
function resolveMutation(
    overrides: Partial<ReturnType<typeof useResolveIngredient>> = {},
): ReturnType<typeof useResolveIngredient> {
    return { mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn(), ...overrides } as unknown as ReturnType<
        typeof useResolveIngredient
    >;
}

afterEach(cleanup);

beforeEach(() => {
    useSearchIngredientsMock.mockReset();
    useAddIngredientByNameMock.mockReset();
    useCreateIngredientMock.mockReset();
    useIngredientCandidatesMock.mockReset();
    useResolveIngredientMock.mockReset();
    useSearchIngredientsMock.mockReturnValue(searchResult());
    useAddIngredientByNameMock.mockReturnValue(addByNameMutation());
    useCreateIngredientMock.mockReturnValue(createMutation());
    useIngredientCandidatesMock.mockReturnValue(candidatesResult());
    useResolveIngredientMock.mockReturnValue(resolveMutation());
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

        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_7',
            name: 'Basil',
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
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
        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_new',
            name: 'Nduja',
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });
});

describe('IngredientPicker — addByName (the async-resolution entry point, R5)', () => {
    it('offers "Find nutrition for …" (addByName) as the primary action for a typed name', () => {
        useSearchIngredientsMock.mockReturnValue(searchResult({ data: [] }));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zzz' } });

        expect(screen.getByRole('button', { name: 'Find nutrition for “zzz”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create “zzz”' })).toBeTruthy();
    });

    it('adds a PENDING line via addByName (NOT createFreeform) that the editor will poll', () => {
        useSearchIngredientsMock.mockReturnValue(searchResult({ data: [] }));
        const added = makeIngredient({
            id: 'ing_food',
            name: 'Quinoa',
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        const addMutate = vi.fn((_name: string, options?: { onSuccess?: (v: typeof added) => void }) => {
            options?.onSuccess?.(added);
        });
        const createMutate = vi.fn();
        useAddIngredientByNameMock.mockReturnValue(addByNameMutation({ mutate: addMutate as never }));
        useCreateIngredientMock.mockReturnValue(createMutation({ mutate: createMutate as never }));
        const onResolve = vi.fn();

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Quinoa' } });
        fireEvent.click(screen.getByRole('button', { name: 'Find nutrition for “Quinoa”' }));

        // Mutation guard: the primary add path calls addByName, never the freeform createIngredient.
        expect(addMutate).toHaveBeenCalledWith('Quinoa', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(createMutate).not.toHaveBeenCalled();
        // The line carries its ACTUAL (PENDING) status so the editor keeps polling it.
        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_food',
            name: 'Quinoa',
            resolutionStatus: FoodResolutionStatus.PENDING,
        });
    });

    it('opens disambiguation when addByName comes back UNRESOLVED', () => {
        useSearchIngredientsMock.mockReturnValue(searchResult({ data: [] }));
        const added = makeIngredient({
            id: 'ing_u',
            name: 'Pepper',
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        const addMutate = vi.fn((_name: string, options?: { onSuccess?: (v: typeof added) => void }) => {
            options?.onSuccess?.(added);
        });
        useAddIngredientByNameMock.mockReturnValue(addByNameMutation({ mutate: addMutate as never }));
        useIngredientCandidatesMock.mockReturnValue(
            candidatesResult({
                isSuccess: true,
                data: [
                    { candidateId: 'cand-a', source: 'usda', externalKey: 'k1', name: 'Black pepper', summary: null },
                ],
            } as never),
        );
        const onResolve = vi.fn();

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Pepper' } });
        fireEvent.click(screen.getByRole('button', { name: 'Find nutrition for “Pepper”' }));

        expect(onResolve).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Black pepper' })).toBeTruthy();
    });
});

describe('IngredientPicker — UNRESOLVED disambiguation (R5)', () => {
    const CANDIDATE = {
        candidateId: 'cand-a',
        source: 'usda',
        externalKey: 'k1',
        name: 'Quinoa, cooked',
        summary: null,
    };

    /** Search returning a single UNRESOLVED match named "Quinoa". */
    function withUnresolvedSearch(): void {
        useSearchIngredientsMock.mockReturnValue(
            searchResult({
                data: [
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Quinoa',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ],
            } as never),
        );
    }

    it('opens the disambiguation panel on an UNRESOLVED match and does not resolve the line yet', () => {
        const onResolve = vi.fn();
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(candidatesResult({ isSuccess: true, data: [CANDIDATE] } as never));

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));

        expect(onResolve).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Quinoa, cooked' })).toBeTruthy();
    });

    it('resolves the line from the picked candidate — sending the RIGHT candidate id', () => {
        const onResolve = vi.fn();
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(
            candidatesResult({
                isSuccess: true,
                data: [CANDIDATE, { ...CANDIDATE, candidateId: 'cand-b', name: 'Quinoa, raw' }],
            } as never),
        );
        const resolved = makeIngredient({
            id: 'ing_u',
            name: 'Quinoa',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        const mutate = vi.fn(
            (
                _vars: { id: string; candidateIds: readonly string[] },
                options?: { onSuccess?: (v: typeof resolved) => void },
            ) => {
                options?.onSuccess?.(resolved);
            },
        );
        useResolveIngredientMock.mockReturnValue(resolveMutation({ mutate: mutate as never }));

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa, cooked' }));

        // Mutation guard: the picked candidate's id (cand-a), not the sibling (cand-b), must be sent.
        expect(mutate).toHaveBeenCalledWith(
            { id: 'ing_u', candidateIds: ['cand-a'] },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_u',
            name: 'Quinoa',
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('surfaces a candidates-load error', () => {
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(candidatesResult({ isError: true } as never));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));

        expect(screen.getByText('We couldn’t load options for that ingredient.')).toBeTruthy();
    });

    it('offers the freeform fallback when there are no candidates', () => {
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(candidatesResult({ isSuccess: true, data: [] } as never));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));

        expect(screen.getByText(/No options to choose from/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create “Quinoa”' })).toBeTruthy();
    });
});
