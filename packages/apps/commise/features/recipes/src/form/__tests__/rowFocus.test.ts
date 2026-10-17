/**
 * Unit tests for `rowFocus.ts` — which row control a focus request names, and where focus goes when a commit settles.
 *
 * REWRITTEN for the UI overhaul's read rows (build spec §7.5.1): the row's glyph is gone from healthy rows, so a settled
 * pick hands focus to the row's OPEN control, which every row has. `leaveEntryFocus` was deleted with the glyph: the
 * row's ⋯ is now always a menu, and leaving an entry returns focus to the open control (`ingredientRowView.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { seedLineKey } from '../lineKey.js';
import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { isFocusRequested, settledFocusOf } from '../rowFocus.js';

describe('isFocusRequested', () => {
    const key = seedLineKey(1, 0);

    it('matches the row and the control, and nothing else', () => {
        const request = { key, control: 'open' } as const;

        expect(isFocusRequested(request, key, 'open')).toBe(true);
        expect(isFocusRequested(request, key, 'actions')).toBe(false);
        expect(isFocusRequested(request, seedLineKey(1, 1), 'open')).toBe(false);
        expect(isFocusRequested(undefined, key, 'open')).toBe(false);
    });
});

describe('settledFocusOf (where focus goes when a commit settles, §2d, item 1)', () => {
    const KEY = seedLineKey(2, 0);
    const settled = (over: Partial<SettledRowCommit>): SettledRowCommit => ({
        origin: { kind: 'entry' },
        pick: { kind: 'catalogFood', foodId: 'food_kale', name: 'Kale' },
        target: { kind: 'line', key: KEY },
        outcome: { kind: 'committed', key: KEY, binding: { ingredientId: 'ing_kale', isUserEntered: false } },
        ...over,
    });

    const ROW = { kind: 'row', request: { key: KEY, control: 'open' } } as const;
    const APPENDED = seedLineKey(2, 1);
    const onTrailing = (over: Partial<SettledRowCommit> = {}) =>
        settled({
            target: { kind: 'newLine' },
            outcome: { kind: 'committed', key: APPENDED, binding: { ingredientId: 'ing_kale', isUserEntered: false } },
            ...over,
        });

    it('an entry pick that committed: the row’s open control, now', () => {
        expect(settledFocusOf(settled({}))).toEqual({ when: 'now', focus: ROW });
    });

    it('an authored food that committed: the row’s open control, once the sheet is gone', () => {
        expect(settledFocusOf(settled({ origin: { kind: 'authoredFood', outcome: 'created' } }))).toEqual({
            when: 'afterAuthoredSheet',
            focus: ROW,
        });
    });

    // §2d: "Trailing row → append: the trailing row's combobox, re-emptied" — the F1 loop.
    it('a pick on the trailing row that committed: the emptied trailing field, now', () => {
        expect(settledFocusOf(onTrailing())).toEqual({ when: 'now', focus: { kind: 'trailing' } });
    });

    it('a food made from the trailing row: the trailing field, once the sheet is gone (item 1)', () => {
        expect(settledFocusOf(onTrailing({ origin: { kind: 'authoredFood', outcome: 'created' } }))).toEqual({
            when: 'afterAuthoredSheet',
            focus: { kind: 'trailing' },
        });
    });

    it('a shortlist pick that committed: the row’s open control, now (the attention line that opened it is gone)', () => {
        expect(settledFocusOf(settled({ origin: { kind: 'shortlist' } }))).toEqual({ when: 'now', focus: ROW });
    });

    it.each<[string, SettledRowCommit | undefined]>([
        ['nothing settled', undefined],
        ['a details pick (its dialog returns focus to ⋮)', settled({ origin: { kind: 'details', mode: 'add' } })],
        ['a pick that failed', settled({ outcome: { kind: 'failed' } })],
        ['a trailing pick that failed (focus is still in its field)', onTrailing({ outcome: { kind: 'failed' } })],
    ])('%s: no move', (_case, commit) => {
        expect(settledFocusOf(commit)).toBeUndefined();
    });
});
