/**
 * The stand-in chip (native). React Native's nested `Text` takes no border or padding, so the chip is a `View`
 * holding a `Text`; the words are still the content (`docs/design/namelessLineCopy.md` §2c).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { palette } from '../../tokens/colors.js';
import { StandIn } from '../StandIn.native.js';

afterEach(cleanup);

describe('StandIn (native)', () => {
    it('renders its words as text a screen reader reads, with no hiding', () => {
        const { container } = render(<StandIn tone="neutral">Private ingredient</StandIn>);

        expect(screen.getByText('Private ingredient')).toBeTruthy();
        expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('draws a dashed outline in the tone’s colour', () => {
        render(
            <>
                <StandIn tone="neutral">Private ingredient</StandIn>
                <StandIn tone="caution">Removed food</StandIn>
            </>,
        );

        const neutralChip = getComputedStyle(chipOf('Private ingredient'));
        const cautionChip = getComputedStyle(chipOf('Removed food'));

        expect(neutralChip.borderTopStyle).toBe('dashed');
        expect(cautionChip.borderTopStyle).toBe('dashed');
        expect(neutralChip.borderTopColor).toBe(formatRgb(palette.slate));
        expect(cautionChip.borderTopColor).toBe(formatRgb(palette['warning-dark']));
        // ⛔ `warning` is a fill, never a text colour: the caution label is charcoal.
        expect(getComputedStyle(screen.getByText('Removed food')).color).toBe(formatRgb(palette.charcoal));
        expect(getComputedStyle(screen.getByText('Private ingredient')).color).toBe(formatRgb(palette.slate));
    });
});

/** The chip around a stand-in's words. */
function chipOf(text: string): HTMLElement {
    const chip = screen.getByText(text).parentElement;

    if (chip === null) {
        throw new Error(`no chip around ${text}`);
    }

    return chip;
}
