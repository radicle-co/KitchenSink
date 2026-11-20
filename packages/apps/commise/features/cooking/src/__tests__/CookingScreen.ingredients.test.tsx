import { CookMarksProvider, useServingScale } from '@commise/features-recipes/cook';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';
import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';
import { makeRecipeIngredientView } from '../__fixtures__/makeRecipeIngredientView.js';
import { CookingScreen } from '../CookingScreen.js';
import { TWO_COLUMN } from '../cookingLayout.js';
import type { CookingScreenRead } from '../cookingViewProps.js';

/**
 * The web cooking screen's ingredients wiring (T-015a): the top bar's Ingredients button, the scale note and the sheet
 * at one column, the column and no button at two. The cook marks and the serving scale are the real ones the recipe page
 * reads, the copy is the real catalogue, and the band comes from a `matchMedia` that answers the real 50 em query.
 */
const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

/** Answer the two-column query: `wide` is whether the window reaches 800 px. */
function stubWindow(wide: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: wide && query === TWO_COLUMN.webQuery,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
}

let counter = 0;

/** A recipe with two ingredient lines and two steps, under a fresh id (the serving scale is keyed by recipe id). */
function open(options: { readonly wide: boolean; readonly servings?: number; readonly lines?: number }) {
    counter += 1;
    const id = `rec_screen_${String(counter)}`;
    const lines = options.lines ?? 2;
    const read: CookingScreenRead = {
        kind: 'ready',
        viewerIsOwner: true,
        recipe: makeCookingRecipe({
            id,
            servings: 2,
            steps: [
                { stepNumber: 1, instruction: 'Mix the flour.' },
                { stepNumber: 2, instruction: 'Bake it.' },
            ],
            ingredients: ['flour', 'sugar']
                .slice(0, lines)
                .map((name) => makeRecipeIngredientView({ ingredientId: `ing_${name}`, name })),
        }),
    };

    stubWindow(options.wide);

    if (options.servings !== undefined) {
        const servings = options.servings;

        renderHook(() => useServingScale(id, 2), { wrapper: Wrapper }).result.current.setServings(servings);
    }

    return render(<CookingScreen read={read} onLeave={vi.fn()} onEdit={vi.fn()} onHome={vi.fn()} />, {
        wrapper: Wrapper,
    });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
});

describe('CookingScreen ingredients: one column', () => {
    it('offers Ingredients in the top bar and no column', () => {
        open({ wide: false });

        expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Ingredients' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: /ingredients/iu })).toBeNull();
    });

    it('opens the sheet from the top bar and closes it on the same step', () => {
        open({ wide: false });

        fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /flour/u })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Close ingredients' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    it('shows no scale note at the recipe servings', () => {
        open({ wide: false });

        expect(screen.queryByRole('note')).toBeNull();
    });

    it('shows the scale note with its open button once the servings differ, and the button opens the sheet', () => {
        open({ wide: false, servings: 4 });

        const note = screen.getByRole('note');

        expect(note.textContent).toContain('You’re making 4');
        fireEvent.click(within(note).getByRole('button', { name: 'Open ingredients' }));

        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('offers nothing to open on a recipe with no ingredients', () => {
        open({ wide: false, lines: 0 });

        expect(screen.queryByRole('button', { name: 'Ingredients' })).toBeNull();
    });
});

describe('CookingScreen ingredients: two columns', () => {
    it('draws the column beside the step, with no Ingredients button in the top bar', () => {
        open({ wide: true });

        const column = htmlElementOf(screen.getByRole('heading', { name: /ingredients/iu }).parentElement);

        expect(within(column).getByRole('checkbox', { name: /flour/u })).toBeTruthy();
        expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Ingredients' })).toBeNull();
        expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    it('keeps the scale note but draws no open button, because the column is in view', () => {
        open({ wide: true, servings: 4 });

        const note = screen.getByRole('note');

        expect(note.textContent).toContain('You’re making 4');
        expect(within(note).queryByRole('button')).toBeNull();
    });

    // P60: no Clear ticks without its Undo, and the Undo's outlet is not on main yet.
    it('draws no Clear ticks after a line is ticked', () => {
        open({ wide: true });

        const column = htmlElementOf(screen.getByRole('heading', { name: /ingredients/iu }).parentElement);

        fireEvent.click(within(column).getByRole('checkbox', { name: /flour/u }));

        expect(within(column).getByRole('checkbox', { name: /flour/u }).getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByRole('button', { name: 'Clear ticks' })).toBeNull();
    });

    it('draws no column on a recipe with no ingredients', () => {
        open({ wide: true, lines: 0 });

        expect(screen.queryByRole('heading', { name: /ingredients/iu })).toBeNull();
    });
});

describe('CookingScreen ingredients: the width container', () => {
    it('lets the step stack keep its own 680 cap with a column, and drops the surface cap', () => {
        const { container } = open({ wide: true });
        const main = htmlElementOf(container.querySelector('main'));

        expect(main.firstElementChild?.className).not.toContain('max-w-[680px]');
    });
});
