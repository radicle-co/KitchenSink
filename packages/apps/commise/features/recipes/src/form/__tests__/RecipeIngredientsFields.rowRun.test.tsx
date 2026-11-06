// @vitest-environment jsdom
/**
 * Issue #144 (web): an ingredient row reads as ONE text run, "amount food · preparation" (UI Designer ruling
 * 2026-11-06). The amount column (`w-[4.5rem]`) is gone, so the amount and the food are not two layout boxes and the
 * text wraps only between words. The amount keeps its no-break space ("2 tablespoons" never splits), the amount and
 * the food are joined by an ordinary space, and the open control's name holds the same visible text (WCAG 2.5.3).
 *
 * Layout cannot be measured under jsdom, so the structure is the proof: the amount and the food text are siblings in
 * ONE element, and nothing in the control is a fixed-width column.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

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
