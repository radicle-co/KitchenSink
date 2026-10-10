import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Text } from 'react-native';

import { roleDark, role } from '../../tokens/colors.js';

const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));

// Imported after the mock is registered.
const { useTheme } = await import('../useTheme.native.js');

/**
 * `useTheme` (native) follows the SYSTEM setting (`darkTheme.md` §5): dark when the OS says dark, light when it says
 * light AND when it says nothing (`null`, the platform with no preference), with no app-level override.
 */
afterEach(cleanup);

function Probe() {
    const theme = useTheme();

    return <Text style={{ color: theme.colors.ink }}>{theme.scheme}</Text>;
}

describe('useTheme (native)', () => {
    it.each([
        ['dark', 'dark', roleDark.ink],
        ['light', 'light', role.ink],
        [null, 'light', role.ink],
    ] as const)('reads %s from the system as the %s theme', (system, expected, ink) => {
        scheme.current = system;
        render(<Probe />);

        const text = screen.getByText(expected);
        const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(ink.slice(at, at + 2), 16));

        expect(getComputedStyle(text).color).toBe(`rgb(${r}, ${g}, ${b})`);
    });
});
