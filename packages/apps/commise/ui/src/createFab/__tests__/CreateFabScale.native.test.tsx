/**
 * Designer ruling d (mergedUiAndroid1.md, 2026-11-02): the floating button's label follows the 1.5x chrome cap, the
 * pill grows with it, and the end room a screen reserves is the DRAWN height at the current text scale plus its margin
 * plus 16 (designAnswers.md). Rendered through the design system's provider so the text scale is the real context.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Text as NativeText } from 'react-native';

vi.mock('expo-glass-effect', () => ({ isLiquidGlassAvailable: () => false, isGlassEffectAPIAvailable: () => false }));
vi.mock('react-native-safe-area-context', async () => await import('../../testing/safeAreaContext.native.js'));
vi.mock('../../screenEnvironment/useWindowWidth.native.js', () => ({ useWindowWidth: () => 390 }));
vi.mock('../../screenEnvironment/useKeyboardOpen.native.js', () => ({ useKeyboardOpen: () => false }));

import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { CreateFab } from '../CreateFab.native.js';
import { fabHeightAt, fabReservedBottomOf } from '../createFabPolicy.js';
import { useFabReservedBottom } from '../useFabReservedBottom.native.js';

afterEach(cleanup);

function Room(): ReactElement {
    return <NativeText testID="room">{String(useFabReservedBottom())}</NativeText>;
}

const roomAt = (scale: number): number => {
    renderWithTamagui(<Room />, 'light', scale);
    const value = Number(screen.getByTestId('room').textContent);
    cleanup();

    return value;
};

const labelSizeAt = (scale: number): number => {
    renderWithTamagui(<CreateFab label="New recipe" icon="plus" onPress={vi.fn()} />, 'light', scale);
    const size = parseFloat(resolvedStyle(screen.getAllByText('New recipe')[0] as HTMLElement, 'fontSize'));
    cleanup();

    return size;
};

describe('the floating button’s end room grows with the font scale', () => {
    it('is 88 at scale 1, 98 at 1.5x, and stays 98 at 2x', () => {
        expect(roomAt(1)).toBe(88);
        expect(roomAt(1.5)).toBe(98);
        expect(roomAt(2)).toBe(98);
    });

    it('is the policy’s formula over the drawn height, not a second copy of it', () => {
        expect(roomAt(1.25)).toBe(fabReservedBottomOf(fabHeightAt(1.25)));
    });
});

describe('the floating button’s label caps at 1.5x', () => {
    it('draws the 14 px label at 14, 21 and then holds 21 at 2x', () => {
        expect(labelSizeAt(1)).toBe(14);
        expect(labelSizeAt(1.5)).toBe(21);
        expect(labelSizeAt(2)).toBe(21);
    });
});

describe('the floating button’s drawn height is the height the end room is computed from', () => {
    const faceHeightAt = (scale: number): string => {
        renderWithTamagui(<CreateFab label="New recipe" icon="plus" onPress={vi.fn()} />, 'light', scale);
        const face = screen.getByRole('button', { name: 'New recipe' }).firstElementChild as HTMLElement;
        const height = face.style.height;
        cleanup();

        return height;
    };

    it('is 56 at scale 1, 66 at 1.5x and still 66 at 2x', () => {
        expect(faceHeightAt(1)).toBe('56px');
        expect(faceHeightAt(1.5)).toBe('66px');
        expect(faceHeightAt(2)).toBe('66px');
    });
});
