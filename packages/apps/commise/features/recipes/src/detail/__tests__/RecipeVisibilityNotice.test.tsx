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
        render(
            <RecipeVisibilityNotice
                owner
                notice={{ kind: 'moment', text: 'Could not save' }}
                announcement={undefined}
            />,
        );

        expect(screen.getByRole('alert').textContent).toBe('Could not save');
        // Drawn once: never also as the muted standing line.
        expect(screen.getAllByText('Could not save')).toHaveLength(1);
    });

    it('draws a standing line outside every live region, and leaves the assertive region empty', () => {
        render(
            <RecipeVisibilityNotice
                owner
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement={undefined}
            />,
        );

        const line = screen.getByText('Stays private');

        expect(line.closest('[aria-live]')).toBeNull();
        expect(screen.getByRole('alert').textContent).toBe('');
    });

    it('says the announcement once in the polite region, and nothing without one', () => {
        const { rerender } = render(<RecipeVisibilityNotice owner notice={undefined} announcement="Now private" />);

        expect(screen.getByRole('status').textContent).toBe('Now private');

        rerender(<RecipeVisibilityNotice owner notice={undefined} announcement={undefined} />);

        expect(screen.getByRole('status').textContent).toBe('');
    });

    it('mounts nothing for a viewer who is not the owner: no line, no live region', () => {
        const { container } = render(
            <RecipeVisibilityNotice
                owner={false}
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement="Now private"
            />,
        );

        expect(container.innerHTML).toBe('');
    });
});
