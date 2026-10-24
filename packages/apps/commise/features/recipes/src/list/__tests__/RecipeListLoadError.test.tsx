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
        render(<RecipeListLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    // ⚠️ REWRITTEN. This test pinned that the error body keeps the create button, because hiding it would strand a cook
    // whose library failed to load. That need is unchanged, but the button now lives in the FRAME (outside the read
    // boundary, so it also shows offline, where this body never renders): `RecipeListFrame.test.tsx` pins it there, and
    // `RecipeListContainer.test.tsx` pins that a failed read still shows it. Two buttons would be the defect.
    it('draws no create button of its own: the frame owns the one floating control', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('offers no first-run CTA — the library has not said it is empty', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(screen.queryByRole('button', { name: 'Add your first recipe' })).toBeNull();
        expect(screen.queryByText('Your recipe box is empty')).toBeNull();
    });

    // Slice 4 (`buildSpec.md` §4.3 Load error): Try again is the design-system secondary button with its glyph.
    it('offers Try again as the secondary design-system button', () => {
        render(<RecipeListLoadError onRetry={noop} />);
        const retry = screen.getByRole('button', { name: 'Try again' });

        expect(retry.querySelector('svg.lucide-rotate-ccw')).not.toBeNull();
    });
});
