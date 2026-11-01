/**
 * The read-only rating variant (native): the community aggregate with the own-recipe note under it.
 *
 * It draws through the design system's `Text` (ADR-0080): the `meta` role, in `inkMuted` for the scheme it is shown
 * in. Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';

import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { RecipeRatingDisplay } from '../RecipeRatingDisplay.native.js';

const TEXT = 'You can’t rate your own recipe.';

afterEach(cleanup);

describe('RecipeRatingDisplay (native)', () => {
    it('sets the text in the meta role', () => {
        const spec = nativeTokens.type.meta;
        renderWithTamagui(<RecipeRatingDisplay average={4.5} ratingCount={2} />, 'light');
        const style = getComputedStyle(screen.getByText(TEXT));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each([
        ['light', role.inkMuted],
        ['dark', roleDark.inkMuted],
    ] as const)('paints the text in inkMuted in the %s scheme', (scheme, colour) => {
        renderWithTamagui(<RecipeRatingDisplay average={4.5} ratingCount={2} />, scheme);

        expect(resolvedColour(screen.getByText(TEXT), 'color')).toBe(formatRgb(colour));
    });
});
