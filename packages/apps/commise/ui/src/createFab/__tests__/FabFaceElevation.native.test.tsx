/**
 * The solid native FAB face draws the lg level of the elevation table whole, in both themes, as `Elevated` does for
 * every native shadow (issue: one path for shadows). It is found as the box that carries the `action` fill, because on
 * Android the elevation draws only on the filled view. Written before the move off `nativeTokens.elevation`.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-glass-effect', async () => {
    const { View } = await import('react-native');

    return {
        isLiquidGlassAvailable: () => false,
        isGlassEffectAPIAvailable: () => false,
        GlassView: View,
    };
});
vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

import { elevationBoxShadow } from '../../testing/elevationShadow.js';
import { filledBoxOf } from '../../testing/filledBox.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { FabFace } from '../FabFace.native.js';

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('FabFace (native, solid), %s theme', (scheme) => {
    // Mutant: a literal shadow, or another level.
    it('lifts the face with the lg level of the elevation table whole', () => {
        systemScheme.current = scheme;
        renderWithTamagui(
            <FabFace label="New recipe" icon="plus" presentation="extended" onLabelWidth={vi.fn()} />,
            scheme,
        );
        const face = filledBoxOf(screen.getAllByText('New recipe')[0], rgb(rolesFor(scheme).action), 'the FAB');

        expect(resolvedStyle(face, 'boxShadow')).toBe(elevationBoxShadow('lg'));
    });
});
