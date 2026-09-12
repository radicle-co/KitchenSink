/**
 * Component tests for the mobile IngredientPicker (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The picker resolves a free-typed name to a catalog `ingredientId` via the
 * (mocked) `useSuggestIngredients` blended query and `useCreateIngredient` mutation, reporting the resolved ingredient
 * upward. Covers the search-results, empty, select, and create-freeform paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import {
    useAddIngredientByFood,
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useRecordIngredientCorrection,
    useResolveIngredient,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import type { IngredientCatalogAvailability, IngredientSuggestion } from '@kitchensink/recipe-service-client';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';
import { compositeOver, computedContrast, contrastRatio, placeholderContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useSuggestIngredients: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useAddIngredientByFood: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientCandidates: vi.fn(),
    useResolveIngredient: vi.fn(),
    // U29 — idle by default: the on-demand source search must never run unless a test presses it.
    useSearchIngredientsLive: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
        data: undefined,
        error: undefined,
    })),
    // U14 — the picker now also mounts the CORRECTION command. A module mock that omits a hook the
    // component calls yields `undefined` at the call site and crashes the whole render, so every suite
    // mocking this module must list every hook the leaf mounts. Its own states are covered next door, in
    // `IngredientPickerCorrection.native.test.tsx`.
    useRecordIngredientCorrection: vi.fn(),
    // U16: the create-your-own-food mutation the picker now reads — inert idle default; these suites
    // never drive the create flow (IngredientPickerCreateFood.native.test.tsx owns those states).
    useCreateAuthoredFoodViaPicker: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
}));

const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientCandidatesMock = vi.mocked(useIngredientCandidates);
const useResolveIngredientMock = vi.mocked(useResolveIngredient);
const useRecordIngredientCorrectionMock = vi.mocked(useRecordIngredientCorrection);

/** Wrap the caller's own catalog rows as `local` blended suggestions (search Stage 2). */
function own(ingredients: readonly Ingredient[]): IngredientSuggestion[] {
    return ingredients.map((ingredient) => ({ provenance: 'local', ingredient }));
}

/** A food-catalog (not-yet-admitted) blended suggestion. */
function fromCatalog(foodId: string, name: string, score = 0.9): IngredientSuggestion {
    return { provenance: 'catalog', foodId, name, score };
}

/**
 * Build a `useSuggestIngredients` result double from the fields the picker reads. `suggestions` is the
 * blended `local | catalog` list; `catalogAvailability` drives the F2 degraded notice.
 */
function searchResult(
    suggestions: readonly IngredientSuggestion[] = [],
    overrides: {
        readonly isLoading?: boolean;
        readonly isError?: boolean;
        readonly catalogAvailability?: IngredientCatalogAvailability;
    } = {},
): ReturnType<typeof useSuggestIngredients> {
    return {
        isLoading: overrides.isLoading ?? false,
        isError: overrides.isError ?? false,
        isSuccess: true,
        data: { suggestions, catalogAvailability: overrides.catalogAvailability ?? 'ok' },
    } as unknown as ReturnType<typeof useSuggestIngredients>;
}

/** Build a `useAddIngredientByFood` mutation double (the Stage-2 catalog pick). */
function addByFoodMutation(
    overrides: Partial<ReturnType<typeof useAddIngredientByFood>> = {},
): ReturnType<typeof useAddIngredientByFood> {
    return { mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn(), ...overrides } as unknown as ReturnType<
        typeof useAddIngredientByFood
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

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

beforeEach(() => {
    // The picker's real `useIngredientResolver` debounces `trimmed` (REQ-057, ~300ms) BEFORE the search
    // hook's `enabled` gate flips true — regardless of `useSuggestIngredients` being mocked here, since the
    // debounce itself lives in `useDebouncedValue`, a real (unmocked) hook. Fake timers + `settleDebounce`
    // let each test cross that window deterministically instead of racing real `setTimeout`.
    vi.useFakeTimers();
    useSuggestIngredientsMock.mockReset();
    useAddIngredientByNameMock.mockReset();
    useAddIngredientByFoodMock.mockReset();
    useCreateIngredientMock.mockReset();
    useIngredientCandidatesMock.mockReset();
    useResolveIngredientMock.mockReset();
    useSuggestIngredientsMock.mockReturnValue(searchResult());
    useAddIngredientByNameMock.mockReturnValue(addByNameMutation());
    useAddIngredientByFoodMock.mockReturnValue(addByFoodMutation());
    useCreateIngredientMock.mockReturnValue(createMutation());
    useIngredientCandidatesMock.mockReturnValue(candidatesResult());
    useResolveIngredientMock.mockReturnValue(resolveMutation());
    useRecordIngredientCorrectionMock.mockReset();
    useRecordIngredientCorrectionMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
        data: undefined,
    } as unknown as ReturnType<typeof useRecordIngredientCorrection>);
});

