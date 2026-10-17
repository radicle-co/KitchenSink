/**
 * Unit tests for the paste's projection (`editor/pastedLines.ts`; blueprint A5, build spec §7.5.4): which pasted lines
 * are still reading, and what each settled line becomes in the recipe.
 *
 * ⛔ REWRITTEN for owner ruling 2026-10-13 (plan 2026-10-15-011): "it takes as long as it takes". There is no client
 * time limit any more — the 3-minute stall bound that settled every unread line through the reader is gone, and with
 * it the cases that pinned it. What replaces it: a pending line reads with the phase the SERVER reports; a line the
 * server calls `stalled`, and a `failed_retryable` line, AWAIT THE COOK (Add as written, or Try again); and a line the
 * cook chose to add as written settles through the add field's own reader. The server's terminals still settle without
 * the cook: an expired job, an unreadable line and a job that cannot be read.
 */
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    makeParseJob,
    makeParseJobLine,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';
import { pastedLinesOf, type PastedLinesInput } from '../pastedLines.js';

const NOW = Date.parse('2026-10-09T10:01:00.000Z');

const input = (over: Partial<PastedLinesInput> = {}): PastedLinesInput => ({
    job: makeParseJob(),
    jobFailed: false,
    now: NOW,
    typedByCook: new Set(),
    ...over,
});

/**
 * REWRITTEN (UX F12): a line the reader settles keeps the unit as the cook typed it ("tbsp"), as a parsed line does, so
 * one line reads the same whichever path settles it. It was `normalizeUnit`'s "tablespoon".
 */
const OLIVE_OIL_FALLBACK = {
    name: 'olive oil',
    measure: { quantity: { kind: 'exact', value: 2 }, unit: 'tbsp', preparation: 'for frying' },
};

