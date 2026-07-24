/**
 * Tests for {@link useIngredientResolver} — the shared headless ingredient-resolution state machine
 * (CP-6/P2) extracted from the two near-identical `IngredientPicker` leaves (web + mobile). Pins the exact
 * transitions those leaves already had — idle → searching → results, the catalog-hit/addByName
 * resolve-or-disambiguate branch, candidate-pick resolution, the `enabled` gating on the candidates fetch,
 * and — the fallback-reachability invariant (FR-007) — that `addFreeform` stays callable and converges on
 * `resolveLine` from every terminal/dead-end view, never just the happy path. The recipe-service-client
 * hooks are mocked (their own behavior is covered by that package's tests), so no QueryClient/backend is
 * needed.
 */
import { act, renderHook } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { useIngredientResolver } from '../useIngredientResolver.js';

/** A default (idle) search-query result: not fetching, no data. */
function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** A default (idle) candidates-query result. */
function idleCandidates(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** A mutation double whose `mutate` synchronously invokes `onSuccess` with `result` (unless `result` is `null`). */
function mutation(result: unknown | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        mutate: vi.fn((_arg: unknown, options?: { onSuccess?: (value: unknown) => void }) => {
            if (result !== null) {
                options?.onSuccess?.(result);
            }
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
        ...extra,
    };
}

beforeEach(() => {
    useSearchIngredientsMock.mockReturnValue(idleSearch());
    useIngredientCandidatesMock.mockReturnValue(idleCandidates());
    useAddIngredientByNameMock.mockReturnValue(mutation(null));
    useCreateIngredientMock.mockReturnValue(mutation(null));
    useResolveIngredientMock.mockReturnValue(mutation(null));
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('useIngredientResolver — idle -> searching -> results', () => {
    it('starts idle with a blank query', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        expect(result.current.viewState).toEqual({ kind: 'idle' });
        expect(result.current.query).toBe('');
    });

    it('moves to searching once a query is set and the search is in flight', () => {
        useSearchIngredientsMock.mockReturnValue({
            isLoading: true,
            isError: false,
            isSuccess: false,
            data: undefined,
        });
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('oli'));

        expect(result.current.trimmed).toBe('oli');
        expect(result.current.viewState).toEqual({ kind: 'searching' });
    });

    it('moves to results once the search settles', () => {
        const hit = makeIngredient({
            id: 'ing_9',
            name: 'Olive oil',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [hit] });
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('oli'));

        expect(result.current.viewState).toEqual({ kind: 'results', results: [hit], isSuccess: true, isError: false });
    });

    it('trims whitespace-only queries back to idle', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('   '));

        expect(result.current.trimmed).toBe('');
        expect(result.current.viewState).toEqual({ kind: 'idle' });
    });
});

describe('useIngredientResolver — catalog-hit (selectMatch) resolves or disambiguates per status', () => {
    it.each([
        FoodResolutionStatus.PENDING,
        FoodResolutionStatus.RESOLVED,
        FoodResolutionStatus.NOT_FOUND,
        FoodResolutionStatus.FAILED,
    ])('resolves immediately for %s', (status) => {
        const onResolved = vi.fn();
        const ingredient = makeIngredient({ id: 'ing_1', name: 'Basil', foodResolutionStatus: status });
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.setQuery('basil'));
        act(() => result.current.selectMatch(ingredient));

        expect(onResolved).toHaveBeenCalledWith({
            ingredientId: 'ing_1',
            name: 'Basil',
            quantity: 1,
            resolutionStatus: status,
        });
        expect(result.current.viewState).toEqual({ kind: 'idle' });
    });

    it('opens disambiguation for UNRESOLVED instead of resolving', () => {
        const onResolved = vi.fn();
        const ingredient = makeIngredient({
            id: 'ing_u',
            name: 'Quinoa',
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.setQuery('quin'));
        act(() => result.current.selectMatch(ingredient));

        expect(onResolved).not.toHaveBeenCalled();
        expect(result.current.viewState).toMatchObject({ kind: 'disambiguating', name: 'Quinoa' });
    });

    it('resets addIngredientByName/createIngredient/resolveIngredient on every resolve (drift #2)', () => {
        const addReset = vi.fn();
        const createReset = vi.fn();
        const resolveReset = vi.fn();
        useAddIngredientByNameMock.mockReturnValue(mutation(null, { reset: addReset }));
        useCreateIngredientMock.mockReturnValue(mutation(null, { reset: createReset }));
        useResolveIngredientMock.mockReturnValue(mutation(null, { reset: resolveReset }));

        const ingredient = makeIngredient({ id: 'ing_1', foodResolutionStatus: FoodResolutionStatus.RESOLVED });
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.selectMatch(ingredient));

        expect(addReset).toHaveBeenCalledTimes(1);
        expect(createReset).toHaveBeenCalledTimes(1);
        expect(resolveReset).toHaveBeenCalledTimes(1);
    });
});

