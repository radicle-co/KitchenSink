/**
 * The two native frames around the one cooking ingredients list: the sheet (L1, L1w) and the column (L2, L3). Nothing
 * is mocked: the view is the real `cookingIngredientsView`, the copy the real catalogue, the list and the house
 * `Sheet` the real leaves. Per designer's D73 the list draws no heading, so each frame draws the title once, and
 * neither frame draws a Done: the sheet's X, named `close`, is the one visible close.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider } from '@commise/features-recipes/cook';
import { render } from '@commise/ui/testing/tamagui';
import { ABSENT_QUANTITY, statedQuantity, type RecipeIngredientView } from '@kitchensink/recipe-core';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookingMessages } from '../../messages.js';
import { CookingIngredientsColumn } from '../CookingIngredientsColumn.native.js';
import { CookingIngredientsSheet } from '../CookingIngredientsSheet.native.js';
import type { CookingIngredientsListView } from '../cookingIngredientsListProps.js';
import { cookingIngredientsView } from '../ingredientsView.js';

const user = userEvent.setup({ delay: null });
const copy = resolveMessages(cookingMessages, 'en');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const line = (id: string, name: string): RecipeIngredientView => ({
    ingredientId: id,
    name,
    quantity: statedQuantity(1) ?? ABSENT_QUANTITY,
    unit: 'cup',
    isUserEntered: false,
});

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

function viewOf(ticked: readonly string[] = []): CookingIngredientsListView {
    const view = cookingIngredientsView({
        ingredients: [line('ing_flour', 'flour'), line('ing_sugar', 'sugar')],
        baseServings: 2,
        servings: 2,
        ticked: new Set(ticked),
        copy,
        locale: 'en',
    });

    if (view.kind !== 'list') {
        throw new Error('The fixture recipe has ingredients, so the view is a list.');
    }

    return view;
}

const commands = () => ({ onToggle: vi.fn(), onSetServings: vi.fn(), onClear: vi.fn() });

describe('CookingIngredientsSheet (native)', () => {
    function mount(open = true, ticked: readonly string[] = []) {
        const handlers = { ...commands(), onClose: vi.fn() };
        const view = viewOf(ticked);

        render(<CookingIngredientsSheet view={view} copy={copy.ingredients} open={open} {...handlers} />, {
            wrapper: Wrapper,
        });

        return { view, ...handlers };
    }

    it('draws the title once, as the sheet heading, and the list under it', () => {
        const { view } = mount();

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(screen.getByRole('heading').textContent).toBe(view.title);
        expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    it('draws nothing while it is closed', () => {
        mount(false);

        expect(screen.queryByRole('heading')).toBeNull();
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('closes through the one close named for the ingredients, and draws no Done', async () => {
        const { onClose } = mount();

        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

        await user.click(screen.getByRole('button', { name: copy.ingredients.close }));

        expect(onClose).toHaveBeenCalledExactlyOnceWith();
    });

    it('passes the list commands through: a tick, a serving and Clear ticks', async () => {
        const { onToggle, onSetServings, onClear, onClose } = mount(true, ['ing_flour']);

        await user.click(screen.getByRole('checkbox', { name: /sugar/ }));
        await user.click(screen.getByRole('button', { name: 'More servings' }));
        await user.click(screen.getByRole('button', { name: copy.ingredients.clear }));

        expect(onToggle).toHaveBeenCalledExactlyOnceWith('ing_sugar');
        expect(onSetServings).toHaveBeenCalledExactlyOnceWith(3);
        expect(onClear).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('CookingIngredientsColumn (native)', () => {
    function mount(ticked: readonly string[] = []) {
        const handlers = commands();
        const view = viewOf(ticked);

        render(<CookingIngredientsColumn view={view} copy={copy.ingredients} {...handlers} />, { wrapper: Wrapper });

        return { view, ...handlers };
    }

    it('heads the list with the title once, as a level 2 heading', () => {
        const { view } = mount();

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(screen.getByRole('heading').textContent).toBe(view.title);
        expect(screen.getByRole('heading').getAttribute('aria-level')).toBe('2');
        expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    it('has no close and no Done, because the column is always open', () => {
        mount();

        expect(screen.queryByRole('button', { name: copy.ingredients.close })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });

    it('passes the list commands through', async () => {
        const { onToggle, onClear } = mount(['ing_flour']);

        await user.click(screen.getByRole('checkbox', { name: /sugar/ }));
        await user.click(screen.getByRole('button', { name: copy.ingredients.clear }));

        expect(onToggle).toHaveBeenCalledExactlyOnceWith('ing_sugar');
        expect(onClear).toHaveBeenCalledOnce();
    });
});
