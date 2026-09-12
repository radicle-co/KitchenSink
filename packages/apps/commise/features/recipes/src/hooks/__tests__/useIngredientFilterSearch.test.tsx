/**
 * Tests for {@link useIngredientFilterSearch} — the recipe-SEARCH ingredient filter's READ-ONLY typeahead
 * (FR-006 gap #3). Pins the exact transitions the filter bar's container relies on: idle -> searching ->
 * results (empty/populated/error), the 2-character trigger + ~300ms debounce (REQ-057, reused verbatim), and
 * that NEITHER `addIngredientByName`/`createIngredient`/`resolveIngredient` NOR any candidate-disambiguation
 * hook is ever invoked — the deliberate scope cut from `useIngredientResolver` documented in the hook's
 * module doc. The recipe-service-client hooks are mocked, so no QueryClient/backend is needed.
 */
import { act, renderHook } from '@testing-library/react';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

const { useSearchIngredientsMock } = vi.hoisted(() => ({
    useSearchIngredientsMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useSearchIngredients: useSearchIngredientsMock,
}));

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '../ingredientResolver.model.js';
import { useIngredientFilterSearch } from '../useIngredientFilterSearch.js';

function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

beforeEach(() => {
    vi.useFakeTimers();
    useSearchIngredientsMock.mockReturnValue(idleSearch());
});

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

function settleDebounce(): void {
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
}

describe('useIngredientFilterSearch — idle -> searching -> results', () => {
    it('starts idle with a blank query', () => {
        const { result } = renderHook(() => useIngredientFilterSearch());

        expect(result.current.viewState).toEqual({ kind: 'idle' });
        expect(result.current.query).toBe('');
    });

    it('never enables search below the FR-010a minimum, and says so instead', () => {
        // ⚠️ REWRITTEN for 003-FR-010a (plan U37), not weakened. It asserted `idle` under the retired
        // 2-character client trigger; the request-suppression half — the thing this hook exists to get
        // right — is unchanged and still asserted. What is new is the view state: below the minimum the
        // bar must TELL the cook, so `idle` (an untouched box) would now be the wrong answer.
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('c'));
        settleDebounce();

        expect(result.current.viewState).toEqual({ kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH });
        expect(useSearchIngredientsMock).toHaveBeenLastCalledWith('c', undefined, { enabled: false });
    });

    it('still suppresses the request at TWO characters — the boundary moved, the suppression did not', () => {
        // The case above passed before U37 at one character too. This is the one that fails if the
        // minimum silently slips back to 2.
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('eg'));
        settleDebounce();

        expect(useSearchIngredientsMock).toHaveBeenLastCalledWith('eg', undefined, { enabled: false });
    });

    it('enables search at exactly three characters, so `egg` and `ham` still work', () => {
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('egg'));
        settleDebounce();

        expect(useSearchIngredientsMock).toHaveBeenLastCalledWith('egg', undefined, { enabled: true });
    });

    it('moves to searching once a query crosses the threshold and is in flight', () => {
        useSearchIngredientsMock.mockReturnValue({
            isLoading: true,
            isError: false,
            isSuccess: false,
            data: undefined,
        });
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('chi'));

        expect(result.current.viewState).toEqual({ kind: 'searching' });
    });

    it('stays searching until the debounce settles, even if the mocked search already has data', () => {
        const hit = makeIngredient({ id: 'ing_1', name: 'Chicken' });
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [hit] });
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('chi'));
        // No settleDebounce() — asserting DURING the debounce window.

        expect(result.current.viewState).toEqual({ kind: 'searching' });
    });

    it('moves to results with the ranked matches once the search settles', () => {
        const hit = makeIngredient({ id: 'ing_1', name: 'Chicken' });
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [hit] });
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('chi'));
        settleDebounce();

        expect(result.current.viewState).toEqual({ kind: 'results', results: [hit], isError: false });
    });

    it('reports an empty settled result set (no matches)', () => {
        useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: [] });
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('zzz'));
        settleDebounce();

        expect(result.current.viewState).toEqual({ kind: 'results', results: [], isError: false });
    });

    it('reports a settled search error', () => {
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: true,
            isSuccess: false,
            data: undefined,
        });
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('chi'));
        settleDebounce();

        expect(result.current.viewState).toEqual({ kind: 'results', results: [], isError: true });
    });

    it('trims whitespace-only queries back to idle', () => {
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('   '));

        expect(result.current.viewState).toEqual({ kind: 'idle' });
    });

    /**
     * ⚠️ REWRITTEN for plan U5 — this is the SAME case, asserting the opposite.
     *
     * It asserted that the hook re-ranked the server's results by `prefix > substring`. That mechanism
     * (`rankIngredientResults`) is retired: the server now owns the order, scoring relevance with a tiered
     * sort key instead of approximating it from string shape. Retiring it here and not on the server would
     * have made the filter WORSE, which is why the plan requires both in one release. See the "RETIRED IN
     * PLAN U5" section of `ingredientResolver.model.ts`, and
     * `recipe-service/__tests__/integration/ingredients/ingredientRanking.integration.test.ts` for where the
     * ordering is now proven.
     */
    it("renders the server's order UNMODIFIED — the filter no longer re-ranks (U5)", () => {
        // Deliberately the order the retired client sort would have INVERTED.
        const first = makeIngredient({ id: 'ing_2', name: 'Baby spinach mix' });
        const second = makeIngredient({ id: 'ing_1', name: 'Spinach' });
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [first, second],
        });
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('spin'));
        settleDebounce();

        expect(result.current.viewState).toMatchObject({ results: [first, second] });
    });
});

describe('useIngredientFilterSearch — read-only scope cut (no resolver machinery)', () => {
    it('never calls anything but useSearchIngredients from the recipe-service-client hooks module', () => {
        const { result } = renderHook(() => useIngredientFilterSearch());

        act(() => result.current.setQuery('chicken'));
        settleDebounce();

        // The hook's returned surface has no addByName/create/candidate/resolve actions at all — there is
        // nothing to call. This is a structural assertion that the scope cut documented in the module doc
        // actually holds: a filter typeahead cannot accidentally mutate the catalog.
        expect(Object.keys(result.current).sort()).toEqual(['query', 'setQuery', 'viewState']);
    });
});
