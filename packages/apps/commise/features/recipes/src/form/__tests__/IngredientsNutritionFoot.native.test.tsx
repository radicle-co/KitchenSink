// @vitest-environment jsdom
/**
 * Component tests for `IngredientsNutritionFoot` (native): the section index's rail foot (build spec §7.2, §7.5.6). It
 * draws the SAME total as the Ingredients section's foot, from the same draft and read (`nutritionTotalViewOf`), and
 * offers no Try again of its own: the section's foot, on the same page, already does.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientNutrition, makeRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { IngredientsNutritionFoot } from '../IngredientsNutritionFoot.native.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const en = recipeFormMessages.en;
const values = makeRecipeFormValues({
    servings: 1,
    ingredients: withLineKeys([
        {
            ingredientId: 'ing_1',
            foodId: 'food_rice',
            name: 'Rice',
            quantity: 100,
            unit: 'g',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        },
    ]),
});

describe('IngredientsNutritionFoot (native)', () => {
    it('reads the running total for the rail foot', () => {
        render(
            <IngredientsNutritionFoot
                values={values}
                nutrition={makeIngredientNutrition({
                    lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130 } }),
                })}
            />,
        );

        expect(screen.getByText('130 cal per serving · 1 of 1 counted')).toBeTruthy();
    });

    it('never says "0 cal" while nothing is counted', () => {
        render(
            <IngredientsNutritionFoot
                values={values}
                nutrition={makeIngredientNutrition({ lookup: () => ({ state: 'absent' }) })}
            />,
        );

        expect(screen.getByText(en.nutritionEmpty)).toBeTruthy();
    });

    it('says the read failed with no Try again of its own', () => {
        render(<IngredientsNutritionFoot values={values} nutrition={makeIngredientNutrition({ read: 'failed' })} />);

        expect(screen.getByText(en.nutritionLoadFailed)).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('loading is skeleton text, heard as loading', () => {
        render(<IngredientsNutritionFoot values={values} nutrition={makeIngredientNutrition({ read: 'loading' })} />);

        expect(screen.getByLabelText(en.nutritionLoading)).toBeTruthy();
    });
});
