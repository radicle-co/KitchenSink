/**
 * Cooking mode's ingredients list against the recipe page's own pieces, with nothing mocked: the real
 * `CookMarksProvider` (marks in `sessionStorage`), the real serving scale, recipe-core's scaling and the real
 * `IngredientCheckRow` the page draws. A mock of any of them would hide the drift this tier exists to catch: a row that
 * names an amount differently from the page, or a tick the page never sees.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider, IngredientCheckRow, useCookMarks, useServingScale } from '@commise/features-recipes/cook';
import { ABSENT_QUANTITY, statedQuantity, type RecipeIngredientView } from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { cookingMessages } from '../../src/messages.js';
import { useCookingIngredients } from '../../src/ingredients/useCookingIngredients.js';

afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
});

const copy = resolveMessages(cookingMessages, 'en');

const line = (id: string, name: string, low: number, unit?: string, high?: number): RecipeIngredientView => ({
    ingredientId: id,
    name,
    quantity: statedQuantity(low, high) ?? ABSENT_QUANTITY,
    ...(unit === undefined ? {} : { unit }),
    isUserEntered: false,
});

const FLOUR = line('ing_flour', 'flour', 1, 'cup');
const SALT = line('ing_salt', 'salt', 1, 'tsp');
const OIL = line('ing_oil', 'oil', 1, 'tbsp', 2);
const TASTE: RecipeIngredientView = {
    ingredientId: 'ing_taste',
    name: 'pepper to taste',
    quantity: ABSENT_QUANTITY,
    isUserEntered: false,
};
const LINES = [FLOUR, SALT, OIL, TASTE];

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

let counter = 0;
const nextId = (): string => `rec_int_${String((counter += 1))}`;

/** The accessible names of the checkboxes a list of lines draws through the page's own row. */
function namesOfRows(lines: readonly RecipeIngredientView[]): readonly string[] {
    render(
        <ul>
            {lines.map((ingredient) => (
                <IngredientCheckRow
                    key={ingredient.ingredientId}
                    ingredient={ingredient}
                    checked={false}
                    allRemoved={false}
                    onToggle={() => undefined}
                />
            ))}
        </ul>,
        { wrapper: Wrapper },
    );

    const names = screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label') ?? '');

    cleanup();

    return names;
}

describe('cooking mode ingredients against the recipe page', () => {
    it.each([1, 2, 100])('names every row as the page does at %i servings', (servings) => {
        const id = nextId();
        const { result } = renderHook(
            () => useCookingIngredients({ recipe: { id, ingredients: LINES, servings: 2 }, copy, locale: 'en' }),
            { wrapper: Wrapper },
        );

        act(() => {
            result.current.setServings(servings);
        });

        const cookingRows = result.current.view.kind === 'list' ? result.current.view.ingredients : [];
        const pageRows = scaleRecipeForServings(
            makeRecipeDetail({ servings: 2, ingredients: [...LINES] }),
            servings,
        ).ingredients;

        expect(namesOfRows(cookingRows)).toEqual(namesOfRows(pageRows));
        expect(namesOfRows(cookingRows)).toHaveLength(LINES.length);
    });

    it('shows one and a half cups of flour when two servings become three', () => {
        const id = nextId();
        const { result } = renderHook(
            () => useCookingIngredients({ recipe: { id, ingredients: LINES, servings: 2 }, copy, locale: 'en' }),
            { wrapper: Wrapper },
        );

        act(() => {
            result.current.setServings(3);
        });

        const rows = result.current.view.kind === 'list' ? result.current.view.ingredients : [];

        expect(namesOfRows(rows)[0]).toBe('1½ cups flour');
    });

    it('ticks a line through the real row, and the page’s own marks binding sees it', async () => {
        const id = nextId();
        const user = userEvent.setup();
        // The cooking list and the page's marks binding sit under ONE provider, as the app root mounts them.
        const both = renderHook(
            () => ({
                cooking: useCookingIngredients({ recipe: { id, ingredients: LINES, servings: 2 }, copy, locale: 'en' }),
                marks: useCookMarks(id, LINES),
            }),
            { wrapper: Wrapper },
        );

        render(
            <ul>
                {LINES.map((ingredient, position) => (
                    <IngredientCheckRow
                        key={ingredient.ingredientId}
                        ingredient={ingredient}
                        checked={false}
                        allRemoved={false}
                        onToggle={() => {
                            both.result.current.cooking.toggle(position);
                        }}
                    />
                ))}
            </ul>,
        );
        const [firstTick] = screen.getAllByRole('checkbox');
        await user.click(firstTick);

        expect([...both.result.current.marks.checkedLines]).toEqual([0]);
    });

    it('clears the ticks, keeps the step, and Undo brings the cleared ticks back', () => {
        const id = nextId();
        const { result } = renderHook(
            () => ({
                cooking: useCookingIngredients({ recipe: { id, ingredients: LINES, servings: 2 }, copy, locale: 'en' }),
                marks: useCookMarks(id, LINES),
                scale: useServingScale(id, 2),
            }),
            { wrapper: Wrapper },
        );
        let undo: () => void = () => undefined;

        act(() => {
            result.current.marks.toggleStep(3);
            result.current.cooking.toggle(0);
            result.current.cooking.toggle(1);
        });
        act(() => {
            undo = result.current.cooking.clearTicks();
        });

        expect(result.current.marks.checkedLines.size).toBe(0);
        expect(result.current.marks.currentStep).toBe(3);

        act(() => {
            undo();
        });

        expect(new Set(result.current.marks.checkedLines)).toEqual(new Set([0, 1]));
        expect(result.current.marks.currentStep).toBe(3);
    });
});
