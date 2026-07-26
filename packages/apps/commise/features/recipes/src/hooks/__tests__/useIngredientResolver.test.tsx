/**
 * Tests for {@link useIngredientResolver} — the shared headless ingredient-resolution state machine
 * (CP-6/P2) extracted from the two near-identical `IngredientPicker` leaves (web + mobile). Pins the exact
 * transitions those leaves already had — idle → searching → results, the catalog-hit/addByName
 * resolve-or-disambiguate branch, candidate-pick resolution, the `enabled` gating on the candidates fetch,
 * and — the fallback-reachability invariant (FR-007) — that `addFreeform` stays callable and converges on
 * `resolveLine` from every terminal/dead-end view, never just the happy path. The recipe-service-client
 * hooks are mocked (their own behavior is covered by that package's tests), so no QueryClient/backend is
 * needed.
 *
 * Since REQ-057 (CP-9), the search query fed to `useSearchIngredients` is debounced ~300ms and gated on a
 * 2-character trigger (`useDebouncedValue` + `meetsIngredientSearchThreshold`, `./ingredientResolver.model`).
 * Because `useSearchIngredients` is mocked to a FIXED return value here, most existing transition tests are
 * unaffected (the mock ignores its call args) — fake timers (`vi.useFakeTimers()`) are used only where a
 * test asserts the exact query string/enabled flag the mocked hook was called with, and in the dedicated
 * "typeahead trigger + debounce" describe block below.
 */
import { act, renderHook } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import type { IngredientCatalogAvailability, IngredientSuggestion } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    useSuggestIngredientsMock,
    useAddIngredientByNameMock,
    useAddIngredientByFoodMock,
    useCreateIngredientMock,
    useIngredientCandidatesMock,
    useResolveIngredientMock,
} = vi.hoisted(() => ({
    useSuggestIngredientsMock: vi.fn(),
    useAddIngredientByNameMock: vi.fn(),
    useAddIngredientByFoodMock: vi.fn(),
    useCreateIngredientMock: vi.fn(),
    useIngredientCandidatesMock: vi.fn(),
    useResolveIngredientMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSuggestIngredients: useSuggestIngredientsMock,
    useAddIngredientByName: useAddIngredientByNameMock,
    useAddIngredientByFood: useAddIngredientByFoodMock,
    useCreateIngredient: useCreateIngredientMock,
    useIngredientCandidates: useIngredientCandidatesMock,
    useResolveIngredient: useResolveIngredientMock,
}));

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '../ingredientResolver.model.js';
import { useIngredientResolver } from '../useIngredientResolver.js';

/** A default (idle) search-query result: not fetching, no data. */
function idleSearch(): Record<string, unknown> {
    return { isLoading: false, isError: false, isSuccess: false, data: undefined };
}

/** Wrap one of the user's own catalog rows as a `local` blended suggestion (search Stage 2). */
function localSuggestion(ingredient: Ingredient): IngredientSuggestion {
    return { provenance: 'local', ingredient };
}

/** A food-catalog (not-yet-admitted) blended suggestion. */
function catalogSuggestion(foodId: string, name: string, score = 0.9): IngredientSuggestion {
    return { provenance: 'catalog', foodId, name, score };
}

/** A settled `useSuggestIngredients` result carrying the given blended suggestions. */
function settledSuggest(
    suggestions: readonly IngredientSuggestion[],
    catalogAvailability: IngredientCatalogAvailability = 'ok',
): Record<string, unknown> {
    return {
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { suggestions, catalogAvailability },
    };
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
    vi.useFakeTimers();
    useSuggestIngredientsMock.mockReturnValue(idleSearch());
    useIngredientCandidatesMock.mockReturnValue(idleCandidates());
    useAddIngredientByNameMock.mockReturnValue(mutation(null));
    useAddIngredientByFoodMock.mockReturnValue(mutation(null));
    useCreateIngredientMock.mockReturnValue(mutation(null));
    useResolveIngredientMock.mockReturnValue(mutation(null));
});

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

/** Advance past the REQ-057 debounce window so `useDebouncedValue`'s pending `setState` settles. */
function settleDebounce(): void {
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
}

