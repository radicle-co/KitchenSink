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
                owner
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement={undefined}
            />,
        );

        expect(screen.getByText('Stays private')).toBeDefined();
    });

    it('draws a moment exactly once, never also as the standing line', () => {
        render(
            <RecipeVisibilityNotice
                owner
                notice={{ kind: 'moment', text: 'Could not save' }}
                announcement={undefined}
            />,
        );

        expect(screen.getAllByText('Could not save')).toHaveLength(1);
    });

    it('draws nothing once the notice is gone', () => {
        const { rerender } = render(
            <RecipeVisibilityNotice
                owner
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement={undefined}
            />,
        );

        expect(screen.getByText('Stays private')).toBeDefined();

        rerender(<RecipeVisibilityNotice owner notice={undefined} announcement={undefined} />);

        expect(screen.queryByText('Stays private')).toBeNull();
    });

    it('mounts nothing for a viewer who is not the owner, whatever the notice says', () => {
        render(
            <RecipeVisibilityNotice
                owner={false}
                notice={{ kind: 'standing', reason: 'policy.book', text: 'Stays private' }}
                announcement="Now private"
            />,
        );

        expect(screen.queryByText('Stays private')).toBeNull();
        expect(screen.queryByText('Now private')).toBeNull();
    });
});
