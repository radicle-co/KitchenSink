/**
 * The native recipe page's nutrition section: its heading and the section's own spacing.
 *
 * It draws through the design system's Tamagui frames (ADR-0080): the heading is the `sectionTitle` role in `ink` for
 * the scheme it is shown in, and the section stacks its parts 12 apart. Every expected value is read from the tokens,
 * so a scale or palette change moves this test with it. The figures, the notes and the Data sources link are still
 * React Native (the link waits on the design system's press component), so their styling is not asserted here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { DetailNutritionSection } from '../DetailNutritionSection.native.js';

const { detail } = recipeMessages.en;

const section = (
    <DetailNutritionSection recipe={makeRecipeDetail()} onOpenDataSources={() => undefined} returnFocusSignal={0} />
);

const heading = (): HTMLElement => screen.getByRole('heading', { name: detail.nutritionHeading });

afterEach(cleanup);

describe('DetailNutritionSection (native)', () => {
    it('names the section with a heading', () => {
        renderWithTamagui(section, 'light');

        expect(heading().textContent).toBe(detail.nutritionHeading);
    });

    it('sets the heading in the sectionTitle role', () => {
        const spec = nativeTokens.type.sectionTitle;
        renderWithTamagui(section, 'light');
        const style = getComputedStyle(heading());

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the heading in ink in the %s scheme', (scheme) => {
        renderWithTamagui(section, scheme);

        expect(resolvedColour(heading(), 'color')).toBe(rgb(rolesFor(scheme).ink));
    });

    it('stacks the heading and the figures space-3 apart', () => {
        renderWithTamagui(section, 'light');
        const frame = heading().parentElement as HTMLElement;

        expect(resolvedStyle(frame, 'gap')).toBe(`${String(nativeTokens.spacing[3])}px`);
    });
});
