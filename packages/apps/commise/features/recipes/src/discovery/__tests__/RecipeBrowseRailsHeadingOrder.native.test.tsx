/**
 * Heading order on Discover at the largest text size (designer finding, qa-ios, 2026-11-03): the rail heading was a plain
 * React Native `Text` with the `sectionTitle` STYLE, which iOS grows by the whole system scale (18 x 3.1 = 55.8 pt) while the
 * page title stops at 1.5x (42 pt). The rail heading is now the design-system Text, `sectionTitle` role, capped at 1.5x.
 *
 * jsdom cannot apply the OS font scale to a plain React Native `Text`, so "no larger than the title" alone would pass for
 * the defect too. The first test therefore also pins the heading to the size its ROLE draws at that scale (27 pt), which
 * only the design-system Text produces. The second states the designer's ordering directly.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { scaledTypeSize } from '@commise/ui/scaled-type';
import { DiscoveryTitle } from '../DiscoveryTitle.native.js';
import { RecipeBrowseRails } from '../RecipeBrowseRails.native.js';

afterEach(cleanup);

/** The iOS scale at AX XXXL. */
const IOS_CAP_SCALE = 3.1;

const px = (element: HTMLElement): number => Number.parseFloat(resolvedStyle(element, 'fontSize'));

function renderDiscover() {
    renderWithTamagui(
        <LocaleProvider locale="en">
            <DiscoveryTitle focusSignal={0} action={undefined} />
            <RecipeBrowseRails
                rails={[{ id: 'trending', onSeeAll: () => undefined, headingFocusSignal: 0, body: null }]}
                cuisines={[{ value: 'Italian', onSelect: () => undefined }]}
            />
        </LocaleProvider>,
        'light',
        IOS_CAP_SCALE,
    );
}

describe('Discover (native) — heading order at the largest text size', () => {
    it('draws the rail heading and the cuisines heading at the sectionTitle role’s capped size', () => {
        renderDiscover();

        const expected = scaledTypeSize('sectionTitle', IOS_CAP_SCALE).fontSize;

        expect(px(screen.getByRole('heading', { name: 'Trending' }))).toBe(expected);
        expect(px(screen.getByRole('heading', { name: 'Browse by cuisine' }))).toBe(expected);
    });

    it('never draws the page title smaller than a rail heading', () => {
        renderDiscover();

        const title = px(screen.getByRole('heading', { name: 'Discover' }));

        expect(title).toBeGreaterThanOrEqual(px(screen.getByRole('heading', { name: 'Trending' })));
        expect(title).toBeGreaterThanOrEqual(px(screen.getByRole('heading', { name: 'Browse by cuisine' })));
    });
});