/** Advance past the REQ-057 debounce window so `useDebouncedValue`'s pending `setState` settles. */
function settleDebounce(): void {
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
}

describe('IngredientPicker — search + select', () => {
    it('lists catalog matches and resolves the selected one, then clears the query', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult(own([makeIngredient({ id: 'ing_7', name: 'Basil' })])));
        const onResolve = vi.fn();

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'bas' } });
        settleDebounce();
        fireEvent.click(screen.getByRole('button', { name: 'Basil' }));

        // ⛔ REWRITTEN FOR U28: the WHOLE `ResolvedRecipeFormIngredient`, not a three-field projection.
        // This leaf used to narrow the hook's line to `{ id, name, resolutionStatus }` and `RecipeEditor`
        // rebuilt it — dropping `caloriesPer100g`/`proteinGPer100g`/`carbsGPer100g`/`fatGPer100g`/`portions`,
        // so a picked ingredient showed calories on WEB and not here. The old assertion pinned the
        // projection, which is why nothing caught it. `quantity: 1` is `toIngredientLine`'s default.
        expect(onResolve).toHaveBeenCalledWith({
            ingredientId: 'ing_7',
            name: 'Basil',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('');
    });
});

describe('IngredientPicker — USDA badge (C5)', () => {
    // C5: wireframe recipe-edit.md:56 shows a "[USDA database]" badge next to the ingredient search box.
    it('renders a "USDA database" badge next to the search box', () => {
        render(<IngredientPicker onResolve={vi.fn()} />);

        expect(screen.getByText('USDA database')).toBeTruthy();
    });
});

describe('IngredientPicker — search field controls (U6 styling)', () => {
    it('shows a clear (×) control only when the query is non-empty, and clears the query when pressed', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        // No query yet → no clear control.
        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'bas' } });
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('');
    });

    /**
     * ⚠️ **REWRITTEN, not deleted (plan U29).** This case used to assert the opposite — that the
     * "Search USDA for …" seam was styled but INERT, deliberately not a button, because nothing was wired
     * behind it. U29 wires it, so the old assertion was asserting the absence of the feature that now
     * exists; leaving it would have made the suite fail for the right reason and be "fixed" by deleting the
     * assertion, which is the outcome §7.1 forbids. It now pins the same slot's NEW contract, and the
     * "Soon" tag it carried is gone with the behaviour it stood in for.
     *
     * The states BEHIND the control — searching, results, empty, busy, failed — live next door in
     * `IngredientPickerLiveSearch.native.test.tsx`, mirroring how the correction affordance is split out.
     */
    it('renders a PRESSABLE "Search USDA for …" control once a query is typed (U29 wires the U6 seam)', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'kimchi' } });
        settleDebounce();

        // The control is visible with the query interpolated, and is now a real button…
        expect(screen.getByLabelText('Search USDA for “kimchi”')).toBeTruthy();
        // …marked SLOW, because it reaches an upstream source and routinely takes seconds…
        expect(screen.getByText('Slow')).toBeTruthy();
        // …and the "Soon" placeholder tag is gone, along with the behaviour it was standing in for.
        expect(screen.queryByText('Soon')).toBeNull();
    });
});

