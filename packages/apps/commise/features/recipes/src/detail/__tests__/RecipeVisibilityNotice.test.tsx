/**
 * `RecipeVisibilityNotice` (web): the owner's visibility slot of the recipe page. A moment is the assertive region, a
 * standing line is plain muted text outside any live region, and the polite hidden region carries the one announcement.
 * The page-level cases are in `RecipeDetailView.test.tsx`; this pins the pure render pair on its own.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecipeVisibilityNotice } from '../RecipeVisibilityNotice.js';

describe('RecipeVisibilityNotice (web)', () => {
    it('puts a moment in the assertive region and draws no standing line', () => {
        render(<RecipeVisibilityNotice notice={{ kind: 'moment', text: 'Could not save' }} announcement={undefined} />);

        expect(screen.getByRole('alert').textContent).toBe('Could not save');
    });

    it('draws a standing line outside every live region, and leaves the assertive region empty', () => {
        render(
            <RecipeVisibilityNotice
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement={undefined}
            />,
        );

        const line = screen.getByText('Stays private');

        expect(line.closest('[aria-live]')).toBeNull();
        expect(screen.getByRole('alert').textContent).toBe('');
    });

    it('says the announcement once in the polite region, and nothing without one', () => {
        const { rerender } = render(<RecipeVisibilityNotice notice={undefined} announcement="Now private" />);

        expect(screen.getByRole('status').textContent).toBe('Now private');

        rerender(<RecipeVisibilityNotice notice={undefined} announcement={undefined} />);

        expect(screen.getByRole('status').textContent).toBe('');
    });
});
