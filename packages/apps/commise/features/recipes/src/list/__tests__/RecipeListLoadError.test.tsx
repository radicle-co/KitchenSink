// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list LOAD ERROR — what the list's error boundary renders when the read failed
 * with nothing loaded. Moved from the retired `RecipeList.test.tsx` ("error state", and the error half of "create
 * FAB (L1)", which the dial predicate used to answer and this branch now answers by always mounting it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeListLoadError } from '../RecipeListLoadError.js';

afterEach(cleanup);

const noop = () => undefined;

describe('RecipeListLoadError (web)', () => {
    it('shows an alert with a retry action that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(<RecipeListLoadError onRetry={onRetry} onCreateRecipe={noop} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('⛔ keeps the create dial, since this body has no create CTA to replace it', async () => {
        // Suppressing it would strand a cook whose library failed to load with no way to create at all.
        const user = userEvent.setup();
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        render(
            <RecipeListLoadError
                onRetry={noop}
                onCreateRecipe={onCreateRecipe}
                onPasteIngredients={onPasteIngredients}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        // Both destinations reach the dial — the error branch must not quietly drop the second one.
        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('offers no first-run CTA — the library has not said it is empty', () => {
        render(<RecipeListLoadError onRetry={noop} onCreateRecipe={noop} />);

        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });
});
