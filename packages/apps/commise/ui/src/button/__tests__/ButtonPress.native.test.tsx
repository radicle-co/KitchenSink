/**
 * The native Button's PRESS paint (parity item 4, `componentFixes` §5 and the web twin `surfaceClass.ts`).
 *
 * Before: a native Button showed only a 0.98 scale, and under reduce-motion NOTHING, so a quiet or ghost button showed no
 * press at all. Now the press paints the press fill of the surface the button sits on (`theme.press`, the canvas row outside any surface) under the scale, and the paint is
 * NOT gated by reduce-motion: motion is non-essential, a response to the touch is not.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from synthetic jsdom events (see `PressScale.native.test`), so
 * `Pressable` is stood in for by one that renders its `pressed` branch, and everything above it (Button, PressScale, the
 * paint) is the real code.
 */
import { cleanup, screen } from '@testing-library/react';
import { pressScaleOf, render } from '../../testing/tamaguiTesting.native.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false, reduceMotion: false }));

vi.mock('react-native', async (importOriginal) => {
    const { pressedPressable } = await import('../../testing/pressedPressable.js');
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, Pressable: pressedPressable(actual, () => press.pressed) };
});

vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => press.reduceMotion }));

import { themeFor } from '../../theme/themeFor.js';
import { RefreshNotice } from '../../refreshNotice/RefreshNotice.native.js';
import { Surface } from '../../surfaceTone/Surface.native.js';
import { Button } from '../Button.native.js';

afterEach(() => {
    cleanup();
    press.pressed = false;
    press.reduceMotion = false;
});

/** `#RRGGBB` → the `rgb(r, g, b)` spelling jsdom normalises colours to. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** The painted pill: the rounded element inside the button. */
function pillOf(button: HTMLElement): HTMLElement {
    const pill = [button, ...Array.from(button.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) > 0,
    );

    if (pill === undefined) {
        throw new Error('The button paints no rounded surface.');
    }

    return pill;
}

const light = themeFor('light');

describe('Button (native) — the press paint', () => {
    it.each(['quiet', 'ghost'] as const)('%s paints nothing at rest and the wash while pressed', (variant) => {
        const { rerender } = render(<Button variant={variant}>Try again</Button>);

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Try again' }))).backgroundColor).not.toBe(
            rgb(light.press.canvas),
        );

        press.pressed = true;
        rerender(<Button variant={variant}>Try again</Button>);

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Try again' }))).backgroundColor).toBe(
            rgb(light.press.canvas),
        );
    });

    it('still paints the wash under reduce-motion, and skips only the scale', () => {
        press.pressed = true;
        press.reduceMotion = true;
        render(<Button variant="quiet">Try again</Button>);
        const button = screen.getByRole('button', { name: 'Try again' });

        expect(getComputedStyle(pillOf(button)).backgroundColor).toBe(rgb(light.press.canvas));
        expect(pressScaleOf(button)).toBe('1');
    });

    it('scales on top of the paint when motion is allowed', () => {
        press.pressed = true;
        render(<Button variant="quiet">Try again</Button>);

        expect(pressScaleOf(screen.getByRole('button', { name: 'Try again' }))).toBe('0.98');
    });

    it('presses to the muted surface’s press fill inside a muted surface, which the page’s press would not match', () => {
        press.pressed = true;
        render(
            <Surface tone="muted">
                <Button variant="quiet">Try again</Button>
            </Surface>,
        );
        const fill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Try again' }))).backgroundColor;

        expect(fill).toBe(rgb(light.press.muted));
        expect(fill).not.toBe(rgb(light.press.canvas));
    });

    it('presses a secondary button to the wash but keeps its lineControl edge', () => {
        press.pressed = true;
        render(
            <Button variant="secondary" icon="check">
                Done
            </Button>,
        );
        const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Done' })));

        expect(pill.backgroundColor).toBe(rgb(light.press.canvas));
        expect(pill.borderTopColor).toBe(rgb(light.colors.lineControl));
    });

    it('presses a primary button to actionPressed, the web hover:bg-action-pressed twin', () => {
        press.pressed = true;
        render(<Button icon="check">Save</Button>);

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Save' }))).backgroundColor).toBe(
            rgb(light.colors.actionPressed),
        );
    });
});

// The notice STATES the muted surface and its quiet Try again reads it: the press is the muted row's, not the page's.
describe('RefreshNotice (native) — Try again on the muted row', () => {
    it('presses to the muted surface’s press fill, not the page’s', () => {
        press.pressed = true;
        render(
            <RefreshNotice
                failed
                refreshing={false}
                onRetry={vi.fn()}
                labels={{ failed: 'We couldn’t refresh.', retry: 'Try again' }}
            />,
        );
        const fill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Try again' }))).backgroundColor;

        expect(fill).toBe(rgb(light.press.muted));
        expect(fill).not.toBe(rgb(light.press.canvas));
    });
});
