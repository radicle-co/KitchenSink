/**
 * `RecipeVisibilityNotice` (native), in lock-step with the web cases in `RecipeVisibilityNotice.test.tsx`.
 */
import { render } from '@commise/ui/testing/tamagui';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecipeVisibilityNotice } from '../RecipeVisibilityNotice.native.js';

describe('RecipeVisibilityNotice (native)', () => {
    it('draws a standing line, plain text', () => {
        render(
            <RecipeVisibilityNotice
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement={undefined}
            />,
        );

        expect(screen.getByText('Stays private')).toBeDefined();
    });

    it('draws a moment exactly once, never also as the standing line', () => {
        render(<RecipeVisibilityNotice notice={{ kind: 'moment', text: 'Could not save' }} announcement={undefined} />);

        expect(screen.getAllByText('Could not save')).toHaveLength(1);
    });

    it('draws nothing once the notice is gone', () => {
        const { rerender } = render(
            <RecipeVisibilityNotice
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement={undefined}
            />,
        );

        expect(screen.getByText('Stays private')).toBeDefined();

        rerender(<RecipeVisibilityNotice notice={undefined} announcement={undefined} />);

        expect(screen.queryByText('Stays private')).toBeNull();
    });
});
