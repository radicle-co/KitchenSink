// @vitest-environment jsdom
/**
 * Issue #144 (web): an ingredient row reads as ONE text run, "amount food · preparation" (UI Designer ruling
 * 2026-11-06). The fixed amount column is gone, so the amount and the food are not two layout boxes and the
 * text wraps only between words. The amount keeps its no-break space ("2 tablespoons" never splits), the amount and
 * the food are joined by an ordinary space, and the open control's name holds the same visible text (WCAG 2.5.3).
 *
 * Layout cannot be measured under jsdom, so the structure is the proof: the amount and the food text are siblings in
 * ONE element, and nothing in the control is a fixed-width column.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { recipeMessages } from '../../messages.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import { defaultRecipeFormValues } from '../values.js';
import {
    makeIngredientNutrition,
    makeIngredientRowEditor,
    makeLookupRetry,
    withLineKeys,
    type UnkeyedFormIngredient,
} from '../../__fixtures__/index.js';

vi.mock('../../layout/useMainContainerClass.js', () => ({ useMainContainerClass: () => 'narrow' }));
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));

afterEach(cleanup);

const LONG = 'extra virgin cold pressed Greek olive oil from the first harvest of the year';
const line = (over: Partial<UnkeyedFormIngredient>): UnkeyedFormIngredient => ({
    ingredientId: 'ing_1',
    foodId: 'food_1',
    isUserEntered: false,
    name: 'x',
    quantity: 1,
    unit: '',
    ...over,
});

const rowButton = (ingredient: UnkeyedFormIngredient, name: string): HTMLElement => {
    render(
        <RecipeIngredientsFields
            values={{ ...defaultRecipeFormValues(), ingredients: withLineKeys([ingredient]) }}
            onChange={() => undefined}
            nutrition={makeIngredientNutrition()}
            lookupRetry={makeLookupRetry()}
            rowEditor={makeIngredientRowEditor()}
        />,
    );

    return screen.getByRole('button', { name });
};

const cases = [
    {
        title: '2 tablespoons unsalted butter · melted',
        ingredient: line({ name: 'unsalted butter', quantity: 2, unit: 'tablespoons', preparation: 'melted' }),
        name: 'Edit 2 tablespoons unsalted butter, melted',
        amount: '2\u00A0tablespoons',
        run: '2\u00A0tablespoons unsalted butter\u00A0· , melted',
    },
    {
        title: '1½ cups whole milk',
        ingredient: line({ name: 'whole milk', quantity: 1.5, unit: 'cups' }),
        name: 'Edit 1½ cups whole milk',
        amount: '1½\u00A0cups',
        run: '1½\u00A0cups whole milk',
    },
    {
        title: '2–3 cups chicken stock',
        ingredient: line({ name: 'chicken stock', quantity: 2, quantityHigh: 3, unit: 'cups' }),
        name: 'Edit 2–3 cups chicken stock',
        amount: '2–3\u00A0cups',
        run: '2–3\u00A0cups chicken stock',
    },
    {
        title: 'a long food name',
        ingredient: line({ name: LONG, quantity: 2, unit: 'tablespoons' }),
        name: `Edit 2 tablespoons ${LONG}`,
        amount: '2\u00A0tablespoons',
        run: `2\u00A0tablespoons ${LONG}`,
    },
];

describe('IngredientRow (web) — amount and food are ONE text run (#144)', () => {
    it.each(cases)('$title: one run, an ordinary space, and the visible text in the name', (c) => {
        const button = rowButton(c.ingredient, c.name);
        const amount = within(button).getByText((_, el) => el?.textContent === c.amount && el.children.length === 0);
        const run = amount.parentElement!;

        expect(run.textContent).toBe(c.run);
        // The food's words are text in the SAME element as the amount: not a second box beside it.
        expect(
            Array.from(run.childNodes).some(
                (n) => n.nodeType === 3 && n.textContent?.includes(c.ingredient.name ?? ''),
            ),
        ).toBe(true);
        expect(amount.nextSibling?.textContent?.startsWith(' ')).toBe(true);
        expect(amount.nextSibling?.textContent?.startsWith('\u00A0')).toBe(false);
        // No fixed-width amount column survives, and no `nowrap` / clamp / clip on the run.
        expect(button.querySelector('[class*="w-["]')).toBeNull();
        expect(run.className).not.toMatch(/nowrap|line-clamp|truncate|overflow-hidden/);
        // WCAG 2.5.3: the visible words are in the accessible name.
        expect(button.getAttribute('aria-label')).toBe(c.name);
    });
});

describe('IngredientRow (web) — a stand-in row (#144, UI Designer)', () => {
    const label = recipeMessages.en.ingredientLineName.privateFood;
    const standIn = (over: Partial<UnkeyedFormIngredient>): UnkeyedFormIngredient => ({
        ingredientId: 'ing_9',
        isUserEntered: false,
        resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('WITH an amount: the amount is its own line above the chip, and the name reads amount then chip', () => {
        const button = rowButton(standIn({}), `Edit 2 tbsp ${label}`);
        const amount = within(button).getByText(
            (_, el) => el?.textContent === '2\u00A0tbsp' && el.children.length === 0,
        );
        const chip = within(button).getByText(label);

        // The amount's line holds the amount alone: the chip is not inside it, so it cannot sit beside it.
        expect(amount.parentElement!.textContent).toBe('2\u00A0tbsp');
        expect(button.textContent!.indexOf('tbsp')).toBeLessThan(button.textContent!.indexOf(label));
        expect(amount.parentElement!.contains(chip)).toBe(false);
    });

    it('WITHOUT an amount: no empty line, and the chip comes first', () => {
        const button = rowButton(standIn({ quantity: Number.NaN, unit: '' }), `Edit ${label}`);
        const chip = within(button).getByText(label);
        const column = button.firstElementChild!;

        expect(Array.from(column.children).every((child) => (child.textContent ?? '') !== '')).toBe(true);
        expect(column.firstElementChild!.contains(chip)).toBe(true);
        expect(button.textContent).toBe(label);
    });
});
