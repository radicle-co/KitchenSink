/**
 * `useColorSchemeName` is the one reading of the system scheme on native. `useTheme` and the Tamagui provider's
 * `defaultTheme` both take it, so the two cannot disagree about which scheme the device is in. A platform with no
 * preference (`null`) is light, and a change on the device reaches the next render.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';

const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));

// Imported after the mock is registered.
const { useColorSchemeName } = await import('../useColorSchemeName.native.js');

function Probe() {
    return <Text>{useColorSchemeName()}</Text>;
}

afterEach(() => {
    cleanup();
    scheme.current = null;
});

describe('useColorSchemeName (native)', () => {
    it.each([
        ['dark', 'dark'],
        ['light', 'light'],
        [null, 'light'],
    ] as const)('reads %s from the system as %s', (system, expected) => {
        scheme.current = system;
        render(<Probe />);

        expect(screen.getByText(expected)).toBeTruthy();
    });

    it('follows a change on the device at the next render', () => {
        scheme.current = 'light';
        const { rerender } = render(<Probe />);

        scheme.current = 'dark';
        act(() => {
            rerender(<Probe />);
        });

        expect(screen.getByText('dark')).toBeTruthy();
    });
});
