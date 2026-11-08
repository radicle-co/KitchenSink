/**
 * The stand-in chip (native). React Native's nested `Text` takes no border or padding, so the chip is a `View`
 * holding a `Text`; the words are still the content (`docs/design/namelessLineCopy.md` §2c).
 */
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { ARIA_HIDDEN_CONTENT, renderWithTamagui, resolvedColour } from '../../testing/tamaguiTesting.native.js';
import { nativeTokens } from '../../tokens/native.js';
import { palette } from '../../tokens/colors.js';
import { StandIn } from '../StandIn.native.js';

afterEach(cleanup);

describe('StandIn (native)', () => {
    it('renders its words as text a screen reader reads, with no hiding', () => {
        const { container } = renderWithTamagui(<StandIn tone="neutral">Private ingredient</StandIn>, 'light');

        expect(screen.getByText('Private ingredient')).toBeTruthy();
        expect(container.querySelector(ARIA_HIDDEN_CONTENT)).toBeNull();
    });

    // ADR-0080 §8, designer ruling 2026-11-01: body-sized text grows to 2× and no further. The label is the design
    // system's Text, which draws its own size from the capped scale; a raw React Native Text grew past it on iOS.
    it('⛔ draws its label at 2× its base size at a system text scale of 3.1, not 3.1×', () => {
        renderWithTamagui(<StandIn tone="neutral">Private ingredient</StandIn>, 'light', 3.1);

        const label = getComputedStyle(screen.getByText('Private ingredient'));

        expect(label.fontSize).toBe(`${String(nativeTokens.type.caption.fontSize * 2)}px`);
        expect(label.lineHeight).toBe(`${String(nativeTokens.type.caption.lineHeight * 2)}px`);
    });

    it('draws a dashed outline in the tone’s colour', () => {
        renderWithTamagui(
            <>
                <StandIn tone="neutral">Private ingredient</StandIn>
                <StandIn tone="caution">Removed food</StandIn>
            </>,
            'light',
        );

        const neutralChip = getComputedStyle(chipOf('Private ingredient'));
        const cautionChip = getComputedStyle(chipOf('Removed food'));

        expect(neutralChip.borderTopStyle).toBe('dashed');
        expect(cautionChip.borderTopStyle).toBe('dashed');
        expect(neutralChip.borderTopColor).toBe(formatRgb(palette.slate));
        expect(cautionChip.borderTopColor).toBe(formatRgb(palette['warning-dark']));
        // ⛔ `warning` is a fill, never a text colour: the caution label is charcoal.
        expect(resolvedColour(screen.getByText('Removed food'), 'color')).toBe(formatRgb(palette.charcoal));
        expect(resolvedColour(screen.getByText('Private ingredient'), 'color')).toBe(formatRgb(palette.slate));
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
