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
import { pastedLinesOf, readerLinesOf, type PastedLinesInput } from '../pastedLines.js';

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
                        foodIndex: 0,
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
            {
                name: 'salt',
                measure: { quantity: ABSENT_QUANTITY, unit: '', preparation: '' },
                sourcePhrase: 'salt',
                foodIndex: 0,
            },
            {
                name: 'pepper',
                measure: { quantity: ABSENT_QUANTITY, unit: '', preparation: '' },
                sourcePhrase: 'pepper',
                foodIndex: 1,
            },
        ]);
    });

    it('a line naming two foods and no amount: both carry its words ("salt and pepper to taste")', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine: 'salt and pepper to taste',
                    status: 'parsed',
                    proposal: makeParseProposal({
                        quantity: ABSENT_QUANTITY,
                        unit: 'to taste',
                        statedMeasure: 'to taste',
                        foods: [makeParseProposalFood({ name: 'salt' }), makeParseProposalFood({ name: 'pepper' })],
                    }),
                }),
            ],
        });
        const [line] = pastedLinesOf(input({ job }));

        expect(line?.kind === 'settled' ? line.rows.map((row) => [row.name, row.measure.unit]) : []).toEqual([
            ['salt', 'to taste'],
            ['pepper', 'to taste'],
        ]);
    });

    it('⛔ a reader row carries no foodIndex: it has no proposal food, so no match, and joins as written', () => {
        const job = makeParseJob({
            lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil', status: 'unparseable', proposal: null })],
        });
        const [line] = pastedLinesOf(input({ job }));
        const rows = line?.kind === 'settled' ? line.rows : [];

        expect(rows).toHaveLength(1);
        expect(rows[0]).not.toHaveProperty('foodIndex');
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
     * Dogfooding PR 132: "3 large eggs" read "3 eggs". The parse keeps a leading size word in the food's name (`large
     * eggs`, no unit), and the matched catalog food names the line, so "large" vanished. ADR-0026 §8: a size word is a
     * unit. The row takes it as its unit and keeps the rest as its name; the phrase the parse lifted stays whole, as the
     * memo key.
     */
    it('a counted line takes its leading size word as the unit', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine: '3 large eggs',
                    status: 'parsed',
                    proposal: makeParseProposal({
                        quantity: { kind: 'exact', value: 3 },
                        unit: null,
                        statedMeasure: '3',
                        foods: [makeParseProposalFood({ name: 'large eggs', prep: null })],
                    }),
                }),
            ],
        });
        const [settled] = pastedLinesOf(input({ job }));

        expect(settled?.kind === 'settled' ? settled.rows : undefined).toEqual([
            {
                name: 'eggs',
                measure: { quantity: { kind: 'exact', value: 3 }, unit: 'large', preparation: '' },
                sourcePhrase: 'large eggs',
                foodIndex: 0,
            },
        ]);
    });

    /** Owner ruling 2026-11-06: a form the cook buys is part of the row's name, never its preparation. */
    it('keeps `dried` in the row’s name', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine: '1 tsp dried thyme',
                    status: 'parsed',
                    proposal: makeParseProposal({
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'teaspoon',
                        statedMeasure: '1 tsp',
                        foods: [makeParseProposalFood({ name: 'dried thyme', prep: null })],
                    }),
                }),
            ],
        });
        const [settled] = pastedLinesOf(input({ job }));

        expect(settled?.kind === 'settled' ? settled.rows[0] : undefined).toMatchObject({
            name: 'dried thyme',
            measure: { preparation: '' },
            sourcePhrase: 'dried thyme',
        });
    });

    /**
     * Owner ruling 2026-11-06: `whipped` before the food is part of the row's name, after the comma it is the row's
     * preparation. The typed reader (`leadingMeasure.test.ts`) answers the same two lines the same way.
     */
    it.each([
        ['1 cup whipped cream', 'whipped cream', null, 'whipped cream', ''],
        ['1 cup heavy cream, whipped', 'heavy cream', 'whipped', 'heavy cream', 'whipped'],
    ] as const)(
        'keeps %j as the name %j and the preparation %j',
        (sourceLine, name, prep, sourcePhrase, preparation) => {
            const job = makeParseJob({
                lines: [
                    makeParseJobLine({
                        sourceLine,
                        status: 'parsed',
                        proposal: makeParseProposal({
                            quantity: { kind: 'exact', value: 1 },
                            unit: 'cup',
                            statedMeasure: '1 cup',
                            foods: [makeParseProposalFood({ name, prep })],
                        }),
                    }),
                ],
            });
            const [settled] = pastedLinesOf(input({ job }));

            expect(settled?.kind === 'settled' ? settled.rows[0] : undefined).toMatchObject({
                name,
                measure: { preparation },
                sourcePhrase,
            });
        },
    );

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

/**
 * 004 FR-022: a paste past the daily allowance is refused with no parse job, so nothing is parsed or matched. Every line
 * the cook pasted still joins, AS WRITTEN, through the add field's own reader.
 */
describe('readerLinesOf (the lines of a paste the daily limit refused)', () => {
    it('settles every line through the reader, in paste order, indexed from 0', () => {
        const lines = readerLinesOf(['2 tbsp olive oil, for frying', 'salt']);

        expect(lines.map((line) => [line.kind, line.lineIndex, line.sourceLine])).toEqual([
            ['settled', 0, '2 tbsp olive oil, for frying'],
            ['settled', 1, 'salt'],
        ]);
        expect(lines[0]?.kind === 'settled' ? lines[0].rows : []).toEqual([OLIVE_OIL_FALLBACK]);
    });

    it('⛔ claims no parsed phrase and no food index: no engine read the line, and there is no match to find', () => {
        const [line] = readerLinesOf(['2 tbsp olive oil']);
        const [row] = line?.kind === 'settled' ? line.rows : [];

        expect(row).not.toHaveProperty('sourcePhrase');
        expect(row).not.toHaveProperty('foodIndex');
    });

    it('a heading, and a measure alone, name no food on this path either', () => {
        const lines = readerLinesOf(['For the sauce:', '2 cups']);

        expect(lines.map((line) => (line.kind === 'settled' ? line.rows : undefined))).toEqual([[], []]);
    });
});

describe('pastedLinesOf - the cook’s words and the note are carried, not dropped (design answers 2026-11-08)', () => {
    const rowsOfLine = (
        sourceLine: string,
        display: 'written' | 'food' | null,
        name: string,
        prep: string | null = null,
    ) => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    sourceLine,
                    status: 'parsed',
                    proposal: makeParseProposal({
                        raw: sourceLine,
                        statedMeasure: null,
                        quantity: { kind: 'exact', value: 1 },
                        unit: null,
                        foods: [makeParseProposalFood({ name, prep, ...(display === null ? {} : { display }) })],
                    }),
                }),
            ],
        });
        const [line] = pastedLinesOf(input({ job }));

        return line?.kind === 'settled' ? line.rows : [];
    };

    it('a food the parse answered "written" keeps the cook’s words as displayText', () => {
        const [row] = rowsOfLine('1 pound sweet Italian sausage', 'written', 'sweet Italian sausage');

        expect(row).toMatchObject({ name: 'sweet Italian sausage', displayText: 'sweet Italian sausage' });
    });

    it.each(['food', null] as const)('a food the parse answered %s has no displayText', (display) => {
        const [row] = rowsOfLine('2 eggs', display, 'eggs');

        expect(row).toBeDefined();
        expect(row).not.toHaveProperty('displayText');
    });

    it('a dimension in parentheses is the row’s note, and is not the unit', () => {
        const [row] = rowsOfLine('1 (9 inch) unbaked pie crust', 'food', 'unbaked pie crust');

        expect(row).toMatchObject({ note: '9 inch' });
        expect(row?.measure.unit).not.toContain('9 inch');
    });

    it('a package size stays in the unit as the cook wrote it, and is no note', () => {
        const [row] = rowsOfLine('1 (28 ounce) can crushed tomatoes', 'food', 'crushed tomatoes');

        expect(row?.measure.unit).toContain('(28 ounce) can');
        expect(row).not.toHaveProperty('note');
    });

    it('a reader row (no parse) has neither', () => {
        const [row] = readerLinesOf(['2 tbsp olive oil']).flatMap((line) => (line.kind === 'settled' ? line.rows : []));

        expect(row).not.toHaveProperty('displayText');
        expect(row).not.toHaveProperty('note');
    });
});
