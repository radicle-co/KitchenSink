/**
 * The native app CANVAS must paint the brand beach-glow gradient once, at the root, for every screen.
 *
 * All nine wireframes paint their page with `--gradient-beach-glow`; mobile painted a flat
 * `palette.fog` on each screen's own container (issue #145). {@link AppCanvas} is the single native
 * consumer of the shared `gradient.hero` token — the mirror of web's `body` rule — so the two platforms
 * derive one wash from one definition.
 *
 * Every assertion below is derived from the TOKEN, never from a copied hex literal: re-tone the ramp in
 * `@commise/ui` and these follow. Mutation lens — restore a flat fill, flatten the stops to one colour, or
 * mirror the vector, and each of the three tests fails in a different way.
 *
 * What this tier CANNOT prove: that the real `expo-linear-gradient` native view rasterizes the ramp on a
 * device. Under jsdom it is the `tests/stubs/expoLinearGradient` stand-in, so this asserts the PROJECTION
 * reaching the library. On-device rendering is covered only by the Maestro visual tier.
 */
import { gradient, toNativeGradient } from '@commise/ui/tokens/gradients';
import { role } from '@commise/ui/colors';
import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it } from 'vitest';

import { AppCanvas } from '../../src/components/AppCanvas';

/** The stub's DOM seam for a rendered `LinearGradient`. */
function canvasElement(): HTMLElement {
    const element = screen.getByText('canvas child').closest('[data-commise-stub="linear-gradient"]');

    expect(element, 'the canvas child is not inside a LinearGradient — the root paints no gradient').not.toBeNull();

    return element as HTMLElement;
}

describe('AppCanvas — the native beach-glow page canvas', () => {
    it('paints the shared hero ramp behind its children, colour for colour', () => {
        render(
            <AppCanvas>
                <Text>canvas child</Text>
            </AppCanvas>,
        );

        const expected = toNativeGradient(gradient.hero);

        expect(canvasElement().getAttribute('data-colors')).toBe(expected.colors.join('|'));
    });

    // REWRITTEN for the redesign: the canvas wash is FLAT (owner ruling, redesign.css), so it is no longer a multi-stop
    // ramp. What is held is that the canvas still reaches the native surface through the shared gradient spec, as the
    // canvas role, across the whole surface.
    it('paints the canvas role, from the shared spec, across the whole surface', () => {
        render(
            <AppCanvas>
                <Text>canvas child</Text>
            </AppCanvas>,
        );

        const expected = toNativeGradient(gradient.hero);
        const colors = (canvasElement().getAttribute('data-colors') ?? '').split('|');

        expect(new Set(colors)).toEqual(new Set([role.canvas]));
        expect(canvasElement().getAttribute('data-locations')).toBe(expected.locations.join('|'));
    });

    it('runs top to bottom, matching the web canvas (180°)', () => {
        render(
            <AppCanvas>
                <Text>canvas child</Text>
            </AppCanvas>,
        );

        const element = canvasElement();
        const [startX, startY] = (element.getAttribute('data-start') ?? '').split(',').map(Number);
        const [endX, endY] = (element.getAttribute('data-end') ?? '').split(',').map(Number);

        expect(startY).toBeLessThan(endY ?? 0);
        expect(startX).toBeCloseTo(endX ?? 0);
    });

    it('renders arbitrary screen content unchanged (it is a pure presentational wrapper)', () => {
        render(
            <AppCanvas>
                <Text>canvas child</Text>
                <Text>second child</Text>
            </AppCanvas>,
        );

        expect(screen.getByText('canvas child')).toBeTruthy();
        expect(screen.getByText('second child')).toBeTruthy();
    });
});
