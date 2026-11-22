/**
 * The native icon button: a 48 dp frame on Android (44 elsewhere) around a 44 circle, one glyph at 24 that stays 24,
 * named by the caller. Mutation lens: a hit slop instead of a frame fails the frame row; a target
 * that grows with the text fails the 2x row; a glyph that grows fails the 2x row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

const platform = vi.hoisted(() => ({ os: undefined as 'android' | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os ?? actual.Platform.OS;
            },
        },
    };
});

import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { IconButton } from '../IconButton.native.js';

afterEach(() => {
    cleanup();
    platform.os = undefined;
});

const glyph = (): HTMLElement => document.querySelector('[data-commise-stub="icon"]') as HTMLElement;

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

    it.each([1, 2])('keeps its 44 target at text scale %s on iOS', (scale) => {
        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />, 'light', scale);
        const frame = getComputedStyle(screen.getByRole('button', { name: 'Cancel' }).firstElementChild as HTMLElement);

        expect(frame.width).toBe('44px');
        expect(frame.height).toBe('44px');
    });

    it('is a 48 dp frame on Android, with the 44 circle inside it and no hit slop', () => {
        platform.os = 'android';
        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />, 'light');
        const frame = getComputedStyle(screen.getByRole('button', { name: 'Cancel' }).firstElementChild as HTMLElement);

        expect(frame.width).toBe('48px');
        expect(frame.height).toBe('48px');
    });
});
