/**
 * The status badge (web): a short word about a line's state, drawn as a filled chip that flows with the text it
 * qualifies (`docs/design/ingredientSpecialization.md` E2 I1).
 *
 * - The words ARE the content: plain text, no role, never hidden.
 * - It is FILLED, never dashed: a dashed outline is `StandIn`'s mark for "these words stand in for a missing name",
 *   and a status read as a name would be a lie.
 * - It wraps inside itself and is never cut off, because it now flows inside the name's text block.
 * - Its radius is half its ONE-LINE height (the §S13 rule): a pill on one line, a rounded rectangle when it wraps, so
 *   wrapped words never run past the curve (E2 I2's defect class).
 * - Each tone's label clears 4.5:1 on its own fill over the card.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { wcagContrast } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { palette, semantic } from '../../tokens/colors.js';
import { StatusBadge } from '../StatusBadge.js';

afterEach(cleanup);

/** WCAG 2.2 SC 1.4.3, normal-size text. */
const AA_TEXT = 4.5;

/**
 * The fill and label a class string paints, read from its `bg-*` and `text-*` palette utilities. A `bg-x/NN` fill is
 * composited over the card, the surface the badge sits on.
 *
 * @throws Error when either utility is missing or names no palette colour, so the check cannot measure nothing.
 */
function paintedPair(className: string): { readonly fill: string; readonly label: string } {
    const fill = /(?:^|\s)bg-([a-z][a-z-]*)(?:\/(\d+))?(?=\s|$)/u.exec(className);
    const label = /(?:^|\s)text-([a-z][a-z-]*)(?=\s|$)/gu;
    const labelName = [...className.matchAll(label)].map((match) => match[1]).find((name) => name in palette);

    if (fill?.[1] === undefined || !(fill[1] in palette) || labelName === undefined) {
        throw new Error(`Expected a palette bg-* and text-* utility in "${className}".`);
    }

    const alpha = fill[2] === undefined ? 1 : Number(fill[2]) / 100;

    return {
        fill: composite(palette[fill[1] as keyof typeof palette], alpha, semantic.card),
        label: palette[labelName as keyof typeof palette],
    };
}

/** `color` at `alpha` over the opaque `backdrop`, as `#rrggbb`. Pure. */
function composite(color: string, alpha: number, backdrop: string): string {
    const channel = (hex: string, at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
    const mixed = [1, 3, 5].map((at) =>
        Math.round(channel(color, at) * alpha + channel(backdrop, at) * (1 - alpha))
            .toString(16)
            .padStart(2, '0'),
    );

    return `#${mixed.join('')}`;
}

describe('StatusBadge (web)', () => {
    it('renders its words as plain text, exposed to assistive technology', () => {
        render(<StatusBadge tone="neutral">Custom</StatusBadge>);

        const badge = screen.getByText('Custom');

        expect(badge.getAttribute('aria-hidden')).toBeNull();
        expect(badge.getAttribute('role')).toBeNull();
        expect(badge.getAttribute('aria-label')).toBeNull();
    });

    it('is a filled chip, never a dashed outline, so it cannot pass for a stand-in name', () => {
        render(
            <>
                <StatusBadge tone="neutral">Custom</StatusBadge>
                <StatusBadge tone="caution">Needs review</StatusBadge>
            </>,
        );

        for (const text of ['Custom', 'Needs review']) {
            expect(screen.getByText(text).className).toMatch(/(?:^|\s)bg-/u);
            expect(screen.getByText(text).className).not.toContain('border-dashed');
        }
    });

    it('takes the caution tone for something the reader can act on, and the neutral tone otherwise', () => {
        render(
            <>
                <StatusBadge tone="neutral">Custom</StatusBadge>
                <StatusBadge tone="caution">Needs review</StatusBadge>
            </>,
        );

        const neutral = screen.getByText('Custom').className;
        const caution = screen.getByText('Needs review').className;

        expect(neutral).toContain('bg-pearl');
        expect(neutral).toContain('text-slate');
        expect(caution).toContain('bg-warning/25');
        // ⛔ `warning` is a fill, never a text colour: the caution label is charcoal.
        expect(caution).toContain('text-charcoal');
        expect(caution).not.toMatch(/\btext-warning\b/u);
    });

    it('labels each tone at 4.5:1 or better on its own fill over the card', () => {
        render(
            <>
                <StatusBadge tone="neutral">Custom</StatusBadge>
                <StatusBadge tone="caution">Needs review</StatusBadge>
            </>,
        );

        for (const text of ['Custom', 'Needs review']) {
            const { fill, label } = paintedPair(screen.getByText(text).className);

            expect(wcagContrast(label, fill), `${text} label on its fill`).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it('flows inline with the text it qualifies, and wraps inside itself without being cut off', () => {
        render(<StatusBadge tone="caution">Needs a pick</StatusBadge>);

        const className = screen.getByText('Needs a pick').className;

        expect(className).toContain('inline-block');
        expect(className).toContain('max-w-full');
        expect(className).toContain('break-words');
        expect(className).not.toMatch(/\b(truncate|whitespace-nowrap|text-ellipsis|shrink-0|ml-auto)\b/u);
    });

    it('rounds to half its one-line height, so a wrapped badge is a rounded rectangle and not a pill', () => {
        render(<StatusBadge tone="neutral">Custom</StatusBadge>);

        const className = screen.getByText('Custom').className;
        // One line is `1lh` plus the vertical padding on both sides. Half of that is `0.5lh` plus ONE side's padding,
        // so the radius is read against the padding step the badge actually uses.
        const paddingStep = /(?:^|\s)py-([\d.]+)(?=\s|$)/u.exec(className)?.[1];

        expect(paddingStep).toBeDefined();
        expect(className).toContain(`rounded-[calc(0.5lh+var(--spacing)*${paddingStep ?? ''})]`);
        expect(className).not.toContain('rounded-full');
    });
});
