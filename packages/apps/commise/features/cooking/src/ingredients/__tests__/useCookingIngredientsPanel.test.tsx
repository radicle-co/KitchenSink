/**
 * The ingredients panel model: what each screen draws for the ingredients at each width band, over the REAL cook marks,
 * serving scale and catalogue (nothing mocked). Narrow, the top bar offers Ingredients, the scale note offers its open
 * button and the sheet exists. Wide, the column exists and neither control does. The sheet closes whenever the band
 * changes, so a window that goes wide and back never reopens it.
 */
import { CookMarksProvider, useServingScale } from '@commise/features-recipes/cook';
import { resolveMessages } from '@commise/i18n';
import { act, renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeCookingRecipe } from '../../__fixtures__/makeCookingRecipe.js';
import { makeRecipeIngredientView } from '../../__fixtures__/makeRecipeIngredientView.js';
import { cookingMessages } from '../../messages.js';
import { useCookingIngredientsPanel } from '../useCookingIngredientsPanel.js';

const copy = resolveMessages(cookingMessages, 'en');

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

afterEach(() => {
    window.sessionStorage.clear();
});

let counter = 0;

/** The panel for a fresh recipe (the serving scale is a module singleton keyed by recipe id). */
function mount(options: { readonly wide: boolean; readonly lines?: number } = { wide: false }) {
    counter += 1;
    const id = `rec_panel_${String(counter)}`;
    const ingredients = Array.from({ length: options.lines ?? 2 }, (_, index) =>
        makeRecipeIngredientView({ ingredientId: `ing_${String(index)}`, name: `item ${String(index)}` }),
    );
    const recipe = makeCookingRecipe({ id, ingredients, servings: 2 });

    return renderHook(
        ({ wide }: { readonly wide: boolean }) => ({
            panel: useCookingIngredientsPanel({ recipe, copy, locale: 'en', wide }),
            scale: useServingScale(id, 2),
        }),
        { wrapper: Wrapper, initialProps: { wide: options.wide } },
    );
}

describe('useCookingIngredientsPanel', () => {
    describe('narrow', () => {
        it('offers Ingredients in the top bar, with the sheet closed and no column', () => {
            const { result } = mount();
            const { panel } = result.current;

            expect(panel.topAction?.label).toBe('Ingredients');
            expect(panel.sheet?.open).toBe(false);
            expect(panel.column).toBeUndefined();
        });

        it('opens the sheet from the top bar and closes it from onClose', () => {
            const { result } = mount();

            act(() => result.current.panel.topAction?.onPress());
            expect(result.current.panel.sheet?.open).toBe(true);

            act(() => result.current.panel.sheet?.onClose());
            expect(result.current.panel.sheet?.open).toBe(false);
        });

        it('has no scale note at the recipe servings', () => {
            expect(mount().result.current.panel.scaleNote).toBeUndefined();
        });

        it('gives the scale note an open button that opens the sheet, once the servings differ', () => {
            const { result } = mount();

            act(() => result.current.scale.setServings(4));

            const note = result.current.panel.scaleNote;

            expect(note?.note).toBe(
                'The steps give amounts for 2. You’re making 4, so use the amounts in Ingredients.',
            );
            expect(note?.openLabel).toBe('Open ingredients');

            act(() => note?.onOpen?.());
            expect(result.current.panel.sheet?.open).toBe(true);
        });
    });

    describe('wide', () => {
        it('draws the column, with no top bar action and no sheet', () => {
            const { result } = mount({ wide: true });
            const { panel } = result.current;

            expect(panel.column?.view.kind).toBe('list');
            expect(panel.topAction).toBeUndefined();
            expect(panel.sheet).toBeUndefined();
        });

        it('keeps the scale note but gives it no open button, because the column is in view', () => {
            const { result } = mount({ wide: true });

            act(() => result.current.scale.setServings(4));

            expect(result.current.panel.scaleNote?.note).toContain('You’re making 4');
            expect(result.current.panel.scaleNote?.onOpen).toBeUndefined();
        });
    });

    describe('crossing the band', () => {
        it('closes an open sheet when the window goes wide, and keeps it closed when it narrows again', () => {
            const { result, rerender } = mount();

            act(() => result.current.panel.topAction?.onPress());
            expect(result.current.panel.sheet?.open).toBe(true);

            rerender({ wide: true });
            rerender({ wide: false });

            expect(result.current.panel.sheet?.open).toBe(false);
        });
    });

    describe('a recipe with no ingredients', () => {
        it.each([false, true])('offers nothing to open (wide: %s)', (wide) => {
            const { result } = mount({ wide, lines: 0 });
            const { panel } = result.current;

            expect(panel.topAction).toBeUndefined();
            expect(panel.sheet).toBeUndefined();
            expect(panel.column).toBeUndefined();
            expect(panel.scaleNote).toBeUndefined();
        });
    });

    // P60: Clear ticks ships with its Undo or not at all, and the Undo's outlet (the cooking snackbar) is not on main yet.
    it.each([false, true])('gives the list no onClear, so Clear ticks is not drawn (wide: %s)', (wide) => {
        const { result } = mount({ wide });
        const frame = result.current.panel.sheet ?? result.current.panel.column;

        expect(frame).toBeDefined();
        expect(frame?.onClear).toBeUndefined();
    });

    it('ticks a line through the panel, and the column reads it back', () => {
        const { result } = mount({ wide: true });

        act(() => result.current.panel.column?.onToggle(0));

        expect(result.current.panel.column?.view.checked.has(0)).toBe(true);
    });
});
