/**
 * Component tests, through the REAL native `Combobox` (react-native-web in jsdom), of the Suggested foods in an
 * ingredient entry field (owner ruling 2026-11-03; designer answer N2: "never the active option when the list opens, so
 * Enter alone does not pick it. Web and mobile alike"; ADR-0070: the UI never auto-selects).
 *
 * Native has no arrow keys and no active option: its options are buttons, and the keyboard's submit key chooses
 * nothing. So the claim here is that the Suggested option leads the list, that opening the list and submitting the
 * keyboard pick nothing, and that only a press picks.
 */
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { ScrollerDragContext } from '@commise/ui/field-reveal';
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeLookupRetry, makeIngredientNutrition, withLineKeys } from '../../__fixtures__/index.js';
import { answeredGroup, makeCatalogFoodOption, settledFoodView } from '../../__fixtures__/foodSearchViews.js';
import { useFakeRowEditor, type FakeRowEditorOverrides } from '../../__fixtures__/useFakeRowEditor.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

afterEach(cleanup);

const NO_FOOD = { ingredientId: null, name: 'Kale', quantity: 1, isUserEntered: false } as const;
const SUGGESTED_ROOT = { kind: 'root', id: 'food_kale_baby', name: 'Kale, baby', source: 'ownCorrection' } as const;
const VIEW = settledFoodView(
    answeredGroup(),
    answeredGroup(makeCatalogFoodOption({ id: 'food_kale', name: 'Kale, raw' })),
);

const Harness: FC<{ readonly over: FakeRowEditorOverrides }> = ({ over }) => {
    const [values, setValues] = useState<RecipeFormValues>({
        ...defaultRecipeFormValues(),
        ingredients: withLineKeys([NO_FOOD]),
    });
    const rowEditor = useFakeRowEditor(values.ingredients, {
        startInEntry: values.ingredients.map((line) => line.key),
        ...over,
    });

    return (
        <BackInterceptProvider onUnhandled={() => false}>
            <ScrollerDragContext.Provider value={() => () => undefined}>
                <RecipeIngredientsFields
                    values={values}
                    onChange={setValues}
                    nutrition={makeIngredientNutrition()}
                    lookupRetry={makeLookupRetry()}
                    rowEditor={rowEditor}
                />
            </ScrollerDragContext.Provider>
        </BackInterceptProvider>
    );
};

function openList() {
    const selectSuggestion = vi.fn();
    const selectFood = vi.fn();

    render(<Harness over={{ entry: { view: VIEW, suggestions: [SUGGESTED_ROOT], selectSuggestion, selectFood } }} />);
    const field = screen.getByLabelText('Ingredient 1 name');

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Kale!' } });

    return { field, selectSuggestion, selectFood };
}

describe('Suggested foods in the entry field, native', () => {
    it('leads the list with the Suggested food, tagged, named so the name starts with what is seen (2.5.3)', () => {
        openList();
        const list = within(screen.getByLabelText('Food suggestions for ingredient 1'));
        const first = list.getAllByRole('button')[0];

        expect(first).toBe(list.getByRole('button', { name: 'Kale, baby, suggested' }));
        expect(first?.textContent).toContain('Kale, baby');
        expect(first?.textContent).toContain('Suggested');
    });

    it('⛔ never auto-selects: opening the list and submitting the keyboard pick nothing', () => {
        const { field, selectSuggestion, selectFood } = openList();

        fireEvent.keyDown(field, { key: 'Enter' });

        expect(selectSuggestion).not.toHaveBeenCalled();
        expect(selectFood).not.toHaveBeenCalled();
    });

    it('a press on the Suggested option picks it, and only it', () => {
        const { selectSuggestion, selectFood } = openList();

        fireEvent.click(screen.getByRole('button', { name: 'Kale, baby, suggested' }));

        expect(selectSuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTED_ROOT);
        expect(selectFood).not.toHaveBeenCalled();
    });
});
