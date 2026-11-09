/**
 * The refusal's pure half (spec section 7): the server's refused lines matched to the draft's rows (by `foodId`, ties by
 * `sortOrder`, deleted rows dropped), and the ways forward a given cook has at a given door (section 7.3). Part of
 * "can go private" is the cook having a Pro plan or a free slot; a cook who cannot is never shown an upsell.
 */
import { describe, expect, it } from 'vitest';

import { RecipeVisibility } from '@kitchensink/recipe-core';

import { matchRefusedLines, parkedRefusalRows, refusalPlanOf, type RefusalRow } from '../privateFoodsRefusal.js';

const ROWS: readonly RefusalRow[] = [
    { rowId: 'a', foodId: 'f1', sortOrder: 0 },
    { rowId: 'b', foodId: 'f2', sortOrder: 1 },
    { rowId: 'c', foodId: 'f1', sortOrder: 2 },
];

describe('matchRefusedLines', () => {
    it('matches by foodId even after the cook reordered the lines', () => {
        const lines = [{ sortOrder: 5, foodId: 'f2' }];

        expect(matchRefusedLines(lines, ROWS).map((row) => row.rowId)).toEqual(['b']);
    });

    it('breaks a tie between two lines of one food by sortOrder', () => {
        const lines = [{ sortOrder: 2, foodId: 'f1' }];

        expect(matchRefusedLines(lines, ROWS).map((row) => row.rowId)).toEqual(['c']);
    });

    it('falls back to the first unmatched row of that food when the sortOrder no longer exists', () => {
        const lines = [{ sortOrder: 9, foodId: 'f1' }];

        expect(matchRefusedLines(lines, ROWS).map((row) => row.rowId)).toEqual(['a']);
    });

    it('names each row once, in the order the editor shows them', () => {
        const lines = [
            { sortOrder: 2, foodId: 'f1' },
            { sortOrder: 0, foodId: 'f1' },
        ];

        expect(matchRefusedLines(lines, ROWS).map((row) => row.rowId)).toEqual(['a', 'c']);
    });

    it('drops a line whose food is no longer in the draft', () => {
        expect(matchRefusedLines([{ sortOrder: 0, foodId: 'gone' }], ROWS)).toEqual([]);
    });
});

describe('refusalPlanOf', () => {
    it('a cook who can go private, at Publish: change, ask, or publish as private', () => {
        expect(refusalPlanOf({ door: 'publish', canGoPrivate: true })).toEqual({
            ways: ['wayChange', 'wayAsk', 'wayPrivatePublish'],
            primary: { key: 'publishPrivate', effect: 'sendAsPrivate' },
            secondary: { key: 'back', effect: 'close' },
            note: null,
            slotsFull: false,
        });
    });

    it('a cook who can go private, at Save changes: the make-private-and-save action', () => {
        expect(refusalPlanOf({ door: 'save', canGoPrivate: true })).toMatchObject({
            ways: ['wayChange', 'wayAsk', 'wayPrivateSave'],
            primary: { key: 'savePrivate', effect: 'sendAsPrivate' },
        });
    });

    it('a cook with no private slot, at Publish: only the ways that work, then the draft is kept, and no upsell', () => {
        const plan = refusalPlanOf({ door: 'publish', canGoPrivate: false });

        expect(plan.ways).toEqual(['wayChange', 'wayAsk']);
        expect(plan.note).toBe('draftKept');
        expect(plan.secondary).toBeNull();
        expect(plan.primary).toEqual({ key: 'back', effect: 'close' });
        expect(JSON.stringify(plan)).not.toMatch(/pro|upsell|premium/iu);
    });

    it('a cook with no private slot, at Save changes: the changes are kept', () => {
        expect(refusalPlanOf({ door: 'save', canGoPrivate: false }).note).toBe('changesKept');
    });

    it('Make public on the detail page and Restore: change or ask, and Close', () => {
        for (const door of ['makePublic', 'restore'] as const) {
            for (const canGoPrivate of [true, false]) {
                expect(refusalPlanOf({ door, canGoPrivate })).toEqual({
                    ways: ['wayChange', 'wayAsk'],
                    primary: { key: 'close', effect: 'close' },
                    secondary: null,
                    note: null,
                    slotsFull: false,
                });
            }
        }
    });

    it('a cook out of slots is told, in one line, that their private recipes are full (ruling 2026-11-09)', () => {
        expect(refusalPlanOf({ door: 'publish', canGoPrivate: false }).slotsFull).toBe(true);
        expect(refusalPlanOf({ door: 'publish', canGoPrivate: true }).slotsFull).toBe(false);
        expect(refusalPlanOf({ door: 'restore', canGoPrivate: false }).slotsFull).toBe(false);
    });
});

describe('parkedRefusalRows (a parked write the server refused with 400, derived from the draft’s own lines — F6)', () => {
    const values = {
        visibility: RecipeVisibility.PUBLIC,
        ingredients: [{ foodVisibility: 'private' as const }, {}, { foodVisibility: 'private' as const }],
    };

    it('names the private-food lines when the parked write is a terminal 400', () => {
        expect(parkedRefusalRows({ failure: 'terminal', status: 400 }, values)).toEqual([0, 2]);
    });

    it('names nothing for any other status or class: a 409 is a conflict and a 500 is not this refusal', () => {
        for (const status of [409, 500, 502, undefined]) {
            expect(parkedRefusalRows({ failure: 'terminal', status }, values)).toEqual([]);
        }
    });

    it('names nothing when the draft holds no private food (the generic alert stands: this 400 is another refusal)', () => {
        expect(
            parkedRefusalRows(
                { failure: 'terminal', status: 400 },
                { ...values, visibility: RecipeVisibility.PRIVATE },
            ),
        ).toEqual([]);
    });

    it('names nothing when nothing is parked', () => {
        expect(parkedRefusalRows(undefined, values)).toEqual([]);
    });
});