describe('useIngredientResolver — addByName (findNutrition, the async-resolution entry point)', () => {
    it('resolves a PENDING addByName result immediately', () => {
        const onResolved = vi.fn();
        const added = makeIngredient({
            id: 'ing_food',
            name: 'Quinoa',
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        useAddIngredientByNameMock.mockReturnValue(mutation(added));
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.setQuery('Quinoa'));
        act(() => result.current.findNutrition());

        expect(onResolved).toHaveBeenCalledWith({
            ingredientId: 'ing_food',
            name: 'Quinoa',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.PENDING,
        });
    });

    it('opens disambiguation when addByName comes back UNRESOLVED', () => {
        const onResolved = vi.fn();
        const added = makeIngredient({
            id: 'ing_u',
            name: 'Pepper',
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        useAddIngredientByNameMock.mockReturnValue(mutation(added));
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.setQuery('Pepper'));
        act(() => result.current.findNutrition());

        expect(onResolved).not.toHaveBeenCalled();
        expect(result.current.viewState).toMatchObject({ kind: 'disambiguating', name: 'Pepper' });
    });
});

describe('useIngredientResolver — candidate pick (pickCandidate) resolves', () => {
    it('sends the disambiguated id + chosen candidate id, then resolves the line', () => {
        const onResolved = vi.fn();
        const unresolved = makeIngredient({
            id: 'ing_u',
            name: 'Quinoa',
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        const resolved = makeIngredient({
            id: 'ing_u',
            name: 'Quinoa',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        const resolveMutate = vi.fn(
            (
                _vars: { id: string; candidateIds: readonly string[] },
                options?: { onSuccess?: (v: unknown) => void },
            ) => {
                options?.onSuccess?.(resolved);
            },
        );
        useResolveIngredientMock.mockReturnValue({
            mutate: resolveMutate,
            isPending: false,
            isError: false,
            reset: vi.fn(),
        });

        const { result } = renderHook(() => useIngredientResolver(onResolved));
        act(() => result.current.setQuery('quin'));
        act(() => result.current.selectMatch(unresolved));
        act(() => result.current.pickCandidate('cand-a'));

        expect(resolveMutate).toHaveBeenCalledWith({ id: 'ing_u', candidateIds: ['cand-a'] }, expect.anything());
        expect(onResolved).toHaveBeenCalledWith({
            ingredientId: 'ing_u',
            name: 'Quinoa',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('is a no-op when nothing is being disambiguated', () => {
        useResolveIngredientMock.mockReturnValue(mutation(null));
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.pickCandidate('cand-a'));

        expect(useResolveIngredientMock.mock.results[0]?.value.mutate).not.toHaveBeenCalled();
    });
});

describe('useIngredientResolver — enabled gating on the candidates fetch', () => {
    it('candidates stays disabled (id "") until a match is being disambiguated', () => {
        renderHook(() => useIngredientResolver(vi.fn()));

        expect(useIngredientCandidatesMock).toHaveBeenCalledWith('', { enabled: false });
    });

    it('candidates enables on the disambiguated id once one is set', () => {
        const ingredient = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.selectMatch(ingredient));

        expect(useIngredientCandidatesMock).toHaveBeenLastCalledWith('ing_u', { enabled: true });
    });

    it('search disables while disambiguating', () => {
        const ingredient = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('quin'));
        act(() => result.current.selectMatch(ingredient));

        expect(useSearchIngredientsMock).toHaveBeenLastCalledWith('quin', undefined, { enabled: false });
    });
});

describe('useIngredientResolver — freeform fallback reachable from every non-idle view (FR-007, no dead ends)', () => {
    /** Build a hook instance, drive it to `queryOrDisambiguate`, and assert `addFreeform` still resolves a line. */
    function expectFreeformReachable(
        drive: (result: { current: ReturnType<typeof useIngredientResolver> }) => void,
    ): void {
        const onResolved = vi.fn();
        const created = makeIngredient({ id: 'ing_new', name: 'Heirloom tomato', isUserEntered: true });
        useCreateIngredientMock.mockReturnValue(mutation(created));
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        drive(result);
        act(() => result.current.addFreeform());

        expect(onResolved).toHaveBeenCalledWith(
            expect.objectContaining({ ingredientId: 'ing_new', name: 'Heirloom tomato' }),
        );
    }

    it('from results (populated)', () => {
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [makeIngredient({ foodResolutionStatus: FoodResolutionStatus.RESOLVED })],
        });
        expectFreeformReachable((result) => act(() => result.current.setQuery('tomato')));
    });

    it('from results (empty)', () => {
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
        expectFreeformReachable((result) => act(() => result.current.setQuery('zzz')));
    });

    it('from results (search error)', () => {
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: true,
            isSuccess: false,
            data: undefined,
        });
        expectFreeformReachable((result) => act(() => result.current.setQuery('oli')));
    });

    it('from terminal (a single dead-end match)', () => {
        const notFound = makeIngredient({
            id: 'ing_x',
            name: 'Mystery spice',
            foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
        });
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [notFound],
        });
        expectFreeformReachable((result) => {
            act(() => result.current.setQuery('mystery'));
            expect(result.current.viewState).toMatchObject({ kind: 'terminal' });
        });
    });

    it('from disambiguating (candidates empty)', () => {
        useIngredientCandidatesMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
        const ingredient = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        expectFreeformReachable((result) => act(() => result.current.selectMatch(ingredient)));
    });

    it('from disambiguating (candidates load error)', () => {
        useIngredientCandidatesMock.mockReturnValue({
            isLoading: false,
            isError: true,
            isSuccess: false,
            data: undefined,
        });
        const ingredient = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        expectFreeformReachable((result) => act(() => result.current.selectMatch(ingredient)));
    });

    it('from disambiguating (a resolve attempt already failed)', () => {
        useIngredientCandidatesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [{ candidateId: 'cand-a', source: 'usda', externalKey: 'k1', name: 'Black pepper', summary: null }],
        });
        useResolveIngredientMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true, reset: vi.fn() });
        const ingredient = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        expectFreeformReachable((result) => act(() => result.current.selectMatch(ingredient)));
    });
});

describe('useIngredientResolver — cancelDisambiguation', () => {
    it('returns to search and resets the resolve mutation (drift #2)', () => {
        const resolveReset = vi.fn();
        useResolveIngredientMock.mockReturnValue({
            mutate: vi.fn(),
            isPending: false,
            isError: true,
            reset: resolveReset,
        });
        const ingredient = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.selectMatch(ingredient));
        act(() => result.current.cancelDisambiguation());

        expect(result.current.viewState).toEqual({ kind: 'idle' });
        expect(resolveReset).toHaveBeenCalledTimes(1);
    });
});
