/**
 * A pressed native `ChoiceRow` takes the press fill of the surface it sits on (`componentFixes.md` §10, §10a), the one
 * its web twin takes from `--cm-press`: `theme.press.<tone>`, never `colors.surfaceMuted`. react-native-web's `Pressable`
 * does not toggle `pressed` from jsdom events, so it is stood in for by one that renders its `pressed` branch.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Surface } from '../../surfaceTone/Surface.native.js';
import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { themeFor } from '../../theme/themeFor.js';
import { ChoiceRow } from '../ChoiceRow.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const { pressedPressable } = await import('../../testing/pressedPressable.js');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return { ...actual, Pressable: pressedPressable(actual) };
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('a pressed ChoiceRow in the %s theme', (scheme) => {
    it.each(['paper', 'paperOverlay'] as const)('on a %s surface presses to that surface’s press fill', (tone) => {
        systemScheme.current = scheme;
        render(
            <Surface tone={tone}>
                <ChoiceRow
                    accessibilityLabel="Whole milk"
                    chosen={false}
                    busy={false}
                    refused={false}
                    onPress={vi.fn()}
                >
                    <Text>Whole milk</Text>
                </ChoiceRow>
            </Surface>,
        );
        const fill = getComputedStyle(screen.getByRole('button', { name: 'Whole milk' })).backgroundColor;

        expect(fill).toBe(rgb(themeFor(scheme).press[tone]));
        expect(fill).not.toBe(rgb(rolesFor(scheme).surfaceMuted));
    });
});
