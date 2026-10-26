/**
 * VariantPartsLine (native) — the same line as the web leaf, in one `Text` (`docs/design/ingredientSpecialization.md`
 * §S4). React Native has no hidden span, so the screen reader hears the `accessibilityLabel`, and a measurement token
 * keeps its hyphen by showing U+2011 instead of a `nowrap` span.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { Text } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';

import { palette } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { fontSize } from '../../tokens/scale.js';
import { VariantPartsLine } from '../VariantPartsLine.native.js';

afterEach(cleanup);

const BRISKET = ['flat half', 'separable lean and fat', '1/8-inch trim', 'select', 'braised'] as const;
const HEARD = 'flat half, separable lean and fat, 1/8-inch trim, select, braised';

/** Whether a rendered `Text` clamps or ellipsizes. react-native-web draws `numberOfLines` as these styles. */
function truncates(element: HTMLElement): boolean {
    const style = getComputedStyle(element);

    return (
        style.textOverflow === 'ellipsis' ||
        style.whiteSpace === 'nowrap' ||
        (element.getAttribute('style') ?? '').includes('line-clamp')
    );
}

describe('VariantPartsLine (native)', () => {
    it('shows every part in wire order with a no-break space and a middle dot between them, and no comma', () => {
        render(<VariantPartsLine parts={BRISKET} tone="secondary" />);

        const shown = screen.getByLabelText(HEARD).textContent;

        expect(shown).toBe(
            'flat half\u00A0· separable lean and fat\u00A0· 1/8\u2011inch trim\u00A0· select\u00A0· braised',
        );
        expect(shown).not.toContain(',');
    });

    it('is heard with commas between the parts, and the measurement token keeps its source hyphen', () => {
        render(<VariantPartsLine parts={BRISKET} tone="primary" />);

        expect(screen.getByLabelText(HEARD)).toBeDefined();
    });

    it('shows one part with no separator', () => {
        render(<VariantPartsLine parts={['whole']} tone="secondary" />);

        expect(screen.getByLabelText('whole').textContent).toBe('whole');
    });

    it('shows an unknown attribute’s label in its wire position, and breaks only a measurement’s hyphen', () => {
        render(<VariantPartsLine parts={['flat half', 'dry-aged 28 days', 'select']} tone="secondary" />);

        expect(screen.getByLabelText('flat half, dry-aged 28 days, select').textContent).toBe(
            'flat half\u00A0· dry-aged 28 days\u00A0· select',
        );
    });

    it('never truncates', () => {
        render(
            <>
                <VariantPartsLine parts={BRISKET} tone="secondary" />
                {/* Positive control: the check sees a clamped line and an ellipsized one. */}
                <Text numberOfLines={2}>clamped</Text>
                <Text numberOfLines={1}>ellipsized</Text>
            </>,
        );

        expect(truncates(screen.getByText('clamped'))).toBe(true);
        expect(truncates(screen.getByText('ellipsized'))).toBe(true);
        expect(truncates(screen.getByLabelText(HEARD))).toBe(false);
    });

    it('reads as secondary text under a name, and as primary text in a dialog row', () => {
        render(
            <>
                <VariantPartsLine parts={['flat half']} tone="secondary" />
                <VariantPartsLine parts={['point end']} tone="primary" />
            </>,
        );

        const secondary = getComputedStyle(screen.getByLabelText('flat half'));
        const primary = getComputedStyle(screen.getByLabelText('point end'));

        expect(secondary.color).toBe(formatRgb(palette.slate));
        expect(secondary.fontSize).toBe(`${fontSize.bodySm}px`);
        expect(primary.color).toBe(formatRgb(palette.charcoal));
        expect(primary.fontSize).toBe(`${fontSize.bodyMd}px`);
    });

    /**
     * E2 I14 — a dotted line of up to eight lines reads at its role's px leading (secondary 20, primary 24), which is
     * the same line height web inherits. With no `lineHeight`, React Native fell back to its default of about 1.2.
     * REWRITTEN for the px model (2026-10-25): it asserted `size × 1.5` (21 for the 14 px tone), which is off the 4 px grid.
     */
    it('sets each tone at its role’s px leading, on the 4 px grid', () => {
        render(
            <>
                <VariantPartsLine parts={['flat half']} tone="secondary" />
                <VariantPartsLine parts={['point end']} tone="primary" />
            </>,
        );

        const expected = {
            'flat half': nativeTokens.type.meta.lineHeight,
            'point end': nativeTokens.type.body.lineHeight,
        };

        for (const [label, lineHeight] of Object.entries(expected)) {
            const style = getComputedStyle(screen.getByLabelText(label));

            expect(Number.parseFloat(style.lineHeight), label).toBe(lineHeight);
            expect(Number.parseFloat(style.lineHeight) % 4, label).toBe(0);
        }
    });
});