/**
 * The search minimum, on MOBILE — 003-FR-010a (owner ruling 2026-08-24, plan U37), which RAISED the old
 * REQ-057 2-character client trigger to three characters and made it a rule the server enforces too.
 *
 * ⚠️ **This block is rewritten, not replaced.** The invariant it has always protected is unchanged and is
 * the reason it exists: below the minimum the leaf must offer NO query-keyed affordance. That is not
 * cosmetic — "Find nutrition for “T”" fires the very search the minimum gates, and "Create “T”" POSTs a
 * real catalog ingredient named "T", one stray keystroke away from junk catalog data. Mobile once gated
 * that row on `trimmed.length > 0` and offered all three at ONE character (caught on-device by Maestro
 * `create`, which asserts the negative).
 *
 * ⛔ U37 makes it load-bearing a SECOND time. `tooShort` is a NEW non-idle view-state kind, so a leaf that
 * gates its action row on `kind !== 'idle'` re-opens exactly that regression — the same defect, arriving
 * through the fix for a different requirement.
 */
describe('IngredientPicker — the 003-FR-010a three-character minimum', () => {
    it.each(['T', 'To'])('offers no query-keyed affordance for the below-minimum query %j', (query) => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: query } });
        settleDebounce();

        expect(screen.queryByRole('button', { name: `Find nutrition for “${query}”` })).toBeNull();
        expect(screen.queryByRole('button', { name: `Create “${query}”` })).toBeNull();
        expect(screen.queryByText(`Search USDA for “${query}”`)).toBeNull();
    });

    it('explains the minimum instead of leaving the cook typing into a dead surface', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'To' } });
        settleDebounce();

        expect(
            screen.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeTruthy();
        // ⛔ NOT the empty-result copy: that asserts the catalog was searched and came back empty.
        expect(screen.queryByText('No matching ingredients. Create a new one below.')).toBeNull();
    });

    it('offers them as soon as the query reaches THREE characters', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Tom' } });
        settleDebounce();

        expect(screen.getByRole('button', { name: 'Find nutrition for “Tom”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create “Tom”' })).toBeTruthy();
        expect(screen.getByText('Search USDA for “Tom”')).toBeTruthy();
        expect(screen.queryByText(/characters or more/)).toBeNull();
    });

    it('searches `egg` — the genuine three-character foods are not casualties', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'egg' } });
        settleDebounce();

        expect(screen.queryByText(/characters or more/)).toBeNull();
    });

    it('offers nothing at all — and says nothing at all — while the field is still empty', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        settleDebounce();

        expect(screen.queryByRole('button', { name: /^Find nutrition for/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull();
        // ⛔ `idle` and `tooShort` are distinct: "keep typing" over an untouched box is noise on every open.
        expect(screen.queryByText(/characters or more/)).toBeNull();
    });
});

