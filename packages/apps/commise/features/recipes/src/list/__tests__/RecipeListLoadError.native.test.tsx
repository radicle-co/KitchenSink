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
        render(<RecipeListLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    // ⚠️ REWRITTEN. This test pinned that the error body keeps the create button. That need is unchanged, but the button
    // now lives in the FRAME (outside the read boundary, so it also shows offline, where this body never renders):
    // `RecipeListFrame.native.test.tsx` pins it there, and `RecipeListScreen.native.test.tsx` pins that a failed read
    // still shows it. Two buttons would be the defect.
    it('draws no create button of its own: the frame owns the one floating control', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('offers no first-run CTA — the library has not said it is empty', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(screen.queryByRole('button', { name: 'Add your first recipe' })).toBeNull();
        expect(screen.queryByText('Your recipe box is empty')).toBeNull();
    });
});