describe('useIngredientResolver — idle -> searching -> results', () => {
    it('starts idle with a blank query', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        expect(result.current.viewState).toEqual({ kind: 'idle' });
        expect(result.current.query).toBe('');
    });

    it('moves to searching once a query is set and the search is in flight', () => {
        useSuggestIngredientsMock.mockReturnValue({
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
        useSuggestIngredientsMock.mockReturnValue(settledSuggest([localSuggestion(hit)]));
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('oli'));
        settleDebounce(); // let the debounced query catch up to 'oli' before results are expected

        expect(result.current.viewState).toEqual({
            kind: 'results',
            suggestions: [localSuggestion(hit)],
            catalogAvailability: 'ok',
            isSuccess: true,
            isError: false,
        });
    });

    // Regression (final-review Finding 1): before the debounced query catches up to `trimmed`, the view
    // must be `searching` — never a fall-through to `results` — even though the (mocked) search hook
    // already has settled data sitting there ready to return.
    it('stays searching (never falls through to results) the instant the query crosses the threshold, before the debounce settles', () => {
        const hit = makeIngredient({
            id: 'ing_9',
            name: 'Olive oil',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        useSuggestIngredientsMock.mockReturnValue(settledSuggest([localSuggestion(hit)]));
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('oli'));
        // No settleDebounce() here — asserting the state DURING the debounce window.

        expect(result.current.viewState).toEqual({ kind: 'searching' });
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
        settleDebounce(); // let the debounced query catch up to 'quin' before it's asserted below
        act(() => result.current.selectMatch(ingredient));

        expect(useSuggestIngredientsMock).toHaveBeenLastCalledWith('quin', undefined, { enabled: false });
    });
});

describe('useIngredientResolver — typeahead trigger + debounce (REQ-057)', () => {
    it('never enables search below the 2-character trigger, even after the debounce settles', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('s'));
        settleDebounce();

        expect(result.current.viewState).toEqual({ kind: 'idle' });
        expect(useSuggestIngredientsMock).toHaveBeenLastCalledWith('s', undefined, { enabled: false });
    });

    it('does not enable search before the debounce window elapses', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('sp'));
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS - 1);
        });

        expect(useSuggestIngredientsMock).toHaveBeenLastCalledWith('', undefined, { enabled: false });
    });

    it('enables search with the settled query once the debounce elapses', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('sp'));
        settleDebounce();

        expect(useSuggestIngredientsMock).toHaveBeenLastCalledWith('sp', undefined, { enabled: true });
    });

    it('collapses rapid keystrokes into a single settled (debounced) query — never an intermediate one', () => {
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('s'));
        act(() => {
            vi.advanceTimersByTime(100);
        });
        act(() => result.current.setQuery('sp'));
        act(() => {
            vi.advanceTimersByTime(100);
        });
        act(() => result.current.setQuery('spi'));
        act(() => {
            vi.advanceTimersByTime(100);
        });
        act(() => result.current.setQuery('spin'));

        // Neither 's', 'sp', nor 'spi' ever reached the search hook as the enabled query.
        expect(useSuggestIngredientsMock).not.toHaveBeenCalledWith('s', undefined, { enabled: true });
        expect(useSuggestIngredientsMock).not.toHaveBeenCalledWith('sp', undefined, { enabled: true });
        expect(useSuggestIngredientsMock).not.toHaveBeenCalledWith('spi', undefined, { enabled: true });

        settleDebounce();

        expect(useSuggestIngredientsMock).toHaveBeenLastCalledWith('spin', undefined, { enabled: true });
    });

    it('re-ranks the mocked search results by match quality (prefix > substring > fuzzy)', () => {
        const prefix = makeIngredient({ id: 'ing_1', name: 'Spinach' });
        const substring = makeIngredient({ id: 'ing_2', name: 'Baby spinach mix' });
        useSuggestIngredientsMock.mockReturnValue(
            settledSuggest([localSuggestion(substring), localSuggestion(prefix)]),
        );
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('spin'));
        settleDebounce();

        expect(result.current.viewState).toMatchObject({
            kind: 'results',
            suggestions: [localSuggestion(prefix), localSuggestion(substring)],
        });
    });

    it('re-ranks WITHIN each provenance section and never interleaves them (search Stage 2)', () => {
        const fuzzyLocal = makeIngredient({ id: 'ing_z', name: 'Zucchini' });
        const prefixCatalog = catalogSuggestion('food_1', 'Spinach, raw');
        useSuggestIngredientsMock.mockReturnValue(settledSuggest([prefixCatalog, localSuggestion(fuzzyLocal)]));
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.setQuery('spin'));
        settleDebounce();

        // The catalog hit is the far better match, yet the user's own row still leads — the sections hold.
        expect(result.current.viewState).toMatchObject({
            kind: 'results',
            suggestions: [localSuggestion(fuzzyLocal), prefixCatalog],
        });
    });
});

