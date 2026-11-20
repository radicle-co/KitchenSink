/**
 * The native cooking ingredients list: pure props to markup over the recipe page's own row and servings stepper, with
 * nothing mocked. The view comes from the real `cookingIngredientsView`, the copy from the real catalogue, and the
 * rows and the stepper are the real `./cook` leaves, so a row that names a line differently from the page, or a stepper
 * that does not call back, fails here. The list owns no state: every case reads what it draws and what it calls.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider } from '@commise/features-recipes/cook';
import { render } from '@commise/ui/testing/tamagui';
import { FoodResolutionStatus, type RecipeIngredientView } from '@kitchensink/recipe-core';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookingMessages } from '../../messages.js';
import { makeRecipeIngredientView } from '../../__fixtures__/makeRecipeIngredientView.js';
import { CookingIngredientsList } from '../CookingIngredientsList.native.js';
import type { CookingIngredientsListProps, CookingIngredientsListView } from '../cookingIngredientsListProps.js';
import { cookingIngredientsView } from '../ingredientsView.js';

const user = userEvent.setup({ delay: null });
const copy = resolveMessages(cookingMessages, 'en');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const FLOUR = makeRecipeIngredientView({ ingredientId: 'ing_flour', name: 'flour' });
const SUGAR = makeRecipeIngredientView({ ingredientId: 'ing_sugar', name: 'sugar' });
const BUTTER = makeRecipeIngredientView({ ingredientId: 'ing_butter', name: 'butter' });
const LINES = [FLOUR, SUGAR, BUTTER];

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

/** What a case may change about the list the screen would hand over. */
interface MountOptions {
    readonly ticked?: readonly number[];
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
    it('draws no heading of its own, because the frame draws the title', () => {
        mount();

        expect(screen.queryAllByRole('heading')).toHaveLength(0);
    });

    it('draws one checkbox per line in the recipe order, with the ticked ones checked', () => {
        mount({ ticked: [1] });

        const boxes = screen.getAllByRole('checkbox');

        expect(boxes.map((box) => box.textContent)).toEqual([
            expect.stringContaining('flour'),
            expect.stringContaining('sugar'),
            expect.stringContaining('butter'),
        ]);
        expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    });

    it('calls onToggle with the position of the pressed row, and nothing else', async () => {
        const props = mount();

        await user.click(within(screen.getByRole('checkbox', { name: /butter/ })).getByText(/butter/));

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(2);
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

        const some = mount({ ticked: [0] });

        await user.click(screen.getByRole('button', { name: copy.ingredients.clear }));

        expect(some.onClear).toHaveBeenCalledOnce();
    });

    // P60: Clear ticks never ships without its Undo, so a host that has no Undo path gives no onClear and no button
    // is drawn.
    it('draws no Clear ticks when the host gives no onClear, even with a ticked line', () => {
        const props: CookingIngredientsListProps = {
            view: viewOf({ ticked: [0] }),
            copy: copy.ingredients,
            onToggle: vi.fn(),
            onSetServings: vi.fn(),
        };

        render(<CookingIngredientsList {...props} />, { wrapper: Wrapper });

        expect(screen.queryByRole('button', { name: copy.ingredients.clear })).toBeNull();
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
    });

    it('draws each section label once, above its own lines, in order', () => {
        mount({
            lines: [
                { ...FLOUR, groupLabel: 'Crust' },
                { ...SUGAR, groupLabel: 'Crust' },
                { ...BUTTER, groupLabel: 'Filling' },
            ],
        });

        // The list draws no title, so the headings are the section labels, in order.
        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Crust', 'Filling']);
        expect(screen.getAllByRole('checkbox').map((box) => box.textContent)).toEqual([
            expect.stringContaining('flour'),
            expect.stringContaining('sugar'),
            expect.stringContaining('butter'),
        ]);
    });

    it('draws no section label when no line has one', () => {
        mount();

        expect(screen.queryAllByRole('heading')).toHaveLength(0);
    });

    // ADR-0096: a tick belongs to its line, so two lines of one food are two rows with two ticks.
    it('ticks one of two lines of one food by position: the press reports it, only that row is checked', async () => {
        const twin = { ...BUTTER };
        const props = mount({ lines: [BUTTER, twin], ticked: [1] });

        expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual([
            'false',
            'true',
        ]);

        await user.click(screen.getAllByRole('checkbox')[1] as HTMLElement);

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('draws no Clear ticks for a tick on a position no line has, because there is nothing to clear', () => {
        mount({ ticked: [7] });

        expect(screen.queryByRole('button', { name: copy.ingredients.clear })).toBeNull();
    });
});
