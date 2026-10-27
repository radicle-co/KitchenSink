/**
 * The status badge (native). React Native's nested `Text` takes no reliable radius or padding, so the badge is a `View`
 * holding the glyph and a `Text`, the same mechanism as `StandIn`.
 *
 * ⚠️ REWRITTEN in slice 2 of the UI overhaul — see the web leaf's test for the contract change: a closed list of
 * statuses instead of a free tone, the `sm` radius instead of half the line, a glyph on each recipe status, and the
 * ink-on-tint fallback for `attention`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb, wcagContrast } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { role } from '../../tokens/colors.js';
import { proTone } from '../../tokens/tones.js';
import { nativeTokens } from '../../tokens/native.js';
import { View } from 'react-native';

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
    it('paints PRO as the grey pair: snow on slate in the light theme', () => {
        render(<StatusBadge status="pro">PRO</StatusBadge>);

        expect(getComputedStyle(badgeOf('PRO')).backgroundColor).toBe(formatRgb(proTone.fill));
        expect(getComputedStyle(screen.getByText('PRO')).color).toBe(formatRgb(proTone.text));
    });

    it('renders its words as text a screen reader reads, with no hiding', () => {
        render(<StatusBadge status="note">Custom</StatusBadge>);

        expect(screen.getByText('Custom').closest('[aria-hidden="true"]')).toBeNull();
    });

    it('fills every status and never dashes it', () => {
        for (const status of BADGE_STATUSES) {
            const { unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);
            const style = getComputedStyle(badgeOf('Word'));

            expect(style.backgroundColor, status).not.toBe('rgba(0, 0, 0, 0)');
            expect(style.borderTopStyle, status).not.toBe('dashed');
            unmount();
        }
    });

    it('labels every status at 4.5:1 or better on its own fill', () => {
        for (const status of BADGE_STATUSES) {
            const { unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);
            const label = getComputedStyle(screen.getByText('Word')).color;
            const fill = getComputedStyle(badgeOf('Word')).backgroundColor;

            expect(wcagContrast(label, fill), status).toBeGreaterThanOrEqual(AA_TEXT);
            unmount();
        }
    });

    // REWRITTEN for componentFixes §7: paper under inkMuted (was pearl under ink, invisible on a pearl parent).
    it('paints the recipe statuses paper and inkMuted, each with its glyph', () => {
        for (const [status, glyph] of [
            ['draft', 'pencil-line'],
            ['private', 'lock'],
            ['public', 'globe'],
        ] as const) {
            const { container, unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);

            expect(getComputedStyle(badgeOf('Word')).backgroundColor, status).toBe(formatRgb(role.paper));
            expect(getComputedStyle(screen.getByText('Word')).color, status).toBe(formatRgb(role.inkMuted));
            expect(
                container.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName'],
                status,
            ).toBe(glyph);
            unmount();
        }
    });

    // componentFixes §7: every neutral badge is paper with a 1 pt lineDivider edge, so it reads on a surfaceMuted parent.
    it.each(['draft', 'private', 'public', 'soon', 'note'] as const)(
        '%s keeps its own paper fill and a 1 pt lineDivider edge on a surfaceMuted parent',
        (status) => {
            render(
                <View style={{ backgroundColor: role.surfaceMuted }}>
                    <StatusBadge status={status}>Word</StatusBadge>
                </View>,
            );
            const style = getComputedStyle(badgeOf('Word'));

            expect(style.backgroundColor).toBe(formatRgb(role.paper));
            expect(style.backgroundColor).not.toBe(formatRgb(role.surfaceMuted));
            expect(style.borderTopWidth).toBe('1px');
            expect(style.borderTopColor).toBe(formatRgb(role.lineDivider));
            expect(getComputedStyle(screen.getByText('Word')).color).toBe(formatRgb(role.inkMuted));
        },
    );

    it.each(['pro', 'attention'] as const)('%s draws no edge', (status) => {
        render(<StatusBadge status={status}>Word</StatusBadge>);

        expect(getComputedStyle(badgeOf('Word')).borderTopWidth).not.toBe('1px');
    });

    it('takes the ink-on-tint fallback for attention', () => {
        render(<StatusBadge status="attention">Needs review</StatusBadge>);

        expect(getComputedStyle(badgeOf('Needs review')).backgroundColor).toBe(formatRgb(role.attentionTint));
        expect(getComputedStyle(screen.getByText('Needs review')).color).toBe(formatRgb(role.ink));
    });

    it('wraps its words inside itself and is never cut off', () => {
        render(<StatusBadge status="attention">Choose a match</StatusBadge>);

        const label = screen.getByText('Choose a match');

        expect(label.getAttribute('numberOfLines')).toBeNull();
        expect(getComputedStyle(label).flexShrink).toBe('1');
        expect(getComputedStyle(badgeOf('Choose a match')).maxWidth).toBe('100%');
    });

    it('is 24pt tall with the sm radius, never a pill', () => {
        render(<StatusBadge status="draft">Draft</StatusBadge>);

        const style = getComputedStyle(badgeOf('Draft'));

        expect(style.minHeight).toBe('24px');
        expect(style.borderTopLeftRadius).toBe(`${String(nativeTokens.radius.sm)}px`);
    });
});
