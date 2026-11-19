/**
 * The native top bar: Exit as ONE control (the × and the visible label together, one accessible name that contains the
 * label, at least 48 tall), then the place as plain text with no button role. The place is one optional value, its text
 * and its tone together, so a tone can never arrive without a place; Done passes none. Native also takes `narrow`, the
 * under-360 rule the screen reads from the window, because a leaf never reads the device.
 */
import { nativeTokens } from '@commise/ui/native';
import { withPlatformOs } from '@commise/ui/testing/platform-os';
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingTopBar, type NativeCookingTopBarProps } from '../CookingTopBar.native.js';
import { tallestMinHeight } from './utils/buttonPill.js';

const user = userEvent.setup({ delay: null });

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

    it('exits on a press', async () => {
        const props = barProps();
        render(<CookingTopBar {...props} />);

        await user.click(screen.getByRole('button', { name: 'Exit cooking mode' }));

        expect(props.exit.onPress).toHaveBeenCalledTimes(1);
    });

    // The spec makes Exit a quiet `md` button, 44 tall like web's, and the platform touch floor lifts it on Android.
    it.each([
        ['ios', 44],
        ['android', 48],
    ] as const)('is the medium button, %s tall to the platform touch floor', (os, height) => {
        withPlatformOs(os, () => {
            render(<CookingTopBar {...barProps()} />);

            expect(tallestMinHeight(screen.getByRole('button', { name: 'Exit cooking mode' }))).toBe(height);
        });
    });

    // The spec: side padding 12 and a gap of 4 between Exit and the place, and the place in body text (16), as on web.
    it('pads 12 at the sides, keeps 4 between Exit and the place, and sets the place in body text', () => {
        render(<CookingTopBar {...barProps()} />);
        const bar = getComputedStyle(screen.getByTestId('cooking-top-bar'));

        expect(bar.paddingInline).toBe('var(--t-space-3)');
        expect(bar.gap).toBe('var(--t-space-1)');
        expect(getComputedStyle(screen.getByText('Step 2 of 6')).fontSize).toBe(
            `${String(nativeTokens.type.body.fontSize)}px`,
        );
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

    describe('the Ingredients button', () => {
        const withIngredients = (overrides: Partial<NativeCookingTopBarProps> = {}) =>
            barProps({ ingredients: { label: 'Ingredients', onPress: vi.fn() }, ...overrides });

        it('is a second button named by its visible label, with the list-checks glyph, never an icon alone', () => {
            render(<CookingTopBar {...withIngredients()} />);

            const button = screen.getByRole('button', { name: 'Ingredients' });

            expect(screen.getAllByRole('button')).toHaveLength(2);
            expect(button.textContent).toContain('Ingredients');
            expect(button.querySelector('[data-commise-stub="icon"]')?.getAttribute('data-icon-name')).toBe(
                'list-checks',
            );
        });

        it('calls its own press, and not Exit, when it is pressed', async () => {
            const props = withIngredients();
            render(<CookingTopBar {...props} />);

            await user.click(screen.getByRole('button', { name: 'Ingredients' }));

            expect(props.ingredients?.onPress).toHaveBeenCalledTimes(1);
            expect(props.exit.onPress).not.toHaveBeenCalled();
        });

        it('draws no Ingredients button while the screen gives none (L2, L3, or no ingredients)', () => {
            render(<CookingTopBar {...barProps()} />);

            expect(screen.queryByRole('button', { name: 'Ingredients' })).toBeNull();
        });

        it('is the medium button, 44 tall on iOS and 48 on Android', () => {
            for (const [os, height] of [
                ['ios', 44],
                ['android', 48],
            ] as const) {
                withPlatformOs(os, () => {
                    render(<CookingTopBar {...withIngredients()} />);

                    expect(tallestMinHeight(screen.getByRole('button', { name: 'Ingredients' }))).toBe(height);
                    cleanup();
                });
            }
        });

        it('wide: Exit, then the place, then Ingredients, on a row that wraps by whole controls', () => {
            render(<CookingTopBar {...withIngredients()} />);

            const exit = screen.getByRole('button', { name: 'Exit cooking mode' });
            const place = screen.getByText('Step 2 of 6');
            const ingredients = screen.getByRole('button', { name: 'Ingredients' });
            const bar = getComputedStyle(screen.getByTestId('cooking-top-bar'));

            expect(exit.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(place.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(bar.flexDirection).toBe('row');
            expect(bar.flexWrap).toBe('wrap');
        });

        it('wide: the place takes the free space, so Ingredients sits at the end of the bar', () => {
            render(<CookingTopBar {...withIngredients()} />);

            const place = getComputedStyle(screen.getByText('Step 2 of 6'));

            expect([place.flexGrow, place.flexShrink]).toEqual(['1', '0']);
        });

        it('narrow: Ingredients sits at the end of the controls row, wrapped or not', () => {
            render(<CookingTopBar {...withIngredients({ narrow: true })} />);

            const end = screen.getByTestId('cooking-top-bar-ingredients');

            expect(end.contains(screen.getByRole('button', { name: 'Ingredients' }))).toBe(true);
            expect(getComputedStyle(end).marginLeft).toBe('auto');
        });

        it('narrow: Exit and Ingredients share one wrapping row, and the place is its own row after it', () => {
            render(<CookingTopBar {...withIngredients({ narrow: true })} />);

            const exit = screen.getByRole('button', { name: 'Exit cooking mode' });
            const ingredients = screen.getByRole('button', { name: 'Ingredients' });
            const place = screen.getByText('Step 2 of 6');
            const controls = screen.getByTestId('cooking-top-bar-controls');
            const controlsStyle = getComputedStyle(controls);

            expect(controls.contains(exit)).toBe(true);
            expect(controls.contains(ingredients)).toBe(true);
            expect(controls.contains(place)).toBe(false);
            expect(exit.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(controls.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(controlsStyle.flexDirection).toBe('row');
            expect(controlsStyle.flexWrap).toBe('wrap');
            expect(getComputedStyle(screen.getByTestId('cooking-top-bar')).flexDirection).toBe('column');
        });
    });
});
