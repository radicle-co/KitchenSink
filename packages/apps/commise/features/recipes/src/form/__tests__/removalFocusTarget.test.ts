/**
 * Where focus goes after an ingredient row is removed (build spec §7.5.1: "Removing a row moves focus to the next row"):
 * the next row's open control; the trailing control when the removed row was last. Both leaves read this one rule, so
 * the two platforms cannot hand focus to different places.
 *
 * REWRITTEN for the UI overhaul's read rows: a healthy row shows no glyph, so the next row's OPEN control ("Edit
 * {amount} {food}"), which every row has, takes focus. A line with no food has one too.
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
// A line with no food: its open control is the same as any row's.
const noFood = (name: string) => ({ ingredientId: null, name, quantity: 1, isUserEntered: false });

describe('removalFocusTarget', () => {
    it('is the NEXT row’s open control', () => {
        const lines = withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek'), notFound('c', 'Okra')]);

        expect(removalFocusTarget(lines, 0)).toEqual({ kind: 'open', key: lines[1]?.key });
        expect(removalFocusTarget(lines, 1)).toEqual({ kind: 'open', key: lines[2]?.key });
    });

    it('is the next row’s open control for a row with no food too: every row has one', () => {
        const lines = withLineKeys([notFound('a', 'Kale'), noFood('Leek')]);

        expect(removalFocusTarget(lines, 0)).toEqual({ kind: 'open', key: lines[1]?.key });
    });

    it('is the trailing control when the removed row was the last, or the only one', () => {
        const lines = withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]);

        expect(removalFocusTarget(lines, 1)).toEqual({ kind: 'trailing' });
        expect(removalFocusTarget(lines.slice(0, 1), 0)).toEqual({ kind: 'trailing' });
    });
});
