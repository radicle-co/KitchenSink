/**
 * Component tests for the native `StateNotice` (react-native-web under jsdom): the thumb-reach stack — an assertive
 * title, a body, then the actions at full width with the primary on top.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { role } from '../../tokens/colors.js';
import { StateNotice } from '../StateNotice.native.js';

afterEach(cleanup);

/** `#RRGGBB` as the `rgb(r, g, b)` string a resolved computed style reports. */
const rgb = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
};

describe('StateNotice (native)', () => {
    it('⛔ announces its title assertively, so it is spoken without a navigation', () => {
        render(<StateNotice title="Something went wrong." />);

        expect(screen.getByText('Something went wrong.').closest('[aria-live="assertive"]')).not.toBeNull();
    });

    it('shows the body only when it has one', () => {
        const { rerender } = render(<StateNotice title="Something went wrong." />);

        expect(screen.queryByText('Try again later.')).toBeNull();

        rerender(<StateNotice title="Something went wrong." body="Try again later." />);

        expect(screen.getByText('Try again later.')).toBeTruthy();
    });

    it('titles the notice in ink and its body in inkMuted', () => {
        render(<StateNotice title="Something went wrong." body="Try again later." />);

        expect(getComputedStyle(screen.getByText('Something went wrong.')).color).toBe(rgb(role.ink));
        expect(getComputedStyle(screen.getByText('Try again later.')).color).toBe(rgb(role.inkMuted));
    });

    it('presses the primary and the secondary action', () => {
        const primary = vi.fn();
        const secondary = vi.fn();
        render(
            <StateNotice
                title="Failed."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: primary }}
                secondary={{ label: 'Back to Home', icon: 'house', onPress: secondary }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));

        expect(primary).toHaveBeenCalledTimes(1);
        expect(secondary).toHaveBeenCalledTimes(1);
    });

    it('stacks the primary above the secondary', () => {
        render(
            <StateNotice
                title="Failed."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: vi.fn() }}
                secondary={{ label: 'Back to Home', icon: 'house', onPress: vi.fn() }}
            />,
        );
        const [first, second] = screen.getAllByRole('button');

        expect(first?.textContent).toContain('Try again');
        expect(second?.textContent).toContain('Back to Home');
    });

    it('draws no buttons when there is no way out', () => {
        render(<StateNotice title="Gone." />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
