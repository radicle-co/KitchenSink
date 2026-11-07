/**
 * The status badge in the dark scheme (native) paints the DARK pairs. It once read the light PRO constant in both
 * themes, so a dark-mode PRO chip was the light fill on a dark page.
 *
 * ⚠️ REWRITTEN for ADR-0080 slice 1: the badge takes its colours as Tamagui theme tokens, so the scheme is the
 * provider's (`renderWithTamagui(…, 'dark')`), not a faked `useColorScheme`. Mutation lens: a badge that reads a light
 * constant, or a raw palette colour, fails here.
 */
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithTamagui, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { roleDark } from '../../tokens/colors.js';
import { proToneDark } from '../../tokens/tones.js';
import { StatusBadge } from '../StatusBadge.native.js';

afterEach(cleanup);

function badgeOf(text: string): HTMLElement {
    const badge = screen.getByText(text).parentElement;

    if (badge === null) {
        throw new Error(`no badge around ${text}`);
    }

    return badge;
}

describe('StatusBadge (native, dark scheme)', () => {
    it('paints PRO with the dark pair', () => {
        renderWithTamagui(<StatusBadge status="pro">PRO</StatusBadge>, 'dark');

        expect(resolvedColour(badgeOf('PRO'), 'backgroundColor')).toBe(formatRgb(proToneDark.fill));
        expect(resolvedColour(screen.getByText('PRO'), 'color')).toBe(formatRgb(proToneDark.text));
    });

    it('paints a neutral badge dark paper with a dark lineDivider edge and inkMuted text', () => {
        renderWithTamagui(<StatusBadge status="draft">Draft</StatusBadge>, 'dark');
        const badge = badgeOf('Draft');

        expect(resolvedColour(badge, 'backgroundColor')).toBe(formatRgb(roleDark.paper));
        expect(resolvedColour(badge, 'backgroundColor')).not.toBe(formatRgb(roleDark.surfaceMuted));
        expect(resolvedStyle(badge, 'borderTopWidth')).toBe('1px');
        expect(resolvedColour(badge, 'borderTopColor')).toBe(formatRgb(roleDark.lineDivider));
        expect(resolvedColour(screen.getByText('Draft'), 'color')).toBe(formatRgb(roleDark.inkMuted));
    });
});
