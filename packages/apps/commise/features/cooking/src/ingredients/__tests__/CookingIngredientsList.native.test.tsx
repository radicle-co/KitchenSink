/**
 * The native cooking ingredients list: pure props to markup over the recipe page's own row and servings stepper, with
 * nothing mocked. The view comes from the real `cookingIngredientsView`, the copy from the real catalogue, and the
 * rows and the stepper are the real `./cook` leaves, so a row that names a line differently from the page, or a stepper
 * that does not call back, fails here. The list owns no state: every case reads what it draws and what it calls.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider } from '@commise/features-recipes/cook';
import { render } from '@commise/ui/testing/tamagui';
import {
    ABSENT_QUANTITY,
    FoodResolutionStatus,
    statedQuantity,
    type RecipeIngredientView,
} from '@kitchensink/recipe-core';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookingMessages } from '../../messages.js';
import { CookingIngredientsList } from '../CookingIngredientsList.native.js';
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

/** What a case may change about the list the screen would hand over. */
interface MountOptions {
    readonly ticked?: readonly string[];
    readonly servings?: number;
    readonly baseServings?: number;
    readonly lines?: readonly RecipeIngredientView[];
}

/** The list view the screen would hand over, from the real view model. */
function viewOf(options: MountOptions = {}): CookingIngredientsListView {
    const view = cookingIngredientsView({
        ingredients: options.lines ?? LINES,
        baseServings: options.baseServings ?? 2,
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

function mount(options: MountOptions = {}) {
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

describe('CookingIngredientsList (native)', () => {
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

    it('draws the removed-food badge once, on the one line whose food is gone', () => {
        mount({ lines: [FLOUR, { ...SUGAR, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }, BUTTER] });

        expect(screen.getAllByText('Food no longer listed')).toHaveLength(1);
    });

    it('draws no per-line badge when every line is removed, because the recipe says it once', () => {
        mount({
            lines: LINES.map((ingredient) => ({ ...ingredient, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED })),
        });

        expect(screen.queryByText('Food no longer listed')).toBeNull();
    });

    it('steps from the recipe own base, so a recipe authored above 100 servings can still go up', async () => {
        const props = mount({ baseServings: 120, servings: 110 });

        await user.click(screen.getByRole('button', { name: 'More servings' }));

        expect(props.onSetServings).toHaveBeenCalledExactlyOnceWith(111);
    });

    it('draws two lines that share an ingredient id as two rows in order, with no duplicate-key warning', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        mount({ lines: [{ ...FLOUR, name: 'plain flour' }, { ...FLOUR, name: 'bread flour' }, BUTTER] });

        const boxes = screen.getAllByRole('checkbox');

        expect(boxes.map((box) => box.textContent)).toEqual([
            expect.stringContaining('plain flour'),
            expect.stringContaining('bread flour'),
            expect.stringContaining('butter'),
        ]);
        expect(error.mock.calls.some((call) => /same key/.test(String(call[0])))).toBe(false);

        error.mockRestore();
    });
});
