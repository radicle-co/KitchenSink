/**
 * Unit tests for the row entry field's description (`fieldErrorIds.ts`): what an entry field's `aria-describedby`
 * names, in reading order, and that every id is scoped to its row.
 */
import { describe, expect, it } from 'vitest';

import {
    ingredientCommitFailureId,
    ingredientEntryDescribedBy,
    trailingCommitFailureId,
    trailingEntryDescribedBy,
    trailingPendingTextId,
    ingredientNoFoodNoteId,
    ingredientPendingTextId,
    ingredientsErrorId,
} from '../fieldErrorIds.js';
import { seedLineKey } from '../lineKey.js';

const KEY = seedLineKey(1, 2);

describe('ingredientEntryDescribedBy', () => {
    it('names nothing for a field with nothing to say', () => {
        expect(
            ingredientEntryDescribedBy(2, KEY, {
                noFoodNote: false,
                unresolvedError: false,
                pending: false,
                failure: false,
            }),
        ).toBeUndefined();
    });

    it('names the no-food note, the form’s refusal, the pending sentence and the failure, in that order', () => {
        expect(
            ingredientEntryDescribedBy(2, KEY, {
                noFoodNote: true,
                unresolvedError: true,
                pending: true,
                failure: true,
            }),
        ).toBe(
            [
                ingredientNoFoodNoteId(2),
                ingredientsErrorId,
                ingredientPendingTextId(KEY),
                ingredientCommitFailureId(KEY),
            ].join(' '),
        );
    });

    it('scopes the pending sentence and the failure to the row', () => {
        expect(ingredientPendingTextId(KEY)).not.toBe(ingredientPendingTextId(seedLineKey(1, 3)));
        expect(ingredientCommitFailureId(KEY)).not.toBe(ingredientCommitFailureId(seedLineKey(1, 3)));
    });
});

describe('trailingEntryDescribedBy (the trailing add row, B8)', () => {
    it('describes the field by its pending sentence, then its failure', () => {
        expect(trailingEntryDescribedBy({ pending: true, failure: true })).toBe(
            `${trailingPendingTextId} ${trailingCommitFailureId}`,
        );
        expect(trailingEntryDescribedBy({ pending: false, failure: true })).toBe(trailingCommitFailureId);
    });

    it('nothing to say: no description', () => {
        expect(trailingEntryDescribedBy({ pending: false, failure: false })).toBeUndefined();
    });

    it('its ids never collide with a row’s: no line key spells the trailing row’s', () => {
        expect(trailingPendingTextId).not.toBe(ingredientPendingTextId(KEY));
        expect(trailingCommitFailureId).not.toBe(ingredientCommitFailureId(KEY));
    });
});
