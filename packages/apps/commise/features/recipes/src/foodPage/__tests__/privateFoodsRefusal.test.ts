/**
 * The refusal's pure half (spec section 7): the server's refused lines matched to the draft's rows (by `foodId`, ties by
 * `sortOrder`, deleted rows dropped), and the ways forward a given cook has at a given door (section 7.3). Part of
 * "can go private" is the cook having a Pro plan or a free slot; a cook who cannot is never shown an upsell.
 */
import { describe, expect, it } from 'vitest';

import { matchRefusedLines, refusalPlanOf, refusedRowsOf, type RefusalRow } from '../privateFoodsRefusal.js';

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

describe('refusedRowsOf (the draft’s rows the server’s refusal named)', () => {
    const values = {
        ingredients: [{ key: 'a', foodId: 'f1' }, { key: 'b', foodId: 'f2' }, { key: 'c' }, { key: 'd', foodId: 'f1' }],
    };

    it('names the rows by food, in the order the editor shows them', () => {
        expect(
            refusedRowsOf(
                [
                    { sortOrder: 3, foodId: 'f1' },
                    { sortOrder: 1, foodId: 'f2' },
                ],
                values,
            ),
        ).toEqual([1, 3]);
    });

    it('names nothing for a food the cook has removed from the draft, and nothing for no lines', () => {
        expect(refusedRowsOf([{ sortOrder: 0, foodId: 'gone' }], values)).toEqual([]);
        expect(refusedRowsOf([], values)).toEqual([]);
    });
});
