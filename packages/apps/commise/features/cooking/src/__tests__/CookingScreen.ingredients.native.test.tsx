/**
 * The native cooking screen's ingredients wiring (T-015a): the top bar's Ingredients button, the scale note and the
 * sheet
 * at one column, the column and no button at two. The cook marks, the serving scale and the copy are the real ones;
 * only
 * the window is doubled, because the band is read from its width: 390 is one column, 900 is two (800 and wider).
 * Every control is found by its accessible name, which is what a screen reader reads.
 */
import { CookMarksProvider, useServingScale } from '@commise/features-recipes/cook';
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';
import { makeRecipeIngredientView } from '../__fixtures__/makeRecipeIngredientView.js';
import { CookingScreen } from '../CookingScreen.native.js';
import type { CookingScreenRead } from '../cookingViewProps.js';

const viewport = vi.hoisted(() => ({ width: 390, height: 844, fontScale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({
            ...actual.useWindowDimensions(),
            width: viewport.width,
            height: viewport.height,
            fontScale: viewport.fontScale,
        }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

let counter = 0;

/** A recipe with two ingredient lines and two steps, under a fresh id (the serving scale is keyed by recipe id). */
function open(options: { readonly width: number; readonly servings?: number; readonly lines?: number }) {
    counter += 1;
    const id = `rec_native_screen_${String(counter)}`;
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

    viewport.width = options.width;

    if (options.servings !== undefined) {
        renderHook(() => useServingScale(id, 2), { wrapper: Wrapper }).result.current.setServings(options.servings);
    }

    return render(
        <Wrapper>
            <CookingScreen read={read} onLeave={vi.fn()} onEdit={vi.fn()} onHome={vi.fn()} />
        </Wrapper>,
    );
}

afterEach(() => {
    cleanup();
    viewport.width = 390;
    window.sessionStorage.clear();
});

describe('CookingScreen (native) ingredients: one column', () => {
    it('offers Ingredients by its accessible name and draws no column', () => {
        open({ width: 390 });

        expect(screen.getByRole('button', { name: 'Ingredients' })).toBeTruthy();
        expect(screen.queryByTestId('cooking-columns')).toBeNull();
    });

    it('opens the sheet from the top bar and closes it on the same step', () => {
        open({ width: 390 });

        fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
        // The native sheet nests more than one dialog, so the open sheet is found by its one × close.
        expect(screen.getByRole('button', { name: 'Close ingredients' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Close ingredients' }));

        expect(screen.queryByRole('button', { name: 'Close ingredients' })).toBeNull();
        expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    it('shows the scale note with its open button once the servings differ, and the button opens the sheet', () => {
        open({ width: 390, servings: 4 });

        const note = screen.getByRole('note');

        expect(note.textContent).toContain('You’re making 4');
        fireEvent.click(within(note).getByRole('button', { name: 'Open ingredients' }));

        expect(screen.getByRole('button', { name: 'Close ingredients' })).toBeTruthy();
    });

    it('shows no scale note at the recipe servings', () => {
        open({ width: 390 });

        expect(screen.queryByRole('note')).toBeNull();
    });

    it('offers nothing to open on a recipe with no ingredients', () => {
        open({ width: 390, lines: 0 });

        expect(screen.queryByRole('button', { name: 'Ingredients' })).toBeNull();
    });
});

describe('CookingScreen (native) ingredients: two columns', () => {
    it('draws the column beside the step, with no Ingredients button', () => {
        open({ width: 800 });

        const slot = screen.getByTestId('cooking-ingredients-slot');

        expect(within(slot).getByRole('checkbox', { name: /flour/u })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Ingredients' })).toBeNull();
        expect(within(screen.getByTestId('cooking-step-slot')).getByText('Step 1 of 2')).toBeTruthy();
    });

    // P60: no Clear ticks without its Undo, and the Undo's outlet is not on main yet.
    it('draws no Clear ticks after a line is ticked', () => {
        open({ width: 900 });

        const slot = screen.getByTestId('cooking-ingredients-slot');

        fireEvent.click(within(slot).getByRole('checkbox', { name: /flour/u }));

        expect(within(slot).getByRole('checkbox', { name: /flour/u }).getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByRole('button', { name: 'Clear ticks' })).toBeNull();
    });

    it('is one column at 799', () => {
        open({ width: 799 });

        expect(screen.queryByTestId('cooking-columns')).toBeNull();
    });

    it('keeps the scale note but draws no open button, because the column is in view', () => {
        open({ width: 900, servings: 4 });

        const note = screen.getByRole('note');

        expect(note.textContent).toContain('You’re making 4');
        expect(within(note).queryByRole('button')).toBeNull();
    });
});
