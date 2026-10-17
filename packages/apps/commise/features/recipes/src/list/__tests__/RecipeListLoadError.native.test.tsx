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

    it('⛔ keeps the create button, since this body has no create CTA to replace it: one tap opens the editor', () => {
        // Rewritten for slice 8: the button no longer discloses a menu (Paste lives in the editor's Ingredients section).
        const onCreateRecipe = vi.fn();
        render(<RecipeListLoadError onRetry={noop} onCreateRecipe={onCreateRecipe} />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Create from Scratch')).toBeNull();
    });

    it('offers no first-run CTA — the library has not said it is empty', () => {
        render(<RecipeListLoadError onRetry={noop} onCreateRecipe={noop} />);

        expect(screen.queryByRole('button', { name: 'Add your first recipe' })).toBeNull();
        expect(screen.queryByText('Your recipe box is empty')).toBeNull();
    });
});
