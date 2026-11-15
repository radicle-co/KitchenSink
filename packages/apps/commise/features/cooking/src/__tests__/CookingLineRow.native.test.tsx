/**
 * The native line row: ONE checkbox per line, named by the line's own text, with the box
 * drawn by the design system's glyph. The focus line is set in the focus role and every other line in the "Then" role,
 * so a swap of either role fails here, not on a device. Props are the shared contract's (`cookingViewProps.ts`): every
 * case kept, rewritten from the old `text`/`ticked`/`then` props.
 */
import { nativeTokens } from '@commise/ui/native';
import { PRESS_SCALE } from '@commise/ui/press-scale';
import { withPlatformOs } from '@commise/ui/testing/platform-os';
import { pressScaleOf, render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false }));

// react-native-web's Pressable does not toggle `pressed` from jsdom events, so a held row is the house stand-in. It renders
// the real Pressable whenever nothing is pressed, so every other case here runs on the real one.
vi.mock('react-native', async (importOriginal) => {
    const { pressedPressable } = await import('@commise/ui/testing/pressed-pressable');
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, Pressable: pressedPressable(actual, () => press.pressed) };
});

import { CookingLineRow } from '../CookingLineRow.native.js';
import type { CookingLineView } from '../cookingViewProps.js';
import { FOCUS_LINE_TYPE } from '../focusLineType.js';
import { tallestMinHeight } from './utils/buttonPill.js';

interface Face {
    readonly fontFamily: string;
}

/** A role's face, read at the regular class when the role has one style per container class. */
function faceOf(style: Face | { readonly regular: Face }): string {
    return 'regular' in style ? style.regular.fontFamily : style.fontFamily;
}

afterEach(() => {
    cleanup();
    press.pressed = false;
});

const LINE = 'Heat 1.5 tbsp. oil in a wide pan.';

/** The line as the contract hands it (`CookingLineView`). */
const lineOf = (checked: boolean, onToggle: () => void): CookingLineView => ({
    key: '0',
    text: LINE,
    checked,
    onToggle,
});

describe('CookingLineRow (native)', () => {
    // A held row answers the touch the way every house control does: it shrinks, keeping its checkbox role and state.
    it('shrinks while it is held, like every house control, still a checkbox with its state', () => {
        press.pressed = true;
        render(<CookingLineRow line={lineOf(true, vi.fn())} emphasis="other" />);

        const row = screen.getByRole('checkbox', { name: LINE });

        expect(pressScaleOf(row)).toBe(String(PRESS_SCALE));
        expect(row.getAttribute('aria-checked')).toBe('true');
    });

    it('is one checkbox named by the line text, reporting its state', () => {
        render(<CookingLineRow line={lineOf(false, vi.fn())} emphasis="focus" />);

        const row = screen.getByRole('checkbox', { name: LINE });

        expect(row.getAttribute('aria-checked')).toBe('false');
        expect(row.textContent).toBe(LINE);
    });

    it('reports ticked', () => {
        render(<CookingLineRow line={lineOf(true, vi.fn())} emphasis="other" />);

        expect(screen.getByRole('checkbox', { name: LINE }).getAttribute('aria-checked')).toBe('true');
    });

    it('toggles on a press of the row and of its text', () => {
        const onToggle = vi.fn();
        render(<CookingLineRow line={lineOf(false, onToggle)} emphasis="other" />);

        fireEvent.click(screen.getByRole('checkbox', { name: LINE }));
        fireEvent.click(screen.getByText(LINE));

        expect(onToggle).toHaveBeenCalledTimes(2);
    });

    // The focus line takes its face from the one seam both platforms read, so a change of the focus role moves this leaf
    // with it. A role with one style per container class is read at its regular class.
    it('sets the focus line in the face of the FOCUS_LINE_TYPE role', () => {
        const face = faceOf(nativeTokens.type[FOCUS_LINE_TYPE.nativeTypeRole]);
        render(<CookingLineRow line={lineOf(false, vi.fn())} emphasis="focus" />);

        expect(getComputedStyle(screen.getByText(LINE)).fontFamily).toBe(face);
    });

    // The focus line is 28, pinned as a number rather than a role so a role change that moves its size fails here; every
    // other line is the readingBody role.
    it('sets the focus line at 28 and every other line in readingBody', () => {
        const { unmount } = render(<CookingLineRow line={lineOf(false, vi.fn())} emphasis="focus" />);

        expect(getComputedStyle(screen.getByText(LINE)).fontSize).toBe('28px');
        unmount();

        render(<CookingLineRow line={lineOf(false, vi.fn())} emphasis="other" />);

        expect(getComputedStyle(screen.getByText(LINE)).fontSize).toBe(
            `${String(nativeTokens.type.readingBody.fontSize)}px`,
        );
    });

    it.each([
        ['ios', '44px'],
        ['android', '48px'],
    ] as const)('is at least the platform touch floor tall on %s', (os, height) => {
        withPlatformOs(os, () => {
            render(<CookingLineRow line={lineOf(false, vi.fn())} emphasis="other" />);

            // The row is a Pressable around the laid-out row, so the floor is the least height it holds anywhere.
            expect(`${String(tallestMinHeight(screen.getByRole('checkbox', { name: LINE })))}px`).toBe(height);
        });
    });
});
