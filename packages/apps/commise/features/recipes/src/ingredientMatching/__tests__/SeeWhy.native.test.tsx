/**
 * Component tests for the native `SeeWhy` (through react-native-web): the visible disclosure that opens a line's reason
 * in place (owner design 2026-10-26). The switch is `accessibilityState.expanded`; the reason shows under the row in
 * the 14 px `meta` role, is announced once on opening, and closes on a second tap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { nativeTokens } from '@commise/ui/native';

import { SeeWhy } from '../SeeWhy.native.js';
import { render } from '@commise/ui/testing/tamagui';

afterEach(cleanup);

const REASON = 'Our check did not run this month, so this is our best guess.';

function renderWhy() {
    const onOpen = vi.fn();

    render(<SeeWhy label="See why" reason={REASON} onOpen={onOpen} />);

    return { onOpen };
}

describe('SeeWhy (native)', () => {
    it('starts closed: a collapsed disclosure button, no reason on screen', () => {
        renderWhy();

        expect(screen.getByRole('button', { name: 'See why' }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText(REASON)).toBeNull();
    });

    it('⛔ opens the reason in place, announces it once, and closes on a second tap without announcing again', () => {
        const { onOpen } = renderWhy();
        const button = screen.getByRole('button', { name: 'See why' });

        fireEvent.click(button);

        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText(REASON)).toBeTruthy();
        expect(onOpen).toHaveBeenCalledTimes(1);

        fireEvent.click(button);

        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText(REASON)).toBeNull();
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('draws the reason in the 14 px meta role', () => {
        renderWhy();
        fireEvent.click(screen.getByRole('button', { name: 'See why' }));

        expect(getComputedStyle(screen.getByText(REASON)).fontSize).toBe(
            `${String(nativeTokens.type.meta.fontSize)}px`,
        );
    });
});