describe('IngredientPicker — empty state', () => {
    it('shows the empty message when a non-empty query returns no matches', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zzz' } });
        settleDebounce();

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
        // REWRITTEN FOR U28 — the whole line (see the search-select test for the defect this closes).
        expect(onResolve).toHaveBeenCalledWith({
            ingredientId: 'ing_new',
            name: 'Nduja',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });
});

describe('IngredientPicker — addByName (the async-resolution entry point, R5)', () => {
    it('offers "Find nutrition for …" (addByName) as the primary action for a typed name', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zzz' } });

        expect(screen.getByRole('button', { name: 'Find nutrition for “zzz”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create “zzz”' })).toBeTruthy();
    });

    it('adds a PENDING line via addByName (NOT createFreeform) that the editor will poll', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());
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
        // REWRITTEN FOR U28 — the whole line (see the search-select test).
        expect(onResolve).toHaveBeenCalledWith({
            ingredientId: 'ing_food',
            name: 'Quinoa',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.PENDING,
        });
    });

    it('opens disambiguation when addByName comes back UNRESOLVED', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());
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
        useSuggestIngredientsMock.mockReturnValue(
            searchResult(
                own([
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Quinoa',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ]),
            ),
        );
    }

    it('opens the disambiguation panel on an UNRESOLVED match and does not resolve the line yet', () => {
        const onResolve = vi.fn();
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(candidatesResult({ isSuccess: true, data: [CANDIDATE] } as never));

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        settleDebounce();
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
        settleDebounce();
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa, cooked' }));

        // Mutation guard: the picked candidate's id (cand-a), not the sibling (cand-b), must be sent.
        expect(mutate).toHaveBeenCalledWith(
            { id: 'ing_u', candidateIds: ['cand-a'] },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        // REWRITTEN FOR U28 — the whole line (see the search-select test).
        expect(onResolve).toHaveBeenCalledWith({
            ingredientId: 'ing_u',
            name: 'Quinoa',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('surfaces a candidates-load error', () => {
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(candidatesResult({ isError: true } as never));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        settleDebounce();
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));

        expect(screen.getByText('We couldn’t load options for that ingredient.')).toBeTruthy();
    });

    it('offers the freeform fallback when there are no candidates', () => {
        withUnresolvedSearch();
        useIngredientCandidatesMock.mockReturnValue(candidatesResult({ isSuccess: true, data: [] } as never));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'quin' } });
        settleDebounce();
        fireEvent.click(screen.getByRole('button', { name: 'Quinoa' }));

        expect(screen.getByText(/No options to choose from/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create “Quinoa”' })).toBeTruthy();
    });
});

/**
 * Search Stage 2 — the BLENDED, sectioned typeahead on mobile. Covers every state the two-section list adds:
 * both sections, catalog-only, local-only, the degraded-catalog notice (F2), the catalog pick's admit
 * round-trip, and its pending/error branches.
 */
describe('IngredientPicker — search Stage 2 (blended food-catalog suggestions)', () => {
    /** Type a query and let the REQ-057 debounce settle so the blended list renders. */
    function typeQuery(query = 'chick'): void {
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: query } });
        settleDebounce();
    }

    it('renders the caller’s own ingredients and the food catalog as TWO labeled sections', () => {
        useSuggestIngredientsMock.mockReturnValue(
            searchResult([
                ...own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]),
                fromCatalog('01J0FOOD', 'Chicken breast, raw'),
            ]),
        );

        render(<IngredientPicker onResolve={vi.fn()} />);
        typeQuery();

        expect(screen.getByText('Your ingredients')).toBeTruthy();
        expect(screen.getByText('Food catalog')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'My chicken' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Chicken breast, raw' })).toBeTruthy();
        // Provenance is legible, not implied: the catalog row is badged.
        expect(screen.getByText('USDA')).toBeTruthy();
    });

    it('renders the local section FIRST in the tree, never interleaved with the catalog section', () => {
        useSuggestIngredientsMock.mockReturnValue(
            searchResult([
                ...own([makeIngredient({ id: 'ing_1', name: 'Zzz mine' })]),
                // Alphabetically and by score this catalog hit would sort first under any global ordering.
                fromCatalog('01J0FOOD', 'Aaa catalog', 0.99),
            ]),
        );

        render(<IngredientPicker onResolve={vi.fn()} />);
        typeQuery();

        const ownHeading = screen.getByText('Your ingredients');
        const catalogHeading = screen.getByText('Food catalog');
        expect(ownHeading.compareDocumentPosition(catalogHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders ONLY the catalog section when the caller has no matching ingredients of their own', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult([fromCatalog('01J0FOOD', 'Chicken breast, raw')]));

        render(<IngredientPicker onResolve={vi.fn()} />);
        typeQuery();

        expect(screen.getByText('Food catalog')).toBeTruthy();
        expect(screen.queryByText('Your ingredients')).toBeNull();
        // Not an empty state either — there IS something on offer.
        expect(screen.queryByText(/No matching ingredients/)).toBeNull();
    });

    it('renders ONLY the local section when the food catalog returns nothing', () => {
        useSuggestIngredientsMock.mockReturnValue(
            searchResult(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })])),
        );

        render(<IngredientPicker onResolve={vi.fn()} />);
        typeQuery();

        expect(screen.getByText('Your ingredients')).toBeTruthy();
        expect(screen.queryByText('Food catalog')).toBeNull();
    });

    it('picking a catalog row ADMITS it by food id and resolves the line from the admitted row', () => {
        const onResolve = vi.fn();
        const admitted = makeIngredient({
            id: 'ing_admitted',
            name: 'Chicken breast, raw',
            foodId: '01J0FOOD',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        const mutate = vi.fn((_foodId: string, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(admitted);
        });
        useSuggestIngredientsMock.mockReturnValue(searchResult([fromCatalog('01J0FOOD', 'Chicken breast, raw')]));
        useAddIngredientByFoodMock.mockReturnValue(addByFoodMutation({ mutate } as never));

        render(<IngredientPicker onResolve={onResolve} />);
        typeQuery();
        fireEvent.click(screen.getByRole('button', { name: 'Chicken breast, raw' }));

        // The opaque food id — never the suggestion's name — is what the admit is keyed on.
        expect(mutate).toHaveBeenCalledWith('01J0FOOD', expect.anything());
        // The line carries the ADMITTED row's ingredient id, not a fabricated one off the suggestion.
        // REWRITTEN FOR U28 — the whole line (see the search-select test).
        expect(onResolve).toHaveBeenCalledWith({
            ingredientId: 'ing_admitted',
            name: 'Chicken breast, raw',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
        // Mutation guard: the pick must NOT fall back to the by-name async fan-out.
        expect(vi.mocked(useAddIngredientByNameMock.mock.results[0]?.value.mutate)).not.toHaveBeenCalled();
    });

    it('shows a busy label and disables the catalog row while the admit is in flight', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult([fromCatalog('01J0FOOD', 'Chicken breast, raw')]));
        useAddIngredientByFoodMock.mockReturnValue(addByFoodMutation({ isPending: true } as never));

        render(<IngredientPicker onResolve={vi.fn()} />);
        typeQuery();

        expect(screen.getByText('Adding from the food catalog…')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Chicken breast, raw' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('surfaces a failed admit as an alert and keeps the freeform fallback reachable (FR-007)', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult([fromCatalog('01J0FOOD', 'Chicken breast, raw')]));
        useAddIngredientByFoodMock.mockReturnValue(addByFoodMutation({ isError: true } as never));

        render(<IngredientPicker onResolve={vi.fn()} />);
        typeQuery();

        expect(screen.getByText(/We couldn’t add that food/)).toBeTruthy();
        // The dead-end escape is still offered.
        expect(screen.getByRole('button', { name: 'Create “chick”' })).toBeTruthy();
    });

    it('picking a LOCAL row resolves immediately, with no admit round-trip', () => {
        const onResolve = vi.fn();
        const mutate = vi.fn();
        useSuggestIngredientsMock.mockReturnValue(
            searchResult([
                ...own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]),
                fromCatalog('01J0FOOD', 'Chicken breast, raw'),
            ]),
        );
        useAddIngredientByFoodMock.mockReturnValue(addByFoodMutation({ mutate } as never));

        render(<IngredientPicker onResolve={onResolve} />);
        typeQuery();
        fireEvent.click(screen.getByRole('button', { name: 'My chicken' }));

        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing_1' }));
        expect(mutate).not.toHaveBeenCalled();
    });

    describe('F2 — a degraded food catalog never blocks the local section', () => {
        it('renders the local results plus a non-blocking notice when the catalog is unavailable', () => {
            useSuggestIngredientsMock.mockReturnValue(
                searchResult(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]), {
                    catalogAvailability: 'unavailable',
                }),
            );

            render(<IngredientPicker onResolve={vi.fn()} />);
            typeQuery();

            expect(screen.getByRole('button', { name: 'My chicken' })).toBeTruthy();
            expect(screen.getByText(/the food catalog is unavailable right now/)).toBeTruthy();
        });

        it('does NOT show the notice when the catalog answered normally', () => {
            useSuggestIngredientsMock.mockReturnValue(
                searchResult(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })])),
            );

            render(<IngredientPicker onResolve={vi.fn()} />);
            typeQuery();

            expect(screen.queryByText(/the food catalog is unavailable right now/)).toBeNull();
        });

        it('does NOT show the notice when the blend was deliberately DISABLED (not an incident)', () => {
            useSuggestIngredientsMock.mockReturnValue(
                searchResult(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]), {
                    catalogAvailability: 'disabled',
                }),
            );

            render(<IngredientPicker onResolve={vi.fn()} />);
            typeQuery();

            expect(screen.queryByText(/the food catalog is unavailable right now/)).toBeNull();
        });

        it('shows the empty state alongside the notice when the catalog degrades AND there are no local hits', () => {
            useSuggestIngredientsMock.mockReturnValue(searchResult([], { catalogAvailability: 'unavailable' }));

            render(<IngredientPicker onResolve={vi.fn()} />);
            typeQuery('zzz');

            expect(screen.getByText(/No matching ingredients/)).toBeTruthy();
            expect(screen.getByText(/the food catalog is unavailable right now/)).toBeTruthy();
            // And both escapes are still offered.
            expect(screen.getByRole('button', { name: 'Find nutrition for “zzz”' })).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Create “zzz”' })).toBeTruthy();
        });
    });
});

