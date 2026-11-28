/**
 * A roadmap placeholder card draws the sm level of the elevation table whole, in both themes, through `Elevated`, on
 * the box that carries the paper fill (Android draws elevation only on a filled view). Written before the move off
 * `nativeTokens.elevation`.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { elevationBoxShadow } from '@commise/ui/testing/elevation-shadow';
import { filledBoxOf } from '@commise/ui/testing/filled-box';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';

import { PlaceholderWidgetCard } from '../../../src/components/home/skeletons/PlaceholderWidgetCard.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('PlaceholderWidgetCard (native), %s theme: its elevation', (scheme) => {
    it('lifts the card with the sm level of the table whole (mutant: a literal shadow, or another level)', () => {
        systemScheme.current = scheme;
        renderWithTamagui(
            <PlaceholderWidgetCard title="Today’s nutrition" soonLabel="Soon">
                {null}
            </PlaceholderWidgetCard>,
            scheme,
        );
        const card = filledBoxOf(screen.getByText('Today’s nutrition'), rgb(rolesFor(scheme).paper), 'the card');

        expect(resolvedStyle(card, 'boxShadow')).toBe(elevationBoxShadow('sm'));
    });
});
