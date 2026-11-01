/**
 * Component tests for the native `StateNotice` (react-native-web under jsdom): the thumb-reach stack — an assertive
 * title, a body, then the actions at full width with the primary on top.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { role } from '../../tokens/colors.js';
import { StateNotice } from '../StateNotice.native.js';
import { pressFrameOf, render, resolvedColour } from '../../testing/tamaguiTesting.native.js';

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

        expect(resolvedColour(screen.getByText('Something went wrong.'), 'color')).toBe(rgb(role.ink));
        expect(resolvedColour(screen.getByText('Try again later.'), 'color')).toBe(rgb(role.inkMuted));
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

    // `componentFixes.md` §1: Try again is the quiet tier at its label's width, under the message; the way out is ghost.
    it('⛔ draws the first action quiet (ink label, actionText glyph, no fill) and the second ghost (actionText)', () => {
        const { container } = render(
            <StateNotice
                title="Failed."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: vi.fn() }}
                secondary={{ label: 'Back to Home', icon: 'house', onPress: vi.fn() }}
            />,
        );
        const [first, second] = screen.getAllByRole('button');

        expect(resolvedColour(screen.getByText('Try again'), 'color')).toBe(rgb(role.ink));
        expect(resolvedColour(screen.getByText('Back to Home'), 'color')).toBe(rgb(role.actionText));

        for (const button of [first, second]) {
            const pill = [button, ...Array.from(button?.querySelectorAll<HTMLElement>('*') ?? [])].find(
                (el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0,
            );

            expect(getComputedStyle(pill as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        }

        expect(container.querySelector('[data-commise-stub="icon"][data-icon-name="refresh-cw"]')).not.toBeNull();
    });

    it('⛔ stops stretching the actions: they sit at their label’s width, not across the screen', () => {
        render(
            <StateNotice
                title="Failed."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: vi.fn() }}
                secondary={{ label: 'Back to Home', icon: 'house', onPress: vi.fn() }}
            />,
        );
        // Each action sits in its press-scale frame, so the row of actions is the frame's parent, and the frame is what
        // that row lays out.
        const frame = pressFrameOf(screen.getByRole('button', { name: 'Try again' }));
        const style = getComputedStyle(frame.parentElement as HTMLElement);

        expect(style.alignItems).not.toBe('stretch');
        expect(style.alignSelf).not.toBe('stretch');
        expect(getComputedStyle(frame).alignSelf).not.toBe('stretch');
    });
});
