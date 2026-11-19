/**
 * The ingredients list cooking mode draws: the lines scaled to the cook's servings, which ids are ticked, whether any
 * line of the list is ticked, the heading, and the note that says the steps still hold the recipe's own amounts. Every
 * expected string is read from `cookingMessages.en`, so a reword is one edit to the catalogue and never a hunt through
 * tests. These cases prove the list view's shape: `ingredients` in recipe order, `checked` and `hasTicks`.
 */
import { fillTemplate, pluralOf, resolveMessages } from '@commise/i18n';
import { allLinesFoodRemoved } from '@commise/features-recipes/cook';
import {
    ABSENT_QUANTITY,
    FoodResolutionStatus,
    statedQuantity,
    type IngredientQuantity,
    type RecipeIngredientView,
} from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { describe, expect, it } from 'vitest';

import { cookingMessages } from '../../messages.js';
import { cookingIngredientsView } from '../ingredientsView.js';

const copy = resolveMessages(cookingMessages, 'en');

/** A quantity the source stated, for a fixture. Narrowing here keeps the lines below readable. */
function stated(low: number, high?: number): IngredientQuantity {
    const quantity = statedQuantity(low, high);

    if (quantity === null) {
        throw new Error(`test fixture: ${low} is not a statable amount`);
    }

    return quantity;
}

const FLOUR: RecipeIngredientView = {
    ingredientId: 'ing_flour',
    name: 'flour',
    quantity: stated(1),
    unit: 'cup',
    isUserEntered: false,
};
const SALT: RecipeIngredientView = {
    ingredientId: 'ing_salt',
    name: 'salt',
    quantity: stated(1),
    unit: 'tsp',
    isUserEntered: false,
};
const TASTE: RecipeIngredientView = {
    ingredientId: 'ing_taste',
    name: 'Salt to taste',
    quantity: ABSENT_QUANTITY,
    isUserEntered: false,
};
const RANGE: RecipeIngredientView = {
    ingredientId: 'ing_oil',
    name: 'oil',
    quantity: stated(1, 2),
    unit: 'tbsp',
    isUserEntered: false,
};
const LINES = [FLOUR, SALT, TASTE, RANGE];

const viewOf = (over: Partial<Parameters<typeof cookingIngredientsView>[0]> = {}) =>
    cookingIngredientsView({
        ingredients: LINES,
        baseServings: 2,
        servings: 2,
        ticked: new Set(),
        copy,
        locale: 'en',
        ...over,
    });

describe('cookingIngredientsView', () => {
    it.each([1, 2, 100])('shows the rows the recipe page would show at %i servings', (servings) => {
        const view = viewOf({ servings });
        const page = scaleRecipeForServings(
            makeRecipeDetail({ servings: 2, ingredients: [...LINES] }),
            servings,
        ).ingredients;

        expect(view.kind).toBe('list');
        expect(view.kind === 'list' ? view.ingredients : []).toEqual(page);
    });

    it('scales one and a half cups of flour at three servings from a base of two', () => {
        const view = viewOf({ servings: 3 });

        expect(view.kind === 'list' ? view.ingredients[0]?.quantity : undefined).toEqual(stated(1.5));
        expect(view.kind === 'list' ? view.ingredients[0]?.unit : undefined).toBe('cup');
    });

    it.each([1, 2, 100])('is none for a recipe with no ingredients, at %i servings', (servings) => {
        expect(viewOf({ ingredients: [], servings })).toEqual({ kind: 'none' });
    });

    it('titles the list for the servings and the number of items, singular and plural', () => {
        const one = viewOf({ ingredients: [FLOUR], servings: 4 });
        const three = viewOf({ ingredients: [FLOUR, SALT, TASTE], servings: 4 });

        expect(one.kind === 'list' ? one.title : '').toBe(
            fillTemplate(pluralOf(copy.ingredients.title, 1, 'en'), { servings: '4', count: '1' }),
        );
        expect(three.kind === 'list' ? three.title : '').toBe(
            fillTemplate(pluralOf(copy.ingredients.title, 3, 'en'), { servings: '4', count: '3' }),
        );
        expect(one.kind === 'list' ? one.title : '').not.toContain('1 items');
    });

    it('has a scale note only when the servings differ from the recipe’s own', () => {
        const same = viewOf({ servings: 2 });
        const scaled = viewOf({ servings: 3 });

        expect(same.kind === 'list' ? same.scaleNote : 'x').toBeUndefined();
        expect(scaled.kind === 'list' ? scaled.scaleNote : '').toBe(
            fillTemplate(copy.step.scaleNote, { base: '2', servings: '3' }),
        );
    });

    it('holds the ticked ids as given, whatever the order of the lines', () => {
        const ticked = new Set(['ing_salt']);
        const forward = viewOf({ ticked });
        const reversed = viewOf({ ticked, ingredients: [...LINES].reverse() });
        const idsOf = (view: ReturnType<typeof viewOf>): readonly string[] =>
            view.kind === 'list' ? view.ingredients.map((ingredient) => ingredient.ingredientId) : [];
        const tickedOf = (view: ReturnType<typeof viewOf>): readonly string[] =>
            view.kind === 'list' ? [...view.checked] : [];

        expect(idsOf(forward)).toEqual(LINES.map((line) => line.ingredientId));
        expect(idsOf(reversed)).toEqual([...LINES].reverse().map((line) => line.ingredientId));
        expect(tickedOf(forward)).toEqual(['ing_salt']);
        expect(tickedOf(reversed)).toEqual(['ing_salt']);
    });

    describe('hasTicks', () => {
        const hasTicksOf = (ticked: readonly string[]): boolean | undefined => {
            const view = viewOf({ ticked: new Set(ticked) });

            return view.kind === 'list' ? view.hasTicks : undefined;
        };

        it('is false when nothing is ticked', () => {
            expect(hasTicksOf([])).toBe(false);
        });

        it('is true when a line of the list is ticked', () => {
            expect(hasTicksOf(['ing_salt'])).toBe(true);
        });

        it('is false when the only ticked id is one that no line has, so a stale tick offers no Clear ticks', () => {
            expect(hasTicksOf(['ing_not_in_this_recipe'])).toBe(false);
        });
    });

    it('says every line is removed exactly when the recipe page says so', () => {
        const removed: RecipeIngredientView = {
            ...FLOUR,
            ingredientId: 'ing_gone',
            name: undefined,
            resolutionStatus: FoodResolutionStatus.FOOD_REMOVED,
        };
        const none = viewOf({ ingredients: [FLOUR] });
        const all = viewOf({ ingredients: [removed] });

        expect(none.kind === 'list' ? none.allRemoved : undefined).toBe(allLinesFoodRemoved([FLOUR]));
        expect(all.kind === 'list' ? all.allRemoved : undefined).toBe(allLinesFoodRemoved([removed]));
        expect(allLinesFoodRemoved([removed])).toBe(true);
    });
});
