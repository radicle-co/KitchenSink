/**
 * The status badge (native). The badge is a row holding the glyph and the words, the same mechanism as `StandIn`.
 *
 * ⚠️ REWRITTEN for ADR-0080 slice 1: the badge is styled with Tamagui, so it renders inside the design system's
 * provider, and every colour and length is read through `resolvedStyle`/`resolvedColour`, which follow Tamagui's theme
 * and token variables to the value a device paints. The contract is unchanged: a closed list of statuses, the `sm`
 * radius, a glyph on each recipe status, paper with a `lineDivider` edge for a neutral status, the ink-on-tint fallback
 * for `attention`, and 4.5:1 on every pair.
 */
import { cleanup, screen } from '@testing-library/react';
import { formatRgb, wcagContrast } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';
import { View } from 'tamagui';

import { renderWithTamagui, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { role } from '../../tokens/colors.js';
import { radius, spacing } from '../../tokens/scale.js';
import { proTone } from '../../tokens/tones.js';
import { StatusBadge } from '../StatusBadge.native.js';
import { BADGE_STATUSES } from '../props.js';

afterEach(cleanup);

/** WCAG 2.2 SC 1.4.3, normal-size text. */
const AA_TEXT = 4.5;

/** The badge around a word. */
function badgeOf(text: string): HTMLElement {
    const badge = screen.getByText(text).parentElement;

    if (badge === null) {
        throw new Error(`no badge around ${text}`);
    }

    return badge;
}

describe('StatusBadge (native)', () => {
    it('paints PRO as the grey pair in the light theme', () => {
        renderWithTamagui(<StatusBadge status="pro">PRO</StatusBadge>, 'light');

        expect(resolvedColour(badgeOf('PRO'), 'backgroundColor')).toBe(formatRgb(proTone.fill));
        expect(resolvedColour(screen.getByText('PRO'), 'color')).toBe(formatRgb(proTone.text));
    });

    it('renders its words as text a screen reader reads, with no hiding', () => {
        renderWithTamagui(<StatusBadge status="note">Custom</StatusBadge>, 'light');

        expect(screen.getByText('Custom').closest('[aria-hidden="true"]')).toBeNull();
    });

    it('fills every status and never dashes it', () => {
        for (const status of BADGE_STATUSES) {
            const { unmount } = renderWithTamagui(<StatusBadge status={status}>Word</StatusBadge>, 'light');

            expect(resolvedColour(badgeOf('Word'), 'backgroundColor'), status).not.toBe('rgba(0, 0, 0, 0)');
            expect(getComputedStyle(badgeOf('Word')).borderTopStyle, status).not.toBe('dashed');
            unmount();
        }
    });

    it('labels every status at 4.5:1 or better on its own fill', () => {
        for (const status of BADGE_STATUSES) {
            const { unmount } = renderWithTamagui(<StatusBadge status={status}>Word</StatusBadge>, 'light');
            const label = resolvedColour(screen.getByText('Word'), 'color');
            const fill = resolvedColour(badgeOf('Word'), 'backgroundColor');

            expect(wcagContrast(label, fill), status).toBeGreaterThanOrEqual(AA_TEXT);
            unmount();
        }
    });

    it('paints the recipe statuses paper and inkMuted, each with its glyph', () => {
        for (const [status, glyph] of [
            ['draft', 'pencil-line'],
            ['private', 'lock'],
            ['public', 'globe'],
        ] as const) {
            const { container, unmount } = renderWithTamagui(<StatusBadge status={status}>Word</StatusBadge>, 'light');

            expect(resolvedColour(badgeOf('Word'), 'backgroundColor'), status).toBe(formatRgb(role.paper));
            expect(resolvedColour(screen.getByText('Word'), 'color'), status).toBe(formatRgb(role.inkMuted));
            expect(
                container.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName'],
                status,
            ).toBe(glyph);
            unmount();
        }
    });

    it.each(['draft', 'private', 'public', 'soon', 'note'] as const)(
        '%s keeps its own paper fill and a 1 pt lineDivider edge on a surfaceMuted parent',
        (status) => {
            renderWithTamagui(
                <View backgroundColor="$surfaceMuted">
                    <StatusBadge status={status}>Word</StatusBadge>
                </View>,
                'light',
            );
            const badge = badgeOf('Word');

            expect(resolvedColour(badge, 'backgroundColor')).toBe(formatRgb(role.paper));
            expect(resolvedColour(badge, 'backgroundColor')).not.toBe(formatRgb(role.surfaceMuted));
            expect(resolvedStyle(badge, 'borderTopWidth')).toBe('1px');
            expect(resolvedColour(badge, 'borderTopColor')).toBe(formatRgb(role.lineDivider));
            expect(resolvedColour(screen.getByText('Word'), 'color')).toBe(formatRgb(role.inkMuted));
        },
    );

    it.each(['pro', 'attention'] as const)('%s draws no edge', (status) => {
        renderWithTamagui(<StatusBadge status={status}>Word</StatusBadge>, 'light');

        expect(resolvedStyle(badgeOf('Word'), 'borderTopWidth')).not.toBe('1px');
    });

    it('takes the ink-on-tint fallback for attention', () => {
        renderWithTamagui(<StatusBadge status="attention">Needs review</StatusBadge>, 'light');

        expect(resolvedColour(badgeOf('Needs review'), 'backgroundColor')).toBe(formatRgb(role.attentionTint));
        expect(resolvedColour(screen.getByText('Needs review'), 'color')).toBe(formatRgb(role.ink));
    });

    it('wraps its words inside itself and is never cut off', () => {
        renderWithTamagui(<StatusBadge status="attention">Choose a match</StatusBadge>, 'light');

        const label = screen.getByText('Choose a match');

        expect(label.getAttribute('numberOfLines')).toBeNull();
        expect(resolvedStyle(label, 'flexShrink')).toBe('1');
        expect(resolvedStyle(badgeOf('Choose a match'), 'maxWidth')).toBe('100%');
    });

    it('is 24pt tall with the sm radius, never a pill', () => {
        renderWithTamagui(<StatusBadge status="draft">Draft</StatusBadge>, 'light');

        const badge = badgeOf('Draft');

        expect(resolvedStyle(badge, 'minHeight')).toBe(`${String(spacing[5])}px`);
        expect(resolvedStyle(badge, 'borderTopLeftRadius')).toBe(`${String(radius.sm)}px`);
    });
});
