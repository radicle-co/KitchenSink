/**
 * The two web frames around the one cooking ingredients list: the sheet (L1, L1w) and the column (L2, L3). Nothing
 * is mocked: the view is the real `cookingIngredientsView`, the copy the real catalogue, the list and the house
 * `Sheet` the real leaves. Per designer's D73 the list draws no heading, so each frame draws the title once, and
 * neither frame draws a Done: the sheet's X, named `close`, is the one visible close.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider } from '@commise/features-recipes/cook';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeIngredientView } from '../../__fixtures__/makeRecipeIngredientView.js';
import { cookingMessages } from '../../messages.js';
import { CookingIngredientsColumn } from '../CookingIngredientsColumn.js';
import { CookingIngredientsSheet } from '../CookingIngredientsSheet.js';
import type { CookingIngredientsListView } from '../cookingIngredientsListProps.js';
import { cookingIngredientsView } from '../ingredientsView.js';

const user = userEvent.setup({ delay: null });
const copy = resolveMessages(cookingMessages, 'en');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

function viewOf(ticked: readonly number[] = []): CookingIngredientsListView {
    const view = cookingIngredientsView({
        ingredients: [
            makeRecipeIngredientView({ ingredientId: 'ing_flour', name: 'flour' }),
            makeRecipeIngredientView({ ingredientId: 'ing_sugar', name: 'sugar' }),
        ],
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

describe('CookingIngredientsSheet (web)', () => {
    function mount(open = true, ticked: readonly number[] = []) {
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
        // The frame's whole set of buttons, so a Done that came back under any other name would fail here too.
        expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
            copy.ingredients.close,
            'Fewer servings',
            'More servings',
        ]);

        await user.click(screen.getByRole('button', { name: copy.ingredients.close }));

        expect(onClose).toHaveBeenCalledExactlyOnceWith();
    });

    it('passes the list commands through: a tick, a serving and Clear ticks', async () => {
        const { onToggle, onSetServings, onClear, onClose } = mount(true, [0]);

        await user.click(screen.getByRole('checkbox', { name: /sugar/ }));
        await user.click(screen.getByRole('button', { name: 'More servings' }));
        await user.click(screen.getByRole('button', { name: copy.ingredients.clear }));

        expect(onToggle).toHaveBeenCalledExactlyOnceWith(1);
        expect(onSetServings).toHaveBeenCalledExactlyOnceWith(3);
        expect(onClear).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('CookingIngredientsColumn (web)', () => {
    function mount(ticked: readonly number[] = []) {
        const handlers = commands();
        const view = viewOf(ticked);

        render(<CookingIngredientsColumn view={view} copy={copy.ingredients} {...handlers} />, { wrapper: Wrapper });

        return { view, ...handlers };
    }

    it('heads the list with the title once, as an h2 heading', () => {
        const { view } = mount();

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(screen.getByRole('heading').textContent).toBe(view.title);
        expect(screen.getByRole('heading').tagName).toBe('H2');
        expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    it('has no close and no Done, because the column is always open', () => {
        mount();

        expect(screen.queryByRole('button', { name: copy.ingredients.close })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
        expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
            'Fewer servings',
            'More servings',
        ]);
    });

    it('passes the list commands through', async () => {
        const { onToggle, onClear } = mount([0]);

        await user.click(screen.getByRole('checkbox', { name: /sugar/ }));
        await user.click(screen.getByRole('button', { name: copy.ingredients.clear }));

        expect(onToggle).toHaveBeenCalledExactlyOnceWith(1);
        expect(onClear).toHaveBeenCalledOnce();
    });
});
