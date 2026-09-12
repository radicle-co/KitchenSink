/**
 * Where focus goes after an ingredient row is removed (`docs/design/ingredientStatusExplanation.md` V1 sign-off item
 * 11): the next row's glyph; the trailing control when the removed row was last. Both leaves read this one rule, so the
 * two platforms cannot hand focus to different places.
 *
 * REWRITTEN for plan 002 V1 B7: item 11's middle step, "that row's Remove when it has no glyph", is gone. B7 gives every
 * panel a body, so every row shows its glyph (item 3a), and on a row whose actions sit behind `⋮` its Remove is not a
 * control that could take focus. A line with no food, which had no glyph before B7, now proves the glyph instead.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { withLineKeys } from '../../__fixtures__/index.js';
import { removalFocusTarget } from '../removalFocusTarget.js';

const notFound = (ingredientId: string, name: string) => ({
    ingredientId,
    name,
    quantity: 1,
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.NOT_FOUND,
});
// A line with no food: before B7 it had no glyph.
const noFood = (name: string) => ({ ingredientId: null, name, quantity: 1, isUserEntered: false });

describe('removalFocusTarget', () => {
    it('is the NEXT row’s glyph when it has one', () => {
        const lines = withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek'), notFound('c', 'Okra')]);

        expect(removalFocusTarget(lines, 0)).toEqual({ kind: 'glyph', key: lines[1]?.key });
        expect(removalFocusTarget(lines, 1)).toEqual({ kind: 'glyph', key: lines[2]?.key });
    });

    it('is the next row’s glyph for a row with no food too: every row shows its glyph', () => {
        const lines = withLineKeys([notFound('a', 'Kale'), noFood('Leek')]);

        expect(removalFocusTarget(lines, 0)).toEqual({ kind: 'glyph', key: lines[1]?.key });
    });

    it('is the trailing control when the removed row was the last, or the only one', () => {
        const lines = withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]);

        expect(removalFocusTarget(lines, 1)).toEqual({ kind: 'trailing' });
        expect(removalFocusTarget(lines.slice(0, 1), 0)).toEqual({ kind: 'trailing' });
    });
});
