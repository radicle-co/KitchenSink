// @vitest-environment jsdom
/**
 * Component tests, through the REAL web `Combobox`, of the Suggested foods in an ingredient entry field (owner ruling
 * 2026-11-03; designer answer N2 in `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`, "no new step ... it is
 * never the active option when the list opens, so Enter alone does not pick it"; the 2026-10-25 ruling, ADR-0070: the UI
 * never auto-selects).
 *
 * The row editor is the stateful fake (`useFakeRowEditor`), so the entry's text and active field move as they do in the
 * app; the list, the suggestions and the picks are what a test passes in. Only the web leaf has arrow keys and Enter, so
 * the keyboard half lives here and native's press half in `RecipeIngredientsFields.suggested.native.test.tsx`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeLookupRetry, makeIngredientNutrition, withLineKeys } from '../../__fixtures__/index.js';
import { answeredGroup, makeCatalogFoodOption, settledFoodView } from '../../__fixtures__/foodSearchViews.js';
import { useFakeRowEditor, type FakeRowEditorOverrides } from '../../__fixtures__/useFakeRowEditor.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which the list calls as it opens.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

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
        <RecipeIngredientsFields
            values={values}
            onChange={setValues}
            nutrition={makeIngredientNutrition()}
            lookupRetry={makeLookupRetry()}
            rowEditor={rowEditor}
        />
    );
};

/** Open the row's list on a view that carries one suggestion, and answer the spies the picks reach. */
async function openList() {
    const user = userEvent.setup();
    const selectSuggestion = vi.fn();
    const selectFood = vi.fn();

    render(<Harness over={{ entry: { view: VIEW, suggestions: [SUGGESTED_ROOT], selectSuggestion, selectFood } }} />);
    const field = screen.getByRole<HTMLInputElement>('combobox', { name: 'Ingredient 1 name' });

    await user.click(field);
    await user.keyboard('!');

    return { user, field, selectSuggestion, selectFood, options: await screen.findAllByRole('option') };
}

describe('Suggested foods in the entry field, web', () => {
    it('lists the Suggested food first, tagged, named so the name starts with what is seen (2.5.3)', async () => {
        const { options } = await openList();

        expect(options[0]?.textContent).toContain('Kale, baby');
        expect(options[0]?.textContent).toContain('Suggested');
        expect(screen.getByRole('option', { name: 'Kale, baby, suggested' })).toBe(options[0]);
        expect(options.map((option) => option.textContent).some((text) => text?.includes('Kale, raw'))).toBe(true);
    });

    it('⛔ never auto-selects: no option is active when the list opens, and Enter alone picks nothing', async () => {
        const { user, field, selectSuggestion, selectFood } = await openList();

        expect(field.getAttribute('aria-activedescendant') ?? '').toBe('');

        await user.keyboard('{Enter}');

        expect(selectSuggestion).not.toHaveBeenCalled();
        expect(selectFood).not.toHaveBeenCalled();
    });

    it('ArrowDown makes the first option, the Suggested one, active; Enter then picks it', async () => {
        const { user, field, options, selectSuggestion, selectFood } = await openList();

        await user.keyboard('{ArrowDown}');

        expect(options[0]?.id).not.toBe('');
        expect(field.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
        expect(selectSuggestion).not.toHaveBeenCalled();

        await user.keyboard('{Enter}');

        expect(selectSuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTED_ROOT);
        expect(selectFood).not.toHaveBeenCalled();
    });

    it('a press on the Suggested option picks it', async () => {
        const { user, selectSuggestion } = await openList();

        await user.click(screen.getByRole('option', { name: 'Kale, baby, suggested' }));

        expect(selectSuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTED_ROOT);
    });
});
