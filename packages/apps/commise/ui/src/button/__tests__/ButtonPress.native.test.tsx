/**
 * The native Button's PRESS paint (parity item 4, `componentFixes` §5 and the web twin `surfaceClass.ts`).
 *
 * Before: a native Button showed only a 0.98 scale, and under reduce-motion NOTHING, so a quiet or ghost button showed no
 * press at all. Now the press paints `theme.wash` (`lineDivider` over a muted parent) under the scale, and the paint is
 * NOT gated by reduce-motion: motion is non-essential, a response to the touch is not.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from synthetic jsdom events (see `PressScale.native.test`), so
 * `Pressable` is stood in for by one that renders its `pressed` branch, and everything above it (Button, PressScale, the
 * paint) is the real code.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false, reduceMotion: false }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        Pressable: (props: {
            readonly children: unknown;
            readonly style: (state: { pressed: boolean }) => Record<string, unknown>;
            readonly accessibilityRole?: 'button';
            readonly accessibilityLabel?: string;
        }) =>
            createElement(
                actual.View,
                {
                    role: props.accessibilityRole,
                    'aria-label': props.accessibilityLabel,
                    style: props.style({ pressed: press.pressed }),
                },
                typeof props.children === 'function'
                    ? (props.children as (state: { pressed: boolean }) => never)({ pressed: press.pressed })
                    : (props.children as never),
            ),
    };
});

vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => press.reduceMotion }));

import { themeFor } from '../../theme/themeFor.js';
import { RefreshNotice } from '../../refreshNotice/RefreshNotice.native.js';
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
            rgb(light.wash),
        );

        press.pressed = true;
        rerender(<Button variant={variant}>Try again</Button>);

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Try again' }))).backgroundColor).toBe(
            rgb(light.wash),
        );
    });

    it('still paints the wash under reduce-motion, and skips only the scale', () => {
        press.pressed = true;
        press.reduceMotion = true;
        render(<Button variant="quiet">Try again</Button>);
        const button = screen.getByRole('button', { name: 'Try again' });

        expect(getComputedStyle(pillOf(button)).backgroundColor).toBe(rgb(light.wash));
        expect(button.style.transform).toBe('scale(1)');
    });

    it('scales on top of the paint when motion is allowed', () => {
        press.pressed = true;
        render(<Button variant="quiet">Try again</Button>);

        expect(screen.getByRole('button', { name: 'Try again' }).style.transform).not.toBe('scale(1)');
    });

    it('presses to lineDivider over a muted parent, where the wash would not show', () => {
        press.pressed = true;
        render(
            <Button variant="quiet" over="muted">
                Try again
            </Button>,
        );

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Try again' }))).backgroundColor).toBe(
            rgb(light.colors.lineDivider),
        );
    });

    it('presses a secondary button to the wash but keeps its lineControl edge', () => {
        press.pressed = true;
        render(
            <Button variant="secondary" icon="check">
                Done
            </Button>,
        );
        const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Done' })));

        expect(pill.backgroundColor).toBe(rgb(light.wash));
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

// Parity item 6: the notice's quiet Try again sits on a surfaceMuted row, so its press must show against it.
describe('RefreshNotice (native) — Try again over the muted row', () => {
    it('presses to lineDivider, not the wash that matches the row', () => {
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

        expect(fill).toBe(rgb(light.colors.lineDivider));
        expect(fill).not.toBe(rgb(light.colors.surfaceMuted));
    });
});
