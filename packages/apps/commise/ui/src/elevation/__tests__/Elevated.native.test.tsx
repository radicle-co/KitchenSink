/**
 * `Elevated` is the one design-system place a native view takes a shadow level. Every number it draws is read from
 * `nativeTokens.elevation`, so this test reads the same table and pins that each level reaches the view whole, in both
 * schemes: the offset, the blur, the opacity and the colour as the browser build draws them, and the Android level in
 * the style itself, which a browser cannot show. Written before the change.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { elevationBoxShadow } from '../../testing/elevationShadow.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { elevationThemeKeyOf, ELEVATION_LEVELS } from '../../theme/tamaguiThemes.js';
import { nativeTokens } from '../../tokens/native.js';
import { Elevated } from '../Elevated.native.js';

afterEach(cleanup);

describe.each(['light', 'dark'] as const)('Elevated, %s theme', (scheme) => {
    it.each(ELEVATION_LEVELS)(
        'draws the %s level of the table whole (mutant: a lost level, a re-typed number or the scrim as the colour)',
        (level) => {
            renderWithTamagui(<Elevated level={level} aria-label="Card" role="group" />, scheme);

            expect(resolvedStyle(screen.getByRole('group', { name: 'Card' }), 'boxShadow')).toBe(
                elevationBoxShadow(level),
            );
        },
    );
});

describe('Elevated, the style each level declares', () => {
    it.each(ELEVATION_LEVELS)('carries every field of the %s level, the Android level included', (level) => {
        const spec = nativeTokens.elevation[level];
        const declared = (Elevated.staticConfig.variants?.['level'] as Record<string, unknown> | undefined)?.[level];

        expect(declared).toEqual({
            shadowColor: `$${elevationThemeKeyOf(level)}`,
            shadowOffset: spec.shadowOffset,
            shadowOpacity: spec.shadowOpacity,
            shadowRadius: spec.shadowRadius,
            elevation: spec.elevation,
        });
    });
});
