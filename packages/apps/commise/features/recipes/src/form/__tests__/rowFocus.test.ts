/**
 * Unit tests for `rowFocus.ts` — where focus goes when the cook leaves a row's entry without a pick
 * (`docs/design/rowEditorOpenDecisions.md` item 4: the control they came from).
 */
import { describe, expect, it } from 'vitest';

import { seedLineKey } from '../lineKey.js';
import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { isFocusRequested, leaveEntryFocus, settledFocusOf } from '../rowFocus.js';

describe('leaveEntryFocus', () => {
    it('a row whose actions sit behind ⋮ came from ⋮: Change food is only ever in a menu', () => {
        expect(leaveEntryFocus({ kind: 'menu', actions: ['changeFood', 'remove'] })).toBe('actions');
    });

    it('a row with one direct action came from its glyph: None of these is in the candidates panel', () => {
        expect(leaveEntryFocus({ kind: 'direct', action: 'remove' })).toBe('glyph');
    });
});

describe('isFocusRequested', () => {
    const key = seedLineKey(1, 0);

    it('matches the row and the control, and nothing else', () => {
        const request = { key, control: 'glyph' } as const;

        expect(isFocusRequested(request, key, 'glyph')).toBe(true);
        expect(isFocusRequested(request, key, 'actions')).toBe(false);
        expect(isFocusRequested(request, seedLineKey(1, 1), 'glyph')).toBe(false);
        expect(isFocusRequested(undefined, key, 'glyph')).toBe(false);
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

    const ROW = { kind: 'row', request: { key: KEY, control: 'glyph' } } as const;
    const APPENDED = seedLineKey(2, 1);
    const onTrailing = (over: Partial<SettledRowCommit> = {}) =>
        settled({
            target: { kind: 'newLine' },
            outcome: { kind: 'committed', key: APPENDED, binding: { ingredientId: 'ing_kale', isUserEntered: false } },
            ...over,
        });

    it('an entry pick that committed: the row’s glyph, now', () => {
        expect(settledFocusOf(settled({}))).toEqual({ when: 'now', focus: ROW });
    });

    it('an authored food that committed: the row’s glyph, once the sheet is gone', () => {
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

    it.each<[string, SettledRowCommit | undefined]>([
        ['nothing settled', undefined],
        ['a details pick (its dialog returns focus to ⋮)', settled({ origin: { kind: 'details', mode: 'add' } })],
        ['a shortlist pick (its panel returns focus to the glyph, row 7)', settled({ origin: { kind: 'shortlist' } })],
        ['a pick that failed', settled({ outcome: { kind: 'failed' } })],
        ['a trailing pick that failed (focus is still in its field)', onTrailing({ outcome: { kind: 'failed' } })],
    ])('%s: no move', (_case, commit) => {
        expect(settledFocusOf(commit)).toBeUndefined();
    });
});
