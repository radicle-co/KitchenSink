/**
 * Mobile component tests for the ingredient picker's ON-DEMAND live source search (plan U29) — the
 * "Search USDA for '…'" control that shipped STYLED BUT INERT in U6, and every state of the panel it now
 * opens: gated, pressable, searching, results, empty, busy, failed, dismissed.
 *
 * ⛔ **The first case is the one this file exists for: typing must never cause a source call.** The upstream
 * source allows 1,000 requests/hour PER IP shared by every cook, of which 003's FR-019 reserves only the top
 * 10% for user-facing work — so at 50 concurrent cooks a per-settled-query autocomplete would want roughly
 * three times the entire key. "It only fires on a press" is a claim until something types a whole word,
 * crosses the local debounce, and asserts the mutation stayed untouched.
 *
 * ⛔ **The three settled outcomes must stay three sentences.** "USDA has nothing for X" tells a cook to stop
 * looking; "rate-limited" and "didn't answer" tell them to try again, and only one of those is our own
 * limit. Each is asserted by its own copy, and the empty case asserts the other two are ABSENT.
 *
 * This is the mobile mirror of `web/tests/components/recipes/IngredientPickerLiveSearch.test.tsx`, not a
 * re-derivation: the decision layer is the SHARED `useOnDemandIngredientSearch`, so what differs between the
 * platforms is only the markup each leaf renders — which is exactly what a per-platform suite should pin.
 *
 * @implements FR-010a
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useAddIngredientByFood,
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useRecordIngredientCorrection,
    useResolveIngredient,
    useSearchIngredientsLive,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSuggestIngredients: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useAddIngredientByFood: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientCandidates: vi.fn(),
    useResolveIngredient: vi.fn(),
    useSearchIngredientsLive: vi.fn(),
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
const useSearchIngredientsLiveMock = vi.mocked(useSearchIngredientsLive);
const useRecordIngredientCorrectionMock = vi.mocked(useRecordIngredientCorrection);

/** An inert mutation double — what every hook this suite does not exercise returns. */
function idleMutation(overrides: Record<string, unknown> = {}): never {
    return {
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
        data: undefined,
        error: undefined,
        ...overrides,
    } as never;
}

/** The live-search mutation double, in whichever settled/in-flight shape a case needs. */
function liveMutation(overrides: Record<string, unknown> = {}): never {
    return idleMutation(overrides);
}

/** Render the picker and type `text` into its search box, settling the local debounce. */
function typeQuery(text: string): void {
    render(<IngredientPicker onResolve={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: text } });
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

beforeEach(() => {
    vi.useFakeTimers();
    useSuggestIngredientsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { suggestions: [], catalogAvailability: 'ok' },
    } as never);
    useAddIngredientByNameMock.mockReturnValue(idleMutation());
    useAddIngredientByFoodMock.mockReturnValue(idleMutation());
    useCreateIngredientMock.mockReturnValue(idleMutation());
    useIngredientCandidatesMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: false,
        data: undefined,
    } as never);
    useResolveIngredientMock.mockReturnValue(idleMutation());
    useSearchIngredientsLiveMock.mockReturnValue(liveMutation());
    useRecordIngredientCorrectionMock.mockReturnValue(idleMutation());
});