/**
 * WCAG 2.1 AA text contrast (SC 1.4.3) for the picker's two seafoam-on-tint labels — the provenance badge and
 * the freeform fallback action. Both are read against the tint their own wrapper actually paints (read off the
 * DOM, not restated), composited over the card's white. The tints, the pills and the filled primary action are
 * non-text accents and stay as they are; see the palette JSDoc in `@commise/ui` for the rule.
 */
describe('IngredientPicker — tinted labels stay WCAG-AA legible', () => {
    /** The opaque colour behind a label: its wrapper's own tint, flattened onto the card's white. */
    function surfaceBehind(label: Element): string {
        const tint = window.getComputedStyle(label.parentElement as Element).backgroundColor;

        return compositeOver(tint, palette.white);
    }

    it('keeps the badge label legible over the badge tint', () => {
        render(<IngredientPicker onResolve={vi.fn()} />);

        // `badgeLabel` is the ONE style both badges share — the search box's "USDA database" pill and each
        // catalog row's "USDA" provenance pill — so a token change here moves both. Seafoam scored 3.66:1 on
        // this tint, under the 4.5:1 body floor.
        const badge = screen.getByText('USDA database');

        expect(computedContrast(badge, { surface: surfaceBehind(badge) }), 'USDA badge label').toBeGreaterThanOrEqual(
            4.5,
        );
    });

    it('keeps the freeform fallback action’s label legible over its tint', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult([]));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zzz' } });
        settleDebounce();

        const label = screen.getByText('Create “zzz”');

        expect(
            computedContrast(label, { surface: surfaceBehind(label) }),
            'freeform fallback action label',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the search field’s PLACEHOLDER legible', () => {
        render(<IngredientPicker onResolve={vi.fn()} />);

        // Placeholder text is text — it is the only thing telling a reader what the field wants before they
        // type — and `mist` scored 1.90:1, below even the 3:1 a meaningful graphic owes. `placeholderContrast`
        // reads the `--placeholderTextColor` property react-native-web actually paints the placeholder with;
        // a plain `color` read would see the input's own charcoal (12.68:1) and pass while nothing was fixed.
        expect(
            placeholderContrast(screen.getByLabelText('Search ingredients')),
            'ingredient search placeholder',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the inert USDA seam’s label legible', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult([]));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zzz' } });
        settleDebounce();

        // The seam is deliberately non-interactive ("coming soon"), but its caption is still copy a reader
        // reads to understand what the slot will do. Muted is a design choice; 1.90:1 is not a design choice.
        const seam = screen.getByText('Search USDA for “zzz”');

        expect(computedContrast(seam), 'USDA seam caption').toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the result row’s disclosure chevron perceivable', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult(own([makeIngredient({ name: 'Olive oil' })])));

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'oli' } });
        settleDebounce();

        // The chevron is the row's only visual affordance for "this opens" — a meaningful graphic, so SC
        // 1.4.11's 3:1 applies. At `mist` it was 1.90:1, which fails even that lower floor. Asserted against
        // 3:1, NOT 4.5, because it is genuinely non-text: over-stating the requirement would invite the next
        // reader to "fix" the test by weakening it. The colour arrives as a PROP, so the icon stub republishes
        // it as `data-icon-color` — there is no computed colour to read.
        const row = screen.getByRole('button', { name: 'Olive oil' });
        const chevron = row.querySelector('[data-icon-name="chevron-right"]');

        expect(chevron, 'no chevron on the result row').not.toBeNull();
        expect(
            contrastRatio(chevron?.getAttribute('data-icon-color') ?? '', palette.white),
            'result-row disclosure chevron',
        ).toBeGreaterThanOrEqual(3);
    });
});
