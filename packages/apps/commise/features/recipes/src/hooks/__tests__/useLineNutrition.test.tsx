// @vitest-environment jsdom
/**
 * Unit tests for `useLineNutrition` — the editor's ONE background nutrition read (plan 002 V1 B5, blueprint
 * Decision 3). The client hook is mocked: what is pinned here is what this adapter ASKS for (the draft's distinct
 * refs, with the previous answer kept on screen) and how it reads the answer back. The mapping itself is covered by
 * `nutritionLookup.test.ts`.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIngredientFoodNutrition } from '@kitchensink/recipe-service-client/hooks';

import { makeRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { useLineNutrition } from '../useLineNutrition.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({ useIngredientFoodNutrition: vi.fn() }));

const useIngredientFoodNutritionMock = vi.mocked(useIngredientFoodNutrition);
const refetch = vi.fn();
const queryReturning = (over: Record<string, unknown>) =>
    ({ data: undefined, isPlaceholderData: false, isError: false, refetch, ...over }) as unknown as ReturnType<
        typeof useIngredientFoodNutrition
    >;

afterEach(() => {
    vi.clearAllMocks();
});

const values = makeRecipeFormValues({
    ingredients: withLineKeys([
        { ingredientId: 'a', name: 'Rice', quantity: 1, isUserEntered: false, foodRef: { kind: 'root', id: 'rice' } },
        {
            ingredientId: 'b',
            name: 'Rice again',
            quantity: 1,
            isUserEntered: false,
            foodRef: { kind: 'root', id: 'rice' },
        },
        { ingredientId: 'c', name: 'Mine', quantity: 1, isUserEntered: true },
    ]),
});

describe('useLineNutrition', () => {
    it('asks ONE read for the draft’s distinct refs, keeping the previous answer while a new one runs', () => {
        useIngredientFoodNutritionMock.mockReturnValue(queryReturning({}));

        renderHook(() => useLineNutrition(values));

        expect(useIngredientFoodNutritionMock).toHaveBeenCalledWith([{ kind: 'root', id: 'rice' }], {
            keepPreviousData: true,
        });
    });

    it('reads the answer back per line, and is loading until it lands', () => {
        useIngredientFoodNutritionMock.mockReturnValue(queryReturning({}));
        const loading = renderHook(() => useLineNutrition(values)).result.current;
        expect(loading.read).toBe('loading');

        useIngredientFoodNutritionMock.mockReturnValue(
            queryReturning({
                data: {
                    entries: [
                        {
                            outcome: 'found',
                            ref: { kind: 'root', id: 'rice' },
                            freshness: 'fresh',
                            caloriesPer100g: 130,
                            portions: [],
                        },
                    ],
                },
            }),
        );
        const ready = renderHook(() => useLineNutrition(values)).result.current;

        expect(ready.read).toBe('ready');
        expect(ready.lookup({ kind: 'root', id: 'rice' })).toEqual({
            state: 'found',
            catalog: { caloriesPer100g: 130 },
        });
    });

    it('Try again refetches the read', () => {
        useIngredientFoodNutritionMock.mockReturnValue(queryReturning({ isError: true }));
        const { result } = renderHook(() => useLineNutrition(values));
        expect(result.current.read).toBe('failed');

        result.current.retry();

        expect(refetch).toHaveBeenCalledTimes(1);
    });
});
