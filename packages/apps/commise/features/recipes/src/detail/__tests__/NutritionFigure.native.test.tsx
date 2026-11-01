/**
 * One per-serving nutrition figure on the native recipe page (build spec §6.1): the value over its label, half a row
 * wide so four make a 2 × 2.
 *
 * It draws through the design system's `Text` (ADR-0080): the value in the `figureStat` role and `ink`, the label in
 * the `caption` role and `inkMuted`, each for the scheme it is shown in. Every expected value is read from the tokens.
 * `figureStat`'s tabular figures are a `font-variant`, which jsdom drops as it parses; the design system's own Text
 * suite asserts them on its variant table.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderedRoot, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

import { NutritionFigure } from '../NutritionFigure.native.js';

const LABEL = 'Protein';
const VALUE = '32 g';

const figure = <NutritionFigure label={LABEL} value={VALUE} />;

afterEach(cleanup);

describe('NutritionFigure (native)', () => {
    it('sets the value in the figureStat role', () => {
        const spec = nativeTokens.type.figureStat;
        renderWithTamagui(figure, 'light');
        const style = getComputedStyle(screen.getByText(VALUE));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it('sets the label in the caption role', () => {
        const spec = nativeTokens.type.caption;
        renderWithTamagui(figure, 'light');
        const style = getComputedStyle(screen.getByText(LABEL));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)(
        'paints the value in ink and the label in inkMuted in the %s scheme',
        (scheme) => {
            renderWithTamagui(figure, scheme);

            expect(resolvedColour(screen.getByText(VALUE), 'color')).toBe(rgb(rolesFor(scheme).ink));
            expect(resolvedColour(screen.getByText(LABEL), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
        },
    );

    it('puts the value over its label, space-1 apart, half a row wide', () => {
        const { container } = renderWithTamagui(figure, 'light');
        const cell = renderedRoot(container);

        expect(cell.firstElementChild?.textContent).toBe(VALUE);
        expect(cell.lastElementChild?.textContent).toBe(LABEL);
        expect(resolvedStyle(cell, 'gap')).toBe(`${String(nativeTokens.spacing[1])}px`);
        expect(resolvedStyle(cell, 'flexBasis')).toBe('50%');
    });
});
