/**
 * Native component tests for the recipe-list LOAD ERROR (react-native-web under jsdom). Mirrors
 * `RecipeListLoadError.test.tsx`; moved from the retired `RecipeList.native.test.tsx` ("error state", and the error
 * half of "create FAB (L1)").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeListLoadError } from '../RecipeListLoadError.native.js';

afterEach(cleanup);

const noop = () => undefined;

describe('RecipeListLoadError (native)', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        render(<RecipeListLoadError onRetry={onRetry} onCreateRecipe={noop} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('⛔ keeps the create dial, since this body has no create CTA to replace it', () => {
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        render(
            <RecipeListLoadError
                onRetry={noop}
                onCreateRecipe={onCreateRecipe}
                onPasteIngredients={onPasteIngredients}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('offers no first-run CTA — the library has not said it is empty', () => {
        render(<RecipeListLoadError onRetry={noop} onCreateRecipe={noop} />);

        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });
});
