/**
 * The status badge (native). React Native's nested `Text` takes no reliable radius or padding, so the chip is a `View`
 * holding a `Text`, the same mechanism as `StandIn` (`docs/design/ingredientSpecialization.md` E2 I1).
 *
 * The same contract as the web leaf: the words are the content, the chip is filled and never dashed, each tone's
 * label clears 4.5:1 on its fill, the label wraps and is never cut off, and the radius is half the one-line height.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb, parse, wcagContrast } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { palette, semantic, tint } from '../../tokens/colors.js';
import { StatusBadge } from '../StatusBadge.native.js';

afterEach(cleanup);

/** WCAG 2.2 SC 1.4.3, normal-size text. */
const AA_TEXT = 4.5;

/** The chip around a badge's words. */
function chipOf(text: string): HTMLElement {
    const chip = screen.getByText(text).parentElement;

    if (chip === null) {
        throw new Error(`no chip around ${text}`);
    }

    return chip;
}

/**
 * A rendered `rgb()`/`rgba()` colour composited over the card, as `rgb(r, g, b)`.
 *
 * @throws Error when the value is not an `rgb`/`rgba` colour, so the check cannot measure nothing.
 */
function overCard(rendered: string): string {
    const parts = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/u.exec(rendered);
    const card = parse(semantic.card);

    if (parts === null || card?.mode !== 'rgb') {
        throw new Error(`Expected an rgb() colour, received "${rendered}".`);
    }

    const alpha = parts[4] === undefined ? 1 : Number(parts[4]);
    const mix = (channel: string | undefined, under: number): number =>
        Math.round(Number(channel) * alpha + under * 255 * (1 - alpha));

    return `rgb(${mix(parts[1], card.r)}, ${mix(parts[2], card.g)}, ${mix(parts[3], card.b)})`;
}

/** A CSS length in px, as a number. */
const px = (value: string): number => Number.parseFloat(value);

describe('StatusBadge (native)', () => {
    it('renders its words as text a screen reader reads, with no hiding', () => {
        const { container } = render(<StatusBadge tone="neutral">Custom</StatusBadge>);

        expect(screen.getByText('Custom')).toBeTruthy();
        expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('fills each tone and never dashes it, so it cannot pass for a stand-in name', () => {
        render(
            <>
                <StatusBadge tone="neutral">Custom</StatusBadge>
                <StatusBadge tone="caution">Needs review</StatusBadge>
            </>,
        );

        const neutral = getComputedStyle(chipOf('Custom'));
        const caution = getComputedStyle(chipOf('Needs review'));

        expect(neutral.backgroundColor).toBe(formatRgb(palette.pearl));
        expect(caution.backgroundColor).toBe(tint(palette.warning, 0.25));
        expect(neutral.borderTopStyle).not.toBe('dashed');
        expect(caution.borderTopStyle).not.toBe('dashed');
        // ⛔ `warning` is a fill, never a text colour: the caution label is charcoal.
        expect(getComputedStyle(screen.getByText('Needs review')).color).toBe(formatRgb(palette.charcoal));
        expect(getComputedStyle(screen.getByText('Custom')).color).toBe(formatRgb(palette.slate));
    });

    it('labels each tone at 4.5:1 or better on its own fill over the card', () => {
        render(
            <>
                <StatusBadge tone="neutral">Custom</StatusBadge>
                <StatusBadge tone="caution">Needs review</StatusBadge>
            </>,
        );

        // Measured from what RENDERED: the label colour and the fill, a translucent fill composited over the card.
        for (const text of ['Custom', 'Needs review']) {
            const label = getComputedStyle(screen.getByText(text)).color;
            const fill = overCard(getComputedStyle(chipOf(text)).backgroundColor);

            expect(wcagContrast(label, fill), `${text} label on its fill`).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it('wraps its words inside itself and is never cut off', () => {
        render(<StatusBadge tone="caution">Needs a pick</StatusBadge>);

        const label = screen.getByText('Needs a pick');

        expect(label.getAttribute('numberOfLines')).toBeNull();
        expect(getComputedStyle(label).textOverflow).not.toBe('ellipsis');
        expect(getComputedStyle(label).flexShrink).toBe('1');
        expect(getComputedStyle(chipOf('Needs a pick')).maxWidth).toBe('100%');
    });

    it('rounds to half its one-line height, so a wrapped badge is a rounded rectangle and not a pill', () => {
        render(<StatusBadge tone="neutral">Custom</StatusBadge>);

        const chip = getComputedStyle(chipOf('Custom'));
        const lineHeight = px(getComputedStyle(screen.getByText('Custom')).lineHeight);
        const oneLine = lineHeight + px(chip.paddingTop) + px(chip.paddingBottom);

        // A declared line height is what makes "one line" a number at all; RN's default leading is unknowable here.
        expect(Number.isFinite(lineHeight)).toBe(true);
        expect(px(chip.borderTopLeftRadius)).toBeCloseTo(oneLine / 2, 5);
    });
});
