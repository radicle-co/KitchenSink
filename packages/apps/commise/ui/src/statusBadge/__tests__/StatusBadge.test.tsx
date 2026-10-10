/**
 * The status badge (web) — a short word about a state, as a filled, non-pressable badge (spec §1.4, §1.6, §1.11).
 *
 * ⚠️ REWRITTEN in slice 2 of the UI overhaul. The free `tone` prop is gone (blueprint Part B, StatusBadge): a badge names
 * a STATUS from a closed list and the badge owns its colours and glyph. The list is the blueprint's recipe statuses
 * (`draft`, `private`, `public`, `pro`, `soon`) plus the two ingredient-line statuses the badge already carried
 * (`note` for the old neutral tone, `attention` for caution), which the blueprint did not account for. The radius is
 * `sm`, not half the line: a one-line badge on the old radius drew a pill, and only pressable controls are pills.
 *
 * - The words ARE the content: plain text, no role, never hidden. A recipe status adds its glyph, so the status never
 *   rests on colour alone (SC 1.4.1).
 * - It is FILLED, never dashed: a dashed outline is `StandIn`'s mark for words standing in for a missing name.
 * - It wraps inside itself and is never cut off, because it flows inside the text it qualifies.
 * - Each status's label clears 4.5:1 on its fill. `attention` takes the recorded fallback: an `ink` label on the
 *   `attentionTint`, because the spec's `attention` text measured below 4.5:1 on its own tint (slice 1).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { wcagContrast } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { palette, role } from '../../tokens/colors.js';
import { kebab } from '../../tokens/emit.js';
import { proTone } from '../../tokens/tones.js';
import { StatusBadge } from '../StatusBadge.js';
import { BADGE_STATUSES, type BadgeStatus } from '../props.js';

afterEach(cleanup);

/** WCAG 2.2 SC 1.4.3, normal-size text. */
const AA_TEXT = 4.5;

/** Every colour a utility can name: the palette, and the roles under their emitted kebab names. */
const COLOURS: Readonly<Record<string, string>> = {
    ...palette,
    ...Object.fromEntries(Object.entries(role).map(([name, value]) => [kebab(name), value])),
    // The PRO pair, fixed in both themes (`darkTheme.md` §2), emitted as `--color-pro-*`.
    'pro-fill': proTone.fill,
    'pro-ink': proTone.text,
};

/** The colour a `bg-*` or `text-*` utility in the badge's classes names. */
function colourOf(className: string, kind: 'bg' | 'text'): string {
    const names = className
        .split(/\s+/u)
        .map((token) => new RegExp(`^${kind}-([a-z][a-z-]*)$`, 'u').exec(token)?.[1])
        .filter((name): name is string => name !== undefined && name in COLOURS);

    if (names.length !== 1) {
        throw new Error(`Expected one ${kind}-* colour in "${className}", found [${names.join(', ')}].`);
    }

    return COLOURS[names[0] as string] as string;
}

/** The badge element around a word: the word's own element sits directly inside it. */
const badgeOf = (word: string): HTMLElement => {
    const badge = screen.getByText(word).parentElement;

    if (badge === null) {
        throw new Error(`no badge around ${word}`);
    }

    return badge;
};

describe('StatusBadge (web)', () => {
    it('renders its words as plain text, exposed to assistive technology', () => {
        render(<StatusBadge status="note">Custom</StatusBadge>);

        const badge = badgeOf('Custom');

        expect(badge.getAttribute('aria-hidden')).toBeNull();
        expect(badge.getAttribute('role')).toBeNull();
        expect(badge.getAttribute('aria-label')).toBeNull();
    });

    it('is a filled badge, never a dashed outline, so it cannot pass for a stand-in name', () => {
        for (const status of BADGE_STATUSES) {
            const { unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);

            expect(badgeOf('Word').className, status).toMatch(/(?:^|\s)bg-/u);
            expect(badgeOf('Word').className, status).not.toContain('border-dashed');
            unmount();
        }
    });

    it('labels every status at 4.5:1 or better on its own fill', () => {
        for (const status of BADGE_STATUSES) {
            const { unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);
            const className = badgeOf('Word').className;

            expect(wcagContrast(colourOf(className, 'text'), colourOf(className, 'bg')), status).toBeGreaterThanOrEqual(
                AA_TEXT,
            );
            unmount();
        }
    });

    it('paints the recipe statuses neutral — pearl and ink, never amber — told apart by their glyph', () => {
        const glyphs: Readonly<Record<'draft' | 'private' | 'public', string>> = {
            draft: 'lucide-pencil-line',
            private: 'lucide-lock',
            public: 'lucide-globe',
        };

        for (const [status, glyph] of Object.entries(glyphs) as [keyof typeof glyphs, string][]) {
            const { unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);
            const badge = badgeOf('Word');

            expect(colourOf(badge.className, 'bg'), status).toBe(palette.pearl);
            expect(colourOf(badge.className, 'text'), status).toBe(role.ink);
            expect(badge.querySelector(`svg.${glyph}`), status).not.toBeNull();
            expect(badge.querySelector('svg')?.getAttribute('aria-hidden'), status).toBe('true');
            unmount();
        }
    });

    // PRO is premium under charcoal in BOTH themes (`darkTheme.md` §2): `ink` would turn light in the dark theme.
    it('paints PRO on the premium fill with a charcoal label that does not re-theme', () => {
        render(<StatusBadge status="pro">PRO</StatusBadge>);

        expect(colourOf(badgeOf('PRO').className, 'bg')).toBe(palette.premium);
        expect(colourOf(badgeOf('PRO').className, 'text')).toBe(palette.charcoal);
    });

    it('takes the ink-on-tint fallback for attention, and inkMuted on pearl for a note', () => {
        render(
            <>
                <StatusBadge status="attention">Needs review</StatusBadge>
                <StatusBadge status="note">Custom</StatusBadge>
            </>,
        );

        expect(colourOf(badgeOf('Needs review').className, 'bg')).toBe(role.attentionTint);
        expect(colourOf(badgeOf('Needs review').className, 'text')).toBe(role.ink);
        expect(colourOf(badgeOf('Custom').className, 'text')).toBe(role.inkMuted);
    });

    it('draws no glyph for the statuses that are only words', () => {
        for (const status of ['pro', 'soon', 'note', 'attention'] satisfies BadgeStatus[]) {
            const { unmount } = render(<StatusBadge status={status}>Word</StatusBadge>);

            expect(badgeOf('Word').querySelector('svg'), status).toBeNull();
            unmount();
        }
    });

    it('flows inline with the text it qualifies, and wraps inside itself without being cut off', () => {
        render(<StatusBadge status="attention">Choose a match</StatusBadge>);

        const className = badgeOf('Choose a match').className;

        expect(className).toContain('inline-flex');
        expect(className).toContain('max-w-full');
        expect(className).not.toMatch(/\b(truncate|whitespace-nowrap|text-ellipsis|shrink-0|ml-auto)\b/u);
    });

    it('is a 24px badge with the sm radius, never a pill (it is not pressable)', () => {
        render(<StatusBadge status="draft">Draft</StatusBadge>);

        const className = badgeOf('Draft').className;

        expect(className).toContain('rounded-sm');
        expect(className).toContain('min-h-6');
        expect(className).not.toContain('rounded-full');
    });
});
