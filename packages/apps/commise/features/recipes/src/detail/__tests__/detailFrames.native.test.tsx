/**
 * The native recipe page's shared frames: the column share each one takes from a 720 pt body (build spec §6.1, the
 * web's `col-span-5` and `col-span-7` of twelve).
 *
 * Tamagui's web build writes a share as the shorthand `flex: 5 0 0`, and jsdom drops that declaration as it parses, so
 * no rendered style can show it. ADR-0080 §6 asserts a style jsdom cannot hold on the variant table, which is what a
 * device receives. The gaps, the heading's role and its colours are asserted on the rendered page, where jsdom holds
 * them (`DetailInstructionsSection`, `DetailNutritionSection` and `RecipeDetailSections` native suites).
 */
import { describe, expect, it } from 'vitest';

import { DetailSection, DetailStack } from '../detailFrames.native.js';

/** A frame's `column` variant, as the table Tamagui holds. */
const columnsOf = (frame: typeof DetailSection | typeof DetailStack): ReadonlyMap<string, unknown> =>
    new Map(Object.entries(frame.staticConfig.variants?.['column'] ?? {}));

describe('the native detail frames', () => {
    it('gives the ingredients section five parts of twelve of the row as its ingredients column', () => {
        expect(columnsOf(DetailSection).get('ingredients')).toEqual({ flex: 5 });
    });

    it('gives the steps stack seven parts of twelve of the row as its steps column', () => {
        expect(columnsOf(DetailStack).get('steps')).toEqual({ flex: 7 });
    });
});
