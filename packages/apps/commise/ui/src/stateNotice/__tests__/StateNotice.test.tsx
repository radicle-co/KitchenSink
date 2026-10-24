/**
 * Component tests for the web `StateNotice`: one alert that says what went wrong and offers up to two ways out, each a
 * design-system button or a real link.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StateNotice } from '../StateNotice.js';

afterEach(cleanup);

describe('StateNotice (web)', () => {
    it('announces its title as the page’s heading inside an alert', () => {
        render(<StateNotice title="We couldn’t load this recipe." />);

        const alert = screen.getByRole('alert');

        expect(alert.contains(screen.getByRole('heading', { level: 1, name: 'We couldn’t load this recipe.' }))).toBe(
            true,
        );
    });

    it('shows the body only when it has one', () => {
        const { rerender } = render(<StateNotice title="Something went wrong." />);

        expect(screen.queryByText('Please try again.')).toBeNull();

        rerender(<StateNotice title="Something went wrong." body="Please try again." />);

        expect(screen.getByText('Please try again.')).toBeTruthy();
    });

    it('draws no action row when there is no way out', () => {
        render(<StateNotice title="Gone." />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('⛔ renders an action with no href as a real button that presses', () => {
        const onPress = vi.fn();
        render(<StateNotice title="Failed." primary={{ label: 'Try again', icon: 'refreshCw', onPress }} />);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('⛔ renders an action with an href as a link, whose plain click goes to onPress and whose modified click stays the browser’s', () => {
        const onPress = vi.fn();
        render(
            <StateNotice
                title="Failed."
                secondary={{ label: 'Back to My recipes', icon: 'chevronLeft', onPress, href: '/en/recipes' }}
            />,
        );
        const link = screen.getByRole('link', { name: 'Back to My recipes' });

        expect(link.getAttribute('href')).toBe('/en/recipes');

        fireEvent.click(link);
        expect(onPress).toHaveBeenCalledTimes(1);

        fireEvent.click(link, { metaKey: true });
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('offers both ways out, primary first', () => {
        render(
            <StateNotice
                title="Failed."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: vi.fn() }}
                secondary={{ label: 'Back to Home', icon: 'house', onPress: vi.fn() }}
            />,
        );
        const [first, second] = screen.getAllByRole('button');

        expect(first?.textContent).toBe('Try again');
        expect(second?.textContent).toBe('Back to Home');
    });
});
