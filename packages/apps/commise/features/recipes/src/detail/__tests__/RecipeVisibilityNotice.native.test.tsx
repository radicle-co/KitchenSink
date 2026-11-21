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

    it('draws no standing line for a moment, and no text for nothing', () => {
        const { rerender } = render(
            <RecipeVisibilityNotice notice={{ kind: 'moment', text: 'Could not save' }} announcement={undefined} />,
        );

        expect(screen.queryByText('Stays private')).toBeNull();

        rerender(<RecipeVisibilityNotice notice={undefined} announcement={undefined} />);

        expect(screen.queryByText('Could not save')).toBeNull();
    });
});