describe('IngredientPicker (mobile) — the on-demand USDA search affordance (U29)', () => {
    it('NEVER searches the source while the cook types — the whole quota argument rests on this', () => {
        const mutate = vi.fn();
        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ mutate }));

        render(<IngredientPicker onResolve={vi.fn()} />);
        const box = screen.getByLabelText('Search ingredients');

        for (const text of ['c', 'ch', 'chi', 'chick', 'chicken']) {
            fireEvent.change(box, { target: { value: text } });
        }

        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        // ⛔ Five keystrokes, past the local debounce, well past the search minimum — and nothing left.
        expect(mutate).not.toHaveBeenCalled();
    });

    it('offers the control once the query is typed, marked as the SLOW path', () => {
        typeQuery('broccoli');

        expect(screen.getByLabelText('Search USDA for “broccoli”')).toBeTruthy();
        // The warning is load-bearing: everything else settles in under a second and this takes several.
        expect(screen.getByText('Slow')).toBeTruthy();
    });

    it('does NOT offer the control below the search minimum (003-FR-010a)', () => {
        typeQuery('br');

        expect(screen.queryByLabelText(/Search USDA for/u)).toBeNull();
    });

    it('searches only when the control is pressed, with the trimmed query', () => {
        const mutate = vi.fn();
        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ mutate }));

        typeQuery('  broccoli  ');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));

        expect(mutate).toHaveBeenCalledExactlyOnceWith('broccoli');
    });

    it('shows a multi-second loading state while the source is being searched', () => {
        // The press has to happen while the control is still pressable, and the in-flight flag flips
        // AFTERWARDS — so the mock is swapped between the two, rather than starting pending (which would
        // mean asserting a state the cook could never have reached).
        const { rerender } = render(<IngredientPicker onResolve={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'broccoli' } });
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));

        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ isPending: true }));
        rerender(<IngredientPicker onResolve={vi.fn()} />);

        expect(screen.getByText('Searching the USDA database…')).toBeTruthy();
        // Says outright that seconds are expected, so the wait reads as the cook's choice, not a hang.
        expect(screen.getByText('This can take a few seconds.')).toBeTruthy();
        // ...and the control that started it is disabled meanwhile, so one press cannot spend the lane twice.
        expect(screen.getByLabelText('Search USDA for “broccoli”').getAttribute('aria-disabled')).toBe('true');
    });

    it('renders the source hits under their own heading', () => {
        useSearchIngredientsLiveMock.mockReturnValue(
            liveMutation({ data: { hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }, { name: 'Broccoli rabe' }] } }),
        );

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));

        expect(screen.getByText('From USDA')).toBeTruthy();
        expect(screen.getByText('Broccoli, raw')).toBeTruthy();
        expect(screen.getByText('Broccoli rabe')).toBeTruthy();
    });

    it('picks a hit we already hold through by-food — no second source call', () => {
        const byFood = vi.fn();
        useAddIngredientByFoodMock.mockReturnValue(idleMutation({ mutate: byFood }));
        const byName = vi.fn();
        useAddIngredientByNameMock.mockReturnValue(idleMutation({ mutate: byName }));
        useSearchIngredientsLiveMock.mockReturnValue(
            liveMutation({ data: { hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }] } }),
        );

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));
        fireEvent.click(screen.getByText('Broccoli, raw'));

        expect(byFood).toHaveBeenCalledWith('food_1', expect.anything());
        // ⛔ Re-admitting by name would re-enter the source fan-out for a food the crosswalk just identified.
        expect(byName).not.toHaveBeenCalled();
    });

    it('picks an unknown hit through by-name, the slower path it genuinely needs', () => {
        const byName = vi.fn((_name: string, options?: { onSuccess?: (value: unknown) => void }) => {
            options?.onSuccess?.(
                makeIngredient({
                    id: 'ing_2',
                    name: 'Broccoli rabe',
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );
        });
        useAddIngredientByNameMock.mockReturnValue(idleMutation({ mutate: byName }));
        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ data: { hits: [{ name: 'Broccoli rabe' }] } }));
        const onResolve = vi.fn();

        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'broccoli' } });
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));
        fireEvent.click(screen.getByText('Broccoli rabe'));

        expect(byName).toHaveBeenCalledWith('Broccoli rabe', expect.anything());
        expect(onResolve).toHaveBeenCalledTimes(1);
    });

    it('says the source has NOTHING — distinct from either failure — when it answers empty', () => {
        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ data: { hits: [] } }));

        typeQuery('zzzzz');
        fireEvent.click(screen.getByLabelText('Search USDA for “zzzzz”'));

        expect(screen.getByText('USDA has nothing for “zzzzz”. Add it as a custom ingredient instead.')).toBeTruthy();
        // ⛔ A cook here should STOP looking, so neither retry sentence appears and no retry is offered.
        expect(screen.queryByText(/didn’t answer/u)).toBeNull();
        expect(screen.queryByText(/rate-limited/u)).toBeNull();
        expect(screen.queryByLabelText('Try again')).toBeNull();
    });

    it('says the source is RATE-LIMITED, and offers a retry, when the budget refused', () => {
        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ error: { name: 'SourceBusyError' } }));

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));

        expect(screen.getByText(/rate-limited/u)).toBeTruthy();
        expect(screen.getByLabelText('Try again')).toBeTruthy();
    });

    it('says the source DIDN’T ANSWER — a different sentence — when it is down', () => {
        useSearchIngredientsLiveMock.mockReturnValue(liveMutation({ error: { name: 'SourceUnavailableError' } }));

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));

        expect(screen.getByText(/didn’t answer/u)).toBeTruthy();
        expect(screen.queryByText(/rate-limited/u)).toBeNull();
    });

    it('retries on demand after a failure, issuing a second search', () => {
        const mutate = vi.fn();
        useSearchIngredientsLiveMock.mockReturnValue(
            liveMutation({ mutate, error: { name: 'SourceUnavailableError' } }),
        );

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));
        fireEvent.click(screen.getByLabelText('Try again'));

        expect(mutate).toHaveBeenCalledTimes(2);
    });

    it('closes the panel on dismiss, without searching again', () => {
        const mutate = vi.fn();
        const reset = vi.fn();
        useSearchIngredientsLiveMock.mockReturnValue(
            liveMutation({ mutate, reset, data: { hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }] } }),
        );

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));
        fireEvent.click(screen.getByLabelText('Close USDA results'));

        expect(screen.queryByText('From USDA')).toBeNull();
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalled();
    });

    it('drops the panel when the cook types on, so hits never sit under a different query', () => {
        useSearchIngredientsLiveMock.mockReturnValue(
            liveMutation({ data: { hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }] } }),
        );

        typeQuery('broccoli');
        fireEvent.click(screen.getByLabelText('Search USDA for “broccoli”'));
        expect(screen.getByText('Broccoli, raw')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'cauliflower' } });
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        // ⛔ Otherwise the cook picks "Broccoli, raw" for a line they have already renamed.
        expect(screen.queryByText('Broccoli, raw')).toBeNull();
    });
});
