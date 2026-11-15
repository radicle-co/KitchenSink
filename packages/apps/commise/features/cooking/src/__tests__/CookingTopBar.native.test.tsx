/**
 * The native top bar: Exit as ONE control (the × and the visible label together, one accessible name that contains the
 * label, at least 48 tall), then the place as plain text with no button role. The place is one optional value, its text
 * and its tone together, so a tone can never arrive without a place; Done passes none. Native also takes `narrow`, the
 * under-360 rule the screen reads from the window, because a leaf never reads the device.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingTopBar, type NativeCookingTopBarProps } from '../CookingTopBar.native.js';
import { tallestMinHeight } from './utils/buttonPill.js';

afterEach(cleanup);

function barProps(overrides: Partial<NativeCookingTopBarProps> = {}): NativeCookingTopBarProps {
    return {
        exit: { label: 'Exit', accessibilityLabel: 'Exit cooking mode', onPress: vi.fn() },
        place: { text: 'Step 2 of 6', tone: 'ink' },
        narrow: false,
        ...overrides,
    };
}

describe('CookingTopBar (native)', () => {
    it('is ONE Exit button, named "Exit cooking mode", showing "Exit"', () => {
        render(<CookingTopBar {...barProps()} />);

        const buttons = screen.getAllByRole('button');
        const exit = screen.getByRole('button', { name: 'Exit cooking mode' });

        expect(buttons).toEqual([exit]);
        expect(exit.textContent).toContain('Exit');
    });

    it('exits on a press', () => {
        const props = barProps();
        render(<CookingTopBar {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Exit cooking mode' }));

        expect(props.exit.onPress).toHaveBeenCalledTimes(1);
    });

    it('is at least 48 tall', () => {
        render(<CookingTopBar {...barProps()} />);

        const height = tallestMinHeight(screen.getByRole('button', { name: 'Exit cooking mode' }));

        expect(height).toBeGreaterThanOrEqual(48);
    });

    it('shows the place as plain text, not a control', () => {
        render(<CookingTopBar {...barProps()} />);

        const place = screen.getByText('Step 2 of 6');

        expect(place.closest('[role="button"]')).toBeNull();
    });

    // While the recipe loads the place says "Step –" in inkMuted.
    it('mutes the place while loading, and draws it in ink otherwise', () => {
        const { unmount } = render(<CookingTopBar {...barProps()} />);
        const ink = getComputedStyle(screen.getByText('Step 2 of 6')).color;
        unmount();

        render(<CookingTopBar {...barProps({ place: { text: 'Step –', tone: 'muted' } })} />);

        expect(getComputedStyle(screen.getByText('Step –')).color).not.toBe(ink);
    });

    // Done has the top bar with its labelled Exit, and no place.
    it('draws Exit alone when it is handed no place (Done)', () => {
        render(<CookingTopBar {...barProps({ place: undefined })} />);

        expect(screen.getByRole('button', { name: 'Exit cooking mode' })).toBeTruthy();
        expect(screen.queryByText('Step 2 of 6')).toBeNull();
    });

    it('keeps the place beside Exit when wide', () => {
        render(<CookingTopBar {...barProps()} />);

        expect(getComputedStyle(screen.getByTestId('cooking-top-bar')).flexDirection).toBe('row');
    });

    // Under 360 wide the place takes its own row under Exit, and Exit keeps its label.
    it('moves the place to its own row under Exit when narrow, keeping the Exit label', () => {
        render(<CookingTopBar {...barProps({ narrow: true })} />);

        const exit = screen.getByRole('button', { name: 'Exit cooking mode' });
        const place = screen.getByText('Step 2 of 6');

        expect(exit.textContent).toContain('Exit');
        expect(getComputedStyle(screen.getByTestId('cooking-top-bar')).flexDirection).toBe('column');
        expect(exit.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
