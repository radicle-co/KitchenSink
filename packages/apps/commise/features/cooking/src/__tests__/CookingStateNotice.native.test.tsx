/**
 * The native cooking notices (load error, no steps, recipe gone): the house `StateNotice`, its title announced as an
 * alert, centred in a column at most 480 wide in every band.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingStateNotice } from '../CookingStateNotice.native.js';
import { NOTICE_COLUMN } from '../cookingLayout.js';

afterEach(cleanup);

describe('CookingStateNotice (native)', () => {
    it('announces the title, says the body, and reports both actions', () => {
        const primary = { label: 'Try again', icon: 'refreshCw' as const, onPress: vi.fn() };
        const secondary = { label: 'Back to the recipe', icon: 'chevronLeft' as const, onPress: vi.fn() };
        render(
            <CookingStateNotice
                title="We couldn’t open this recipe"
                body="Check your connection, then try again."
                primary={primary}
                secondary={secondary}
            />,
        );

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t open this recipe');
        expect(screen.getByText('Check your connection, then try again.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Try again/u }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to the recipe' }));
        expect(primary.onPress).toHaveBeenCalledTimes(1);
        expect(secondary.onPress).toHaveBeenCalledTimes(1);
    });

    it('sits in a column at most 480 wide', () => {
        render(<CookingStateNotice title="This recipe isn’t available any more" />);

        expect(getComputedStyle(screen.getByTestId('cooking-notice-column')).maxWidth).toBe(
            `${String(NOTICE_COLUMN.maxPx)}px`,
        );
    });
});