describe('useIngredientResolver — selectSuggestion (search Stage 2: the blended pick)', () => {
    const CATALOG_HIT = catalogSuggestion('food_1', 'Chicken breast, raw');

    it('resolves a LOCAL suggestion straight through, with no admit round-trip', () => {
        const onResolved = vi.fn();
        const mine = makeIngredient({
            id: 'ing_1',
            name: 'My chicken',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        const byFood = mutation(null);
        useAddIngredientByFoodMock.mockReturnValue(byFood);
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.selectSuggestion(localSuggestion(mine)));

        expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing_1', name: 'My chicken' }));
        expect(byFood['mutate']).not.toHaveBeenCalled();
    });

    it('opens disambiguation for an UNRESOLVED local suggestion instead of resolving the line', () => {
        const onResolved = vi.fn();
        const unresolved = makeIngredient({ id: 'ing_u', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED });
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.selectSuggestion(localSuggestion(unresolved)));

        expect(result.current.viewState).toMatchObject({ kind: 'disambiguating' });
        expect(onResolved).not.toHaveBeenCalled();
    });

    it('ADMITS a catalog suggestion by food id, then resolves the line from the SERVER response', () => {
        const onResolved = vi.fn();
        // The admitted row: it has an ingredient id and nutrition, neither of which the suggestion carried.
        const admitted = makeIngredient({
            id: 'ing_admitted',
            name: 'Chicken breast, raw',
            foodId: 'food_1',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            caloriesPer100g: 165,
        });
        const byFood = mutation(admitted);
        useAddIngredientByFoodMock.mockReturnValue(byFood);
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.selectSuggestion(CATALOG_HIT));

        // The opaque food id — never the suggestion's name — is what the admit is keyed on.
        expect(byFood['mutate']).toHaveBeenCalledWith('food_1', expect.anything());
        // And the line carries the admitted row's id + nutrition, NOT a fabricated id off the suggestion.
        expect(onResolved).toHaveBeenCalledWith(
            expect.objectContaining({ ingredientId: 'ing_admitted', caloriesPer100g: 165 }),
        );
    });

    it('does NOT resolve a line while the catalog admit is still in flight', () => {
        const onResolved = vi.fn();
        useAddIngredientByFoodMock.mockReturnValue(mutation(null)); // never calls onSuccess
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.selectSuggestion(CATALOG_HIT));

        expect(onResolved).not.toHaveBeenCalled();
    });

    it('routes an admitted-but-still-UNRESOLVED food into disambiguation rather than a nutrition-less line', () => {
        const onResolved = vi.fn();
        const admitted = makeIngredient({
            id: 'ing_admitted',
            foodId: 'food_1',
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        useAddIngredientByFoodMock.mockReturnValue(mutation(admitted));
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.selectSuggestion(CATALOG_HIT));

        expect(result.current.viewState).toMatchObject({ kind: 'disambiguating' });
        expect(onResolved).not.toHaveBeenCalled();
    });

    it('exposes the admit mutation’s own pending/error flags, separate from addByName’s', () => {
        useAddIngredientByFoodMock.mockReturnValue(mutation(null, { isPending: true, isError: true }));
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        expect(result.current.addByFoodStatus).toEqual({ isPending: true, isError: true });
        // Mutation guard: the pick's busy/failed state must not light up the unrelated by-name action.
        expect(result.current.addByNameStatus).toEqual({ isPending: false, isError: false });
    });

    it('keeps the freeform fallback reachable after a FAILED catalog admit (FR-007, no dead ends)', () => {
        const onResolved = vi.fn();
        const freeform = makeIngredient({ id: 'ing_free', name: 'chicken', isUserEntered: true });
        useAddIngredientByFoodMock.mockReturnValue(mutation(null, { isError: true }));
        useCreateIngredientMock.mockReturnValue(mutation(freeform));
        const { result } = renderHook(() => useIngredientResolver(onResolved));

        act(() => result.current.setQuery('chicken'));
        act(() => result.current.selectSuggestion(CATALOG_HIT));
        expect(onResolved).not.toHaveBeenCalled();

        act(() => result.current.addFreeform());

        expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing_free' }));
    });

    it('resets the admit mutation when a line resolves, so a stale error cannot flash on the next pick', () => {
        const admitted = makeIngredient({ id: 'ing_admitted', foodResolutionStatus: FoodResolutionStatus.RESOLVED });
        const byFood = mutation(admitted);
        useAddIngredientByFoodMock.mockReturnValue(byFood);
        const { result } = renderHook(() => useIngredientResolver(vi.fn()));

        act(() => result.current.selectSuggestion(CATALOG_HIT));

        expect(byFood['reset']).toHaveBeenCalled();
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
        useSuggestIngredientsMock.mockReturnValue(
            settledSuggest([localSuggestion(makeIngredient({ foodResolutionStatus: FoodResolutionStatus.RESOLVED }))]),
        );
        expectFreeformReachable((result) => act(() => result.current.setQuery('tomato')));
    });

    it('from results (empty)', () => {
        useSuggestIngredientsMock.mockReturnValue(settledSuggest([]));
        expectFreeformReachable((result) => act(() => result.current.setQuery('zzz')));
    });

    it('from results (search error)', () => {
        useSuggestIngredientsMock.mockReturnValue({
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
        useSuggestIngredientsMock.mockReturnValue(settledSuggest([localSuggestion(notFound)]));
        expectFreeformReachable((result) => {
            act(() => result.current.setQuery('mystery'));
            settleDebounce(); // let the debounced query catch up before the terminal state is expected
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
