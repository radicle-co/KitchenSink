/**
 * Unit tests for the paste's projection (`editor/pastedLines.ts`; blueprint A5, build spec §7.5.4): which pasted lines
 * are still reading, and what each settled line becomes in the recipe.
 *
 * ⛔ Three facts about the service decide when a line has stopped moving, so each has a case: a `partial`
 * job keeps moving, expiry is the timestamp and not the status, and a line can stay `pending` forever. None of them may
 * leave a row reading for good: past the stall bound, an expired job, an unreadable line and a job that cannot be read
 * all settle the line through the add field's own reader.
 */
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    makeParseJob,
    makeParseJobLine,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';
import { PASTE_STALL_BOUND_MS, pastedLinesOf, type PastedLinesInput } from '../pastedLines.js';

const NOW = Date.parse('2026-10-09T10:01:00.000Z');

const input = (over: Partial<PastedLinesInput> = {}): PastedLinesInput => ({
    job: makeParseJob(),
    jobFailed: false,
    now: NOW,
    runningSince: NOW - 1_000,
    ...over,
});

const OLIVE_OIL_FALLBACK = {
    name: 'olive oil',
    measure: { quantity: { kind: 'exact', value: 2 }, unit: 'tablespoon', preparation: 'for frying' },
};

describe('pastedLinesOf', () => {
    it('a pending line of a running job is reading, with its own text', () => {
        expect(pastedLinesOf(input())).toEqual([{ kind: 'reading', lineIndex: 0, sourceLine: '2 cups flour' }]);
    });

    it('a parsed line becomes one row per proposed food: the name to look up, the measure, the phrase it read', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine: '2 cups flour, sifted',
                    status: 'parsed',
                    proposal: makeParseProposal({ foods: [makeParseProposalFood({ name: 'flour', prep: 'sifted' })] }),
                }),
            ],
        });

        expect(pastedLinesOf(input({ job }))).toEqual([
            {
                kind: 'settled',
                lineIndex: 0,
                sourceLine: '2 cups flour, sifted',
                rows: [
                    {
                        name: 'flour',
                        measure: { quantity: { kind: 'exact', value: 2 }, unit: 'cup', preparation: 'sifted' },
                        sourcePhrase: 'flour',
                    },
                ],
            },
        ]);
    });

    it('a line naming two foods: the first carries the measure, the second states none', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine: 'salt and pepper',
                    status: 'parsed',
                    proposal: makeParseProposal({
                        quantity: ABSENT_QUANTITY,
                        unit: null,
                        foods: [makeParseProposalFood({ name: 'salt' }), makeParseProposalFood({ name: 'pepper' })],
                    }),
                }),
            ],
        });
        const [line] = pastedLinesOf(input({ job }));

        expect(line?.kind === 'settled' ? line.rows : []).toEqual([
            { name: 'salt', measure: { quantity: ABSENT_QUANTITY, unit: '', preparation: '' }, sourcePhrase: 'salt' },
            {
                name: 'pepper',
                measure: { quantity: ABSENT_QUANTITY, unit: '', preparation: '' },
                sourcePhrase: 'pepper',
            },
        ]);
    });

    it('a heading names no food, so it settles into no row', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine: 'For the sauce:',
                    status: 'parsed',
                    proposal: makeParseProposal({ foods: [] }),
                }),
            ],
        });

        expect(pastedLinesOf(input({ job }))).toEqual([
            { kind: 'settled', lineIndex: 0, sourceLine: 'For the sauce:', rows: [] },
        ]);
    });

    it('an unreadable line settles through the add field’s own reader, and claims no phrase it did not parse', () => {
        const job = makeParseJob({
            status: 'complete',
            lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying', status: 'unparseable' })],
        });

        expect(pastedLinesOf(input({ job }))).toEqual([
            { kind: 'settled', lineIndex: 0, sourceLine: '2 tbsp olive oil, for frying', rows: [OLIVE_OIL_FALLBACK] },
        ]);
    });

    it('a fallback line that reads as a measure alone keeps its whole text as the name', () => {
        const job = makeParseJob({ lines: [makeParseJobLine({ sourceLine: '2 cups', status: 'unparseable' })] });
        const [line] = pastedLinesOf(input({ job }));

        expect(line?.kind === 'settled' ? line.rows.map((row) => row.name) : []).toEqual(['2 cups']);
    });

    it('⛔ a partial job keeps reading its retryable lines: they may still land on their own', () => {
        const job = makeParseJob({
            status: 'partial',
            lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying', status: 'failed_retryable' })],
        });

        expect(pastedLinesOf(input({ job }))[0]?.kind).toBe('reading');
    });

    it.each([
        { why: 'a pending line past the stall bound', status: 'running' as const, line: 'pending' as const },
        { why: 'a retryable line past the stall bound', status: 'partial' as const, line: 'failed_retryable' as const },
    ])('⛔ $why settles through the reader, so no row reads for good', ({ status, line }) => {
        const job = makeParseJob({
            status,
            lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying', status: line })],
        });

        expect(pastedLinesOf(input({ job, runningSince: NOW - PASTE_STALL_BOUND_MS - 1 }))).toEqual([
            { kind: 'settled', lineIndex: 0, sourceLine: '2 tbsp olive oil, for frying', rows: [OLIVE_OIL_FALLBACK] },
        ]);
    });

    it.each([
        { why: 'the sweep expired it', job: { status: 'expired' as const } },
        { why: '⛔ its deadline passed while it still reads running', job: { expiresAt: '2026-10-09T10:00:30.000Z' } },
    ])('an expired job settles its unread lines through the reader: $why', ({ job }) => {
        const expired = makeParseJob({
            ...job,
            lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying' })],
        });

        expect(pastedLinesOf(input({ job: expired }))[0]).toEqual({
            kind: 'settled',
            lineIndex: 0,
            sourceLine: '2 tbsp olive oil, for frying',
            rows: [OLIVE_OIL_FALLBACK],
        });
    });

    it('a job that cannot be read settles every line through the reader', () => {
        expect(pastedLinesOf(input({ jobFailed: true }))[0]?.kind).toBe('settled');
    });

    it('lines come in paste order whatever order the job lists them in', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({ lineIndex: 1, sourceLine: 'b' }),
                makeParseJobLine({ lineIndex: 0, sourceLine: 'a' }),
            ],
        });

        expect(pastedLinesOf(input({ job })).map((line) => line.sourceLine)).toEqual(['a', 'b']);
    });
});
