/**
 * Unit tests for `pasteSectionsView.ts`: how the Ingredients section keeps the lines the paste list owns out of its
 * ordinary rows, so no line is drawn twice (ADR-0071), and when the section has a paste block to draw at all. Seen red
 * first.
 */
import { describe, expect, it } from 'vitest';

import { hasMatchedLines, withoutOwnedRows } from '../pasteSectionsView.js';
import type { PasteMatchingView } from '../props.js';

const row = (key: string) => ({ line: { key } });
const section = (key: string, ...rows: string[]) => ({ key, rows: rows.map(row) });

const matching = (over: Partial<PasteMatchingView> = {}): PasteMatchingView => ({
    ownedKeys: new Set(),
    summary: undefined,
    summaryFocusSignal: 0,
    notice: undefined,
    layoutFor: () => undefined,
    ...over,
});

describe('withoutOwnedRows', () => {
    it('⛔ drops the rows the paste list owns, in every section, and keeps the rest in order', () => {
        const sections = [section('a', 'k1', 'k2'), section('b', 'k3', 'k4')];
        const kept = withoutOwnedRows(sections, new Set(['k2', 'k3']));

        expect(kept.map((each) => each.rows.map((r) => r.line.key))).toEqual([['k1'], ['k4']]);
    });

    it('leaves a section with no ordinary row in place (its heading and add field stay)', () => {
        const kept = withoutOwnedRows([section('a', 'k1')], new Set(['k1']));

        expect(kept).toHaveLength(1);
        expect(kept[0]?.rows).toEqual([]);
    });

    it('changes nothing when the paste list owns nothing, or there is no paste list', () => {
        const sections = [section('a', 'k1')];

        expect(withoutOwnedRows(sections, undefined)).toBe(sections);
        expect(withoutOwnedRows(sections, new Set())).toEqual(sections);
    });

    it('keeps the section`s other fields', () => {
        const kept = withoutOwnedRows([{ ...section('a', 'k1'), label: 'Dough' }], new Set(['k1']));

        expect(kept[0]).toMatchObject({ key: 'a', label: 'Dough' });
    });
});

describe('hasMatchedLines', () => {
    it('is false with no paste list and with an empty one', () => {
        expect(hasMatchedLines(undefined)).toBe(false);
        expect(hasMatchedLines(matching())).toBe(false);
    });

    it.each([
        ['an owned line', { ownedKeys: new Set(['k1']) }],
        ['a summary', { summary: { added: 'Added 1 line', paragraph: '' } }],
        ['a notice', { notice: { kind: 'quota' as const, resetsAt: '2026-10-27T08:00:00.000Z', timeZone: 'UTC' } }],
    ])('is true with %s', (_name, over) => {
        expect(hasMatchedLines(matching(over))).toBe(true);
    });
});
