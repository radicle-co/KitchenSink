/**
 * The web cooking ingredients list: pure props to markup over the recipe page's own row and servings stepper, with
 * nothing mocked. The view comes from the real `cookingIngredientsView`, the copy from the real catalogue, and the
 * rows and the stepper are the real `./cook` leaves, so a row that names a line differently from the page, or a stepper
 * that does not call back, fails here. The list owns no state: every case reads what it draws and what it calls.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider } from '@commise/features-recipes/cook';
import { ABSENT_QUANTITY, statedQuantity, type RecipeIngredientView } from '@kitchensink/recipe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookingMessages } from '../../messages.js';
import { CookingIngredientsList } from '../CookingIngredientsList.js';
import type { CookingIngredientsListProps, CookingIngredientsListView } from '../cookingIngredientsListProps.js';
import { cookingIngredientsView } from '../ingredientsView.js';

const user = userEvent.setup({ delay: null });
const copy = resolveMessages(cookingMessages, 'en');

afterEach(cleanup);

const line = (id: string, name: string): RecipeIngredientView => ({
    ingredientId: id,
    name,
    quantity: statedQuantity(1) ?? ABSENT_QUANTITY,
    unit: 'cup',
    isUserEntered: false,
});

const FLOUR = line('ing_flour', 'flour');
const SUGAR = line('ing_sugar', 'sugar');
const BUTTER = line('ing_butter', 'butter');
const LINES = [FLOUR, SUGAR, BUTTER];

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

/** The list view the screen would hand over, from the real view model. */
function viewOf(
    options: { readonly ticked?: readonly string[]; readonly servings?: number } = {},
): CookingIngredientsListView {
    const view = cookingIngredientsView({
        ingredients: LINES,
        baseServings: 2,
        servings: options.servings ?? 2,
        ticked: new Set(options.ticked ?? []),
        copy,
        locale: 'en',
    });

    if (view.kind !== 'list') {
        throw new Error('The fixture recipe has ingredients, so the view is a list.');
    }

    return view;
}

function mount(options: { readonly ticked?: readonly string[]; readonly servings?: number } = {}) {
    const props: CookingIngredientsListProps = {
        view: viewOf(options),
        copy: copy.ingredients,
        onToggle: vi.fn(),
        onSetServings: vi.fn(),
        onClear: vi.fn(),
    };

    render(<CookingIngredientsList {...props} />, { wrapper: Wrapper });

    return props;
}

describe('CookingIngredientsList (web)', () => {
    it('says its title, once, as a heading', () => {
        const props = mount();

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(screen.getByRole('heading').textContent).toBe(props.view.title);
    });

    it('draws one checkbox per line in the recipe order, with the ticked ones checked', () => {
        mount({ ticked: ['ing_sugar'] });

        const boxes = screen.getAllByRole('checkbox');

        expect(boxes.map((box) => box.textContent)).toEqual([
            expect.stringContaining('flour'),
            expect.stringContaining('sugar'),
            expect.stringContaining('butter'),
        ]);
        expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    });

    it('calls onToggle with the ingredient id of the pressed row, and nothing else', async () => {
        const props = mount();

        await user.click(within(screen.getByRole('checkbox', { name: /butter/ })).getByText(/butter/));

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith('ing_butter');
        expect(props.onClear).not.toHaveBeenCalled();
        expect(props.onSetServings).not.toHaveBeenCalled();
    });

    it('asks for one more serving than the list shows, through the page stepper', async () => {
        const props = mount({ servings: 4 });

        await user.click(screen.getByRole('button', { name: 'More servings' }));

        expect(props.onSetServings).toHaveBeenCalledExactlyOnceWith(5);
    });

    it('draws Clear ticks only while a line is ticked, and calls onClear when it is pressed', async () => {
        const none = mount();

        expect(screen.queryByRole('button', { name: copy.ingredients.clear })).toBeNull();
        expect(none.onClear).not.toHaveBeenCalled();
        cleanup();

        const some = mount({ ticked: ['ing_flour'] });

        await user.click(screen.getByRole('button', { name: copy.ingredients.clear }));

        expect(some.onClear).toHaveBeenCalledOnce();
    });
});
