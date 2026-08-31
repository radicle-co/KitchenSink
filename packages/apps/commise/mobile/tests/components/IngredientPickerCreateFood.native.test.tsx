/**
 * Mobile component tests for the U16 create-your-own-food vertical — every state of the shared
 * sub-machine as the NATIVE leaf renders it: the affordance, the open form (query prefilled), inline
 * per-field validation, submitting, the resolved create-and-attach, the ⛔ DISTINCT duplicate state with
 * its reuse affordance, the retryable submit failure, and cancel.
 *
 * The mobile mirror of `web/tests/components/recipes/IngredientPickerCreateFood.test.tsx`, not a
 * re-derivation: the decision layer is the SHARED `useIngredientResolver().createFood`, so what differs
 * between the platforms is only the markup — exactly what a per-platform suite should pin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useAddIngredientByFood,
    useAddIngredientByName,
    useCreateAuthoredFoodViaPicker,
    useCreateIngredient,
    useIngredientCandidates,
    useRecordIngredientCorrection,
    useResolveIngredient,
    useSearchIngredientsLive,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';
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
    useCreateAuthoredFoodViaPicker: vi.fn(),
}));

const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientCandidatesMock = vi.mocked(useIngredientCandidates);
const useResolveIngredientMock = vi.mocked(useResolveIngredient);
const useSearchIngredientsLiveMock = vi.mocked(useSearchIngredientsLive);
const useRecordIngredientCorrectionMock = vi.mocked(useRecordIngredientCorrection);
const useCreateAuthoredFoodViaPickerMock = vi.mocked(useCreateAuthoredFoodViaPicker);

/** An inert mutation double. */
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

/** A mutation double whose `mutate` synchronously settles with `outcome` (or calls onError when it is an Error). */
function settlingMutation(outcome: unknown): never {
    return idleMutation({
        mutate: vi.fn(
            (_arg: unknown, options?: { onSuccess?: (v: unknown) => void; onError?: (e: unknown) => void }) => {
                if (outcome instanceof Error) {
                    options?.onError?.(outcome);

                    return;
                }

                options?.onSuccess?.(outcome);
            },
        ),
    });
}

/** Render, type a settled query, and open the create form from the affordance. */
function openForm(onResolve = vi.fn()): ReturnType<typeof vi.fn> {
    render(<IngredientPicker onResolve={onResolve} />);
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'grandma blend' } });
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
    fireEvent.click(screen.getByLabelText('Create your own food'));

    return onResolve;
}

/** Fill the four macro fields with a valid profile. */
function fillMacros(): void {
    fireEvent.change(screen.getByLabelText('Calories (kcal)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Protein (g)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Carbs (g)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Fat (g)'), { target: { value: '5' } });
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
    useSearchIngredientsLiveMock.mockReturnValue(idleMutation());
    useRecordIngredientCorrectionMock.mockReturnValue(idleMutation());
    useCreateAuthoredFoodViaPickerMock.mockReturnValue(idleMutation());
});

describe('IngredientPicker (mobile) — the U16 create-your-own-food vertical', () => {
    it('offers the affordance on an empty result set and opens the form with the query prefilled', () => {
        openForm();

        // ⚠️ Not getByLabelText('Create “grandma blend”'): mobile's FREEFORM fallback carries the same
        // "Create “{query}”" label, so the form is identified by its own fields instead.
        expect((screen.getByLabelText('Food name') as HTMLInputElement).value).toBe('grandma blend');
        // The only-you promise (D9a/U11) is on screen before anything is submitted.
        expect(screen.getByText('Only you can see foods you create.')).toBeTruthy();
    });

    it('renders INLINE per-field errors on an invalid submit — nothing reaches the wire', () => {
        const mutate = vi.fn();

        useCreateAuthoredFoodViaPickerMock.mockReturnValue(idleMutation({ mutate }));
        openForm();
        fireEvent.click(screen.getByLabelText('Create and add'));

        expect(screen.getAllByText('Required')).toHaveLength(4);
        expect(mutate).not.toHaveBeenCalled();
    });

    it('creates and ATTACHES in one flow — the resolved line reaches onResolve and the form closes', () => {
        const admitted = makeIngredient({ id: 'ing-a1', name: 'grandma blend', foodId: 'F_new' });

        useCreateAuthoredFoodViaPickerMock.mockReturnValue(settlingMutation({ created: true, ingredient: admitted }));

        const onResolve = openForm();

        fillMacros();
        fireEvent.click(screen.getByLabelText('Create and add'));

        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing-a1' }));
        expect(screen.queryByLabelText('Food name')).toBeNull();
    });

    it('⛔ the per-author duplicate renders its OWN sentence and a working reuse affordance', () => {
        const existing = makeIngredient({ id: 'ing-prior', name: 'grandma blend', foodId: 'F_prior' });

        useCreateAuthoredFoodViaPickerMock.mockReturnValue(
            settlingMutation({ created: false, reason: 'duplicate', existingFoodId: 'F_prior' }),
        );
        useAddIngredientByFoodMock.mockReturnValue(settlingMutation(existing));

        const onResolve = openForm();

        fillMacros();
        fireEvent.click(screen.getByLabelText('Create and add'));

        expect(screen.getByText('You already have a food named “grandma blend”.')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Use that one'));

        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing-prior' }));
    });

    it('a FAILED create surfaces the retryable alert with every field intact', () => {
        useCreateAuthoredFoodViaPickerMock.mockReturnValue(settlingMutation(new Error('down')));

        openForm();
        fillMacros();
        fireEvent.click(screen.getByLabelText('Create and add'));

        expect(screen.getByText('Could not create the food. Check your connection and try again.')).toBeTruthy();
        expect((screen.getByLabelText('Calories (kcal)') as HTMLInputElement).value).toBe('100');
    });

    it('cancel closes the form and returns to the search results', () => {
        openForm();
        fireEvent.click(screen.getByLabelText('Cancel'));

        expect(screen.queryByLabelText('Food name')).toBeNull();
        expect(screen.getByLabelText('Search ingredients')).toBeTruthy();
    });
});