describe('pastedLinesOf', () => {
    it('a pending line of a running job is reading, with its own text and the phase the server reports', () => {
        expect(pastedLinesOf(input())).toEqual([
            { kind: 'reading', lineIndex: 0, sourceLine: '2 cups flour', phase: 'queued' },
        ]);
    });

    it.each(['queued', 'reading', 'retrying', 'delayed'] as const)(
        'a pending line the server reads as %s reads so',
        (phase) => {
            const job = makeParseJob({ lines: [makeParseJobLine({ progress: { phase } })] });

            expect(pastedLinesOf(input({ job }))[0]).toEqual({
                kind: 'reading',
                lineIndex: 0,
                sourceLine: '2 cups flour',
                phase,
            });
        },
    );

    it('⛔ a stalled line awaits the cook rather than settling: no clock gives up on it', () => {
        const job = makeParseJob({ lines: [makeParseJobLine({ progress: { phase: 'stalled' } })] });

        expect(pastedLinesOf(input({ job }))).toEqual([
            { kind: 'awaitingCook', lineIndex: 0, sourceLine: '2 cups flour', cause: 'stalled' },
        ]);
    });

    it('a pending line with no progress reads as queued', () => {
        const job = makeParseJob({ lines: [makeParseJobLine({ progress: null })] });

        expect(pastedLinesOf(input({ job }))[0]).toMatchObject({ kind: 'reading', phase: 'queued' });
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
                        // The unit as the cook stated it ("2 cups"), not the parse's canonical "cup" (F12).
                        measure: { quantity: { kind: 'exact', value: 2 }, unit: 'cups', preparation: 'sifted' },
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
                        statedMeasure: null,
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

    /**
     * UX F12 (`evaluateFinal.md`): a paste rewrote what the cook typed — "2 tbsp" became "2 tablespoon", "1 large onion"
     * lost "large", and "a handful of" vanished. Spec §7.5.3: the amount and unit the cook typed are the cook's own
     * statement. So the measure comes from the cook's words (`statedMeasure`), read with the add field's amount rules;
     * the parse's own reading stands only where the cook's words state no amount it can read but the parse read one.
     */
    it.each([
        {
            line: '2 tbsp olive oil',
            proposal: { quantity: { kind: 'exact', value: 2 }, unit: 'tablespoon', statedMeasure: '2 tbsp' },
            measure: { quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' },
        },
        {
            line: '1 large onion, finely chopped',
            proposal: { quantity: { kind: 'exact', value: 1 }, unit: null, statedMeasure: '1 large' },
            measure: { quantity: { kind: 'exact', value: 1 }, unit: 'large' },
        },
        {
            line: 'a handful of coriander leaves, to serve',
            proposal: { quantity: ABSENT_QUANTITY, unit: null, statedMeasure: 'a handful' },
            measure: { quantity: ABSENT_QUANTITY, unit: 'a handful' },
        },
        {
            line: '200g butter',
            proposal: { quantity: { kind: 'exact', value: 200 }, unit: 'gram', statedMeasure: '200g' },
            measure: { quantity: { kind: 'exact', value: 200 }, unit: 'g' },
        },
        {
            line: '1 1/2 cups of flour',
            proposal: { quantity: { kind: 'exact', value: 1.5 }, unit: 'cup', statedMeasure: '1 1/2 cups of' },
            measure: { quantity: { kind: 'exact', value: 1.5 }, unit: 'cups' },
        },
        {
            line: '2–3 Tbsp water',
            proposal: { quantity: { kind: 'range', low: 2, high: 3 }, unit: 'tablespoon', statedMeasure: '2–3 Tbsp' },
            measure: { quantity: { kind: 'range', low: 2, high: 3 }, unit: 'Tbsp' },
        },
        {
            line: 'one cup sugar',
            proposal: { quantity: { kind: 'exact', value: 1 }, unit: 'cup', statedMeasure: 'one cup' },
            measure: { quantity: { kind: 'exact', value: 1 }, unit: 'cup' },
        },
        {
            line: '2 cups flour',
            proposal: { quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: null },
            measure: { quantity: { kind: 'exact', value: 2 }, unit: 'cup' },
        },
    ] as const)('"$line" keeps the cook’s measure', ({ line: sourceLine, proposal, measure }) => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine,
                    status: 'parsed',
                    proposal: makeParseProposal({ ...proposal, foods: [makeParseProposalFood({ name: 'food' })] }),
                }),
            ],
        });
        const [settled] = pastedLinesOf(input({ job }));

        expect(settled?.kind === 'settled' ? settled.rows[0]?.measure : undefined).toEqual({
            ...measure,
            preparation: '',
        });
    });

    /**
     * 2026-10-09 review, Medium 1: the heading test ran only on the reader path, so a parse that proposed a food for a
     * heading ("dough" for "For the dough:") still added a food row. The heading is tested before the status decides.
     */
    it.each([
        { sourceLine: 'For the dough:', heading: true },
        { sourceLine: 'For the dough :', heading: true },
        { sourceLine: '  For the filling:  ', heading: true },
        { sourceLine: 'Salt: to taste', heading: false },
    ])(
        'a parsed proposal for "$sourceLine" adds rows only when the line is not a heading',
        ({ sourceLine, heading }) => {
            const job = makeParseJob({
                lines: [
                    makeParseJobLine({
                        sourceLine,
                        status: 'parsed',
                        proposal: makeParseProposal({ foods: [makeParseProposalFood({ name: 'dough' })] }),
                    }),
                ],
            });
            const [line] = pastedLinesOf(input({ job }));

            expect(line?.kind === 'settled' ? line.rows.map((row) => row.name) : undefined).toEqual(
                heading ? [] : ['dough'],
            );
        },
    );

    /**
     * A line the SERVER holds as `withdrawn` was kept as written by the cook (plan 2026-10-15-011, open question 8). It
     * settles through the reader even when this client no longer remembers the choice (a remount), because no engine
     * will ever answer for it.
     */
    it('a withdrawn line settles through the reader without the cook’s local choice', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying', status: 'withdrawn', progress: null }),
            ],
        });

        expect(pastedLinesOf(input({ job }))).toEqual([
            { kind: 'settled', lineIndex: 0, sourceLine: '2 tbsp olive oil, for frying', rows: [OLIVE_OIL_FALLBACK] },
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

    /**
     * REWRITTEN (2026-10-09 review, finding 9): a fallback line that reads as a measure alone used to keep its whole text
     * as the food's name, so `2 cups` became a food named "2 cups" and a write to the catalog. A line with no words left
     * for the food search names no food, so it adds no row.
     */
    it('a fallback line that reads as a measure alone names no food, so it adds no row', () => {
        const job = makeParseJob({ lines: [makeParseJobLine({ sourceLine: '2 cups', status: 'unparseable' })] });

        expect(pastedLinesOf(input({ job }))).toEqual([
            { kind: 'settled', lineIndex: 0, sourceLine: '2 cups', rows: [] },
        ]);
    });

    /**
     * Every path that settles a line through the reader, against the shapes of line that name no food. A heading ending
     * in a colon used to be dropped only when the parse answered; on every other path it became a food named after it.
     */
    describe('a line the reader settles adds no food when it names none (finding 9)', () => {
        const PATHS = [
            {
                path: 'the cook chose to add it as written',
                at: (sourceLine: string) =>
                    input({
                        job: makeParseJob({ lines: [makeParseJobLine({ sourceLine })] }),
                        typedByCook: new Set([0]),
                    }),
            },
            {
                path: 'an unparseable line',
                at: (sourceLine: string) =>
                    input({
                        job: makeParseJob({
                            status: 'complete',
                            lines: [makeParseJobLine({ sourceLine, status: 'unparseable' })],
                        }),
                    }),
            },
            {
                path: 'an expired job',
                at: (sourceLine: string) =>
                    input({ job: makeParseJob({ status: 'expired', lines: [makeParseJobLine({ sourceLine })] }) }),
            },
            {
                path: 'a parsed line with no proposal',
                at: (sourceLine: string) =>
                    input({
                        job: makeParseJob({
                            lines: [makeParseJobLine({ sourceLine, status: 'parsed', proposal: null })],
                        }),
                    }),
            },
            {
                path: 'a job that cannot be read',
                at: (sourceLine: string) =>
                    input({ job: makeParseJob({ lines: [makeParseJobLine({ sourceLine })] }), jobFailed: true }),
            },
        ];
        const SHAPES = [
            { sourceLine: '2 cups', names: [] as string[], why: 'a measure with no food' },
            { sourceLine: '2 cups:', names: [], why: 'a measure ending in a colon' },
            { sourceLine: 'For the dough:', names: [], why: 'a heading' },
            { sourceLine: 'For the dough :', names: [], why: 'a heading with a space before its colon' },
            { sourceLine: '  For the filling:  ', names: [], why: 'a heading with whitespace around it' },
            {
                sourceLine: 'Salt: to taste',
                names: ['Salt: to taste'],
                why: 'a colon inside the line is not a heading',
            },
            { sourceLine: '2 cups flour', names: ['flour'], why: 'a measure and a food' },
        ];

        it.each(PATHS.flatMap(({ path, at }) => SHAPES.map((shape) => ({ path, at, ...shape }))))(
            '$path: "$sourceLine" ($why)',
            ({ at, sourceLine, names }) => {
                const [line] = pastedLinesOf(at(sourceLine));

                expect(line?.kind).toBe('settled');
                expect(line?.kind === 'settled' ? line.rows.map((row) => row.name) : undefined).toEqual(names);
            },
        );
    });

    /**
     * REWRITTEN (plan 2026-10-15-011): this used to assert a retryable line keeps reading because it "may still land on
     * its own". Since the worker claims only a `pending` line, it almost never does, so it waits on the cook instead.
     */
    it('⛔ a retryable line awaits the cook, whatever the job status says', () => {
        for (const status of ['partial', 'running'] as const) {
            const job = makeParseJob({
                status,
                lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying', status: 'failed_retryable' })],
            });

            expect(pastedLinesOf(input({ job }))).toEqual([
                { kind: 'awaitingCook', lineIndex: 0, sourceLine: '2 tbsp olive oil, for frying', cause: 'retryable' },
            ]);
        }
    });

    it.each([
        { why: 'a stalled line', line: makeParseJobLine({ progress: { phase: 'stalled' } }) },
        { why: 'a retryable line', line: makeParseJobLine({ status: 'failed_retryable' }) },
        { why: 'a line still being read', line: makeParseJobLine({ progress: { phase: 'reading' } }) },
        {
            why: "⛔ a line whose parse landed after the cook chose — the cook's choice wins",
            line: makeParseJobLine({ status: 'parsed', proposal: makeParseProposal() }),
        },
    ])('$why the cook chose to add as written settles through the reader', ({ line }) => {
        const job = makeParseJob({ lines: [{ ...line, sourceLine: '2 tbsp olive oil, for frying' }] });

        expect(pastedLinesOf(input({ job, typedByCook: new Set([0]) }))).toEqual([
            { kind: 'settled', lineIndex: 0, sourceLine: '2 tbsp olive oil, for frying', rows: [OLIVE_OIL_FALLBACK] },
        ]);
    });

    it("the cook's choice for one line leaves the others alone", () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({ lineIndex: 0, sourceLine: '2 tbsp olive oil, for frying' }),
                makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
            ],
        });

        expect(pastedLinesOf(input({ job, typedByCook: new Set([0]) })).map((line) => line.kind)).toEqual([
            'settled',
            'awaitingCook',
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
