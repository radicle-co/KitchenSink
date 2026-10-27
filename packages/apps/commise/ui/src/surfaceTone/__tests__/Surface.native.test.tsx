/**
 * The native surface: a `View` that paints its tone's fill AND states the tone to every control inside it, because the
 * paint and the statement are one fact (`componentFixes.md` §10). Controls read the tone through a React context; React
 * context passes through a `Modal` (it is the React tree, not the native one), so a popup root states its own tone and a
 * control inside never inherits a parent's tone from behind the popup.
 *
 * Mutation lens: paint a different role, forget the provider, or let the innermost surface lose, and a test fails.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

import { Text } from 'react-native';

import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { themeFor } from '../../theme/themeFor.js';
import { SURFACE_TONE_NAMES, SURFACE_TONES, type SurfaceTone } from '../surfaceTone.js';
import { Surface } from '../Surface.native.js';
import { useSurfaceTone } from '../surfaceToneContext.js';
import { usePressFill } from '../usePressFill.native.js';

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

/** Prints the tone and the press fill its place in the tree reads. */
function Probe({ label }: { readonly label: string }) {
    const tone = useSurfaceTone();
    const press = usePressFill();

    return <Text>{`${label}:${tone}:${press}`}</Text>;
}

describe('Surface (native)', () => {
    for (const scheme of ['light', 'dark'] as const) {
        for (const tone of SURFACE_TONE_NAMES) {
            it(`${scheme} ${tone}: paints the tone's fill role`, () => {
                systemScheme.current = scheme;
                render(
                    <Surface tone={tone} accessibilityLabel="surface">
                        <Probe label="in" />
                    </Surface>,
                );

                expect(getComputedStyle(screen.getByLabelText('surface')).backgroundColor).toBe(
                    rgb(rolesFor(scheme)[SURFACE_TONES[tone].fill]),
                );
            });
        }
    }

    it('states its tone to a control inside, which reads that tone’s press fill', () => {
        for (const scheme of ['light', 'dark'] as const) {
            systemScheme.current = scheme;

            for (const tone of SURFACE_TONE_NAMES) {
                const { unmount } = render(
                    <Surface tone={tone}>
                        <Probe label="in" />
                    </Surface>,
                );

                expect(screen.getByText(`in:${tone}:${themeFor(scheme).press[tone]}`)).not.toBeNull();
                unmount();
            }
        }
    });

    it('reads the canvas row outside every surface', () => {
        render(<Probe label="out" />);

        expect(screen.getByText(`out:canvas:${themeFor('light').press.canvas}`)).not.toBeNull();
    });

    it('lets the innermost surface win, and hands its tone down to a container that states nothing', () => {
        const nested: SurfaceTone[] = ['paper', 'muted'];

        render(
            <Surface tone={nested[0] as SurfaceTone}>
                <Probe label="outer" />
                <Surface tone={nested[1] as SurfaceTone}>
                    <Text>{/* a container that states nothing */}</Text>
                    <Probe label="inner" />
                </Surface>
                <Probe label="after" />
            </Surface>,
        );

        const press = themeFor('light').press;

        expect(screen.getByText(`outer:paper:${press.paper}`)).not.toBeNull();
        expect(screen.getByText(`inner:muted:${press.muted}`)).not.toBeNull();
        expect(screen.getByText(`after:paper:${press.paper}`)).not.toBeNull();
    });
});
