/**
 * The design system's provider (ADR-0080): the one place that pairs the Tamagui config with the scheme the device is
 * in. The app's provider tree and the test `render` both mount it, so a test paints in the scheme the app would. The
 * device scheme comes from the shared stub, so these rows fail if the provider stops following it or paints a fixed
 * theme.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleSheet } from 'react-native';
import { styled, View } from 'tamagui';

import { systemScheme } from '../../testing/systemColorScheme.js';
import { resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { role, roleDark } from '../../tokens/colors.js';
import { DesignSystemProvider } from '../DesignSystemProvider.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

const Swatch = styled(View, { backgroundColor: '$paper' });

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('DesignSystemProvider (native)', () => {
    it.each([
        ['dark', roleDark],
        ['light', role],
        [null, role],
    ] as const)('paints in the scheme the device reports (%s)', (scheme, colors) => {
        systemScheme.current = scheme;

        render(
            <DesignSystemProvider>
                <Swatch aria-label="swatch" />
            </DesignSystemProvider>,
        );

        expect(resolvedColour(screen.getByLabelText('swatch'), 'backgroundColor')).toBe(formatRgb(colors.paper));
    });

    // Designer ruling 2026-11-01: a section divider or a rule is the device's hairline, through the `$hairline` token.
    it('draws a `$hairline` border at React Native’s hairline width', () => {
        render(
            <DesignSystemProvider>
                <View aria-label="rule" borderBottomWidth="$hairline" />
            </DesignSystemProvider>,
        );

        expect(resolvedStyle(screen.getByLabelText('rule'), 'borderBottomWidth')).toBe(
            `${String(StyleSheet.hairlineWidth)}px`,
        );
    });

    it('re-themes the tree when the device scheme changes', () => {
        // A fresh element each time: React skips a root rerender given the same element object.
        const tree = (): JSX.Element => (
            <DesignSystemProvider>
                <Swatch aria-label="swatch" />
            </DesignSystemProvider>
        );

        systemScheme.current = 'light';
        const { rerender } = render(tree());

        systemScheme.current = 'dark';
        rerender(tree());

        expect(resolvedColour(screen.getByLabelText('swatch'), 'backgroundColor')).toBe(formatRgb(roleDark.paper));
    });
});
