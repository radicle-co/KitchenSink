/**
 * The native icon button: a 48 dp frame on Android (44 elsewhere) around a 44 circle, one glyph at 24 that stays 24,
 * named by the caller. Mutation lens: a hit slop instead of a frame fails the frame row; a target
 * that grows with the text fails the 2x row; a glyph that grows fails the 2x row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { createRef, type ReactElement } from 'react';
import type { View } from 'react-native';

// react-native-web does not implement `sendAccessibilityEvent`; the focus request reads its calls.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { present } from '../../testing/present.js';
import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { DesignSystemTheme } from '../../tamagui/DesignSystemTheme.native.js';
import { IconButton } from '../IconButton.native.js';

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const glyph = (): HTMLElement =>
    present(document.querySelector<HTMLElement>('[data-commise-stub="icon"]'), 'the glyph');

describe('IconButton (native)', () => {
    it('is a button named by the caller that reports a press once', () => {
        const onPress = vi.fn();
        renderWithTamagui(
            <IconButton icon="pause" accessibilityLabel="Pause Roast timer" onPress={onPress} />,
            'light',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Pause Roast timer' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('draws a 24 glyph at the default text size and still 24 at twice the size', () => {
        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />, 'light', 1);
        expect(glyph().dataset['iconSize']).toBe('24');
        cleanup();

        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />, 'light', 2);
        expect(glyph().dataset['iconSize']).toBe('24');
    });

    it.each([
        ['ios', 1, 44],
        ['ios', 2, 44],
        ['android', 1, 48],
        ['android', 2, 48],
    ] as const)('on %s at text scale %s the touch frame is %i and the 44 circle sits inside it', (os, scale, side) => {
        withPlatformOs(os, () =>
            renderWithTamagui(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />, 'light', scale),
        );
        const frame = present(screen.getByRole('button', { name: 'Cancel' }).firstElementChild, 'the frame');
        const circle = present(frame.firstElementChild, 'the circle');

        expect(getComputedStyle(frame).width).toBe(`${String(side)}px`);
        expect(getComputedStyle(frame).height).toBe(`${String(side)}px`);
        expect(getComputedStyle(circle).width).toBe('44px');
    });
});

describe('IconButton (native), a focus request', () => {
    const themed = (ui: ReactElement) => (
        <DesignSystemTheme scheme="light" textScale={1}>
            {ui}
        </DesignSystemTheme>
    );
    const requested = (focusRequested: boolean, onFocusRequestHandled = vi.fn<() => void>()) => (
        <IconButton
            icon="x"
            accessibilityLabel="Cancel"
            onPress={vi.fn()}
            focusRequested={focusRequested}
            onFocusRequestHandled={onFocusRequestHandled}
        />
    );

    it('moves the screen-reader cursor to the button and acknowledges, once', () => {
        const handled = vi.fn<() => void>();
        const { rerender } = render(themed(requested(false, handled)));

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(themed(requested(true, handled)));
        rerender(themed(requested(true, handled)));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: 'Cancel' }),
            'focus',
        );
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('hands the host its own ref, object or callback, the button node, and still moves focus on a request', () => {
        const objectRef = createRef<View>();
        const callbackRef = vi.fn<(node: View | null) => void>();

        const { rerender } = render(
            themed(
                <IconButton
                    icon="x"
                    accessibilityLabel="Cancel"
                    onPress={vi.fn()}
                    ref={objectRef}
                    focusRequested={false}
                />,
            ),
        );
        const button = screen.getByRole('button', { name: 'Cancel' });

        expect(objectRef.current).toBe(button);

        rerender(
            themed(
                <IconButton
                    icon="x"
                    accessibilityLabel="Cancel"
                    onPress={vi.fn()}
                    ref={callbackRef}
                    focusRequested
                    onFocusRequestHandled={vi.fn()}
                />,
            ),
        );

        expect(callbackRef).toHaveBeenCalledWith(button);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(button, 'focus');
    });
});
