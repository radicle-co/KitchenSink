import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CookingStateNotice } from '../CookingStateNotice.js';
import { NOTICE_COLUMN } from '../cookingLayout.js';
import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';

/** The load error, no steps and gone notices: the house StateNotice, centred at a max of 480. */
describe('CookingStateNotice', () => {
    it('announces as an alert with the title as the h1', () => {
        render(
            <CookingStateNotice
                title="We couldn’t open this recipe"
                body="Check your connection, then try again."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: vi.fn() }}
                secondary={{ label: 'Back to the recipe', icon: 'chevronLeft', onPress: vi.fn() }}
            />,
        );

        const alert = screen.getByRole('alert');

        expect(alert.querySelector('h1')?.textContent).toBe('We couldn’t open this recipe');
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Back to the recipe' })).toBeTruthy();
    });

    it('stands alone with its title and one way out', () => {
        render(
            <CookingStateNotice
                title="This recipe isn’t available any more"
                secondary={{ label: 'Go to Home', icon: 'house', onPress: vi.fn() }}
            />,
        );

        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Go to Home']);
        expect(screen.getByRole('alert').querySelector('p')).toBeNull();
    });

    it('centres the notice at a max width of 480', () => {
        render(<CookingStateNotice title="This recipe has no steps yet" />);

        const wrapper = htmlElementOf(screen.getByRole('alert').parentElement);

        expect(wrapper.className).toContain(NOTICE_COLUMN.webClassName);
        expect(wrapper.className).toContain('mx-auto');
    });
});
