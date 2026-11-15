/**
 * Truth table for the wizard cursor: every end (empty, first, last, done), skip/back, and the marks it asks the caller to write.
 *
 * REWRITTEN for the service lane (ADR-0072 §1, the contract's `cursor` route). The first version carried one mark PER ITEM
 * (`reviews: ItemReview[]`), which needs an array as long as the file: a file of any size is accepted (owner ruling), so a
 * hostile `expectedTotal` would allocate it. The cursor now carries only its position and the item COUNT, and a move names the
 * one mark it makes. Every behaviour the old table pinned is pinned again below on that shape.
 */
import { describe, expect, it } from 'vitest';

import {
    backItem,
    nextItem,
    openItem,
    ordinalOfPosition,
    positionOfOrdinal,
    skipItem,
    startPosition,
    type CursorPosition,
} from '../importCursor.js';

const at = (index: number): CursorPosition => ({ kind: 'at', index });
const DONE: CursorPosition = { kind: 'done' };

describe('startPosition', () => {
    it('opens the first item', () => {
        expect(startPosition(3)).toEqual(at(0));
    });

    it('is done at once when there is nothing to review', () => {
        expect(startPosition(0)).toEqual(DONE);
    });
});

describe('nextItem', () => {
    it('marks the current item reviewed and moves on', () => {
        expect(nextItem(at(0), 3)).toEqual({ position: at(1), mark: { index: 0, review: 'reviewed' } });
    });

    it('is done after the last item, which is marked reviewed', () => {
        expect(nextItem(at(1), 2)).toEqual({ position: DONE, mark: { index: 1, review: 'reviewed' } });
    });

    it('does nothing once done: no move and no mark', () => {
        expect(nextItem(DONE, 2)).toEqual({ position: DONE, mark: undefined });
    });
});

describe('skipItem', () => {
    it('marks the current item skipped and moves on', () => {
        expect(skipItem(at(0), 3)).toEqual({ position: at(1), mark: { index: 0, review: 'skipped' } });
    });

    it('is done after skipping the last item', () => {
        expect(skipItem(at(1), 2)).toEqual({ position: DONE, mark: { index: 1, review: 'skipped' } });
    });

    it('does nothing once done', () => {
        expect(skipItem(DONE, 1)).toEqual({ position: DONE, mark: undefined });
    });
});

describe('backItem', () => {
    it('moves to the previous item and marks nothing', () => {
        expect(backItem(at(2), 3)).toEqual({ position: at(1), mark: undefined });
    });

    it('stays on the first item', () => {
        expect(backItem(at(0), 2)).toEqual({ position: at(0), mark: undefined });
    });

    it('returns from done to the last item', () => {
        expect(backItem(DONE, 2)).toEqual({ position: at(1), mark: undefined });
    });

    it('stays done when there is no item to return to', () => {
        expect(backItem(DONE, 0)).toEqual({ position: DONE, mark: undefined });
    });
});

describe('openItem', () => {
    it('jumps to any item in range and marks nothing', () => {
        expect(openItem(at(0), 3, 2)).toEqual({ position: at(2), mark: undefined });
    });

    it('can open the first and the last item', () => {
        expect(openItem(at(1), 3, 0).position).toEqual(at(0));
        expect(openItem(at(1), 3, 2).position).toEqual(at(2));
    });

    it('opens an item from done', () => {
        expect(openItem(DONE, 1, 0).position).toEqual(at(0));
    });

    it.each([-1, 3, 1.5, Number.NaN])('ignores %s, which is not an item', (index) => {
        expect(openItem(at(1), 3, index)).toEqual({ position: at(1), mark: undefined });
    });
});

describe('the stored ordinal', () => {
    it('reads an ordinal below the count as that item and the count itself as done (the column’s own convention)', () => {
        expect(positionOfOrdinal(0, 3)).toEqual(at(0));
        expect(positionOfOrdinal(2, 3)).toEqual(at(2));
        expect(positionOfOrdinal(3, 3)).toEqual(DONE);
    });

    it('writes done as the count and an item as its ordinal', () => {
        expect(ordinalOfPosition(DONE, 3)).toBe(3);
        expect(ordinalOfPosition(at(1), 3)).toBe(1);
    });

    it('round-trips every position of a file', () => {
        for (let ordinal = 0; ordinal <= 4; ordinal += 1) {
            expect(ordinalOfPosition(positionOfOrdinal(ordinal, 4), 4)).toBe(ordinal);
        }
    });

    it('allocates nothing per item: a file of any size is fine (kills: an array as long as the file)', () => {
        const huge = 2_147_483_647;

        expect(nextItem(at(huge - 1), huge)).toEqual({ position: DONE, mark: { index: huge - 1, review: 'reviewed' } });
        expect(startPosition(huge)).toEqual(at(0));
    });
});
