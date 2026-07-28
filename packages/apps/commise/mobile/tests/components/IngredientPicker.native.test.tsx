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
    useResolveIngredient,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import type { IngredientCatalogAvailability, IngredientSuggestion } from '@kitchensink/recipe-service-client';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';
import { compositeOver, computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSuggestIngredients: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useAddIngredientByFood: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientCandidates: vi.fn(),
    useResolveIngredient: vi.fn(),
}));

const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientCandidatesMock = vi.mocked(useIngredientCandidates);
const useResolveIngredientMock = vi.mocked(useResolveIngredient);

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

        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_7',
            name: 'Basil',
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

    it('renders a styled — but inert (not a button) — "Search USDA for …" seam once a query is typed (U6)', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'kimchi' } });
        settleDebounce();

        // The seam is visible with the query interpolated…
        expect(screen.getByText('Search USDA for “kimchi”')).toBeTruthy();
        // …but it is a placeholder for a future CR — NOT a pressable/button (nothing wired behind it yet).
        expect(screen.queryByRole('button', { name: 'Search USDA for “kimchi”' })).toBeNull();
    });
});

/**
 * REQ-057 gates the ingredient search at {@link MIN_INGREDIENT_QUERY_LENGTH} (2) characters, and the shared
 * resolver model encodes that as the `idle` view state. The web leaf renders its action row ONLY inside the
 * non-idle kinds (`searching`/`results`/`terminal`), so a single character offers nothing. Mobile gated the
 * same row on `trimmed.length > 0` instead — a platform divergence that offered all three query-keyed
 * affordances at ONE character (caught on-device by Maestro `create`, which asserts the negative).
 *
 * It is not merely cosmetic: "Find nutrition for “T”" fires the very food-service search REQ-057 gates, and
 * "Create “T”" POSTs a real catalog ingredient named "T" — one stray keystroke away from junk catalog data.
 */
describe('IngredientPicker — REQ-057 2-character search threshold', () => {
    it('offers no query-keyed affordance for a single character', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'T' } });
        settleDebounce();

        expect(screen.queryByRole('button', { name: 'Find nutrition for “T”' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create “T”' })).toBeNull();
        expect(screen.queryByText('Search USDA for “T”')).toBeNull();
    });

    it('offers them as soon as the query reaches two characters', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'To' } });
        settleDebounce();

        expect(screen.getByRole('button', { name: 'Find nutrition for “To”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create “To”' })).toBeTruthy();
        expect(screen.getByText('Search USDA for “To”')).toBeTruthy();
    });

    it('offers nothing at all while the field is still empty', () => {
        useSuggestIngredientsMock.mockReturnValue(searchResult());

        render(<IngredientPicker onResolve={vi.fn()} />);
        settleDebounce();

        expect(screen.queryByRole('button', { name: /^Find nutrition for/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull();
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
        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_new',
            name: 'Nduja',
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
        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_food',
            name: 'Quinoa',
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
        expect(onResolve).toHaveBeenCalledWith({
            id: 'ing_admitted',
            name: 'Chicken breast, raw',
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

        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'ing_1' }));
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
});
