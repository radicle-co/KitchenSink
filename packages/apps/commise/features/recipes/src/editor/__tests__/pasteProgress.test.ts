/**
 * The paste's visible state (`editor/pasteProgress.ts`, plan 2026-10-15-011): each unjoined line's row state, the one
 * progress block over them, and the milestone the polite region may speak. Tables over the UX spec's rules, because
 * each rule is a first-match order a reordering would silently break.
 */
import { describe, expect, it } from 'vitest';

import type { PasteReadingRow, PasteRowState } from '../../form/props.js';
import type { PastedLine } from '../pastedLines.js';
import { milestoneOnChange, pasteMilestoneOf, pasteProgressOf, pasteRowsOf } from '../pasteProgress.js';

const reading = (lineIndex: number, phase: 'queued' | 'reading' | 'retrying' | 'delayed'): PastedLine => ({
    kind: 'reading',
    lineIndex,
    sourceLine: `line ${String(lineIndex)}`,
    phase,
});
const awaiting = (lineIndex: number, cause: 'stalled' | 'retryable'): PastedLine => ({
    kind: 'awaitingCook',
    lineIndex,
    sourceLine: `line ${String(lineIndex)}`,
    cause,
});
const settled = (lineIndex: number): PastedLine => ({
    kind: 'settled',
    lineIndex,
    sourceLine: `line ${String(lineIndex)}`,
    rows: [],
});

const rowsOf = (states: readonly PasteRowState[]): readonly PasteReadingRow[] =>
    states.map((state, index) => ({
        key: `j:${String(index)}`,
        lineIndex: index,
        sourceLine: `line ${String(index)}`,
        state,
    }));

describe('pasteRowsOf — one row per line not in the recipe yet', () => {
    it('maps each line to its own state, the next settled line joining and later ones ready', () => {
        const rows = pasteRowsOf({
            jobId: 'j',
            lines: [
                settled(0),
                settled(1),
                reading(2, 'reading'),
                reading(3, 'retrying'),
                reading(4, 'delayed'),
                reading(5, 'queued'),
                awaiting(6, 'stalled'),
                awaiting(7, 'retryable'),
            ],
            done: 0,
            failedAt: undefined,
            waiting: false,
        });

        expect(rows.map((row) => row.state)).toEqual([
            'joining',
            'ready',
            'reading',
            'retrying',
            'delayed',
            'queued',
            'stalled',
            'retryable',
        ]);
        expect(rows[2]).toEqual({ key: 'j:2', lineIndex: 2, sourceLine: 'line 2', state: 'reading' });
    });

    it('drops the lines already joined', () => {
        const rows = pasteRowsOf({
            jobId: 'j',
            lines: [settled(0), settled(1), reading(2, 'queued')],
            done: 2,
            failedAt: undefined,
            waiting: false,
        });

        expect(rows.map((row) => row.lineIndex)).toEqual([2]);
    });

    it("a failed lookup outranks being offline, and being offline outranks the line's own state", () => {
        const rows = pasteRowsOf({
            jobId: 'j',
            lines: [settled(0), reading(1, 'reading'), awaiting(2, 'retryable')],
            done: 0,
            failedAt: 0,
            waiting: true,
        });

        expect(rows.map((row) => row.state)).toEqual(['lookupFailed', 'waiting', 'waiting']);
    });
});

describe('pasteProgressOf — the one block above the rows', () => {
    it.each<{ why: string; states: PasteRowState[]; status: ReturnType<typeof pasteProgressOf>['status'] }>([
        {
            why: 'a line needs the cook: retryable and failed lookups both count, first',
            states: ['retryable', 'lookupFailed', 'reading', 'waiting'],
            status: { kind: 'needsYou', count: 2 },
        },
        { why: 'offline comes next', states: ['waiting', 'stalled'], status: { kind: 'offline' } },
        {
            why: 'every line the server still holds is stalled, ready ones behind them',
            states: ['stalled', 'ready', 'stalled'],
            status: { kind: 'stalled' },
        },
        {
            why: "otherwise the head line's step, by its position in the paste",
            states: ['reading', 'queued'],
            status: { kind: 'step', step: 'reading', position: 4 },
        },
        { why: 'a retrying head', states: ['retrying'], status: { kind: 'step', step: 'retrying', position: 4 } },
        { why: 'a delayed head', states: ['delayed'], status: { kind: 'step', step: 'delayed', position: 4 } },
        { why: 'a queued head', states: ['queued'], status: { kind: 'step', step: 'queued', position: 4 } },
        { why: 'a joining head', states: ['joining', 'ready'], status: { kind: 'step', step: 'joining', position: 4 } },
        {
            why: 'a stalled head while a later line moves names the moving one',
            states: ['stalled', 'reading'],
            status: { kind: 'step', step: 'reading', position: 5 },
        },
    ])('$why', ({ states, status }) => {
        // The rows start at line index 3, so a 1-based position of 4 proves the index, not the row, is named.
        const rows = rowsOf(states).map((row) => ({ ...row, lineIndex: row.lineIndex + 3 }));

        expect(pasteProgressOf(rows, 3, 10).status).toEqual(status);
    });

    it('counts the lines in the recipe against the paste, and what each action would cover', () => {
        const progress = pasteProgressOf(rowsOf(['stalled', 'retryable', 'retryable', 'ready', 'reading']), 5, 10);

        expect(progress).toMatchObject({ done: 5, count: 10, retryCount: 2, restCount: 3 });
    });

    it('offers nothing to retry or add as written when no line waits on the cook', () => {
        expect(pasteProgressOf(rowsOf(['reading', 'queued']), 0, 2)).toMatchObject({ retryCount: 0, restCount: 0 });
    });
});

describe('pasteMilestoneOf — what the polite region may speak about', () => {
    it.each<[ReturnType<typeof pasteProgressOf>['status'], ReturnType<typeof pasteMilestoneOf>]>([
        [{ kind: 'needsYou', count: 1 }, 'needsYou'],
        [{ kind: 'offline' }, 'offline'],
        [{ kind: 'stalled' }, 'stalled'],
        [{ kind: 'step', step: 'reading', position: 1 }, 'moving'],
        [{ kind: 'step', step: 'joining', position: 9 }, 'moving'],
    ])('%o → %s', (status, milestone) => {
        expect(pasteMilestoneOf({ done: 0, count: 1, retryCount: 0, restCount: 0, status })).toBe(milestone);
    });
});

describe('milestoneOnChange — the polite region speaks only when the condition changes', () => {
    it.each<
        [
            Parameters<typeof milestoneOnChange>[0],
            Parameters<typeof milestoneOnChange>[1],
            ReturnType<typeof milestoneOnChange>,
        ]
    >([
        [undefined, 'moving', 'started'],
        [undefined, 'stalled', 'started'],
        ['moving', 'moving', undefined],
        ['moving', 'needsYou', 'needsYou'],
        ['moving', 'stalled', 'stalled'],
        ['moving', 'offline', 'offline'],
        ['stalled', 'moving', 'resumed'],
        ['offline', 'moving', 'resumed'],
        ['needsYou', 'moving', 'resumed'],
        ['stalled', 'stalled', undefined],
    ])('%s → %s says %s', (previous, next, milestone) => {
        expect(milestoneOnChange(previous, next)).toBe(milestone);
    });
});
