/**
 * `ToneScope` states a surface's tone ONCE, to both readers: Tamagui's `<Theme name>` (so a bare `Text` or any Tamagui
 * part inside takes the tone's ink) and the JS tone context (`useSurfaceTone`, `usePressFill`). A raw
 * `SurfaceToneScope` states only the JS half; the guard `surfaceToneScopeOwnership` keeps it from being used alone.
 *
 * Mutation lens: drop the `<Theme>`, drop the context, or key the theme on the wrong tone, and a test fails.
 */
import { cleanup } from '@testing-library/react';
import { formatHex, wcagContrast } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { rgb, rolesFor } from '../../testing/systemColorScheme.js';
import { renderWithTamagui, resolvedColour } from '../../testing/tamaguiTesting.native.js';
import { Text } from '../../text/Text.native.js';
import { mixOver } from '../../tokens/colors.js';
import { INVERSE_INK_ALPHA, SURFACE_TONE_NAMES, SURFACE_TONES, type SurfaceTone } from '../surfaceTone.js';
import { useSurfaceTone } from '../surfaceToneContext.js';
import { Surface } from '../Surface.native.js';
import { ToneScope } from '../ToneScope.native.js';

afterEach(cleanup);

/** Prints the tone the JS context holds. */
function Probe() {
    return <Text>{`tone:${useSurfaceTone()}`}</Text>;
}

describe.each(['light', 'dark'] as const)('ToneScope (%s)', (scheme) => {
    const roles = rolesFor(scheme);

    it.each(SURFACE_TONE_NAMES)('%s: a bare Text takes the tone’s ink, and the JS context holds the tone', (tone) => {
        const { getByText } = renderWithTamagui(
            <ToneScope tone={tone}>
                <Text>plain</Text>
                <Probe />
            </ToneScope>,
            scheme,
        );

        expect(resolvedColour(getByText('plain'), 'color')).toBe(rgb(roles[SURFACE_TONES[tone].ink]));
        expect(getByText(`tone:${tone}`)).toBeTruthy();
    });

    it('lets the innermost tone win, through a nested lookup', () => {
        const { getByText } = renderWithTamagui(
            <ToneScope tone="paperOverlay">
                <ToneScope tone="inverse">
                    <Text>inner</Text>
                </ToneScope>
                <Text>outer</Text>
            </ToneScope>,
            scheme,
        );

        expect(resolvedColour(getByText('inner'), 'color')).toBe(rgb(roles.inverseInk));
        expect(resolvedColour(getByText('outer'), 'color')).toBe(rgb(roles.ink));
    });

    it('is what Surface states: a bare Text on an inverse surface reads inverseInk with no colour prop', () => {
        const { getByText } = renderWithTamagui(
            <Surface tone="inverse">
                <Text>on inverse</Text>
            </Surface>,
            scheme,
        );

        expect(resolvedColour(getByText('on inverse'), 'color')).toBe(rgb(roles.inverseInk));
    });

    it('a muted Text on an inverse surface takes the derived muted ink, and on the page the page’s', () => {
        const { getByText } = renderWithTamagui(
            <>
                <ToneScope tone="inverse">
                    <Text color="$inkMuted">on inverse</Text>
                </ToneScope>
                <Text color="$inkMuted">on the page</Text>
            </>,
            scheme,
        );

        expect(resolvedColour(getByText('on inverse'), 'color')).toBe(
            rgb(mixOver(roles.inverseInk, roles.inverse, INVERSE_INK_ALPHA.inkMuted)),
        );
        expect(resolvedColour(getByText('on the page'), 'color')).toBe(rgb(roles.inkMuted));
    });

    it.each(SURFACE_TONE_NAMES)('%s: the ink clears 4.5:1 on its own fill', (tone: SurfaceTone) => {
        const { ink, fill } = SURFACE_TONES[tone];

        expect(wcagContrast(formatHex(roles[ink]) ?? '', formatHex(roles[fill]) ?? '')).toBeGreaterThanOrEqual(4.5);
    });
});
