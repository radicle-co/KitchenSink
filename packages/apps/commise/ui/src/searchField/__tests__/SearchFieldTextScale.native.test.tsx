/**
 * The search pill's input at the system text cap. It takes the body role's size at the capped scale, as the design-system
 * Text does, and the platform does not scale it a second time.
 *
 * On iOS it carries NO `lineHeight`: React Native's Fabric text input applies a line height as paragraph style without
 * the baseline offset that centres a `Text` (`RCTTextLayoutManager.mm` calls `RCTApplyBaselineOffset`; the text input
 * path never does), so a line box taller than the font pushes the text to its bottom edge, low in the pill. qa-ios
 * measured it 4 pt low at 1x and touching the border at the cap.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { SearchField } from '../SearchField.native.js';

afterEach(cleanup);

const field = (scale: number, os: 'ios' | 'android' = 'ios'): HTMLElement => {
    withPlatformOs(os, () =>
        renderWithTamagui(
            <SearchField
                id="search"
                label="Search recipes"
                labelVisibility="hidden"
                clearLabel="Clear search"
                value=""
                onChangeText={() => undefined}
                placeholder="Search your recipes"
            />,
            'light',
            scale,
        ),
    );

    return screen.getByRole('textbox', { name: 'Search recipes' });
};

describe('SearchField (native) — the input at the system text scale', () => {
    it.each([1, 2, 3.1])('draws the body size at scale %s, to the 2x cap', (scale) => {
        expect(resolvedStyle(field(scale), 'fontSize')).toBe(`${scaledTypeSize('body', scale).fontSize}px`);
    });

    it('holds at the cap past 2x', () => {
        const atCap = resolvedStyle(field(2), 'fontSize');
        cleanup();

        expect(resolvedStyle(field(3.1), 'fontSize')).toBe(atCap);
    });

    // ⛔ A line height here pushes the text to the bottom of its box on iOS: qa-ios measured it 4 pt low at 1x and touching
    // the border at the cap.
    it.each([1, 3.1])(
        'sets no line height on iOS at scale %s, so the platform centres the text in the pill',
        (scale) => {
            expect(field(scale).style.lineHeight).toBe('');
        },
    );

    it('keeps the capped line height on Android, which has no such offset and otherwise grows its leading uncapped', () => {
        expect(resolvedStyle(field(3.1, 'android'), 'lineHeight')).toBe(`${scaledTypeSize('body', 3.1).lineHeight}px`);
    });
});
