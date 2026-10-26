/**
 * Truth table for the wizard cursor: every end (empty, first, last, done), skip/back, and the marks it owns.
 */
import { describe, expect, it } from 'vitest';

import { backItem, nextItem, openItem, skipItem, startCursor, type MigrationCursor } from '../migrationCursor.js';

const at = (index: number, reviews: MigrationCursor['reviews']): MigrationCursor => ({
    position: { kind: 'at', index },
    reviews,
});

describe('startCursor', () => {
    it('opens the first item with every item pending', () => {
        expect(startCursor(3)).toEqual(at(0, ['pending', 'pending', 'pending']));
    });

    it('is done at once when there is nothing to review', () => {
        expect(startCursor(0)).toEqual({ position: { kind: 'done' }, reviews: [] });
    });
});

describe('nextItem', () => {
    it('marks the current item reviewed and moves on', () => {
        expect(nextItem(startCursor(3))).toEqual(at(1, ['reviewed', 'pending', 'pending']));
    });

    it('is done after the last item, which is marked reviewed', () => {
        const last = at(1, ['reviewed', 'pending']);
        expect(nextItem(last)).toEqual({ position: { kind: 'done' }, reviews: ['reviewed', 'reviewed'] });
    });

    it('does nothing once done', () => {
        const done = nextItem(nextItem(startCursor(1)));
        expect(nextItem(done)).toEqual(done);
    });

    it('turns an earlier skip into reviewed when the cook comes back and goes on', () => {
        expect(nextItem(at(0, ['skipped', 'pending']))).toEqual(at(1, ['reviewed', 'pending']));
    });
});

describe('skipItem', () => {
    it('marks the current item skipped and moves on', () => {
        expect(skipItem(startCursor(3))).toEqual(at(1, ['skipped', 'pending', 'pending']));
    });

    it('is done after skipping the last item', () => {
        expect(skipItem(at(1, ['reviewed', 'pending']))).toEqual({
            position: { kind: 'done' },
            reviews: ['reviewed', 'skipped'],
        });
    });

    it('does nothing once done', () => {
        const done = skipItem(startCursor(1));
        expect(skipItem(done)).toEqual(done);
    });
});

describe('backItem', () => {
    it('moves to the previous item and keeps every mark', () => {
        expect(backItem(at(2, ['reviewed', 'skipped', 'pending']))).toEqual(at(1, ['reviewed', 'skipped', 'pending']));
    });

    it('stays on the first item', () => {
        expect(backItem(at(0, ['pending', 'pending']))).toEqual(at(0, ['pending', 'pending']));
    });

    it('returns from done to the last item', () => {
        const done = nextItem(nextItem(startCursor(2)));
        expect(backItem(done)).toEqual(at(1, ['reviewed', 'reviewed']));
    });

    it('stays done when there is no item to return to', () => {
        expect(backItem(startCursor(0))).toEqual(startCursor(0));
    });
});

describe('openItem', () => {
    it('jumps to any item in range without changing marks', () => {
        expect(openItem(at(0, ['pending', 'pending', 'pending']), 2)).toEqual(at(2, ['pending', 'pending', 'pending']));
    });

    it('can open the first and the last item', () => {
        const c = at(1, ['pending', 'pending', 'pending']);
        expect(openItem(c, 0).position).toEqual({ kind: 'at', index: 0 });
        expect(openItem(c, 2).position).toEqual({ kind: 'at', index: 2 });
    });

    it('opens an item from done', () => {
        const done = nextItem(startCursor(1));
        expect(openItem(done, 0).position).toEqual({ kind: 'at', index: 0 });
    });

    it.each([-1, 3, 1.5, Number.NaN])('ignores %s, which is not an item', (index) => {
        const c = at(1, ['pending', 'pending', 'pending']);
        expect(openItem(c, index)).toEqual(c);
    });
});
