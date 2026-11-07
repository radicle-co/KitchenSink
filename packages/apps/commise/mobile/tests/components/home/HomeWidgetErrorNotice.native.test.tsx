/**
 * What a failed Home widget shows in place of its body (native): one polite status line, in the `meta` role and the
 * `inkMuted` colour of the scheme it is shown in. The web leaf's `text-body-sm` is the same 14 px size.
 *
 * It draws through the design system's `Text` (ADR-0080), so it follows the device's dark scheme and the 2x text cap.
 * Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 *
 * Not observable here: its `accessibilityLiveRegion`, the channel TalkBack reads. Tamagui's web build, which this lane
 * renders, drops the prop rather than projecting it to `aria-live` as react-native-web did, so it is a device check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { homeMessages } from '@commise/features-core/home';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { HomeWidgetErrorNotice } from '../../../src/components/home/HomeWidgetErrorNotice.js';

afterEach(cleanup);

describe('HomeWidgetErrorNotice (native)', () => {
    it('says the failure as a polite status, in the localized copy', () => {
        renderWithTamagui(<HomeWidgetErrorNotice />, 'light');

        expect(screen.getByRole('status').textContent).toBe(homeMessages.en.widgetError);
    });

    it('sets the text in the meta role', () => {
        const spec = nativeTokens.type.meta;
        renderWithTamagui(<HomeWidgetErrorNotice />, 'light');
        const style = getComputedStyle(screen.getByRole('status'));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the text in inkMuted in the %s scheme', (scheme) => {
        renderWithTamagui(<HomeWidgetErrorNotice />, scheme);

        expect(resolvedColour(screen.getByRole('status'), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
    });
});
